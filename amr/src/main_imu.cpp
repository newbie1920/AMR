
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Arduino.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <TelnetStream.h> // <== Thêm thư viện Telnet
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <WiFiManager.h>
#include <Wire.h>
#include <esp_wifi.h>


#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

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
#define BATT_PIN                                                               \
  35 // Analog pin for battery voltage (Divider: 5x 10k resistors)

// MPU6050 I2C Pins (ESP32 default)
#define IMU_SDA 21
#define IMU_SCL 22
#define MPU6050_ADDR 0x68

// ─── BATTERY CALIBRATION
// ────────────────────────────────────────────────────── If battery % is too
// low/high, adjust BATT_SCALE_FACTOR:
//   - % too LOW  → increase BATT_SCALE_FACTOR (e.g. 5.0 → 5.3)
//   - % too HIGH → decrease BATT_SCALE_FACTOR (e.g. 5.0 → 4.7)
// BATT_OFFSET: Fine correction in Volts (e.g. +0.2 if reading is 0.2V too low)
#define BATT_SCALE_FACTOR 4.0f // Tỉ lệ 3k:1k
#define BATT_OFFSET 0.0f       // Calibration offset in Volts
#define BATT_MIN_V 10.5f       // Mức pin cạn an toàn
#define BATT_MAX_V 12.6f       // Pin đầy (3S LiPo)

// ─── CONFIGURABLE PARAMETERS ─────────────────────────────────────────────────
float WHEEL_RADIUS = 0.0264f; // Meters (Calibrated from 0.033f: 0.8x correction
                              // as real 40cm = monitor 50cm)
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
bool brakeEnabled = false; // Phanh điện tử

// ─── ENCODER VARIABLES ───────────────────────────────────────────────────────
volatile long leftTicks = 0;
volatile long rightTicks = 0;
volatile int lastEncodedLeft = 0;
volatile int lastEncodedRight = 0;

// ─── INVERSION FLAGS ─────────────────────────────────────────────────────────
// Cấu hình để: TIẾN = Cả 2 Encoder đều tăng (Dương)
bool invertLeftEncoder = false;
bool invertRightEncoder = true; // Đảo lại vì thực tế đang bị đếm lùi
bool invertLeftMotor = true;
bool invertRightMotor = true;

// ─── CONTROL VARIABLES ──────────────────────────────────────────────────────
float targetLeftVel = 0;  // rad/s
float targetRightVel = 0; // rad/s
long prevT = 0;
long lastTicksL = 0;
long lastTicksR = 0;
unsigned long lastCmdTime = 0;

// ─── MOTOR TUNING (FEED-FORWARD) ─────────────────────────────────────────────
float ffGainLeft = 24.0f; // Reduced from 25.0 as left was faster
float ffGainRight =
    32.0f; // Increased from 28.0 to compensate right motor sluggishness
int minPWM = 50;

