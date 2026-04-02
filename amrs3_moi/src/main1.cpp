
// ============================================================
//   AMR S3 FIRMWARE — ESP32-S3 N16R8 (USB Lidar Version)
//   IMU + Encoder Fusion + RPLidar A1M8 (via USB Host)
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
#include <USBHostSerial.h> // Library cho USB Host CDC
#include <stdarg.h>
#include <stdio.h>

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

// Battery ADC
#define BATT_PIN 2

// Status RGB LED
#define RGB_LED_PIN 48
Adafruit_NeoPixel rgbLed(1, RGB_LED_PIN, NEO_GRB + NEO_KHZ800);

// ─── RPLidar A1M8 (USB TYPE-C) ───────────────────────────────────────────────
#define LIDAR_MOTOR_PIN 16 
#define LIDAR_BAUDRATE 115200

USBHostSerial usbHost; 
RPLidar lidar; 

// ============================================================
//   HEARTBEAT / LOGGING
// ============================================================
// Redirect all logs to TelnetStream since Serial might conflict with USB Host
void log_info(const char* format, ...) {
    char buf[256];
    va_list args;
    va_start(args, format);
    vsnprintf(buf, sizeof(buf), format, args);
    va_end(args);
    TelnetStream.print(buf);
}

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
bool oledOK = false; 
unsigned long lastScanBroadcast = 0;

// ─── MPU6050 ─────────────────────────────────────────────────────────────────
#define MPU6050_ADDR 0x68

// ─── BATTERY CALIBRATION ─────────────────────────────────────────────────────
#define BATT_SCALE_FACTOR 5.80f
#define BATT_OFFSET 0.0f
#define BATT_MIN_V 6.6f
#define BATT_MAX_V 8.4f

// ─── ROBOT KINEMATICS ────────────────────────────────────────────────────────
float WHEEL_RADIUS = 0.0264f;    
float WHEEL_SEPARATION = 0.170f; 
int TICKS_PER_REV = 1665;        

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
unsigned long lastTelemetryTime = 0;
unsigned long lastOledUpdateTime = 0;

WebServer server(80);
WebSocketsServer webSocket(81);

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
  uint8_t err = Wire.endTransmission(); 
  if (err != 0) {
    Wire.begin(IMU_SDA, IMU_SCL);
    Wire.setClock(400000); 
    return 0;
  }
  uint8_t rcv = Wire.requestFrom((uint8_t)MPU6050_ADDR, (uint8_t)2);
  if (rcv < 2) {
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
  Wire.setClock(400000);
  Wire.setTimeout(20);

  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(0x75);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)MPU6050_ADDR, (uint8_t)1);

  if (Wire.available() < 1) {
    log_info("[IMU] MPU6050 NOT FOUND!\n");
    return false;
  }

  uint8_t whoAmI = Wire.read();
  log_info("[IMU] WHO_AM_I: 0x%02X\n", whoAmI);
  if (whoAmI != 0x68 && whoAmI != 0x72)
    log_info("[IMU] Unknown device, attempting anyway...\n");

  mpu6050_writeReg(0x6B, 0x00);
  delay(100);
  mpu6050_writeReg(0x1B, 0x00);
  mpu6050_writeReg(0x1A, 0x06);
  mpu6050_writeReg(0x19, 0x04);

  log_info("[IMU] MPU6050 init OK (±250°/s, DLPF=5Hz, 200Hz)\n");
  return true;
}

float mpu6050_readGyroZ() {
  int16_t raw = mpu6050_readReg16(0x47);
  return (raw / 131.0f) * (PI / 180.0f);
}

void mpu6050_calibrate(float rawZ) {
  gyroCalSum += rawZ;
  gyroCalSamples++;
  if (gyroCalSamples >= GYRO_CAL_COUNT) {
    gyroZBias = gyroCalSum / (float)gyroCalSamples;
    gyroCalibrated = true;
    log_info("[IMU] Gyro calibrated. Bias: %.6f rad/s\n", gyroZBias);
  }
}

// ============================================================
//   RPLIDAR A1M8 FUNCTIONS
// ============================================================
void lidar_motorStart() {
  pinMode(LIDAR_MOTOR_PIN, OUTPUT);
  digitalWrite(LIDAR_MOTOR_PIN, HIGH);
}

void lidar_motorStop() { digitalWrite(LIDAR_MOTOR_PIN, LOW); }

