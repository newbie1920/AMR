/**
 * AMR Robot Firmware - ESP32 2-Wheel Drive
 * Tích hợp điều khiển chạm (Touch) và cấu hình Pin mới
 */

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <WiFiManager.h>

// ============================================
// Pin Configuration
// ============================================

// NÚT NHẤN (TẠM TẮT ĐỂ ƯU TIÊN PIN CHO MOTOR)
// #define BUTTON_UP 14
// #define BUTTON_DOWN 27
// #define BUTTON_LEFT 26
// #define BUTTON_RIGHT 25
const int TOUCH_THRESHOLD = 30;

// MOTOR TRÁI (Motor A) - Giữ nguyên (Đang chạy OK)
#define MOTOR_LEFT_EN 19
#define MOTOR_LEFT_IN1 18
#define MOTOR_LEFT_IN2 5

// MOTOR PHẢI (Motor B) - ĐỔI SANG CHÂN AN TOÀN (27, 26, 25)
// (Bỏ qua nút bấm để lấy chân cho Motor)
#define MOTOR_RIGHT_EN 27
#define MOTOR_RIGHT_IN3 26
#define MOTOR_RIGHT_IN4 25

// ENCODER
#define ENCODER_LEFT_A 35
#define ENCODER_LEFT_B 34
#define ENCODER_RIGHT_A 23
#define ENCODER_RIGHT_B 22

// Thông số Robot & PID
const float WHEEL_RADIUS = 0.033f;
const float WHEEL_SEPARATION = 0.170f;
const int TICKS_PER_REV = 333;
float kp = 15.0f, ki = 0.2f, kd = 0.5f; // Tăng Kp để motor phản ứng mạnh hơn
// Biến toàn cục
volatile long leftTicks = 0, rightTicks = 0;
volatile int lastEncodedLeft = 0;
volatile int lastEncodedRight = 0;
float targetLeftVel = 0, targetRightVel = 0;
float eprevL = 0, eintegralL = 0, eprevR = 0, eintegralR = 0;
long prevT = 0, lastTicksL = 0, lastTicksR = 0;

// Odometry & Telemetry
float robotX = 0, robotY = 0, robotTheta = 0; // Vị trí & Góc (Odom)
float robotDistance = 0;                      // Tổng quãng đường
float robotLinVel = 0, robotAngVel = 0;
float robotAccel = 0, prevLinVel = 0;
unsigned long lastTelemetryTime = 0;

WebServer server(80);
WebSocketsServer webSocket(81);

// ISR Encoders (Full Quadrature Decoding)
void IRAM_ATTR leftISR() {
  int MSB = digitalRead(ENCODER_LEFT_A);
  int LSB = digitalRead(ENCODER_LEFT_B);
  int encoded = (MSB << 1) | LSB;
  int sum = (lastEncodedLeft << 2) | encoded;
  if (sum == 0b1101 || sum == 0b0100 || sum == 0b0010 || sum == 0b1011)
    leftTicks--;
  if (sum == 0b1110 || sum == 0b0111 || sum == 0b0001 || sum == 0b1000)
    leftTicks++;
  lastEncodedLeft = encoded;
}
void IRAM_ATTR rightISR() {
  int MSB = digitalRead(ENCODER_RIGHT_A);
  int LSB = digitalRead(ENCODER_RIGHT_B);
  int encoded = (MSB << 1) | LSB;
  int sum = (lastEncodedRight << 2) | encoded;
  if (sum == 0b1101 || sum == 0b0100 || sum == 0b0010 || sum == 0b1011)
    rightTicks++;
  if (sum == 0b1110 || sum == 0b0111 || sum == 0b0001 || sum == 0b1000)
    rightTicks--;
  lastEncodedRight = encoded;
}

