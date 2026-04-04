# AMR S3 — ESP32-S3 N16R8 + RPLidar A1M8

## Thư mục này chứa firmware mới cho ESP32-S3

### Thay đổi so với `amr/` (ESP32 DevKit v1)

| Tính năng         | amr (ESP32)         | amrs3 (ESP32-S3)       |
|-------------------|---------------------|------------------------|
| Board             | esp32doit-devkit-v1 | esp32-s3-devkitc-1     |
| Flash             | 4MB                 | 16MB                   |
| PSRAM             | Không               | OPI PSRAM (8MB)        |
| PWM API           | ledcSetup/Attach    | ledcAttach (mới)       |
| Motor EN          | GPIO 19, 27         | GPIO 8, 11             |
| Motor IN          | GPIO 5/18, 26/25    | GPIO 9/10, 12/13       |
| Encoder L         | GPIO 32, 33         | GPIO 4, 5              |
| Encoder R         | GPIO 17, 16         | GPIO 6, 7              |
| I2C (IMU/OLED)    | SDA=21, SCL=22      | SDA=41, SCL=42         |
| Battery ADC       | GPIO 35             | GPIO 1 (ADC1_CH0)      |
| **LiDAR A1M8**    | ❌ Không có         | ✅ UART1 RX=18, TX=17  |
| LiDAR Motor CTL   | ❌                  | GPIO 16 (HIGH=bật)     |

### Chú ý PIN ESP32-S3

- **Không dùng**: GPIO 0, 3, 19, 20 (USB/strapping)  
- **Không dùng**: GPIO 26–32 (PSRAM OPI trên N16R8)  
- **ADC an toàn khi WiFi bật**: ADC1 (GPIO 1–10) ✅  

### Kết nối RPLidar A1M8

```
RPLidar A1M8          ESP32-S3
──────────────────────────────────
TX (Lidar output)  →  GPIO 18 (RX1)
RX (Lidar input)   →  GPIO 17 (TX1)
GND                →  GND
5V                 →  5V (nguồn riêng)
MOTOCTL            →  GPIO 16 (HIGH = motor quay)
```

### Thư viện

- `robopeak/RPLidar@^1.0.0` — Driver A1M8
- `links2004/WebSockets` — WebSocket server
- `bblanchon/ArduinoJson` — JSON protocol
- `tzapu/WiFiManager` — WiFi provisioning
- `adafruit/Adafruit SSD1306` — OLED 128×32
- `jandrassy/TelnetStream` — Remote debug

### WebSocket Commands

| Command              | Mô tả                       |
|----------------------|-----------------------------|
| `{"cmd":"lidar_start"}` | Bật motor + bắt đầu quét |
| `{"cmd":"lidar_stop"}`  | Dừng quét + tắt motor    |
| `{"cmd":"reset_odom"}`  | Reset odometry            |
| `{"cmd":"recal_gyro"}`  | Tái hiệu chỉnh gyroscope |
| `{"cmd":"brake","val":1}` | Bật/tắt phanh điện tử  |
| `{"type":"config",...}` | Cấu hình PID/kinematics  |
| `{"linear":0.1,"angular":0}` | Lệnh vận tốc      |

### LiDAR Telemetry Format

```json
{"lidar":true, "pts":[angle0,dist0, angle1,dist1, ...]}
```
- `angle`: 0–360 độ  
- `dist`: mm  
- Tần suất: ~3Hz, tối đa 180 điểm/gói