bool lidar_init() {
  log_info("[LIDAR] Initializing USB Host Serial...\n");
  // Initialize USB Host Serial (Default 8N1 for Lidar)
  // stopbits: 0: 1 stopbit, parity: 0: None, databits: 8
  usbHost.begin(LIDAR_BAUDRATE, 0, 0, 8);
  lidar.begin(usbHost);

  lidar_motorStart();
  delay(1000); 

  rplidar_response_device_health_t healthInfo;
  if (IS_OK(lidar.getHealth(healthInfo, 1000))) {
    log_info("[LIDAR] Health: status=%d, err=%d\n", healthInfo.status, healthInfo.error_code);
    if (healthInfo.status == RPLIDAR_STATUS_ERROR) {
      log_info("[LIDAR] ERROR status! Restarting...\n");
      lidar_motorStop();
      delay(100);
      lidar_motorStart();
      delay(1000);
    }
  } else {
    log_info("[LIDAR] Cannot get health info!\n");
    return false;
  }

  rplidar_response_device_info_t devInfo;
  if (IS_OK(lidar.getDeviceInfo(devInfo, 1000))) {
    log_info("[LIDAR] Model: %d | FW: %d.%d | HW: %d\n", devInfo.model, devInfo.firmware_version >> 8, devInfo.firmware_version & 0xFF, devInfo.hardware_version);
  }

  if (!IS_OK(lidar.startScan(false, 1))) {
    log_info("[LIDAR] Start scan failed!\n");
    return false;
  }

  log_info("[LIDAR] RPLidar A1M8 USB init OK — scanning...\n");
  return true;
}

void lidar_readPoints() {
  if (!lidarOK) return;
  while (IS_OK(lidar.waitPoint())) {
    float angle = lidar.getCurrentPoint().angle;
    float dist = lidar.getCurrentPoint().distance;
    uint8_t qual = lidar.getCurrentPoint().quality;
    if (dist > 0 && qual > 5) {
      int idx = (int)angle % MAX_SCAN_POINTS;
      if (idx >= 0 && idx < MAX_SCAN_POINTS) {
        scanData[idx].angle = angle;
        scanData[idx].distance = dist;
        scanData[idx].quality = qual;
        scanCount = max(scanCount, idx + 1);
      }
    }
  }
}