// Logic điều khiển Motor
void setMotor(int in1, int in2, int pwmCh, float u) {
  int pwr = (int)fabs(u);
  // Deadzone compensation: Tăng mạnh lên 140 để chắc chắn bánh quay được khi
  // Pivot Turn
  if (pwr > 2 && pwr < 140)
    pwr = 140;
  pwr = constrain(pwr, 0, 255);
  if (u > 0) {
    digitalWrite(in1, HIGH);
    digitalWrite(in2, LOW);
  } else if (u < 0) {
    digitalWrite(in1, LOW);
    digitalWrite(in2, HIGH);
  } else {
    digitalWrite(in1, LOW);
    digitalWrite(in2, LOW);
  }
  ledcWrite(pwmCh, pwr);
}

// Kiểm tra điều khiển tay (Nút nhấn) - TẠM TẮT
void checkButtonControls() {
  /*
  bool up = digitalRead(BUTTON_UP) == LOW;
  bool down = digitalRead(BUTTON_DOWN) == LOW;
  bool left = digitalRead(BUTTON_LEFT) == LOW;
  bool right = digitalRead(BUTTON_RIGHT) == LOW;

  if (up || down || left || right) {
    // ... logic ...
  } else {
  */
  if (webSocket.connectedClients() == 0) {
    // Timeout safety - nếu mất kết nối thì dừng
    // (Logic này cần cải thiện sau)
  }
  /*
  }
  */
  float lin = 0, ang = 0;
  /*
  if (up)
    lin = 0.4f;
  else if (down)
    lin = -0.4f;

  if (left)
    ang = 1.0f; // Giảm tốc độ xoay cho dễ lái
  else if (right)
    ang = -1.0f;

  targetLeftVel = (lin - ang * WHEEL_SEPARATION / 2.0f) / WHEEL_RADIUS;
  targetRightVel = (lin + ang * WHEEL_SEPARATION / 2.0f) / WHEEL_RADIUS;
} else {
  // ƯU TIÊN WEBSOCKET:
  // Nếu WebSocket đang điều khiển (targetVel khác 0), ta bỏ qua nút nhấn vật
  // lý để tránh conflicts. Nếu WebSocket = 0, ta mới xét đến nút nhấn.
  if (abs(targetLeftVel) > 0.01 || abs(targetRightVel) > 0.01) {
    // Đang có lệnh từ Web, không làm gì cả (để Web quyết định)
  } else {
    // Không có lệnh Web, nếu cũng không nhấn nút -> Dừng
    targetLeftVel = 0;
    targetRightVel = 0;
  }
}
*/
}

