
// ============================================================
//   AMR S3 FIRMWARE — ESP32-S3 N16R8
//   IMU + Encoder Fusion + RPLidar A1M8
// ============================================================
//
//   ┌─────────────────────────────────────────────────┐
//   │              PIN MAP (ESP32-S3)                 │
//   ├──────────────────────┬──────────────────────────┤
//   │ Motor Driver (L298N) │                          │
//   │   MOTOR_LEFT_EN      │ GPIO 8  (PWM)            │
//   │   MOTOR_LEFT_IN1     │ GPIO 9                   │
//   │   MOTOR_LEFT_IN2     │ GPIO 10                  │
//   │   MOTOR_RIGHT_EN     │ GPIO 11 (PWM)            │
//   │   MOTOR_RIGHT_IN3    │ GPIO 12                  │
//   │   MOTOR_RIGHT_IN4    │ GPIO 13                  │
//   ├──────────────────────┼──────────────────────────┤
//   │ Encoder              │                          │
//   │   ENC_LEFT_A         │ GPIO 4                   │
//   │   ENC_LEFT_B         │ GPIO 5                   │
//   │   ENC_RIGHT_A        │ GPIO 6                   │
//   │   ENC_RIGHT_B        │ GPIO 7                   │
//   ├──────────────────────┼──────────────────────────┤
//   │ I2C (IMU + OLED)     │                          │
//   │   SDA                │ GPIO 39 (Fixed conflict) │
//   │   SCL                │ GPIO 40 (Fixed conflict) │
//   ├──────────────────────┼──────────────────────────┤
//   │ RPLidar A1M8 (UART1) │                          │
//   │   LIDAR_TX → ESP RX  │ GPIO 15 (Safe)           │
//   │   LIDAR_RX → ESP TX  │ GPIO 16 (Safe)           │
//   │   LIDAR_MOTOR_PWM    │ GPIO 21 (PWM spin motor) │
//   ├──────────────────────┼──────────────────────────┤
//   │ Battery ADC          │ GPIO 2  (ADC1_CH1)       │
//   └──────────────────────┴──────────────────────────┘
//
//   NOTE:  Avoid GPIO 0, 3, 19, 20 (USB/boot strapping)
//          Avoid GPIO 26–32 (used by PSRAM on N16R8 OPI)
//          GPIO 35–37 input-only on some revisions
// ============================================================

#include <Adafruit_GFX.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_SSD1306.h>
#include <Arduino.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <HardwareSerial.h>
#include <RPLidar.h>
#include <TelnetStream.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <WiFiManager.h>
#include <Wire.h>
#include <esp_wifi.h>

// ─── OLED ────────────────────────────────────────────────────────────────────
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ─── PIN DEFINITIONS (ESP32-S3) ──────────────────────────────────────────────
// Motor L298N
#define MOTOR_LEFT_EN 8
#define MOTOR_LEFT_IN1 9
#define MOTOR_LEFT_IN2 10
#define MOTOR_RIGHT_EN 11
#define MOTOR_RIGHT_IN3 12
#define MOTOR_RIGHT_IN4 13

// Quadrature Encoders
#define ENCODER_LEFT_A 4
#define ENCODER_LEFT_B 5
#define ENCODER_RIGHT_A 6
#define ENCODER_RIGHT_B 7

// I2C: MPU6050 + OLED (Dùng 39 và 40 cho an toàn trên S3)
#define IMU_SDA 39
#define IMU_SCL 40

// Battery ADC (ADC1 — luôn an toàn khi WiFi bật)
// NOTE: GPIO 16 is used by LIDAR_MOTOR_PIN — moved battery to GPIO 2
#define BATT_PIN 2

// Status RGB LED (Built-in NeoPixel on ESP32-S3)
#define RGB_LED_PIN 48
Adafruit_NeoPixel rgbLed(1, RGB_LED_PIN, NEO_GRB + NEO_KHZ800);

// ─── RPLidar A1M8 ────────────────────────────────────────────────────────────
// Dùng UART1 (Serial1) của ESP32-S3
// CHÚ Ý: ESP32-S3-N16R8 sử dụng Octal PSRAM (OPI), các chân 33, 34, 35, 36, 37
// được dùng nội bộ cho bộ nhớ PSRAM này. Tuyệt đối không dùng cho UART.
#define LIDAR_SERIAL_RX 15
#define LIDAR_SERIAL_TX 16
#define LIDAR_MOTOR_PIN 21
#define LIDAR_BAUDRATE 115200