void lidar_broadcast() {
  if (!lidarOK || scanCount == 0) return;
  if (millis() - lastScanBroadcast < 333) return;
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
  webSocket.broadcastTXT(out);
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

void setMotor(int pinIN1, int pinIN2, int pwmCh, float u) {
  int pwr = (int)fabs(u);
  if (pwr > 255) pwr = 255;
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

void setup() {
  Serial.begin(115200); 
  delay(1000);

  pinMode(MOTOR_LEFT_IN1, OUTPUT);
  pinMode(MOTOR_LEFT_IN2, OUTPUT);
  pinMode(MOTOR_RIGHT_IN3, OUTPUT);
  pinMode(MOTOR_RIGHT_IN4, OUTPUT);
  ledcSetup(0, 20000, 8); 
  ledcAttachPin(MOTOR_LEFT_EN, 0);
  ledcSetup(1, 20000, 8); 
  ledcAttachPin(MOTOR_RIGHT_EN, 1);

  analogSetPinAttenuation(BATT_PIN, ADC_11db);
  pinMode(BATT_PIN, INPUT);

  rgbLed.begin();
  rgbLed.setBrightness(30);
  rgbLed.setPixelColor(0, rgbLed.Color(0, 0, 50)); 
  rgbLed.show();

  pinMode(ENCODER_LEFT_A, INPUT_PULLUP);
  pinMode(ENCODER_LEFT_B, INPUT_PULLUP);
  pinMode(ENCODER_RIGHT_A, INPUT_PULLUP);
  pinMode(ENCODER_RIGHT_B, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(ENCODER_LEFT_A), leftISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_LEFT_B), leftISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_RIGHT_A), rightISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_RIGHT_B), rightISR, CHANGE);

  imuAvailable = mpu6050_init();
  
  oledOK = display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS);
  if (oledOK) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("AMR S3 USB Mode...");
    display.println("Connecting WiFi");
    display.display();
  }

  WiFiManager wm;
  wm.autoConnect("AMR_S3_USB_AP");
  WiFi.setSleep(false);
  esp_wifi_set_ps(WIFI_PS_NONE);

  if (MDNS.begin("amrs3")) {
    MDNS.addService("http", "tcp", 80);
    MDNS.addService("ws", "tcp", 81);
  }

  ArduinoOTA.setHostname("amr-s3-usb");
  ArduinoOTA.begin();
  TelnetStream.begin();

  lidarOK = lidar_init();
  if (!lidarOK) lidar_motorStop();

  webSocket.begin();
  webSocket.onEvent([](uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
    if (type != WStype_TEXT) return;
    JsonDocument doc;
    deserializeJson(doc, payload);

    if (doc["type"] == "ping") {
      JsonDocument pong;
      pong["type"] = "pong";
      pong["ts"] = doc["ts"];
      String out;
      serializeJson(pong, out);
      webSocket.sendTXT(num, out);
      return;
    }

    if (doc["cmd"] == "reset_odom") {
      robotX = robotY = robotTheta = robotDistance = 0;
      leftTicks = rightTicks = lastTicksL = lastTicksR = 0;
      targetLeftVel = targetRightVel = 0;
      gyroTheta = encoderTheta = fusedTheta = 0;
      log_info("[CMD] Odometry reset.\n");
    }

    if (doc["cmd"] == "recal_gyro") {
      gyroCalibrated = false;
      gyroCalSamples = 0;
      gyroCalSum = 0;
      gyroZBias = 0;
      log_info("[IMU] Gyro recalibrating...\n");
    }

    if (doc["cmd"] == "brake") {
      brakeEnabled = doc["val"];
      log_info("[CMD] Brake: %d\n", brakeEnabled);
    }

    if (doc["cmd"] == "lidar_start") {
      if (!lidarOK) {
        lidarOK = lidar_init();
      } else {
        lidar_motorStart();
        lidar.startScan(false, 1);
      }
      log_info("[LIDAR] Start command received.\n");
    }
    
    if (doc["cmd"] == "lidar_stop") {
      lidar.stop();
      lidar_motorStop();
      log_info("[LIDAR] Stop command received.\n");
    }

    if (doc["cmd"] == "led") {
      bool val = doc["val"];
      rgbLed.setPixelColor(0, val ? rgbLed.Color(0, 150, 0) : rgbLed.Color(0, 0, 0));
      rgbLed.show();
      log_info("[CMD] RGB LED: %d\n", val);
    }

    if (doc["type"] == "config") {
      if (!doc["ticks_per_rev"].isNull()) TICKS_PER_REV = doc["ticks_per_rev"];
      if (!doc["wheel_width"].isNull()) WHEEL_SEPARATION = doc["wheel_width"];
      if (!doc["wheel_radius"].isNull()) WHEEL_RADIUS = doc["wheel_radius"];
      if (!doc["ff_gain"].isNull()) ffGainLeft = ffGainRight = doc["ff_gain"];
      if (!doc["ff_gain_right"].isNull()) ffGainRight = doc["ff_gain_right"];
      if (!doc["min_pwm"].isNull()) minPWM = doc["min_pwm"];
      if (!doc["cmd_timeout"].isNull()) cmdTimeout = doc["cmd_timeout"];
      if (!doc["comp_alpha"].isNull()) COMP_FILTER_ALPHA = constrain(doc["comp_alpha"].as<float>(), 0.0f, 1.0f);
      log_info("[CMD] Config updated.\n");
    }

    if (!doc["linear"].isNull()) {
      float v = doc["linear"];
      float w = doc["angular"];
      targetLeftVel = constrain((v + w * WHEEL_SEPARATION / 2.0f) / WHEEL_RADIUS, -30.0f, 30.0f);
      targetRightVel = constrain((v - w * WHEEL_SEPARATION / 2.0f) / WHEEL_RADIUS, -30.0f, 30.0f);
      lastCmdTime = millis();
    }
  });

  server.begin();
  prevT = micros();

  log_info("================================================\n");
  log_info("  AMR S3 FIRMWARE — USB HOST MODE              \n");
  log_info("  IP: %s\n", WiFi.localIP().toString().c_str());
  log_info("  IMU   : %s\n", imuAvailable ? "MPU6050 OK" : "NOT FOUND");
  log_info("  LiDAR : %s\n", lidarOK ? "A1M8 OK" : "NOT FOUND");
  log_info("  Alpha : %.2f\n", COMP_FILTER_ALPHA);
  log_info("================================================\n");

  if (oledOK) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("AMR S3 USB READY");
    display.print("IP: ");
    display.println(WiFi.localIP());
    display.printf("IMU:%s LiDAR:%s\n", imuAvailable ? "OK" : "--", lidarOK ? "OK" : "--");
    display.display();
  }
}

