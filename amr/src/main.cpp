
#include <Arduino.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <WiFiManager.h>

// =======================================================================================
//   AMR FIRMWARE - STANDARD LOGIC "CW = FORWARD"
// =======================================================================================
//   RULE 1: Positive Velocity (>0) ==> Motor spins CLOCKWISE (CW) ==> Robot
//   moves FORWARD RULE 2: Encoder turns CW ==> Ticks INCREASE (++)
//
//   HARDWARE SETUP INSTRUCTIONS:
//   1. Lift robot off ground.
//   2. Send "Forward" command.
//      - If Wheel spins CCW (Backward) -> SWAP MOTOR WIRES (IN1 <-> IN2).
//   3. Check Ticks in App.
//      - If Wheel spins Forward (CW) but Ticks DECREASE -> SWAP ENCODER WIRES
//      (A <-> B).
// =======================================================================================

// PIN DEFINITIONS
#define MOTOR_LEFT_EN 19
#define MOTOR_LEFT_IN1 5
#define MOTOR_LEFT_IN2 18

#define MOTOR_RIGHT_EN 27
#define MOTOR_RIGHT_IN3 26
#define MOTOR_RIGHT_IN4 25

#define ENCODER_LEFT_A 32
#define ENCODER_LEFT_B 33
#define ENCODER_RIGHT_A 17
#define ENCODER_RIGHT_B 16

// CONFIGURABLE PARAMETERS
float WHEEL_RADIUS = 0.033f;     // Meters
float WHEEL_SEPARATION = 0.170f; // Meters
int TICKS_PER_REV = 333;         // Ticks per revolution

// ENCODER VARIABLES
volatile long leftTicks = 0;
volatile long rightTicks = 0;
volatile int lastEncodedLeft = 0;
volatile int lastEncodedRight = 0;

// INVERSION FLAGS - HARDCODED (phụ thuộc dây cáp vật lý, KHÔNG cho app đổi)
// Back-to-back: 1 motor invert, 1 không. Encoder invert theo hướng đếm thực tế.
bool invertLeftEncoder = true;
bool invertRightEncoder = false;
bool invertLeftMotor = true; // PID feedback: must match encoder inversion
bool invertRightMotor = true;

// CONTROL VARIABLES
float targetLeftVel = 0;  // rad/s
float targetRightVel = 0; // rad/s
long prevT = 0;
long lastTicksL = 0;
long lastTicksR = 0;
unsigned long lastCmdTime = 0; // Failsafe timeout

// CONFIGURABLE MOTOR PARAMS (tunable from app)
// !! GHI CHÚ: DEADBAND OFFSET !!
// Motor cần ~55 PWM để vượt ma sát tĩnh. minPWM được CỘNG vào PID output
// (offset), không phải nhảy bậc (threshold), để PID hoạt động
// trong vùng tuyến tính của motor.
// Dải động cơ: (255-55)=200 PWM cho 75 rad/s → ff = 200/75 ≈ 2.7
float ffGain = 2.5f; // Feedforward gain (for linear range above deadband)
// Bánh trái luôn chạy bốc hơn, ta giảm sức mạnh cơ bản của nó xuống 8%
float ffGainLeft = 2.3f;
int minPWM = 55;                // Deadband offset (cộng trong setMotor)
unsigned long cmdTimeout = 500; // Failsafe timeout ms

// Last PWM values for telemetry
float lastPwmLeft = 0;
float lastPwmRight = 0;

// TARGET VELOCITY & FEATURE TOGGLES
float vL_meas = 0;
float vR_meas = 0;

// STALL & BOOST VARIABLES
unsigned long stallStartTime = 0;
const int STALL_BOOST =
    50; // Extra PWM to break stiction (increased for reliability)

float Kp = 3.0f;
float Ki =
    5.0f; // Increased to fix steady-state velocity mismatch between motors
float errLeft_prev = 0;
float errRight_prev = 0;
float intLeft = 0;
float intRight = 0;

// MOTION START
unsigned long motionStartTime = 0;
bool wasMoving = false;

