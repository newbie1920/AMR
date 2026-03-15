# AMR Control System

Hệ thống điều khiển AMR (Autonomous Mobile Robot) hoàn chỉnh với ROS2, ESP32, và Desktop Application.

![AMR Control Center](docs/screenshot.png)

## 📋 Tổng Quan

Dự án bao gồm 3 thành phần chính:

1. **ROS2 Packages** - Xử lý navigation, SLAM, và robot control
2. **ESP32 Firmware** - Điều khiển motor với micro-ROS
3. **Desktop Application** - Giao diện điều khiển với map real-time

## 🏗️ Cấu Trúc Dự Án

```
AMR/
├── amr_ws/                    # ROS2 Workspace
│   └── src/
│       ├── amr_description/   # URDF model, RViz config
│       ├── amr_bringup/       # Launch files, Gazebo world
│       └── amr_navigation/    # Nav2, SLAM Toolbox config
├── esp32_firmware/            # PlatformIO project
│   ├── include/               # Header files
│   └── src/                   # Source files
└── desktop_app/               # Electron + React app
    ├── electron/              # Electron main process
    └── src/                   # React components
```

## 🔧 Yêu Cầu Hệ Thống

### ROS2 (Ubuntu/WSL2)
- ROS2 Humble hoặc Iron
- Nav2
- SLAM Toolbox
- Gazebo (Ignition)
- rosbridge_server

### ESP32
- PlatformIO
- micro-ROS
- ESP32 DevKit

### Desktop App
- Node.js >= 18
- npm hoặc yarn

## 🚀 Hướng Dẫn Cài Đặt

### 1. ROS2 Packages

```bash
# Clone và build
cd ~/
mkdir -p amr_ws/src
cp -r /path/to/AMR/amr_ws/src/* ~/amr_ws/src/

# Install dependencies
cd ~/amr_ws
rosdep install --from-paths src --ignore-src -r -y

# Build
colcon build --symlink-install
source install/setup.bash
```

### 2. ESP32 Firmware

```bash
cd esp32_firmware

# Cấu hình WiFi và Agent IP trong include/config.h
# Sửa WIFI_SSID, WIFI_PASSWORD, MICRO_ROS_AGENT_IP

# Build và Upload
pio run --target upload
```

### 3. Desktop Application

```bash
cd desktop_app

# Install dependencies
npm install

# Development mode
npm run electron:dev

# Build production
npm run electron:build
```

## 📡 Kết Nối Hệ Thống

### Khởi động ROS2 System

```bash
# Terminal 1: Robot + Navigation
ros2 launch amr_bringup amr.launch.py

# Terminal 2: micro-ROS Agent (cho ESP32)
ros2 run micro_ros_agent micro_ros_agent udp4 --port 8888
```

### Khởi động Simulation (Optional)

```bash
ros2 launch amr_bringup simulation.launch.py
```

### Khởi động Desktop App

```bash
cd desktop_app
npm run electron:dev
```

## 🎮 Điều Khiển

### Keyboard
- **W/A/S/D** - Di chuyển robot
- **Q/E** - Xoay + tiến
- **Space** - Dừng

### Mouse
- **Click trên map** - Đặt navigation goal
- **Scroll** - Zoom in/out
- **Middle-click + drag** - Pan map

## 🔌 Sơ Đồ Nối Dây Linh Kiện (Hardware Wiring)

Hệ thống sử dụng **ESP32** kết hợp với Driver động cơ **L298N** (hoặc tương đương) và động cơ DC có **Encoder**. Dưới đây là cấu hình chân thực tế đã được lập trình trong Firmware.

### 1. Kết nối Động cơ (Motor Driver - L298N)
| Linh kiện | Chân ESP32 | Chân L298N | Chức năng |
| :--- | :--- | :--- | :--- |
| **Motor Trái** | GPIO 19 | ENA | PWM (Tốc độ) |
| | GPIO 5 | IN1 | Hướng quay |
| | GPIO 18 | IN2 | Hướng quay |
| **Motor Phải** | GPIO 27 | ENB | PWM (Tốc độ) |
| | GPIO 26 | IN3 | Hướng quay |
| | GPIO 25 | IN4 | Hướng quay |

### 2. Kết nối Encoder
| Linh kiện | Chân ESP32 | Chân Encoder | Màu dây (Gợi ý) |
| :--- | :--- | :--- | :--- |
| **Encoder Trái** | GPIO 32 | Phase A | Trắng / Vàng |
| | GPIO 33 | Phase B | Xanh dương |
| **Encoder Phải** | GPIO 17 | Phase A | Trắng / Vàng |
| | GPIO 16 | Phase B | Xanh dương |
| **Nguồn** | 3.3V / 5V | VCC | Đỏ |
| | GND | GND | Đen |

### 3. Sơ đồ Nguồn (Power Supply)
*   **Pin 12V:** Cấp vào chân `VCC 12V` của L298N.
*   **GND:** Nối chung tất cả GND (Pin, ESP32, L298N, Encoder).
*   **5V Out (L298N):** Có thể dùng để cấp nguồn cho ESP32 nếu dùng nguồn Pin 12V.

> [!IMPORTANT]
> **Lưu ý về hướng quay:** Nếu robot đi tiến mà một bánh quay ngược, hãy đảo 2 dây nối từ L298N ra động cơ đó (OUT1-OUT2 hoặc OUT3-OUT4), KHÔNG cần sửa code.


## ⚙️ Cấu Hình

### Robot Parameters (`esp32_firmware/include/config.h`)
```cpp
#define WHEEL_RADIUS    0.05    // 50mm
#define WHEEL_SEPARATION 0.30   // 300mm
#define MAX_RPM         130
#define ENCODER_PPR     11
#define GEAR_RATIO      90
```

### PID Tuning
```cpp
#define PID_KP  2.0
#define PID_KI  0.5
#define PID_KD  0.1
```

## 📸 Screenshots

### Desktop Application
- Real-time map với robot position
- Task management system
- Manual joystick control
- Navigation goal setting

## 🔍 Troubleshooting

### ESP32 không kết nối được micro-ROS Agent
1. Kiểm tra WiFi SSID/Password trong `config.h`
2. Kiểm tra IP của Agent
3. Đảm bảo Agent đang chạy: `ros2 run micro_ros_agent micro_ros_agent udp4 --port 8888`

### Desktop App không kết nối được ROS
1. Kiểm tra rosbridge_server đang chạy
2. Kiểm tra URL: `ws://localhost:9090`
3. Kiểm tra firewall

### Robot không di chuyển
1. Kiểm tra nối dây L298N
2. Kiểm tra nguồn 12V
3. Kiểm tra encoder connections

## 📄 License

MIT License

## 👨‍💻 Tác Giả

AMR Developer
