#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <WiFiManager.h>

// =======================================================================================
//   AMR FIRMWARE - SERVO MG996R VERSION
// =======================================================================================
//   Điều khiển động cơ Servo MG996R thay cho động cơ giảm tốc.
//   Sử dụng ledc của ESP32 để xuất xung PWM 50Hz với độ phân giải cao
//   nhằm điều khiển từng góc siêu nhỏ một cách chính xác nhất.
// =======================================================================================

// PIN DEFINITIONS - Sử dụng lại các pin PWM của động cơ cũ (hoặc đổi chân tuỳ
// mạch)
#define SERVO_LEFT_PIN 19
#define SERVO_RIGHT_PIN 27

// CẤU HÌNH PWM CHO SERVO
#define SERVO_FREQ 50    // Tần số chuẩn cho servo MG996R là 50Hz (chu kỳ 20ms)
#define SERVO_CH_LEFT 0  // Kênh PWM trái
#define SERVO_CH_RIGHT 2 // Kênh PWM phải

// SỬ DỤNG ĐỘ PHÂN GIẢI 14-BIT (Tối đa của ESP32-S3 ở 50Hz)
#define SERVO_RES 14

// BIẾN TOÀN CỤC SERVO
// Với chu kỳ 20ms và độ phân giải 14-bit (16384):
// 0.5ms -> (0.5 / 20.0) * 16384 = 409.6 (~410)
// 2.5ms -> (2.5 / 20.0) * 16384 = 2048.0 (~2048)
int servoMinPulse = 410;
int servoMaxPulse = 2048;

float currentAngleLeft = 90.0;
float currentAngleRight = 90.0;

unsigned long lastTelemetryTime = 0;

WebServer server(80);
WebSocketsServer webSocket(81);

// ============================================================
//   HÀM ĐIỀU KHIỂN GÓC CHÍNH XÁC CHO SERVO (0.0 ĐẾN 180.0 ĐỘ)
// ============================================================
void setServoAngle(int pwmChannel, float angle) {
  // Ràng buộc góc an toàn
  if (angle < 0.0)
    angle = 0.0;
  if (angle > 180.0)
    angle = 180.0;

  // Ánh xạ góc (0-180) sang duty cycle phân giải cao (16-bit)
  uint32_t duty = servoMinPulse +
                  (uint32_t)((angle / 180.0) * (servoMaxPulse - servoMinPulse));

  // Ghi giá trị xung PWM
  ledcWrite(pwmChannel, duty);
}

// ============================================================
//   SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(1000); // Chờ 1 giây để ổn định hệ thống tránh WDT reset
  Serial.println("ESP32-S3 Starting...");

  // 1. Cấu hình chân PWM cho Servo MG996R (Frequency 50Hz, Timer 16 bits)
  ledcSetup(SERVO_CH_LEFT, SERVO_FREQ, SERVO_RES);
  ledcAttachPin(SERVO_LEFT_PIN, SERVO_CH_LEFT);

  ledcSetup(SERVO_CH_RIGHT, SERVO_FREQ, SERVO_RES);
  ledcAttachPin(SERVO_RIGHT_PIN, SERVO_CH_RIGHT);

  // Khởi tạo servo ở góc 90 độ (vị trí giữa)
  setServoAngle(SERVO_CH_LEFT, currentAngleLeft);
  setServoAngle(SERVO_CH_RIGHT, currentAngleRight);

  // 2. Cài đặt WiFi (Học hỏi từ main.cpp)
  WiFiManager wm;

  // NẾU BẠN MUỐN XÓA WIFI CŨ ĐỂ THẤY TÊN MỚI, BỎ DẤU // Ở DÒNG DƯỚI:
  // wm.resetSettings();

  wm.autoConnect("AMR_Robot_AP");

  if (MDNS.begin("amr")) {
    Serial.println("MDNS Started: amr.local");
    MDNS.addService("http", "tcp", 80);
    MDNS.addService("ws", "tcp", 81);
  }

  // 3. Thiết lập WebSocket lắng nghe lệnh từ ứng dụng
  webSocket.begin();
  webSocket.onEvent([](uint8_t num, WStype_t type, uint8_t *payload,
                       size_t length) {
    if (type == WStype_TEXT) {
      JsonDocument doc;
      deserializeJson(doc, payload);

      // =========================================================
      // LỆNH 1: SET GÓC CHÍNH XÁC (Dành cho Servo MG996R chuẩn)
      // =========================================================
      if (doc["cmd"] == "set_servo") {
        if (doc["angle_left"].is<float>()) {
          currentAngleLeft = doc["angle_left"];
          setServoAngle(SERVO_CH_LEFT, currentAngleLeft);
        }
        if (doc["angle_right"].is<float>()) {
          currentAngleRight = doc["angle_right"];
          setServoAngle(SERVO_CH_RIGHT, currentAngleRight);
        }

        // Tinh chỉnh biên độ xung (dùng khi bạn muốn hiệu chỉnh siêu nhỏ tay)
        if (doc["min_pulse"].is<int>()) {
          servoMinPulse = doc["min_pulse"];
        }
        if (doc["max_pulse"].is<int>()) {
          servoMaxPulse = doc["max_pulse"];
        }
      }

      // =========================================================
      // LÊNH 3: TƯƠNG THÍCH VỚI JOYSTICK CỦA APP (linear/angular)
      // =========================================================
      if (doc["linear"].is<float>()) {
        float v = doc["linear"];  // m/s
        float w = doc["angular"]; // rad/s

        // Chuyển đổi joystick sang tốc độ servo (giả định servo 360)
        // Nếu là servo 180, lệnh này sẽ điều khiển vị trí góc dựa trên tốc độ
        float speedL = v - w;
        float speedR = v + w;

        currentAngleLeft = 90.0 + (speedL * 90.0);
        currentAngleRight = 90.0 + (speedR * 90.0);

        setServoAngle(SERVO_CH_LEFT, currentAngleLeft);
        setServoAngle(SERVO_CH_RIGHT, currentAngleRight);

        Serial.printf("Joystick -> V:%.2f W:%.2f | L_Angle:%.1f R_Angle:%.1f\n",
                      v, w, currentAngleLeft, currentAngleRight);
      }

      // Log lệnh nhận được để debug
      if (doc["cmd"]) {
        String msg = "Cmd: ";
        serializeJson(doc, msg);
        Serial.println(msg);
      }
    }
  });

  server.begin();
  Serial.println("AMR IP: " + WiFi.localIP().toString());
  Serial.println("Servo MG996R High-Precision Control Mode Started");
}

// ============================================================
//   MAIN LOOP
// ============================================================
void loop() {
  webSocket.loop();
  server.handleClient();

  // 4. Báo cáo trạng thái góc hiện tại về App (Mỗi 200ms)
  if (millis() - lastTelemetryTime > 200) {
    lastTelemetryTime = millis();

    JsonDocument doc;
    doc["telem"] = true;
    doc["servo"] = true;

    JsonObject angles = doc.createNestedObject("angles");
    angles["l"] = currentAngleLeft;
    angles["r"] = currentAngleRight;

    String output;
    serializeJson(doc, output);
    webSocket.broadcastTXT(output);
  }
}