// STRAIGHT-LINE COMPENSATION (Virtual Axle)
// Dùng Kp rất lớn để "khoá" cứng 2 trục lại với nhau ngay từ lúc khởi động.
float Kp_straight = 1.5f;   // Rất mạnh ngấu nghiến sai lệch encoder
float Ki_straight = 0.05f;  // Bù dài hạn
float straightIntegral = 0; // Integral of tick error
long straightBaseL = 0;     // Encoder baseline when straight started
long straightBaseR = 0;
bool wasStraight = false;         // Previous straight state
float lastStraightCorrection = 0; // For telemetry

// ODOMETRY STATE
float robotX = 0;
float robotY = 0;
float robotTheta = 0;
float robotDistance = 0;
unsigned long lastTelemetryTime = 0;

WebServer server(80);
WebSocketsServer webSocket(81);

// ============================================================
//   INTERRUPT SERVICE ROUTINES (ISRs)
// ============================================================
// Standard Quadrature Decoding
// IF A leads B ==> CW ==> Increment
void IRAM_ATTR leftISR() {
  int MSB = digitalRead(ENCODER_LEFT_A);
  int LSB = digitalRead(ENCODER_LEFT_B);
  int encoded = (MSB << 1) | LSB;
  int sum = (lastEncodedLeft << 2) | encoded;

  // 0b1101, 0b0100, 0b0010, 0b1011 ==> CW ==> ++
  if (sum == 0b1101 || sum == 0b0100 || sum == 0b0010 || sum == 0b1011) {
    invertLeftEncoder ? leftTicks-- : leftTicks++;
  }
  // 0b1110, 0b0111, 0b0001, 0b1000 ==> CCW ==> --
  else if (sum == 0b1110 || sum == 0b0111 || sum == 0b0001 || sum == 0b1000) {
    invertLeftEncoder ? leftTicks++ : leftTicks--;
  }
  lastEncodedLeft = encoded;
}

void IRAM_ATTR rightISR() {
  int MSB = digitalRead(ENCODER_RIGHT_A);
  int LSB = digitalRead(ENCODER_RIGHT_B);
  int encoded = (MSB << 1) | LSB;
  int sum = (lastEncodedRight << 2) | encoded;

  if (sum == 0b1101 || sum == 0b0100 || sum == 0b0010 || sum == 0b1011) {
    invertRightEncoder ? rightTicks-- : rightTicks++;
  } else if (sum == 0b1110 || sum == 0b0111 || sum == 0b0001 || sum == 0b1000) {
    invertRightEncoder ? rightTicks++ : rightTicks--;
  }
  lastEncodedRight = encoded;
}

// ============================================================
//   MOTOR CONTROL
// ============================================================
// u > 0 ==> CW (Forward)
// u < 0 ==> CCW (Backward)
void setMotor(int pinIN1, int pinIN2, int pinPWM, int pwmChannel, float u) {
  int pwr = (int)fabs(u);

  if (pwr > 255)
    pwr = 255;

  if (u > 0) {
    // FORWARD / CW
    digitalWrite(pinIN1, HIGH);
    digitalWrite(pinIN2, LOW);
  } else if (u < 0) {
    // BACKWARD / CCW
    digitalWrite(pinIN1, LOW);
    digitalWrite(pinIN2, HIGH);
  } else {
    // STOP
    digitalWrite(pinIN1, LOW);
    digitalWrite(pinIN2, LOW);
  }

  ledcWrite(pwmChannel, pwr);
}