void setup() {
  Serial.begin(115200);

  // Motor Pins
  pinMode(MOTOR_LEFT_IN1, OUTPUT);
  pinMode(MOTOR_LEFT_IN2, OUTPUT);
  pinMode(MOTOR_RIGHT_IN3, OUTPUT);
  pinMode(MOTOR_RIGHT_IN4, OUTPUT);

  // PWM EN Pins
  ledcSetup(0, 20000, 8);
  ledcAttachPin(MOTOR_LEFT_EN, 0);
  ledcSetup(2, 20000, 8); // Đổi sang kênh 2 cho an toàn
  ledcAttachPin(MOTOR_RIGHT_EN, 2);

  // SAFETY STOP: Đảm bảo motor dừng ngay khi khởi động
  ledcWrite(0, 0);
  ledcWrite(2, 0);
  digitalWrite(MOTOR_LEFT_IN1, LOW);
  digitalWrite(MOTOR_LEFT_IN2, LOW);
  digitalWrite(MOTOR_RIGHT_IN3, LOW);
  digitalWrite(MOTOR_RIGHT_IN4, LOW);

  /* Button Pins - Tạm tắt
  pinMode(BUTTON_UP, INPUT_PULLUP);
  pinMode(BUTTON_DOWN, INPUT_PULLUP);
  pinMode(BUTTON_LEFT, INPUT_PULLUP);
  pinMode(BUTTON_RIGHT, INPUT_PULLUP);
  */

  // Encoder Pins
  pinMode(ENCODER_LEFT_A, INPUT_PULLUP);
  pinMode(ENCODER_LEFT_B, INPUT_PULLUP);
  pinMode(ENCODER_RIGHT_A, INPUT_PULLUP);
  pinMode(ENCODER_RIGHT_B, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(ENCODER_LEFT_A), leftISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_LEFT_B), leftISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_RIGHT_A), rightISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_RIGHT_B), rightISR, CHANGE);

  // WiFi
  WiFiManager wm;
  wm.autoConnect("AMR_Robot_AP");

  server.on("/", []() {
    String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>AMR Dashboard</title>
  <style>
    body { font-family: 'Segoe UI', Arial; background: #1e1e1e; color: #ddd; margin: 0; display: flex; flex-direction: column; align-items: center; }
    h2 { margin: 10px 0; color: #fff; }
    .container { display: flex; flex-wrap: wrap; justify-content: center; width: 100%; max-width: 1200px; }
    .panel { background: #2d2d2d; padding: 15px; border-radius: 10px; margin: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
    .control-panel { width: 300px; }
    .map-panel { flex-grow: 1; display: flex; flex-direction: column; align-items: center; }
    
    /* Map Style */
    canvas { background: #000; border: 2px solid #444; border-radius: 5px; cursor: crosshair; }
    
    /* Control Style */
    .btn-grid { display: grid; gap: 10px; grid-template-columns: repeat(3, 1fr); margin-bottom: 20px; }
    .btn { height: 60px; border-radius: 8px; border: none; font-size: 24px; cursor: pointer; background: #444; color: white; box-shadow: 0 4px #111; user-select: none; }
    .btn:active { background: #666; transform: translateY(2px); box-shadow: 0 2px #111; }
    .btn.stop { background: #c0392b; grid-column: 2; }
    .spacer { grid-column: 1 / 3; }

    /* Sliders */
    .slider-group { margin-bottom: 15px; }
    .slider-Header { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 5px; color: #888; }
    .slider-val { color: #f1c40f; font-weight: bold; }
    input[type=range] { width: 100%; height: 6px; background: #555; outline: none; -webkit-appearance: none; border-radius: 3px; }
    input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; background: #3498db; border-radius: 50%; cursor: pointer; transition: .2s; }

    /* Inputs */
    .settings-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
    .inp-box { background: #333; border: 1px solid #555; color: white; padding: 5px; width: 100%; border-radius: 4px; }
    label { font-size: 12px; color: #aaa; }

    /* Telemetry */
    .telemetry { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 14px; margin-top: 10px; border-top: 1px solid #444; padding-top: 10px; }
    .tm-item span { color: #2ecc71; font-weight: bold; float: right; }
  </style>
</head>
<body>
  <h2>AMR Control Center</h2>
  <div class="container">
    
    <!-- MAP PANEL -->
    <div class="panel map-panel">
      <canvas id="mapCanvas" width="500" height="500"></canvas>
      <div style="font-size: 12px; margin-top: 5px; color: #888;">Map Size: <span id="lblMapSize">20</span>x<span id="lblMapSize2">20</span>m | Grid: 1m</div>
    </div>

    <!-- CONTROL PANEL -->
    <div class="panel control-panel">
      <!-- Joystick -->
      <div class="btn-grid">
        <button class="btn" style="grid-column: 2" ontouchstart="move(1,0)" onmousedown="move(1,0)" ontouchend="stop()" onmouseup="stop()">&#8593;</button>
        <button class="btn" style="grid-column: 1; grid-row: 2" ontouchstart="move(0,1)" onmousedown="move(0,1)" ontouchend="stop()" onmouseup="stop()">&#8592;</button>
        <button class="btn stop" style="grid-row: 2" onclick="stop()">STOP</button>
        <button class="btn" style="grid-column: 3; grid-row: 2" ontouchstart="move(0,-1)" onmousedown="move(0,-1)" ontouchend="stop()" onmouseup="stop()">&#8594;</button>
        <button class="btn" style="grid-column: 2; grid-row: 3" ontouchstart="move(-1,0)" onmousedown="move(-1,0)" ontouchend="stop()" onmouseup="stop()">&#8595;</button>
      </div>

      <!-- Sliders -->
      <div class="slider-group">
        <div class="slider-Header"><span>Max Speed</span> <span id="v_lin" class="slider-val">0.5</span>m/s</div>
        <input type="range" min="0.1" max="1.5" step="0.05" value="0.5" id="s_lin" oninput="updVal('lin')">
      </div>
      <div class="slider-group">
        <div class="slider-Header"><span>Turn Speed</span> <span id="v_ang" class="slider-val">1.5</span>rad/s</div>
        <input type="range" min="0.5" max="5.0" step="0.1" value="1.5" id="s_ang" oninput="updVal('ang')">
      </div>

      <!-- Settings -->
      <div class="settings-group">
        <div><label>Map Size (m)</label><input type="number" id="cfg_map" class="inp-box" value="20" onchange="initMap()"></div>
        <div><label>Wheel Radius</label><input type="number" id="cfg_r" class="inp-box" value="0.033"></div>
        <div><label>Wheel Base</label><input type="number" id="cfg_b" class="inp-box" value="0.170"></div>
        <button onclick="saveCfg()" style="grid-column: span 2; background: #3498db; border:none; padding: 5px; color:white; border-radius:4px; cursor:pointer">Update Config</button>
      </div>

      <!-- Telemetry -->
      <div class="telemetry">
        <div class="tm-item">X: <span id="t_x">0.00</span></div>
        <div class="tm-item">Y: <span id="t_y">0.00</span></div>
        <div class="tm-item">Heading: <span id="t_h">0°</span></div>
        <div class="tm-item">Dist: <span id="t_d">0.00 m</span></div>
        <div class="tm-item">Vel: <span id="t_v">0.00</span></div>
        <div class="tm-item">Status: <span id="status" style="color:red">...</span></div>
      </div>
    </div>
  </div>

  <script>
    var ws, ctx, cvs;
    var robot = {x: 0, y: 0, th: 0};
    var mapSize = 20; // meters
    var scale = 25; // pixels per meter

    function init() {
      cvs = document.getElementById('mapCanvas');
      ctx = cvs.getContext('2d');
      initMap();
      
      ws = new WebSocket('ws://' + window.location.hostname + ':81/');
      ws.onopen = () => { document.getElementById('status').innerText = 'LINKED'; document.getElementById('status').style.color = '#2ecc71'; };
      ws.onclose = () => { document.getElementById('status').innerText = 'LOST'; document.getElementById('status').style.color = '#e74c3c'; setTimeout(init, 2000); };
      ws.onmessage = (e) => {
        var d = JSON.parse(e.data);
        if(d.telem) {
          // Update Telemetry Display
          document.getElementById('t_v').innerText = d.v.toFixed(2);
          document.getElementById('t_h').innerText = d.h.toFixed(1) + '°';
          document.getElementById('t_d').innerText = d.d.toFixed(2);
          document.getElementById('t_x').innerText = d.x.toFixed(2);
          document.getElementById('t_y').innerText = d.y.toFixed(2);
          
          // Update Robot Position from Real Odometry
          robot.x = d.x; 
          robot.y = d.y;
          robot.th = d.h * Math.PI / 180;
          
          drawMap();
        }
      };
    }

    function initMap() {
      mapSize = parseFloat(document.getElementById('cfg_map').value);
      document.getElementById('lblMapSize').innerText = mapSize;
      document.getElementById('lblMapSize2').innerText = mapSize;
      scale = cvs.width / mapSize;
      drawMap();
    }

    function drawMap() {
      // Clear
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cvs.width, cvs.height);
      
      // Grid
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
      for(let i=0; i<=mapSize; i++) {
        let p = i * scale;
        ctx.beginPath(); ctx.moveTo(p,0); ctx.lineTo(p,cvs.height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0,p); ctx.lineTo(cvs.width,p); ctx.stroke();
      }

      // Draw Robot (Center of Map + Offset)
      let cx = cvs.width/2 + robot.x * scale;
      let cy = cvs.height/2 - robot.y * scale; // Invert Y for cartesian

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-robot.th); // Canvas rotation is clockwise
      
      // Robot Body
      ctx.fillStyle = '#3498db';
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, 2*Math.PI); ctx.fill();
      // Heading Line
      ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0, -15); ctx.stroke();
      
      ctx.restore();
    }

    /* CONTROL LOGIC */
    function updVal(k) { document.getElementById('v_'+k).innerText = document.getElementById('s_'+k).value; }
    
    function move(x, z) {
      if(ws.readyState == 1) {
        let v = document.getElementById('s_lin').value;
        let w = document.getElementById('s_ang').value;
        ws.send(JSON.stringify({linear: x*v, angular: z*w}));
        
        // Sim motion for visual feedback until Odometry is fully working
        if(x) { robot.x += Math.sin(robot.th)*0.1*x; robot.y += Math.cos(robot.th)*0.1*x; }
        drawMap();
      }
    }
    
    function stop() { if(ws.readyState == 1) ws.send(JSON.stringify({linear:0, angular:0})); }
    
    function saveCfg() {
       // Send config to ESP32 (Placeholder)
       alert('Config Sent! (Feature pending on ESP side)');
    }

    window.onload = init;
  </script>
</body>
</html>
)rawliteral";
    server.send(200, "text/html", html);
  });

  server.onNotFound([]() { server.send(404, "text/plain", ""); });

  server.begin();
  webSocket.begin();
  webSocket.onEvent([](uint8_t num, WStype_t type, uint8_t *payload,
                       size_t length) {
    if (type == WStype_TEXT) {
      JsonDocument doc;
      deserializeJson(doc, payload);
      if (doc["linear"].is<float>()) {
        float lin = doc["linear"], ang = doc["angular"];
        Serial.printf("WEB CMD: Lin=%.2f Ang=%.2f\n", lin, ang); // DEBUG WEB
        targetLeftVel = (lin - ang * WHEEL_SEPARATION / 2.0f) / WHEEL_RADIUS;
        targetRightVel = (lin + ang * WHEEL_SEPARATION / 2.0f) / WHEEL_RADIUS;
      }
    }
  });

  // TEST CỨNG TỪNG CHIỀU:

  // 1. Trái Tiến
  Serial.println("TEST: Left Forward");
  digitalWrite(MOTOR_LEFT_IN1, HIGH);
  digitalWrite(MOTOR_LEFT_IN2, LOW);
  ledcWrite(0, 200);
  delay(1000);
  ledcWrite(0, 0);
  delay(500);

  // 2. Trái Lùi (Kiểm tra đảo chiều)
  Serial.println("TEST: Left Backward");
  digitalWrite(MOTOR_LEFT_IN1, LOW);
  digitalWrite(MOTOR_LEFT_IN2, HIGH);
  ledcWrite(0, 200);
  delay(1000);
  ledcWrite(0, 0);
  delay(500);

  // 3. Phải Tiến
  Serial.println("TEST: Right Forward");
  digitalWrite(MOTOR_RIGHT_IN3, HIGH);
  digitalWrite(MOTOR_RIGHT_IN4, LOW);
  ledcWrite(1, 200);
  delay(1000);
  ledcWrite(1, 0);
  delay(500);

  // 4. Phải Lùi (Kiểm tra đảo chiều)
  Serial.println("TEST: Right Backward");
  digitalWrite(MOTOR_RIGHT_IN3, LOW);
  digitalWrite(MOTOR_RIGHT_IN4, HIGH);
  ledcWrite(1, 200);
  delay(1000);
  ledcWrite(1, 0);
  delay(500);

  prevT = micros();
}

void loop() {
  server.handleClient();
  webSocket.loop();
  // checkButtonControls(); // Commented out as per instruction

  long currT = micros();
  float deltaT = ((float)(currT - prevT)) / 1.0e6;
  if (deltaT >= 0.02) {
    prevT = currT;
    noInterrupts();
    long cL = leftTicks, cR = rightTicks;
    interrupts();

    float vL = ((float)(cL - lastTicksL) / TICKS_PER_REV * 2.0f * PI) / deltaT;
    float vR = ((float)(cR - lastTicksR) / TICKS_PER_REV * 2.0f * PI) / deltaT;
    lastTicksL = cL;
    lastTicksR = cR;

    // --- KINEMATICS & ODOMETRY ---
    // Tính vận tốc robot thực tế từ Encoder
    float v = (vR + vL) / 2.0f;             // Vận tốc dài trung bình
    float w = (vR - vL) / WHEEL_SEPARATION; // Vận tốc góc thực tế

    // Tính quãng đường & góc
    float distStep = v * deltaT;
    robotDistance += fabs(distStep); // Tổng quãng đường đi được
    robotTheta += w * deltaT;

    // Chuẩn hóa góc về -PI đến PI (hoặc đổi sang độ để hiển thị)
    // Tính gia tốc
    robotAccel = (v - prevLinVel) / deltaT;
    prevLinVel = v;

    robotLinVel = v;
    robotAngVel = w;

    // Broadcasting Telemetry every 200ms
    if (millis() - lastTelemetryTime > 200) {
      lastTelemetryTime = millis();
      String jsonString = "{\"telem\":true,\"v\":";
      jsonString += String(robotLinVel, 2);
      jsonString += ",\"h\":";
      jsonString += String(robotTheta * 180.0 / PI, 1); // Đổi sang độ
      jsonString += ",\"d\":";
      jsonString += String(robotDistance, 2);
      jsonString += ",\"a\":";
      jsonString += String(robotAccel, 2);
      jsonString += "}";
      webSocket.broadcastTXT(jsonString);
    }
    // -----------------------------

    /* PID CONTROL - TẠM TẮT ĐỂ TEST PHẦN CỨNG
    float errorL = targetLeftVel - vL;
    eintegralL += errorL * deltaT;
    eintegralL = constrain(eintegralL, -50, 50); // Anti-windup
    float uL = kp * errorL + kd * (errorL - eprevL) / deltaT + ki * eintegralL;
    eprevL = errorL;

    float errorR = targetRightVel - vR;
    eintegralR += errorR * deltaT;
    eintegralR = constrain(eintegralR, -50, 50); // Anti-windup
    float uR = kp * errorR + kd * (errorR - eprevR) / deltaT + ki * eintegralR;
    eprevR = errorR;
    */

    // OPEN LOOP CONTROL (Test Thô)
    // Tăng gain lên 25.0 để chạy và xoay nhanh hơn
    float uL = targetLeftVel * 25.0f;
    float uR = targetRightVel * 25.0f;

    setMotor(MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, 0, uL);
    setMotor(MOTOR_RIGHT_IN3, MOTOR_RIGHT_IN4, 2, uR); // Kênh 2

    // DEBUG: In thông tin mỗi 500ms
    static long lastDebug = 0;
    if (currT - lastDebug > 500000) {
      lastDebug = currT;
      Serial.printf(
          "[OPEN_LOOP] Tgt: %.2f %.2f | Mea: %.2f %.2f | PWM: %d %d\n",
          targetLeftVel, targetRightVel, vL, vR, (int)fabs(uL), (int)fabs(uR));
    }
  }
}