RPLidar lidar; // Đối tượng RPLidar (thư viện robopeak/RPLidar)

// Lưu trữ scan mới nhất
struct LidarPoint {
  float angle;    // Độ (0–360)
  float distance; // mm
  uint8_t quality;
};
static const int MAX_SCAN_POINTS = 360;
LidarPoint scanData[MAX_SCAN_POINTS];
int scanCount = 0;
bool lidarOK = false;
bool oledOK = false; // Track OLED availability to avoid I2C spam
unsigned long lastScanBroadcast = 0;

// ─── MPU6050 ─────────────────────────────────────────────────────────────────
#define MPU6050_ADDR 0x68

// ─── BATTERY CALIBRATION ─────────────────────────────────────────────────────
#define BATT_SCALE_FACTOR                                                      \
  2.0f // Tỉ lệ phân áp (bạn có thể cần chỉnh lại theo phần cứng)
#define BATT_OFFSET 0.0f
#define BATT_MIN_V 6.6f
#define BATT_MAX_V 8.4f
#define BATT_V_REF 3.3f

// ─── ROBOT KINEMATICS ────────────────────────────────────────────────────────
float WHEEL_RADIUS = 0.0264f;    // Meters
float WHEEL_SEPARATION = 0.170f; // Meters
int TICKS_PER_REV = 1665;        // Ticks per revolution

// ─── IMU FUSION ──────────────────────────────────────────────────────────────
float COMP_FILTER_ALPHA = 0.95f;
float gyroZBias = 0;
bool gyroCalibrated = false;
int gyroCalSamples = 0;
float gyroCalSum = 0;
const int GYRO_CAL_COUNT = 500;

float gyroZ_raw = 0;
float gyroTheta = 0;
float encoderTheta = 0;
float fusedTheta = 0;
bool imuAvailable = false;
bool brakeEnabled = false;

// ─── ENCODERS ────────────────────────────────────────────────────────────────
volatile long leftTicks = 0;
volatile long rightTicks = 0;
volatile int lastEncodedLeft = 0;
volatile int lastEncodedRight = 0;

bool invertLeftEncoder = false;
bool invertRightEncoder = true;
bool invertLeftMotor = true;
bool invertRightMotor = true;

// ─── CONTROL ─────────────────────────────────────────────────────────────────
float targetLeftVel = 0;
float targetRightVel = 0;
long prevT = 0;
long lastTicksL = 0;
long lastTicksR = 0;
unsigned long lastCmdTime = 0;

float ffGainLeft = 24.0f;
float ffGainRight = 32.0f;
int minPWM = 50;

float Kp_vel = 2.0f;
float Ki_vel = 1.5f;
float errorIntL = 0;
float errorIntR = 0;
unsigned long cmdTimeout = 1500;

float lastPwmLeft = 0;
float lastPwmRight = 0;

float vL_meas = 0;
float vR_meas = 0;

// ─── ODOMETRY ────────────────────────────────────────────────────────────────
float robotX = 0;
float robotY = 0;
float robotTheta = 0;
float robotDistance = 0;
float filteredVBatt = 12.0f;
unsigned long lastLidarRetry = 0;
unsigned long lastTelemetryTime = 0;
unsigned long lastOledUpdateTime = 0;

WebServer server(80);
WebSocketsServer webSocket(81);
WiFiManager wm; // Move to global to avoid stack corruption

// ============================================================
//   MPU6050 BARE-METAL FUNCTIONS
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
  uint8_t err = Wire.endTransmission(); // Defaults to true, sends STOP. Avoids
                                        // i2cWriteReadNonStop driver bug
  if (err != 0) {
    // I2C bus error — attempt recovery
    Wire.begin(IMU_SDA, IMU_SCL);
    Wire.setClock(400000); // Khôi phục 400kHz sau khi đổi chân an toàn
    return 0;
  }
  uint8_t rcv = Wire.requestFrom((uint8_t)MPU6050_ADDR, (uint8_t)2);
  if (rcv < 2) {
    // Recovery on read timeout
    Wire.end();
    delay(2);
    Wire.begin(IMU_SDA, IMU_SCL);
    Wire.setClock(400000);
    return 0;
  }
  return (Wire.read() << 8) | Wire.read();
}

