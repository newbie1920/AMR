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

## 🔌 Sơ Đồ Nối Dây ESP32

ESP32          L298N          Motor
----------------------------------
GPIO19 (EN)    ENA            Left Motor
GPIO18         IN1            Left Motor
GPIO5          IN2            Left Motor
GPIO4 (EN)     ENB            Right Motor
GPIO17         IN3            Right Motor
GPIO16         IN4            Right Motor
GND            GND            -
-              OUT1/2         Left Motor
-              OUT3/4         Right Motor

ESP32          Encoder (Left)
----------------------------------
GPIO35         Channel A
GPIO34         Channel B
GND            GND

ESP32          Encoder (Right)
----------------------------------
GPIO23         Channel A
GPIO22         Channel B
GND            GND

ESP32          Touch Controls
----------------------------------
GPIO14         Up
GPIO27         Down
GPIO32         Left
GPIO33         Right


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
