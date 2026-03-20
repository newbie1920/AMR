
#include <Arduino.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <WiFiManager.h>
#include <Wire.h>

// =======================================================================================
//   AMR FIRMWARE — IMU + ENCODER FUSION
// =======================================================================================
//   Bản nâng cấp từ main.cpp:
//   - Encoder: Xác định tọa độ (x, y) và quãng đường.
//   - MPU6050 Gyroscope: Xác định góc quay (theta) chính xác hơn encoder.
//   - Complementary Filter: Kết hợp cả 2 nguồn dữ liệu.
//     theta_fused = ALPHA * gyro_theta + (1 - ALPHA) * encoder_theta
//
//   Lý do: Encoder bị trượt bánh khi xoay tại chỗ/xoay nhanh → sai góc.
//          Gyroscope cung cấp vận tốc góc trực tiếp, không bị ảnh hưởng
//          bởi trượt bánh, nhưng tích phân lâu sẽ bị drift.
//          → Dùng Complementary Filter: Gyro ngắn hạn + Encoder dài hạn.
//
//   HARDWARE: MPU6050 qua I2C (SDA=21, SCL=22 trên ESP32)
//
//   RULE 1: Positive Velocity (>0) ==> Motor spins CLOCKWISE (CW) ==> FORWARD
//   RULE 2: Encoder turns CW ==> Ticks INCREASE (++)
// =======================================================================================

// ─── PIN DEFINITIONS ─────────────────────────────────────────────────────────
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

// MPU6050 I2C Pins (ESP32 default)
#define IMU_SDA 21
#define IMU_SCL 22
#define MPU6050_ADDR 0x68

// ─── CONFIGURABLE PARAMETERS ─────────────────────────────────────────────────
float WHEEL_RADIUS = 0.033f;     // Meters
float WHEEL_SEPARATION = 0.170f; // Meters
int TICKS_PER_REV = 1665;        // Encoder ticks per revolution

// ─── IMU FUSION PARAMETERS ───────────────────────────────────────────────────
// Complementary Filter: theta = ALPHA * gyro + (1-ALPHA) * encoder
// ALPHA cao → tin gyro nhiều hơn (chính xác khi xoay, nhưng drift dài hạn)
// ALPHA thấp → tin encoder nhiều hơn (ổn định dài hạn, nhưng sai khi trượt)
float COMP_FILTER_ALPHA = 0.95f; // 95% gyro, 5% encoder (gyro rất tốt ngắn hạn)

// Gyroscope calibration (bias offset — tính trung bình khi robot đứng yên)
float gyroZBias = 0;
bool gyroCalibrated = false;
int gyroCalSamples = 0;
float gyroCalSum = 0;
const int GYRO_CAL_COUNT = 500; // Số mẫu để calibrate (~ 1 giây)

// IMU raw data
float gyroZ_raw = 0;       // Vận tốc góc từ gyroscope (rad/s)
float gyroTheta = 0;       // Góc tích phân từ gyroscope (rad)
float encoderTheta = 0;    // Góc tích phân từ encoder (rad)
float fusedTheta = 0;      // Góc sau fusion (rad) — ĐÂY LÀ GÓC CHÍNH
bool imuAvailable = false; // MPU6050 có kết nối không?

// ─── ENCODER VARIABLES ───────────────────────────────────────────────────────
volatile long leftTicks = 0;
volatile long rightTicks = 0;
volatile int lastEncodedLeft = 0;
volatile int lastEncodedRight = 0;

// ─── INVERSION FLAGS ─────────────────────────────────────────────────────────
bool invertLeftEncoder = true;
bool invertRightEncoder = true;
bool invertLeftMotor = true;
bool invertRightMotor = true;

// ─── CONTROL VARIABLES ──────────────────────────────────────────────────────
float targetLeftVel = 0;  // rad/s
float targetRightVel = 0; // rad/s
long prevT = 0;
long lastTicksL = 0;
long lastTicksR = 0;
unsigned long lastCmdTime = 0;

// ─── MOTOR TUNING (OPEN-LOOP SCALE) ──────────────────────────────────────────
float ffGain = 18.0f;     // Scale từ rad/s sang PWM
float ffGainLeft = 18.0f;
int minPWM = 50;
unsigned long cmdTimeout = 500;

float lastPwmLeft = 0;
float lastPwmRight = 0;

// ─── VELOCITY MEASUREMENT ────────────────────────────────────────────────────
float vL_meas = 0;
float vR_meas = 0;