bool mpu6050_init() {
  Wire.begin(IMU_SDA, IMU_SCL);
  Wire.setClock(400000); // Khôi phục 400kHz
  Wire.setTimeout(20);

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
  if (whoAmI != 0x68 && whoAmI != 0x72)
    Serial.println("[IMU] Unknown device, attempting anyway...");

  mpu6050_writeReg(0x6B, 0x00); // Wake up
  delay(100);
  mpu6050_writeReg(0x1B, 0x00); // ±250°/s
  mpu6050_writeReg(0x1A, 0x06); // DLPF 5Hz
  mpu6050_writeReg(0x19, 0x04); // 200Hz sample rate

  Serial.println("[IMU] MPU6050 init OK (±250°/s, DLPF=5Hz, 200Hz)");
  return true;
}

float mpu6050_readGyroZ() {
  int16_t raw = mpu6050_readReg16(0x47);
  return (raw / 131.0f) * (PI / 180.0f); // rad/s
}

void mpu6050_calibrate(float rawZ) {
  gyroCalSum += rawZ;
  gyroCalSamples++;
  if (gyroCalSamples >= GYRO_CAL_COUNT) {
    gyroZBias = gyroCalSum / (float)gyroCalSamples;
    gyroCalibrated = true;
    Serial.printf("[IMU] Gyro calibrated. Bias: %.6f rad/s\n", gyroZBias);
  }
}

// ============================================================
//   RPLIDAR A1M8 FUNCTIONS
// ============================================================

// Khởi động motor LiDAR qua chân MOTOCTL (HIGH = quay)
void lidar_motorStart() {
  pinMode(LIDAR_MOTOR_PIN, OUTPUT);
  digitalWrite(LIDAR_MOTOR_PIN, HIGH);
}

void lidar_motorStop() { digitalWrite(LIDAR_MOTOR_PIN, LOW); }

bool lidar_init() {
  Serial.println("[LIDAR] Starting initialization...");
  
  // Đảm bảo LiDAR ở trạng thái dừng và sạch buffer trước khi bắt đầu
  lidar.stop();
  delay(100);
  
  // Cấu hình Serial1 (Gọi setRxBufferSize TRƯỚC begin trên ESP32)
  Serial1.setRxBufferSize(2048); 
  Serial1.begin(LIDAR_BAUDRATE, SERIAL_8N1, LIDAR_SERIAL_RX, LIDAR_SERIAL_TX);
  lidar.begin(Serial1);

  // BẬT MOTOR
  lidar_motorStart();
  Serial.println("[LIDAR] Motor is ON, waiting 1500ms for spin-up...");
  delay(1500); 
  
  // Xóa buffer rác sinh ra trong lúc khởi động motor
  while (Serial1.available()) Serial1.read();
  
  // Kiểm tra sức khỏe LiDAR
  rplidar_response_device_health_t health;
  u_result healthRes = lidar.getHealth(health);
  if (IS_OK(healthRes)) {
    Serial.printf("[LIDAR] Health status: %d (Error: %d)\n", health.status, health.error_code);
    if (health.status == 2) { // Status 2 = Error
      Serial.println("[LIDAR] Warning: Device error detected.");
      // lidardrv.reset() is not supported in this fork
    }
  } else {
    Serial.printf("[LIDAR] Could not get health: 0x%08X\n", healthRes);
  }
  
  // Khởi động scan
  u_result res = lidar.startScan(false, 3000); // Tăng timeout lên 3s
  if (IS_OK(res)) {
    Serial.println("[LIDAR] Initial scan started successfully.");
    return true;
  } else {
    Serial.printf("[LIDAR] Initial scan failed: 0x%08X.\n", res);
    return false;
  }
}

void lidar_readPoints() {
  while (Serial1.available() > 0) {
    if (IS_OK(lidar.waitPoint(0))) { // Revert về timeout = 0 như bản cũ của bạn
      float angle = lidar.getCurrentPoint().angle;
      float dist = lidar.getCurrentPoint().distance;
      uint8_t qual = lidar.getCurrentPoint().quality;

      if (dist > 0 && qual > 0) {
        int idx = (int)angle % MAX_SCAN_POINTS;
        if (idx >= 0 && idx < MAX_SCAN_POINTS) {
          scanData[idx].angle = angle;
          scanData[idx].distance = dist;
          scanData[idx].quality = qual;
          scanCount = max(scanCount, idx + 1);
        }
      }
    } else {
      break;
    }
  }
}