void loop() {
  ArduinoOTA.handle();
  webSocket.loop();
  server.handleClient();

  if (millis() - lastCmdTime > cmdTimeout) {
    targetLeftVel = 0;
    targetRightVel = 0;
  }

  lidar_readPoints();

  long currT = micros();
  float deltaT = ((float)(currT - prevT)) / 1.0e6f;

  if (deltaT >= 0.02f) {
    prevT = currT;

    if (imuAvailable) {
      gyroZ_raw = mpu6050_readGyroZ();
      if (!gyroCalibrated) {
        mpu6050_calibrate(gyroZ_raw);
        gyroZ_raw = 0;
      } else {
        gyroZ_raw -= gyroZBias;
        if (fabs(targetLeftVel) < 0.01f && fabs(targetRightVel) < 0.01f && fabs(gyroZ_raw) < 0.01f) gyroZ_raw = 0;
        gyroTheta += gyroZ_raw * deltaT;
        gyroTheta = atan2(sin(gyroTheta), cos(gyroTheta));
      }
    }

    noInterrupts();
    long cL = leftTicks;
    long cR = rightTicks;
    interrupts();

    float vL_raw = (float)(cL - lastTicksL) / TICKS_PER_REV * 2.0f * PI / deltaT;
    float vR_raw = (float)(cR - lastTicksR) / TICKS_PER_REV * 2.0f * PI / deltaT;
    vL_meas = 0.7f * vL_meas + 0.3f * vL_raw;
    vR_meas = 0.7f * vR_meas + 0.3f * vR_raw;
    lastTicksL = cL;
    lastTicksR = cR;

    float v_robot = (vR_meas + vL_meas) / 2.0f * WHEEL_RADIUS;
    float w_encoder = (vR_meas - vL_meas) * WHEEL_RADIUS / WHEEL_SEPARATION;
    encoderTheta += w_encoder * deltaT;
    encoderTheta = atan2(sin(encoderTheta), cos(encoderTheta));

    float w_fused;
    if (imuAvailable && gyroCalibrated) {
      float diff = gyroTheta - encoderTheta;
      while (diff > PI) diff -= 2.0f * PI;
      while (diff < -PI) diff += 2.0f * PI;
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

    if (invertLeftMotor) pwmLeft = -pwmLeft;
    if (invertRightMotor) pwmRight = -pwmRight;

    setMotor(MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, 0, pwmLeft);
    setMotor(MOTOR_RIGHT_IN3, MOTOR_RIGHT_IN4, 1, pwmRight);

    if (millis() - lastTelemetryTime > 200) {
      lastTelemetryTime = millis();
      float b_sum = 0;
      for (int i = 0; i < 10; i++) b_sum += analogRead(BATT_PIN);
      float v_now = (b_sum / 10.0f / 4095.0f) * 3.3f * BATT_SCALE_FACTOR + BATT_OFFSET;
      if (fabs(lastPwmLeft) < 20.0f && fabs(lastPwmRight) < 20.0f)
        filteredVBatt = filteredVBatt * 0.95f + v_now * 0.05f;
      else
        filteredVBatt = filteredVBatt * 0.999f + v_now * 0.001f;

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
      telem["batt_v"] = filteredVBatt;

      String out;
      serializeJson(telem, out);
      webSocket.broadcastTXT(out);
      lidar_broadcast();

      if (oledOK && millis() - lastOledUpdateTime > 1000) {
        lastOledUpdateTime = millis();
        display.clearDisplay();
        display.setTextSize(1);
        display.setCursor(0, 0);
        display.print("IP: "); display.println(WiFi.localIP());
        display.print("Bat:"); display.print(battPct);
        display.print("% D:"); display.print(robotDistance, 1);
        display.println("m");
        display.print("H:"); display.print(robotTheta * 180.0f / PI, 1);
        display.print(" LiDAR:"); display.println(lidarOK ? "OK" : "--");
        display.print("Status: ");
        display.println((fabs(targetLeftVel) > 0.01f || fabs(targetRightVel) > 0.01f) ? "MOVING" : "READY");
        display.display();
      }
      
      log_info("L:%ld R:%ld | vL:%.1f vR:%.1f | θ:%.1f° LiDAR:%s\n",
          cL, cR, vL_meas, vR_meas, fusedTheta * 180.0f / PI, lidarOK ? "OK" : "--");
    }
  }
}