// ============================================================
//   SETUP
// ============================================================
void setup() {
  Serial.begin(115200);

  // 1. Motor Pins
  pinMode(MOTOR_LEFT_IN1, OUTPUT);
  pinMode(MOTOR_LEFT_IN2, OUTPUT);
  pinMode(MOTOR_RIGHT_IN3, OUTPUT);
  pinMode(MOTOR_RIGHT_IN4, OUTPUT);

  // 2. PWM Setup
  ledcSetup(0, 20000, 8); // Ch 0, 20kHz, 8-bit
  ledcAttachPin(MOTOR_LEFT_EN, 0);
  ledcSetup(2, 20000, 8); // Ch 2
  ledcAttachPin(MOTOR_RIGHT_EN, 2);

  // 3. Encoder Pins
  pinMode(ENCODER_LEFT_A, INPUT_PULLUP);
  pinMode(ENCODER_LEFT_B, INPUT_PULLUP);
  pinMode(ENCODER_RIGHT_A, INPUT_PULLUP);
  pinMode(ENCODER_RIGHT_B, INPUT_PULLUP);

  attachInterrupt(digitalPinToInterrupt(ENCODER_LEFT_A), leftISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_LEFT_B), leftISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_RIGHT_A), rightISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_RIGHT_B), rightISR, CHANGE);

  // 4. WiFi & MDNS
  WiFiManager wm;
  wm.autoConnect("AMR_Robot_AP");

  if (MDNS.begin("amr")) {
    Serial.println("MDNS Started: amr.local");
    MDNS.addService("http", "tcp", 80);
    MDNS.addService("ws", "tcp", 81);
  }

  // 4.1 OTA Setup
  ArduinoOTA.setHostname("amr-robot");
  ArduinoOTA.onStart([]() { Serial.println("OTA Start"); });
  ArduinoOTA.onEnd([]() { Serial.println("\nOTA End"); });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("Progress: %u%%\r", (progress / (total / 100)));
  });
  ArduinoOTA.onError(
      [](ota_error_t error) { Serial.printf("Error[%u]: ", error); });
  ArduinoOTA.begin();

  // 5. WebSocket
  webSocket.begin();
  webSocket.onEvent(
      [](uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
        if (type == WStype_TEXT) {
          JsonDocument doc;
          deserializeJson(doc, payload);

          // CMD: RESET
          if (doc["cmd"] == "reset_odom") {
            robotX = 0;
            robotY = 0;
            robotTheta = 0;
            robotDistance = 0;
            leftTicks = 0;
            rightTicks = 0;
            lastTicksL = 0;
            lastTicksR = 0;

            targetLeftVel = 0;
            targetRightVel = 0;
            intLeft = 0;
            intRight = 0;
            errLeft_prev = 0;
            errRight_prev = 0;

            // Reset sync
            straightIntegral = 0;
            straightBaseL = 0;
            straightBaseR = 0;
            wasStraight = false;
            lastStraightCorrection = 0;
          }

          // CMD: TEST SPEED
          if (doc["cmd"] == "test_7rad") {
            targetLeftVel = 7.0f;
            targetRightVel = 7.0f;
            lastCmdTime = millis();
          }

          // CMD: CONFIG
          if (doc["type"] == "config") {
            if (doc["ticks_per_rev"].is<int>())
              TICKS_PER_REV = doc["ticks_per_rev"];
            if (doc["wheel_width"].is<float>())
              WHEEL_SEPARATION = doc["wheel_width"];
            if (doc["wheel_radius"].is<float>())
              WHEEL_RADIUS = doc["wheel_radius"];

            if (doc["kp"].is<float>())
              Kp = doc["kp"];
            if (doc["ki"].is<float>())
              Ki = doc["ki"];
            if (doc["kd"].is<float>()) {
              // Kd is disabled for this robot
            }

            // INVERSION FLAGS: Bỏ qua hoàn toàn từ app.
            // Encoder/motor inversion phụ thuộc dây cáp vật lý,
            // đã hardcode ở đầu file. App gửi sai sẽ phá hệ thống.

            // Pure motor tuning params
            if (doc["ff_gain"].is<float>()) {
              ffGain = doc["ff_gain"];
              ffGainLeft = ffGain * 0.92f; // Left wheel bias (8% reduction)
            }
            if (doc["min_pwm"].is<int>())
              minPWM = doc["min_pwm"];
            if (doc["cmd_timeout"].is<int>())
              cmdTimeout = doc["cmd_timeout"];

            // Straight-line compensation params
            if (doc["kp_straight"].is<float>())
              Kp_straight = doc["kp_straight"];
            if (doc["ki_straight"].is<float>())
              Ki_straight = doc["ki_straight"];
          }

          if (doc["linear"].is<float>()) {
            float v_app = doc["linear"];  // m/s (App Forward > 0)
            float w_app = doc["angular"]; // rad/s (App Left > 0)

            // INVERSION FOR APP CONVENTION:
            // Phục hồi lại dấu trừ: Xe nhận lệnh v < 0 để đi thẳng
            // (vì quy ước phần cứng Odometry).
            float v = -v_app;
            float w = -w_app;

            // Kinematics: Convert v, w to wheel speeds (rad/s)
            targetLeftVel = (v - w * WHEEL_SEPARATION / 2.0f) / WHEEL_RADIUS;
            targetRightVel = (v + w * WHEEL_SEPARATION / 2.0f) / WHEEL_RADIUS;
            lastCmdTime = millis(); // Reset timeout
          }
        }
      });

  server.begin();
  prevT = micros();
  Serial.println("AMR IP: " + WiFi.localIP().toString());
}