void lidar_broadcast() {
  if (!lidarOK || scanCount == 0)
    return;
  if (millis() - lastScanBroadcast < 333)
    return; // ~3Hz (Logic gốc)
  lastScanBroadcast = millis();

  JsonDocument doc;
  doc["lidar"] = true;
  JsonArray arr = doc["pts"].to<JsonArray>();

  int step = max(1, scanCount / 180); 
  for (int i = 0; i < scanCount; i += step) {
    if (scanData[i].distance > 0 && scanData[i].quality > 5) {
      arr.add((int)scanData[i].angle);
      arr.add((int)scanData[i].distance);
    }
  }

  String out;
  serializeJson(doc, out);
  webSocket.broadcastTXT(out.c_str()); // Dùng .c_str() để tránh lỗi Syntax
}

// ============================================================
//   ISRs — ENCODER
// ============================================================
void IRAM_ATTR leftISR() {
  int MSB = digitalRead(ENCODER_LEFT_A);
  int LSB = digitalRead(ENCODER_LEFT_B);
  int encoded = (MSB << 1) | LSB;
  int sum = (lastEncodedLeft << 2) | encoded;
  if (sum == 0b1101 || sum == 0b0100 || sum == 0b0010 || sum == 0b1011)
    invertLeftEncoder ? leftTicks-- : leftTicks++;
  else if (sum == 0b1110 || sum == 0b0111 || sum == 0b0001 || sum == 0b1000)
    invertLeftEncoder ? leftTicks++ : leftTicks--;
  lastEncodedLeft = encoded;
}

void IRAM_ATTR rightISR() {
  int MSB = digitalRead(ENCODER_RIGHT_A);
  int LSB = digitalRead(ENCODER_RIGHT_B);
  int encoded = (MSB << 1) | LSB;
  int sum = (lastEncodedRight << 2) | encoded;
  if (sum == 0b1101 || sum == 0b0100 || sum == 0b0010 || sum == 0b1011)
    invertRightEncoder ? rightTicks-- : rightTicks++;
  else if (sum == 0b1110 || sum == 0b0111 || sum == 0b0001 || sum == 0b1000)
    invertRightEncoder ? rightTicks++ : rightTicks--;
  lastEncodedRight = encoded;
}

// ============================================================
//   WIFI MANAGER CALLBACK
// ============================================================
void configModeCallback(WiFiManager *myWiFiManager) {
  if (oledOK) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("WIFI CONFIG MODE");
    display.println("AP: AMR_S3_AP");
    display.println("IP: 192.168.4.1");
    display.display();
  }
  Serial.println("[WIFI] Config mode started");
}

// ============================================================
//   MOTOR CONTROL
//   ESP32-S3: dùng ledcAttach() API mới (thay ledcSetup/ledcAttachPin)
// ============================================================
void setMotor(int pinIN1, int pinIN2, int pwmCh, float u) {
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
    if (brakeEnabled) {
      digitalWrite(pinIN1, HIGH);
      digitalWrite(pinIN2, HIGH);
      pwr = 255;
    } else {
      digitalWrite(pinIN1, LOW);
      digitalWrite(pinIN2, LOW);
      pwr = 0;
    }
  }
  ledcWrite(pwmCh, pwr);
}