// ─── VELOCITY PI CONTROL ──────────────────────────────────────────────────
float Kp_vel = 2.0f; // P THẤP: phản ứng nhẹ nhàng, không gây giật
float Ki_vel = 1.5f; // I nhỏ: chỉ bù steady-state
float errorIntL = 0;
float errorIntR = 0;
unsigned long cmdTimeout =
    1500; // Increased to 1500ms for more tolerant connection drops

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
float filteredVBatt = 12.0f; // Initial guess for filtering
unsigned long lastTelemetryTime = 0;
unsigned long lastOledUpdateTime = 0; // Track OLED updates

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
  // DLPF_CFG = 6 → Bandwidth 5Hz, Delay 19ms (max filtering)
  mpu6050_writeReg(0x1A, 0x06);

  // Set Sample Rate Divider for 200Hz gyro sampling
  // Sample Rate = Gyro Output Rate / (1 + SMPLRT_DIV)
  // With DLPF enabled: Gyro Output Rate = 1kHz
  // SMPLRT_DIV = 4 → 1000/(1+4) = 200Hz
  mpu6050_writeReg(0x19, 0x04);

  Serial.println("[IMU] MPU6050 Initialized (±250°/s, DLPF=5Hz, 200Hz)");
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
    // Stop behavior
    if (brakeEnabled) {
      digitalWrite(pinIN1, HIGH);
      digitalWrite(pinIN2, HIGH);
      pwr = 255; // Provide full duty cycle for braking
    } else {
      digitalWrite(pinIN1, LOW);
      digitalWrite(pinIN2, LOW);
      pwr = 0;
    }
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

  // 2. Battery ADC Setup
  // CRITICAL: Without 11dB attenuation, ESP32 ADC only reads 0-1.1V → always
  // 0%! ADC_11db expands range to 0-3.9V which covers our ~2.4V divider output.
  analogSetPinAttenuation(BATT_PIN, ADC_11db);
  pinMode(BATT_PIN, INPUT);

  // 3. PWM Setup
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

  // 4.5. OLED Init
  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println(F("[OLED] SSD1306 allocation failed"));
  } else {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("Connecting WiFi...");
    display.println("AMR_Robot_IMU_AP");
    display.display();
  }

  // 5. WiFi & MDNS
  WiFiManager wm;
  wm.autoConnect("AMR_Robot_IMU_AP");
  WiFi.setSleep(
      false); // Disable WiFi power saving for max stability and low latency
  WiFi.setTxPower(WIFI_POWER_19_5dBm); // Force maximum transmit power
  esp_wifi_set_ps(WIFI_PS_NONE); // Absolutely ensure no power saving logic

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
  TelnetStream.begin(); // <== Bắt đầu phát Serial qua mạng

  // 6. WebSocket
  webSocket.begin();
  webSocket.onEvent(
      [](uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
        if (type == WStype_TEXT) {
          JsonDocument doc;
          deserializeJson(doc, payload);

          // CMD: PING/PONG (Keep-alive)
          if (doc["type"] == "ping") {
            JsonDocument pong;
            pong["type"] = "pong";
            pong["ts"] = doc["ts"]; // Echo back timestamp if provided
            String output;
            serializeJson(pong, output);
            webSocket.sendTXT(num, output);
            return;
          }

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
          if (doc.containsKey("imu_alpha")) {
            COMP_FILTER_ALPHA = doc["imu_alpha"];
            COMP_FILTER_ALPHA = constrain(COMP_FILTER_ALPHA, 0.0f, 1.0f);
            Serial.printf("[IMU] Comp filter alpha set to: %.2f\n",
                          COMP_FILTER_ALPHA);
          }

          // CMD: BRAKE
          if (doc["cmd"] == "brake") {
            brakeEnabled = doc["val"];
            Serial.printf("[CMD] Brake enabled: %d\n", brakeEnabled);
          }

          // CMD: TEST SPEED
          if (doc["cmd"] == "test_7rad") {
            targetLeftVel = 7.0f;
            targetRightVel = 7.0f;
            lastCmdTime = millis();
          }

          // CMD: CONFIG
          if (doc["type"] == "config") {
            if (doc.containsKey("ticks_per_rev"))
              TICKS_PER_REV = doc["ticks_per_rev"];
            if (doc.containsKey("wheel_width"))
              WHEEL_SEPARATION = doc["wheel_width"];
            if (doc.containsKey("wheel_radius"))
              WHEEL_RADIUS = doc["wheel_radius"];

            if (doc.containsKey("ff_gain")) {
              float gain = doc["ff_gain"];
              ffGainLeft = gain;
              ffGainRight = gain;
            }
            if (doc.containsKey("ff_gain_right")) {
              ffGainRight = doc["ff_gain_right"];
            }
            if (doc.containsKey("min_pwm"))
              minPWM = doc["min_pwm"];
            if (doc.containsKey("cmd_timeout"))
              cmdTimeout = doc["cmd_timeout"];

            // IMU fusion alpha tunable from app9
            if (doc.containsKey("comp_alpha")) {
              COMP_FILTER_ALPHA =
                  constrain(doc["comp_alpha"].as<float>(), 0.0f, 1.0f);
            }
          }

          if (doc.containsKey("linear")) {
            float v_app = doc["linear"];
            float w_app = doc["angular"];

            // TIẾN LÙI: v > 0 là tiến
            float v = v_app;

            // w > 0 (app) = xoay TRÁI (theo app) -> w thực tế dương
            // w < 0 (app) = xoay PHẢI (theo app) -> w thực tế âm
            float w = w_app;

            // Kinematics: Manual swap to match user motor wiring
            targetLeftVel = (v + w * WHEEL_SEPARATION / 2.0f) / WHEEL_RADIUS;
            targetRightVel = (v - w * WHEEL_SEPARATION / 2.0f) / WHEEL_RADIUS;

            targetLeftVel = constrain(targetLeftVel, -30.0f, 30.0f);
            targetRightVel = constrain(targetRightVel, -30.0f, 30.0f);

            lastCmdTime = millis();
          }
        }
      });

  server.begin();
  prevT = micros();
  Serial.println("AMR IP: " + WiFi.localIP().toString());

  // Show IP on OLED
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Robot Connected!");
  display.setCursor(0, 16);
  display.print("IP: ");
  display.println(WiFi.localIP());
  display.display();
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
        // Trừ bias và ĐẢO DẤU để khớp hướng với App (Xoay phải app tăng góc)
        gyroZ_raw = (gyroZ_raw - gyroZBias);

        // Lọc nhiễu nhỏ (dead zone): Chỉ triệt tiêu khi xe đang đứng im để
        // tránh sai lệch góc khi xe quay thật sự
        if (fabs(targetLeftVel) < 0.01f && fabs(targetRightVel) < 0.01f &&
            fabs(gyroZ_raw) < 0.01f) {
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

    // Velocity measurements swapped to match motor swap
    float vL_raw =
        (float)(cL - lastTicksL) / TICKS_PER_REV * 2.0f * PI / deltaT;
    float vR_raw =
        (float)(cR - lastTicksR) / TICKS_PER_REV * 2.0f * PI / deltaT;
    // Low-pass filter: 30% giá trị mới + 70% giá trị cũ → khử nhiễu encoder
    vL_meas = 0.7f * vL_meas + 0.3f * vL_raw;
    vR_meas = 0.7f * vR_meas + 0.3f * vR_raw;

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
      while (angleDiff > PI)
        angleDiff -= 2.0f * PI;
      while (angleDiff < -PI)
        angleDiff += 2.0f * PI;

      fusedTheta = encoderTheta + COMP_FILTER_ALPHA * angleDiff;
      fusedTheta = atan2(sin(fusedTheta), cos(fusedTheta));
      encoderTheta =
          fusedTheta; // CRITICAL: Update encoder reference to fused heading to
                      // prevent "drag" after manual rotation
      w_fused = gyroZ_raw;
      robotTheta = fusedTheta;
    } else {
      fusedTheta = encoderTheta;
      w_fused = w_encoder;
      robotTheta = encoderTheta;
    }

    // Pose Integration (Standard CCW Heading)
    float dist = v_robot * deltaT;
    robotDistance += fabs(dist);
    robotX += dist * cos(robotTheta);
    robotY += dist * sin(robotTheta);

    // ─── MOTOR CONTROL: FF + PI + SYNC (đơn giản, hiệu quả) ──────
    float pwmLeft = 0;
    float pwmRight = 0;

    if (fabs(targetL) > 0.01f ||
        fabs(targetR) > 0.01f) { // Lowered threshold from 0.1 to 0.01 to
                                 // support slow movements
      // 1. Error
      float errL = targetL - vL_meas;
      float errR = targetR - vR_meas;

      // 2. Integral (đơn giản, anti-windup chặt)
      errorIntL += errL * deltaT;
      errorIntR += errR * deltaT;
      errorIntL = constrain(errorIntL, -5.0f, 5.0f); // Max Ki = 1.5×5 = 7.5 PWM
      errorIntR = constrain(errorIntR, -5.0f, 5.0f);

      // 3. PWM = Feed-Forward + P + I
      pwmLeft = (targetL * ffGainLeft) + (Kp_vel * errL) + (Ki_vel * errorIntL);
      pwmRight =
          (targetR * ffGainRight) + (Kp_vel * errR) + (Ki_vel * errorIntR);

      // 4. Đồng bộ 2 bánh (nhẹ nhàng, không gây giật)
      float syncErr = (vL_meas - vR_meas) - (targetL - targetR);
      pwmLeft -= 3.0f * syncErr;
      pwmRight += 3.0f * syncErr;

      // 5. Bù Deadband
      pwmLeft += (targetL > 0) ? minPWM : -minPWM;
      pwmRight += (targetR > 0) ? minPWM : -minPWM;
    } else {
      // Dừng: reset
      errorIntL = 0;
      errorIntR = 0;
      pwmLeft = 0;
      pwmRight = 0;
    }

    // Clamp output chuẩn 8-bit
    pwmLeft = constrain(pwmLeft, -255.0f, 255.0f);
    pwmRight = constrain(pwmRight, -255.0f, 255.0f);

    lastPwmLeft = pwmLeft;
    lastPwmRight = pwmRight;

    // Apply motor inversion
    if (invertLeftMotor)
      pwmLeft = -pwmLeft;
    if (invertRightMotor)
      pwmRight = -pwmRight;

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

      // --- SMOOTH BATTERY MONITORING ---
      // Read battery voltage multiple times to reduce noise
      float b_sum = 0;
      for (int i = 0; i < 10; i++)
        b_sum += analogRead(BATT_PIN);
      float b_raw = b_sum / 10.0f;

      // Convert to voltage using calibration constants
      float v_now = (b_raw / 4095.0f) * 3.3f * BATT_SCALE_FACTOR + BATT_OFFSET;

      // Voltage Sag Compensation: Only significantly update battery when motors
      // are idle
      if (fabs(lastPwmLeft) < 20.0f && fabs(lastPwmRight) < 20.0f) {
        // Idle: Update normally (Filter: 95% old + 5% new)
        filteredVBatt = (filteredVBatt * 0.95f) + (v_now * 0.05f);
      } else {
        // Driving: Update EXTREMELY slowly to prevent false "0%" alarms
        filteredVBatt = (filteredVBatt * 0.999f) + (v_now * 0.001f);
      }

      // DEBUG: Print measured voltage every cycle so you can calibrate
      TelnetStream.printf("[BATT] ADC=%.0f V=%.2f | ", b_raw, filteredVBatt);

      // Map to 0-100% using calibration voltage range
      doc["batt"] = constrain(
          (int)((filteredVBatt - BATT_MIN_V) / (BATT_MAX_V - BATT_MIN_V) * 100),
          0, 100);

      String output;
      serializeJson(doc, output);
      webSocket.broadcastTXT(output);

      // 6. OLED Status Update (1Hz)
      if (millis() - lastOledUpdateTime > 1000) {
        lastOledUpdateTime = millis();
        display.clearDisplay();
        display.setTextSize(1);
        display.setCursor(0, 0);
        display.print("IP: ");
        display.println(WiFi.localIP());

        // Line 2: Battery & Distance
        display.print("Bat:");
        display.print(constrain((int)((filteredVBatt - BATT_MIN_V) /
                                      (BATT_MAX_V - BATT_MIN_V) * 100),
                                0, 100));
        display.print("% | D:");
        display.print(robotDistance, 1);
        display.println("m");

        // Line 3: Heading & IMU
        display.print("H:");
        display.print(robotTheta * 180.0f / PI, 1);
        display.print(" deg ");
        if (imuAvailable && gyroCalibrated)
          display.println("[IMU]");
        else
          display.println("[ENC]");

        // Line 4: Status
        display.print("Status: ");
        if (fabs(targetLeftVel) > 0.01f || fabs(targetRightVel) > 0.01f) {
          display.println("MOVING");
        } else {
          display.println("READY");
        }
        display.display();
      }

      // DEBUG
      Serial.printf("L:%ld R:%ld | vL:%.1f vR:%.1f | θ:%.1f°%s\n", cL, cR,
                    vL_meas, vR_meas, fusedTheta * 180.0f / PI,
                    (imuAvailable && gyroCalibrated) ? " [IMU]" : "");
      TelnetStream.printf(
          "L:%ld R:%ld | vL:%.1f vR:%.1f | θ:%.1f°%s | Dist:%.2fm\n", cL, cR,
          vL_meas, vR_meas, fusedTheta * 180.0f / PI,
          (imuAvailable && gyroCalibrated) ? " [IMU]" : "", robotDistance);
    }
  }
}