// ============================================================
//   MAIN LOOP
// ============================================================
void loop() {
  ArduinoOTA.handle();
  webSocket.loop();
  server.handleClient();

  // 0. SAFETY FAILSAFE (Timeout)
  if (millis() - lastCmdTime > cmdTimeout) {
    targetLeftVel = 0;
    targetRightVel = 0;
  }

  long currT = micros();
  float deltaT = ((float)(currT - prevT)) / 1.0e6f;

  if (deltaT >= 0.02f) { // 50Hz Control Loop
    prevT = currT;

    // 1. READ ENCODERS (Atomic)
    noInterrupts();
    long cL = leftTicks;
    long cR = rightTicks;
    interrupts();

    // 2. CALCULATE VELOCITIES
    vL_meas = (float)(cL - lastTicksL) / TICKS_PER_REV * 2.0f * PI / deltaT;
    vR_meas = (float)(cR - lastTicksR) / TICKS_PER_REV * 2.0f * PI / deltaT;

    lastTicksL = cL;
    lastTicksR = cR;

    // 2.5 TARGET VELOCITIES
    float targetL = targetLeftVel;
    float targetR = targetRightVel;

    // 3. ODOMETRY (Forward Kinematics)
    // Robot Velocity
    float v_robot = (vR_meas + vL_meas) / 2.0f * WHEEL_RADIUS;
    float w_robot;

    // Khi Virtual Axle đang active (xe đi thẳng), force w=0 để tránh
    // tích lũy sai số theta do dao động vận tốc tức thời giữa 2 bánh.
    // Encoder ticks bằng nhau → xe đang thẳng → không có vận tốc góc.
    if (wasStraight) {
      w_robot = 0;
    } else {
      w_robot = (vR_meas - vL_meas) * WHEEL_RADIUS / WHEEL_SEPARATION;
    }

    // Pose Integration
    float dist = v_robot * deltaT;
    robotDistance += fabs(dist);
    robotTheta += w_robot * deltaT;
    // Normalize Theta (-PI to PI)
    robotTheta = atan2(sin(robotTheta), cos(robotTheta));

    robotX += dist * cos(robotTheta);
    robotY += dist * sin(robotTheta);

    // 4. MOTION START TRACKING (must be before PID and Virtual Axle)
    bool isMoving = (fabs(targetL) > 0.1f || fabs(targetR) > 0.1f);
    if (isMoving && !wasMoving) {
      motionStartTime = millis();
      intLeft = 0;
      intRight = 0;
    }
    wasMoving = isMoving;
    unsigned long motionAge = millis() - motionStartTime;

    // 4.1 STRAIGHT-LINE COMPENSATION (Cross-Coupled Control)
    // Thay vì chỉnh Target Velocity (bị PID nội bộ làm mờ),
    // chúng ta tính lực bù trực tiếp trên PWM để khóa chặt 2 bánh.
    bool isStraight = (fabs(targetLeftVel - targetRightVel) < 0.05f) &&
                      (fabs(targetLeftVel) > 0.05f);

    float pwmCorrectionL = 0;
    float pwmCorrectionR = 0;

    if (isStraight && motionAge > 500) {
      if (!wasStraight) {
        straightBaseL = cL;
        straightBaseR = cR;
        straightIntegral = 0;
        stallStartTime = 0;
      }

      // 1. Tính TỔNG QUÃNG ĐƯỜNG TUYỆT ĐỐI (từ lúc bắt đầu đi thẳng)
      // Dùng fabs() để bỏ qua hướng âm/dương của xe tịnh tiến
      float distL_abs = fabs((float)(cL - straightBaseL));
      float distR_abs = fabs((float)(cR - straightBaseR));

      // 2. TÍNH SAI SỐ
      // Nếu error > 0 => Trái đi XA HƠN Phải
      // Nếu error < 0 => Trái đi GẦN HƠN Phải
      float error_ticks = distL_abs - distR_abs;
      float error_rad = error_ticks / TICKS_PER_REV * 2.0f * PI;

      // Stall detection
      bool oneStalled = (fabs(vL_meas) < 0.2f && fabs(vR_meas) > 1.0f) ||
                        (fabs(vR_meas) < 0.2f && fabs(vL_meas) > 1.0f);
      if (oneStalled) {
        if (stallStartTime == 0)
          stallStartTime = millis();
        if (millis() - stallStartTime > 200) {
          straightBaseL = cL;
          straightBaseR = cR;
          straightIntegral = 0;
          stallStartTime = millis();
        }
      } else {
        stallStartTime = 0;
      }

      // Tích phân dựa trên error
      straightIntegral += error_rad * deltaT;
      // Tháo giới hạn hoàn toàn để nó có thể cộng dồn tùy ý nếu xe vẫn lệch
      straightIntegral = constrain(straightIntegral, -255.0f, 255.0f);

      // 3. TÍNH ĐỘ LỚN CỦA LỰC BÙ
      float correctionMagnitude = (Kp_straight * 50.0f) * error_rad +
                                  (Ki_straight * 50.0f) * straightIntegral;

      // Cho phép lực bù TỐI ĐA (lên tới 200 PWM) nếu 2 bánh bị lệch nheieuf
      correctionMagnitude = constrain(correctionMagnitude, -200.0f, 200.0f);

      // Phân bổ lực bù: Trái chịu nửa, Phải chịu nửa (ngược dấu)
      pwmCorrectionL = -correctionMagnitude; // Trái nhanh thì trừ PWM trái
      pwmCorrectionR = correctionMagnitude;  // Phải chậm thì cộng PWM phải

      lastStraightCorrection = correctionMagnitude; // for telemetry
    } else {
      straightIntegral = 0;
      lastStraightCorrection = 0;
      straightBaseL = cL;
      straightBaseR = cR;
    }
    wasStraight = (isStraight && motionAge > 500);

    // 4.2 MOTOR CONTROL (Closed Loop PI + Feedforward)
    // MASTER-SLAVE CONTROL

    // Luôn tính PID cho bánh PHẢI (MASTER)
    float errRight = targetR - vR_meas;
    intRight += errRight * deltaT;
    intRight = constrain(intRight, -255.0f, 255.0f);

    float pwmRight = 0;
    if (fabs(targetR) < 0.01f) {
      pwmRight = 0;
      intRight = 0;
      errRight = 0;
    } else {
      pwmRight = (targetR * ffGain) + (Kp * errRight) + (Ki * intRight);
      // Clamp to max 255 BEFORE compensation to allow Virtual Axle to reduce
      // power
      pwmRight = constrain(pwmRight, -255.0f, 255.0f);
    }

    float pwmLeft = 0;
    float errLeft = 0;

    // --- CHẾ ĐỘ ĐI ĐƯỜNG TRÒN / XOAY TẠI CHỖ ---
    if (!isStraight || motionAge <= 500) {
      // Dùng PID nội bộ cho bánh TRÁI như bình thường
      errLeft = targetL - vL_meas;
      intLeft += errLeft * deltaT;
      intLeft = constrain(intLeft, -255.0f, 255.0f);
      if (fabs(targetL) < 0.01f) {
        pwmLeft = 0;
        intLeft = 0;
        errLeft = 0;
      } else {
        pwmLeft = (targetL * ffGainLeft) + (Kp * errLeft) + (Ki * intLeft);
        pwmLeft = constrain(pwmLeft, -255.0f, 255.0f);
      }
    }
    // --- CHẾ ĐỘ ĐI ĐƯỜNG THẲNG (MASTER-SLAVE) ---
    else {
      // Bánh trái (SLAVE) sẽ "nhắm mắt" làm theo bánh phải (MASTER),
      // chỉ tính bù sai số Ticks (Virtual Axle)

      // Xóa bộ nhớ PID của Bánh Trái để không bị dồn khi nghỉ chạy
      intLeft = 0;
      errLeft = targetL - vL_meas; // Chỉ dùng cho telemetry

      // 1. Lấy "ga" cơ bản từ Đại Ka (Bánh Phải), nhân thêm hệ số bù cơ khí của
      // Đàn Em
      pwmLeft = pwmRight * (ffGainLeft / ffGain);

      // 2. NHẬN LỰC BÙ TỪ VIRTUAL AXLE
      // Nếu pwmLeft đang > 0 (quay dương) và error_rad > 0 (Trái chạy lẹ hơn)
      // -> pwmCorrectionL Âm -> Cần trừ đi để pwmLeft NHỎ ĐI DẦN -> GIẢM TỐC.
      // Dùng hàm sign để chắc chắn luôn "thắng" được bánh Trái:
      float signL = (pwmLeft >= 0) ? 1.0f : -1.0f;
      pwmLeft += signL * pwmCorrectionL;
    }

    errLeft_prev = errLeft;
    errRight_prev = errRight;

    // DEAD-BAND COMPENSATION & STICTION BOOST
    if (targetL > 0.01f) {
      pwmLeft += minPWM;
      if (vL_meas < 0.2f && targetL > 1.0f)
        pwmLeft += STALL_BOOST;
    } else if (targetL < -0.01f) {
      pwmLeft -= minPWM;
      if (vL_meas > -0.2f && targetL < -1.0f)
        pwmLeft -= STALL_BOOST;
    }

    if (targetR > 0.01f) {
      pwmRight += minPWM;
      if (vR_meas < 0.2f && targetR > 1.0f)
        pwmRight += STALL_BOOST;
    } else if (targetR < -0.01f) {
      pwmRight -= minPWM;
      if (vR_meas > -0.2f && targetR < -1.0f)
        pwmRight -= STALL_BOOST;
    }

    // Store PWM for telemetry (after all adjustments, before inversion)
    lastPwmLeft = pwmLeft;
    lastPwmRight = pwmRight;

    // Apply motor inversion
    if (invertLeftMotor)
      pwmLeft = -pwmLeft;
    if (invertRightMotor)
      pwmRight = -pwmRight;

    // PID có toàn quyền điều khiển motor mà không bị chặn hay giật ngược.
    setMotor(MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, MOTOR_LEFT_EN, 0, pwmLeft);
    setMotor(MOTOR_RIGHT_IN3, MOTOR_RIGHT_IN4, MOTOR_RIGHT_EN, 2, pwmRight);

    // 5. TELEMETRY (5Hz)
    if (millis() - lastTelemetryTime > 200) {
      lastTelemetryTime = millis();
      JsonDocument doc;
      doc["telem"] = true;
      doc["vx"] = -v_robot;       // NEGATE for App
      doc["wz"] = -w_robot;       // NEGATE for App
      doc["theta"] = -robotTheta; // NEGATE for App
      doc["d"] = robotDistance;
      doc["x"] = -robotX; // NEGATE for App
      doc["y"] = -robotY; // NEGATE for App

      // 1. Calculate base rounded values
      long rounded_cL = round((float)cL / 1000.0f) * 1000;
      long rounded_cR = round((float)cR / 1000.0f) * 1000;

      // 2. Snap-to-Sync: If in straight mode and physical diff < 1000 ticks (~3
      // wheel revs), force them to match to avoid the ±1000 quantization
      // flicker in display/logs.
      if (wasStraight && abs(cL - cR) < 1000) {
        long avg = (cL + cR) / 2;
        long common = round((float)avg / 1000.0f) * 1000;
        rounded_cL = common;
        rounded_cR = common;
      }

      JsonObject enc = doc["enc"].to<JsonObject>();
      enc["l"] = -rounded_cL; // NEGATE for App
      enc["r"] = -rounded_cR; // NEGATE for App

      // === PID Tuning Data ===
      // Negate these so the app plots positive velocities for forward
      doc["vL_t"] = -targetLeftVel;
      doc["vR_t"] = -targetRightVel;
      doc["vL_r"] = -vL_meas;
      doc["vR_r"] = -vR_meas;

      // === PWM Monitor ===
      doc["pwmL"] = (int)lastPwmLeft;
      doc["pwmR"] = (int)lastPwmRight;

      // Straight-line compensation telemetry
      doc["tickErr"] = (cL - straightBaseL) - (cR - straightBaseR);
      doc["sCor"] = lastStraightCorrection;

      String output;
      serializeJson(doc, output);
      webSocket.broadcastTXT(output);

      // DEBUG: Print to Serial Monitor
      Serial.printf("L_Ticks: %ld | R_Ticks: %ld | vL: %.2f | vR: %.2f%s\n",
                    rounded_cL, rounded_cR, vL_meas, vR_meas,
                    wasStraight ? " [VA: ACTIVE]" : "");
    }
  }
}