// ============================================================
//   SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500); // Đợi USB CDC ổn định

  // ── Motor Pins ──────────────────────────────────────────
  pinMode(MOTOR_LEFT_IN1, OUTPUT);
  pinMode(MOTOR_LEFT_IN2, OUTPUT);
  pinMode(MOTOR_RIGHT_IN3, OUTPUT);
  pinMode(MOTOR_RIGHT_IN4, OUTPUT);

  // ledcSetup(channel, freq, resolution)
  // ledcAttachPin(pin, channel)
  ledcSetup(0, 20000, 8); // 20kHz, 8-bit, Channel 0
  ledcAttachPin(MOTOR_LEFT_EN, 0);
  ledcSetup(1, 20000, 8); // 20kHz, 8-bit, Channel 1
  ledcAttachPin(MOTOR_RIGHT_EN, 1);

  // ── Battery ADC ─────────────────────────────────────────
  analogSetPinAttenuation(BATT_PIN, ADC_11db);
  pinMode(BATT_PIN, INPUT);

  // ── Status RGB LED ─────────────────────────────────────
  rgbLed.begin();
  rgbLed.setBrightness(30);
  rgbLed.setPixelColor(0, rgbLed.Color(0, 0, 50)); // Blue on startup
  rgbLed.show();

  // ── Encoders ────────────────────────────────────────────
  pinMode(ENCODER_LEFT_A, INPUT_PULLUP);
  pinMode(ENCODER_LEFT_B, INPUT_PULLUP);
  pinMode(ENCODER_RIGHT_A, INPUT_PULLUP);
  pinMode(ENCODER_RIGHT_B, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(ENCODER_LEFT_A), leftISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_LEFT_B), leftISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_RIGHT_A), rightISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_RIGHT_B), rightISR, CHANGE);

  // ── IMU ─────────────────────────────────────────────────
  imuAvailable = mpu6050_init();
  if (imuAvailable)
    Serial.println("[IMU] MPU6050 OK — calibrating gyro...");
  else
    Serial.println("[IMU] MPU6050 NOT found — encoder-only mode.");

  // ── OLED ────────────────────────────────────────────────
  oledOK = display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS);
  if (!oledOK) {
    Serial.println("[OLED] SSD1306 not found — skipping OLED.");
  } else {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("AMR S3 Boot...");
    display.println("Connecting WiFi");
    display.display();
  }

  // ── WiFi ─────────────────────────────────────────────────
  display.clearDisplay();
  display.setCursor(0, 0);
  display.println("Connecting WiFi...");
  display.display();

  // Tối ưu WiFi ngay từ đầu để kết nối nhanh hơn
  WiFi.mode(WIFI_STA);
  esp_wifi_set_ps(WIFI_PS_NONE);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);

  wm.setConnectTimeout(15);       // Đợi WiFi cũ tối đa 15s cho nhanh
  wm.setConfigPortalTimeout(120); // Nếu phát AP thì cũng chỉ đợi 2 phút
  wm.setAPCallback(configModeCallback);

  if (!wm.autoConnect("AMR_S3_AP")) {
    Serial.println("[WIFI] Kết nối thất bại hoặc quá thời gian chờ.");
    if (oledOK) {
      display.clearDisplay();
      display.setCursor(0, 0);
      display.println("WiFi Timeout!");
      display.println("Starting Lidar...");
      display.display();
      delay(2000);
    }
  }

  WiFi.setSleep(false);

  // ── RPLidar A1M8 ────────────────────────────────────────
  // Khởi động LIDAR SAU khi đã có WiFi để tránh sụt áp đột ngột
  lidarOK = lidar_init();

  if (MDNS.begin("amrs3")) {
    MDNS.addService("http", "tcp", 80);
    MDNS.addService("ws", "tcp", 81);
    Serial.println("[NET] mDNS: amrs3.local");
  }

  // ── OTA ──────────────────────────────────────────────────
  ArduinoOTA.setHostname("amr-s3");
  ArduinoOTA.begin();
  TelnetStream.begin();

  // ── WebSocket ────────────────────────────────────────────
  webSocket.begin();
  webSocket.onEvent(
      [](uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
        if (type != WStype_TEXT)
          return;

        JsonDocument doc;
        deserializeJson(doc, payload);

        // PING/PONG
        if (doc["type"] == "ping") {
          JsonDocument pong;
          pong["type"] = "pong";
          pong["ts"] = doc["ts"];
          String out;
          serializeJson(pong, out);
          webSocket.sendTXT(num, out);
          return;
        }

        // RESET ODOMETRY
        if (doc["cmd"] == "reset_odom") {
          robotX = robotY = robotTheta = robotDistance = 0;
          leftTicks = rightTicks = lastTicksL = lastTicksR = 0;
          targetLeftVel = targetRightVel = 0;
          gyroTheta = encoderTheta = fusedTheta = 0;
          Serial.println("[CMD] Odometry reset.");
        }

        // RECALIBRATE GYRO
        if (doc["cmd"] == "recal_gyro") {
          gyroCalibrated = false;
          gyroCalSamples = 0;
          gyroCalSum = 0;
          gyroZBias = 0;
          Serial.println("[IMU] Gyro recalibrating...");
        }

        // BRAKE
        if (doc["cmd"] == "brake") {
          brakeEnabled = doc["val"];
          Serial.printf("[CMD] Brake: %d\n", brakeEnabled);
        }

        // LIDAR: Start/Stop motor
        if (doc["cmd"] == "lidar_start") {
          if (!lidarOK) {
            lidarOK = lidar_init();
          } else {
            lidar_motorStart();
            lidar.startScan(false, 1);
          }
          Serial.println("[LIDAR] Start command received.");
        }
        if (doc["cmd"] == "lidar_stop") {
          lidar.stop();
          lidar_motorStop();
          Serial.println("[LIDAR] Stop command received.");
        }

        // LED (RGB Control)
        if (doc["cmd"] == "led") {
          bool val = doc["val"];
          if (val) {
            rgbLed.setPixelColor(0, rgbLed.Color(0, 150, 0)); // Green
          } else {
            rgbLed.setPixelColor(0, rgbLed.Color(0, 0, 0)); // Off
          }
          rgbLed.show();
          Serial.printf("[CMD] RGB LED: %d\n", val);
        }

        // CONFIG
        if (doc["type"] == "config") {
          if (!doc["ticks_per_rev"].isNull())
            TICKS_PER_REV = doc["ticks_per_rev"];
          if (!doc["wheel_width"].isNull())
            WHEEL_SEPARATION = doc["wheel_width"];
          if (!doc["wheel_radius"].isNull())
            WHEEL_RADIUS = doc["wheel_radius"];
          if (!doc["ff_gain"].isNull())
            ffGainLeft = ffGainRight = doc["ff_gain"];
          if (!doc["ff_gain_right"].isNull())
            ffGainRight = doc["ff_gain_right"];
          if (!doc["min_pwm"].isNull())
            minPWM = doc["min_pwm"];
          if (!doc["cmd_timeout"].isNull())
            cmdTimeout = doc["cmd_timeout"];
          if (!doc["comp_alpha"].isNull())
            COMP_FILTER_ALPHA =
                constrain(doc["comp_alpha"].as<float>(), 0.0f, 1.0f);
        }

        // VELOCITY COMMAND
        if (!doc["linear"].isNull()) {
          float v = doc["linear"];
          float w = doc["angular"];
          targetLeftVel = constrain(
              (v + w * WHEEL_SEPARATION / 2.0f) / WHEEL_RADIUS, -30.0f, 30.0f);
          targetRightVel = constrain(
              (v - w * WHEEL_SEPARATION / 2.0f) / WHEEL_RADIUS, -30.0f, 30.0f);
          lastCmdTime = millis();
        }
      });

  server.begin();
  prevT = micros();

  Serial.println("================================================");
  Serial.println("  AMR S3 FIRMWARE — ESP32-S3 N16R8             ");
  Serial.printf("  IP: %s\n", WiFi.localIP().toString().c_str());
  Serial.printf("  IMU   : %s\n", imuAvailable ? "MPU6050 OK" : "NOT FOUND");
  Serial.printf("  LiDAR : %s\n", lidarOK ? "A1M8 OK" : "NOT FOUND");
  Serial.printf("  Alpha : %.2f\n", COMP_FILTER_ALPHA);
  Serial.println("================================================");

  // OLED: IP
  if (oledOK) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("AMR S3 READY");
    display.print("IP: ");
    display.println(WiFi.localIP());
    display.printf("IMU:%s LiDAR:%s\n", imuAvailable ? "OK" : "--",
                   lidarOK ? "OK" : "--");
    display.display();
  }
}