// ─── ODOMETRY STATE ──────────────────────────────────────────────────────────
float robotX = 0;
float robotY = 0;
float robotTheta = 0; // Góc chính thức (= fusedTheta nếu IMU hoạt động)
float robotDistance = 0;
unsigned long lastTelemetryTime = 0;

WebServer server(80);
WebSocketsServer webSocket(81);

// ============================================================
//   MPU6050 FUNCTIONS
// ============================================================

void mpu6050_writeReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

int16_t mpu6050_readReg16(uint8_t reg) {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)MPU6050_ADDR, (uint8_t)2);
  int16_t val = (Wire.read() << 8) | Wire.read();
  return val;
}

bool mpu6050_init() {
  Wire.begin(IMU_SDA, IMU_SCL);
  Wire.setClock(400000); // 400kHz I2C

  // Check WHO_AM_I register
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(0x75); // WHO_AM_I
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)MPU6050_ADDR, (uint8_t)1);

  if (Wire.available() < 1) {
    Serial.println("[IMU] MPU6050 NOT FOUND!");
    return false;
  }

  uint8_t whoAmI = Wire.read();
  Serial.printf("[IMU] WHO_AM_I: 0x%02X\n", whoAmI);
  if (whoAmI != 0x68 && whoAmI != 0x72) {
    Serial.println("[IMU] Unknown device, attempting anyway...");
  }

  // Wake up MPU6050 (clear SLEEP bit)
  mpu6050_writeReg(0x6B, 0x00);
  delay(100);

  // Set Gyroscope Full Scale: ±250°/s (highest precision for slow robots)
  // Register 0x1B: GYRO_CONFIG
  // Bits FS_SEL: 0 = ±250°/s (sensitivity = 131 LSB/°/s)
  //              1 = ±500°/s (sensitivity = 65.5 LSB/°/s)
  //              2 = ±1000°/s
  //              3 = ±2000°/s
  mpu6050_writeReg(0x1B, 0x00); // ±250°/s

  // Set DLPF (Digital Low Pass Filter) for noise reduction
  // Register 0x1A: CONFIG
  // DLPF_CFG = 3 → Bandwidth 44Hz, Delay 4.9ms (good balance)
  mpu6050_writeReg(0x1A, 0x03);

  // Set Sample Rate Divider for 200Hz gyro sampling
  // Sample Rate = Gyro Output Rate / (1 + SMPLRT_DIV)
  // With DLPF enabled: Gyro Output Rate = 1kHz
  // SMPLRT_DIV = 4 → 1000/(1+4) = 200Hz
  mpu6050_writeReg(0x19, 0x04);

  Serial.println("[IMU] MPU6050 Initialized (±250°/s, DLPF=44Hz, 200Hz)");
  return true;
}

float mpu6050_readGyroZ() {
  // GYRO_ZOUT_H (0x47) and GYRO_ZOUT_L (0x48)
  int16_t raw = mpu6050_readReg16(0x47);

  // ±250°/s sensitivity = 131 LSB per °/s
  // Convert to rad/s: °/s * (PI/180)
  float dps = (float)raw / 131.0f;
  float rads = dps * (PI / 180.0f);
  return rads;
}

void mpu6050_calibrate(float rawZ) {
  // Accumulate samples while robot is stationary at startup
  gyroCalSum += rawZ;
  gyroCalSamples++;

  if (gyroCalSamples >= GYRO_CAL_COUNT) {
    gyroZBias = gyroCalSum / (float)gyroCalSamples;
    gyroCalibrated = true;
    Serial.printf("[IMU] Gyro Z-axis calibrated. Bias: %.6f rad/s\n",
                  gyroZBias);
  }
}