// ============================================================
//   MAIN LOOP
// ============================================================
void loop() {
  yield(); // Nhường CPU cho WiFi stack — QUAN TRỌNG để tránh mất kết nối
  ArduinoOTA.handle();
  webSocket.loop();
  server.handleClient();

  // Gửi LiDAR scan độc lập với Control Loop để tránh gửi chồng chéo với
  // Telemetry
  lidar_broadcast();

  // ── Safety failsafe (timeout) ──────────────────────────
  if (millis() - lastCmdTime > cmdTimeout) {
    targetLeftVel = 0;
    targetRightVel = 0;
  }

  // ── LiDAR: đọc liên tục (non-blocking) ─────────────────
  lidar_readPoints();

  // Retry LiDAR
  if (!lidarOK && (millis() - lastLidarRetry > 5000)) {
    lastLidarRetry = millis();
    Serial.println("[LIDAR] Attempting recovery...");
    lidar.stop();
    delay(200);
    
    u_result res = lidar.startScan(false, 2000);
    if (IS_OK(res)) {
      lidarOK = true;
      Serial.println("[LIDAR] RECOVERED!");
    } else {
      Serial.printf("[LIDAR] Recovery fail: 0x%08X\n", res);
    }
  }

  // ═══════════════════════════════════════════════════════
  //   Control Loop: 50Hz
  // ═══════════════════════════════════════════════════════
  long currT = micros();
  float deltaT = ((float)(currT - prevT)) / 1.0e6f;

  if (deltaT >= 0.02f) {
    prevT = currT;

    // ── IMU Read ──────────────────────────────────────────
    if (imuAvailable) {
      gyroZ_raw = mpu6050_readGyroZ();
      if (!gyroCalibrated) {
        mpu6050_calibrate(gyroZ_raw);
        gyroZ_raw = 0;
      } else {
        gyroZ_raw -= gyroZBias;
        if (fabs(targetLeftVel) < 0.01f && fabs(targetRightVel) < 0.01f &&
            fabs(gyroZ_raw) < 0.01f)
          gyroZ_raw = 0;
        gyroTheta += gyroZ_raw * deltaT;
        gyroTheta = atan2(sin(gyroTheta), cos(gyroTheta));
      }
    }

    // ── Read Encoders ─────────────────────────────────────
    noInterrupts();
    long cL = leftTicks;
    long cR = rightTicks;
    interrupts();

    float vL_raw =
        (float)(cL - lastTicksL) / TICKS_PER_REV * 2.0f * PI / deltaT;
    float vR_raw =
        (float)(cR - lastTicksR) / TICKS_PER_REV * 2.0f * PI / deltaT;
    vL_meas = 0.7f * vL_meas + 0.3f * vL_raw;
    vR_meas = 0.7f * vR_meas + 0.3f * vR_raw;
    lastTicksL = cL;
    lastTicksR = cR;

    // ── Kinematics ────────────────────────────────────────
    float v_robot = (vR_meas + vL_meas) / 2.0f * WHEEL_RADIUS;
    float w_encoder = (vR_meas - vL_meas) * WHEEL_RADIUS / WHEEL_SEPARATION;

    encoderTheta += w_encoder * deltaT;
    encoderTheta = atan2(sin(encoderTheta), cos(encoderTheta));

    // ── Sensor Fusion ─────────────────────────────────────
    float w_fused;
    if (imuAvailable && gyroCalibrated) {
      float diff = gyroTheta - encoderTheta;
      while (diff > PI)
        diff -= 2.0f * PI;
      while (diff < -PI)
        diff += 2.0f * PI;
      fusedTheta = encoderTheta + COMP_FILTER_ALPHA * diff;
      fusedTheta = atan2(sin(fusedTheta), cos(fusedTheta));
      encoderTheta = fusedTheta;
      w_fused = gyroZ_raw;
      robotTheta = fusedTheta;
    } else {
      fusedTheta = encoderTheta;
      w_fused = w_encoder;
      robotTheta = encoderTheta;
    }

    float dist = v_robot * deltaT;
    robotDistance += fabs(dist);
    robotX += dist * cos(robotTheta);
    robotY += dist * sin(robotTheta);

    // ── Motor PI + FF ─────────────────────────────────────
    float pwmLeft = 0, pwmRight = 0;
    float targetL = targetLeftVel, targetR = targetRightVel;

    if (fabs(targetL) > 0.01f || fabs(targetR) > 0.01f) {
      float errL = targetL - vL_meas;
      float errR = targetR - vR_meas;
      errorIntL = constrain(errorIntL + errL * deltaT, -5.0f, 5.0f);
      errorIntR = constrain(errorIntR + errR * deltaT, -5.0f, 5.0f);
      pwmLeft = (targetL * ffGainLeft) + Kp_vel * errL + Ki_vel * errorIntL;
      pwmRight = (targetR * ffGainRight) + Kp_vel * errR + Ki_vel * errorIntR;
      float sync = (vL_meas - vR_meas) - (targetL - targetR);
      pwmLeft -= 3.0f * sync;
      pwmRight += 3.0f * sync;
      pwmLeft += (targetL > 0) ? minPWM : -minPWM;
      pwmRight += (targetR > 0) ? minPWM : -minPWM;
    } else {
      errorIntL = errorIntR = 0;
    }

    pwmLeft = constrain(pwmLeft, -255.0f, 255.0f);
    pwmRight = constrain(pwmRight, -255.0f, 255.0f);
    lastPwmLeft = pwmLeft;
    lastPwmRight = pwmRight;

    if (invertLeftMotor)
      pwmLeft = -pwmLeft;
    if (invertRightMotor)
      pwmRight = -pwmRight;

    // ESP32-S3: ledcWrite với Channel
    setMotor(MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, 0, pwmLeft);
    setMotor(MOTOR_RIGHT_IN3, MOTOR_RIGHT_IN4, 1, pwmRight);

    // ── Telemetry & LiDAR Broadcast (4Hz) ────────────────
    // Giảm từ 5Hz (200ms) xuống 4Hz (250ms) để giảm tải WiFi
    if (millis() - lastTelemetryTime > 250) {
      lastTelemetryTime = millis();

      // Battery logic (Xử lý nhiễu ADC)
      long b_sum = 0;
      for (int i = 0; i < 20; i++) b_sum += analogRead(BATT_PIN);
      float v_now = (b_sum / 20.0f / 4095.0f) * 3.3f * BATT_SCALE_FACTOR + BATT_OFFSET;
      
      // Lọc thông thấp cho pin để không bị nhảy số
      filteredVBatt = filteredVBatt * 0.9f + v_now * 0.1f;
      if (filteredVBatt < 1.0f) filteredVBatt = v_now; // Reset nếu bắt đầu từ 0
      
      int battPct = constrain((int)((filteredVBatt - BATT_MIN_V) / (BATT_MAX_V - BATT_MIN_V) * 100), 0, 100);


      JsonDocument telem;
      telem["telem"] = true;
      telem["vx"] = v_robot;
      telem["wz"] = w_fused;
      telem["theta"] = robotTheta;
      telem["h"] = robotTheta * 180.0f / PI;
      telem["d"] = robotDistance;
      telem["x"] = robotX;
      telem["y"] = robotY;
      telem["imu"] = imuAvailable;
      telem["imu_cal"] = gyroCalibrated;
      telem["gyroZ"] = gyroZ_raw;
      telem["fTheta"] = fusedTheta * 180.0f / PI;
      telem["lidar"] = lidarOK;

      JsonObject enc = telem["enc"].to<JsonObject>();
      enc["l"] = cL;
      enc["r"] = cR;

      telem["vL_t"] = targetLeftVel;
      telem["vR_t"] = targetRightVel;
      telem["vL_r"] = vL_meas;
      telem["vR_r"] = vR_meas;
      telem["pwmL"] = (int)lastPwmLeft;
      telem["pwmR"] = (int)lastPwmRight;
      telem["batt"] = battPct;

      String out;
      serializeJson(telem, out);
      webSocket.broadcastTXT(out);

      // LiDAR scan now broadcasts independently in main loop

      // ── OLED (1Hz) — only if display present ───────────
      if (oledOK && millis() - lastOledUpdateTime > 1000) {
        lastOledUpdateTime = millis();
        display.clearDisplay();
        display.setTextSize(1);
        display.setCursor(0, 0);
        display.print("IP: ");
        display.println(WiFi.localIP());
        display.print("Bat:");
        display.print(battPct);
        display.print("% D:");
        display.print(robotDistance, 1);
        display.println("m");
        display.print("H:");
        display.print(robotTheta * 180.0f / PI, 1);
        display.print(" LiDAR:");
        display.println(lidarOK ? "OK" : "--");
        display.print("Status: ");
        display.println(
            (fabs(targetLeftVel) > 0.01f || fabs(targetRightVel) > 0.01f)
                ? "MOVING"
                : "READY");
        display.display();
      }

      Serial.printf("[AMR] Enc:%ld,%ld V:%.1f,%.1f IMU:%s Lidar:%s Bat:%d%% | "
                    "X:%.1f Y:%.1f H:%.1f\n",
                    cL, cR, vL_meas, vR_meas, imuAvailable ? "OK" : "--",
                    lidarOK ? "OK" : "--", battPct, robotX, robotY,
                    robotTheta * 180.0f / PI);

      TelnetStream.printf("L:%ld R:%ld | vL:%.1f vR:%.1f | θ:%.1f° LiDAR:%s\n",
                          cL, cR, vL_meas, vR_meas, fusedTheta * 180.0f / PI,
                          lidarOK ? "OK" : "--");
    }
  }
}