// ============================================================
//   INTERRUPT SERVICE ROUTINES (ISRs)
// ============================================================
void IRAM_ATTR leftISR() {
  int MSB = digitalRead(ENCODER_LEFT_A);
  int LSB = digitalRead(ENCODER_LEFT_B);
  int encoded = (MSB << 1) | LSB;
  int sum = (lastEncodedLeft << 2) | encoded;

  if (sum == 0b1101 || sum == 0b0100 || sum == 0b0010 || sum == 0b1011) {
    invertLeftEncoder ? leftTicks-- : leftTicks++;
  } else if (sum == 0b1110 || sum == 0b0111 || sum == 0b0001 || sum == 0b1000) {
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
void setMotor(int pinIN1, int pinIN2, int pinPWM, int pwmChannel, float u) {
  int pwr = (int)fabs(u);
  if (pwr > 255)
    pwr = 255;

  if (u > 0) {
    digitalWrite(pinIN1, HIGH);
    digitalWrite(pinIN2, LOW);
  } else if (u < 0) {
    digitalWrite(pinIN1, LOW);
    digitalWrite(pinIN2, HIGH);
  } else {
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
  ledcSetup(0, 20000, 8);
  ledcAttachPin(MOTOR_LEFT_EN, 0);
  ledcSetup(2, 20000, 8);
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

  // 4. MPU6050 IMU Init
  imuAvailable = mpu6050_init();
  if (imuAvailable) {
    Serial.println(
        "[IMU] MPU6050 connected. Calibrating gyro (hold robot still)...");
  } else {
    Serial.println("[IMU] MPU6050 NOT available. Using encoder-only odometry.");
  }

  // 5. WiFi & MDNS
  WiFiManager wm;
  wm.autoConnect("AMR_Robot_IMU_AP");

  if (MDNS.begin("amr")) {
    Serial.println("MDNS Started: amr.local");
    MDNS.addService("http", "tcp", 80);
    MDNS.addService("ws", "tcp", 81);
  }

  // 5.1 OTA Setup
  ArduinoOTA.setHostname("amr-robot-imu");
  ArduinoOTA.onStart([]() { Serial.println("OTA Start"); });
  ArduinoOTA.onEnd([]() { Serial.println("\nOTA End"); });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("Progress: %u%%\r", (progress / (total / 100)));
  });
  ArduinoOTA.onError(
      [](ota_error_t error) { Serial.printf("Error[%u]: ", error); });
  ArduinoOTA.begin();

  // 6. WebSocket
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

            // Reset IMU state
            gyroTheta = 0;
            encoderTheta = 0;
            fusedTheta = 0;
          }

          // CMD: RECALIBRATE GYRO
          if (doc["cmd"] == "recal_gyro") {
            gyroCalibrated = false;
            gyroCalSamples = 0;
            gyroCalSum = 0;
            gyroZBias = 0;
            Serial.println("[IMU] Recalibrating gyro... Hold robot still.");
          }

          // CMD: SET IMU ALPHA
          if (doc["imu_alpha"].is<float>()) {
            COMP_FILTER_ALPHA = doc["imu_alpha"];
            COMP_FILTER_ALPHA = constrain(COMP_FILTER_ALPHA, 0.0f, 1.0f);
            Serial.printf("[IMU] Comp filter alpha set to: %.2f\n",
                          COMP_FILTER_ALPHA);
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

            if (doc["ff_gain"].is<float>()) {
              ffGain = doc["ff_gain"];
              ffGainLeft = ffGain;
            }
            if (doc["min_pwm"].is<int>())
              minPWM = doc["min_pwm"];
            if (doc["cmd_timeout"].is<int>())
              cmdTimeout = doc["cmd_timeout"];

            // IMU fusion alpha tunable from app
            if (doc["comp_alpha"].is<float>()) {
              COMP_FILTER_ALPHA =
                  constrain(doc["comp_alpha"].as<float>(), 0.0f, 1.0f);
            }
          }

          if (doc["linear"].is<float>()) {
            float v_app = doc["linear"];
            float w_app = doc["angular"];

            // TIẾN LÙI: v > 0 là tiến
            float v = v_app;

            // XOAY TRÁI PHẢI: w > 0 là xoay trái
            float w = w_app; 

            targetLeftVel = (v - w * WHEEL_SEPARATION / 2.0f) / WHEEL_RADIUS;
            targetRightVel = (v + w * WHEEL_SEPARATION / 2.0f) / WHEEL_RADIUS;

            targetLeftVel = constrain(targetLeftVel, -15.0f, 15.0f);
            targetRightVel = constrain(targetRightVel, -15.0f, 15.0f);

            lastCmdTime = millis();
          }
        }
      });

  server.begin();
  prevT = micros();
  Serial.println("AMR IP: " + WiFi.localIP().toString());
  Serial.println("========================================");
  Serial.println("  AMR FIRMWARE — IMU + ENCODER FUSION   ");
  Serial.printf("  IMU: %s | Alpha: %.2f\n",
                imuAvailable ? "MPU6050 OK" : "NOT FOUND", COMP_FILTER_ALPHA);
  Serial.println("========================================");
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

    // ============================================================
    //   IMU READ & CALIBRATE (trước khi tính odometry)
    // ============================================================
    if (imuAvailable) {
      gyroZ_raw = mpu6050_readGyroZ();

      if (!gyroCalibrated) {
        // Robot phải đứng yên trong lúc startup
        mpu6050_calibrate(gyroZ_raw);
        gyroZ_raw = 0; // Chưa calibrate xong, chưa dùng
      } else {
        // Trừ bias
        gyroZ_raw -= gyroZBias;

        // Lọc nhiễu nhỏ (dead zone)
        if (fabs(gyroZ_raw) < 0.005f) {
          gyroZ_raw = 0;
        }

        // Tích phân gyro → gyroTheta
        gyroTheta += gyroZ_raw * deltaT;
        // Normalize
        gyroTheta = atan2(sin(gyroTheta), cos(gyroTheta));
      }
    }

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
    float v_robot = (vR_meas + vL_meas) / 2.0f * WHEEL_RADIUS;
    float w_encoder = (vR_meas - vL_meas) * WHEEL_RADIUS / WHEEL_SEPARATION;

    // Encoder theta integration
    encoderTheta += w_encoder * deltaT;
    encoderTheta = atan2(sin(encoderTheta), cos(encoderTheta));

    // ============================================================
    //   SENSOR FUSION: Complementary Filter
    // ============================================================
    float w_fused; // Vận tốc góc sau fusion

    if (imuAvailable && gyroCalibrated) {
      float angleDiff = gyroTheta - encoderTheta;
      while (angleDiff > PI) angleDiff -= 2.0f * PI;
      while (angleDiff < -PI) angleDiff += 2.0f * PI;

      fusedTheta = encoderTheta + COMP_FILTER_ALPHA * angleDiff;
      fusedTheta = atan2(sin(fusedTheta), cos(fusedTheta));
      w_fused = gyroZ_raw;
      robotTheta = fusedTheta;
    } else {
      fusedTheta = encoderTheta;
      w_fused = w_encoder;
      robotTheta = encoderTheta;
    }

    // Pose Integration
    float dist = v_robot * deltaT;
    robotDistance += fabs(dist);
    robotX += dist * cos(robotTheta);
    robotY += dist * sin(robotTheta);

    // ─── SIMPLE OPEN-LOOP MOTOR CONTROL ──────────────────────────
    // PWM = (targetVel * gain) + minPWM_deadband
    float pwmLeft = 0;
    float pwmRight = 0;

    if (fabs(targetL) > 0.01f) {
      pwmLeft = targetL * ffGainLeft;
      pwmLeft += (targetL > 0) ? minPWM : -minPWM;
    }
    if (fabs(targetR) > 0.01f) {
      pwmRight = targetR * ffGain;
      pwmRight += (targetR > 0) ? minPWM : -minPWM;
    }
    
    // Clamp
    pwmLeft = constrain(pwmLeft, -255.0f, 255.0f);
    pwmRight = constrain(pwmRight, -255.0f, 255.0f);

    lastPwmLeft = pwmLeft;
    lastPwmRight = pwmRight;

    // Apply motor inversion
    if (invertLeftMotor) pwmLeft = -pwmLeft;
    if (invertRightMotor) pwmRight = -pwmRight;

    setMotor(MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, MOTOR_LEFT_EN, 0, pwmLeft);
    setMotor(MOTOR_RIGHT_IN3, MOTOR_RIGHT_IN4, MOTOR_RIGHT_EN, 2, pwmRight);

      // 5. TELEMETRY (5Hz)
      if (millis() - lastTelemetryTime > 200) {
        lastTelemetryTime = millis();
        JsonDocument doc;
        doc["telem"] = true;
        doc["vx"] = v_robot;
        doc["wz"] = w_fused;       
        doc["theta"] = robotTheta; 
        doc["h"] = robotTheta * 180.0f / PI; // Bổ sung góc độ
        doc["d"] = robotDistance;
        doc["x"] = robotX;
        doc["y"] = robotY;

        // IMU-specific telemetry
        doc["imu"] = imuAvailable;
        doc["imu_cal"] = gyroCalibrated;
        doc["gyroZ"] = gyroZ_raw;                 
        doc["fTheta"] = fusedTheta * 180.0f / PI;   

        JsonObject enc = doc["enc"].to<JsonObject>();
        enc["l"] = cL; // RAW Ticks (App handles display)
        enc["r"] = cR;

        doc["vL_t"] = targetLeftVel;
        doc["vR_t"] = targetRightVel;
        doc["vL_r"] = vL_meas;
        doc["vR_r"] = vR_meas;

        doc["pwmL"] = (int)lastPwmLeft;
        doc["pwmR"] = (int)lastPwmRight;

        String output;
        serializeJson(doc, output);
        webSocket.broadcastTXT(output);

        // DEBUG
        Serial.printf("L:%ld R:%ld | vL:%.1f vR:%.1f | θ:%.1f°%s\n",
                      cL, cR, vL_meas, vR_meas,
                      fusedTheta * 180.0f / PI, 
                      (imuAvailable && gyroCalibrated) ? " [IMU]" : "");
      }
    }
  }
