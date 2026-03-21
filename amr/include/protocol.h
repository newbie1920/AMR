// =======================================================================================
//   AMR TYPED WEBSOCKET PROTOCOL - v1.0
//   Thay thế ROS2 message types bằng typed JSON schema
//
//   MESSAGE FORMAT: Mỗi message đều có field "type" để phân biệt loại
//
//   INBOUND (Desktop → Robot):
//     cmd_vel : Điều khiển vận tốc (tương đương geometry_msgs/Twist)
//     config  : Cập nhật tham số robot
//     cmd     : Lệnh đặc biệt (reset_odom, calibrate_imu, e_stop)
//
//   OUTBOUND (Robot → Desktop):
//     telem   : Telemetry tổng hợp (tương đương nav_msgs/Odometry +
//     sensor_msgs/Imu) status  : Trạng thái hệ thống (WiFi, uptime, battery)
//     scan    : (Future) LiDAR scan data (tương đương sensor_msgs/LaserScan)
// =======================================================================================

#pragma once

// =======================================================================================
//   INBOUND MESSAGE TYPES
// =======================================================================================

// --- CMD_VEL (tương đương geometry_msgs/Twist) ---
// {
//   "type": "cmd_vel",
//   "linear": <float m/s>,    // Vận tốc tịnh tiến (+ = forward)
//   "angular": <float rad/s>  // Vận tốc góc (+ = counterclockwise / quay trái)
// }
#define MSG_TYPE_CMD_VEL "cmd_vel"

// --- CONFIG (tham số robot runtime) ---
// {
//   "type": "config",
//   "ticks_per_rev": <int>,     // Encoder ticks/vòng
//   "wheel_radius": <float m>,  // Bán kính bánh xe
//   "wheel_separation": <float m>, // Khoảng cách 2 bánh
//   "max_vel": <float m/s>,     // Optional: giới hạn vận tốc
//   "max_accel": <float m/s2>   // Optional: giới hạn gia tốc
// }
#define MSG_TYPE_CONFIG "config"

// --- CMD (lệnh đặc biệt) ---
// {
//   "type": "cmd",
//   "cmd": "reset_odom" | "calibrate_imu" | "e_stop" | "clear_e_stop"
// }
#define MSG_TYPE_CMD "cmd"

// =======================================================================================
//   OUTBOUND MESSAGE TYPES
// =======================================================================================

// --- TELEM (tương đương nav_msgs/Odometry + sensor_msgs/Imu) ---
// {
//   "type": "telem",
//   "seq": <int>,           // Sequence number (tương đương ROS header.seq)
//   "ts": <long ms>,        // Timestamp millis() (tương đương header.stamp)
//
//   // Pose (tương đương nav_msgs/Odometry.pose)
//   "x": <float m>,         // Vị trí X trong frame odom
//   "y": <float m>,         // Vị trí Y trong frame odom
//   "theta": <float rad>,   // Hướng (yaw) trong frame odom
//
//   // Twist (tương đương nav_msgs/Odometry.twist)
//   "vx": <float m/s>,      // Vận tốc tịnh tiến đo từ encoder
//   "vy": <float m/s>,      // Luôn = 0 cho differential drive
//   "wz": <float rad/s>,    // Vận tốc góc đo từ encoder/IMU
//
//   // IMU (tương đương sensor_msgs/Imu)
//   "imu": {
//     "ax": <float m/s2>,   // Gia tốc X (đã lọc)
//     "ay": <float m/s2>,   // Gia tốc Y (đã lọc)
//     "az": <float m/s2>,   // Gia tốc Z (đã lọc)
//     "gx": <float rad/s>,  // Gyro X (đã lọc)
//     "gy": <float rad/s>,  // Gyro Y (đã lọc)
//     "gz": <float rad/s>,  // Gyro Z (đã lọc)
//     "roll": <float rad>,  // Roll từ complementary filter
//     "pitch": <float rad>, // Pitch từ complementary filter
//     "yaw": <float rad>    // Yaw từ Kalman Filter
//   },
//
//   // Encoder raw (tương đương sensor_msgs/JointState)
//   "enc": {
//     "l": <long ticks>,    // Encoder trái tích lũy
//     "r": <long ticks>,    // Encoder phải tích lũy
//     "vl": <float rad/s>,  // Vận tốc góc bánh trái
//     "vr": <float rad/s>   // Vận tốc góc bánh phải
//   },
//
//   // Fused position (EKF output, tương đương odometry/filtered)
//   "fused": {
//     "x": <float m>,       // Vị trí X từ sensor fusion
//     "y": <float m>,       // Vị trí Y từ sensor fusion
//     "vx": <float m/s>,    // Vận tốc X từ sensor fusion
//     "vy": <float m/s>     // Vận tốc Y từ sensor fusion
//   },
//
//   "stationary": <bool>,   // ZUPT: robot đang đứng yên?
//   "distance": <float m>   // Tổng quãng đường đã đi
// }
#define MSG_TYPE_TELEM "telem"

// --- STATUS (tương đương diagnostic_msgs) ---
// {
//   "type": "status",
//   "ts": <long ms>,
//   "uptime": <long s>,       // Thời gian từ khi boot
//   "wifi_rssi": <int dBm>,   // WiFi signal strength
//   "wifi_ip": <string>,      // IP address
//   "heap_free": <int bytes>, // RAM còn trống
//   "imu_ok": <bool>,         // MPU6050 hoạt động bình thường
//   "e_stop": <bool>          // Emergency stop active?
// }
#define MSG_TYPE_STATUS "status"

// =======================================================================================
//   TELEMETRY RATES
// =======================================================================================
#define TELEM_RATE_HZ 10   // Hz - telemetry broadcast rate
#define STATUS_RATE_HZ 1   // Hz - status broadcast rate
#define CONTROL_RATE_HZ 50 // Hz - motor control loop rate
#define IMU_RATE_HZ 200    // Hz - IMU sampling rate
#define TELEM_INTERVAL_MS (1000 / TELEM_RATE_HZ)
#define STATUS_INTERVAL_MS (1000 / STATUS_RATE_HZ)
#define CONTROL_INTERVAL_MS (1000 / CONTROL_RATE_HZ)
#define IMU_INTERVAL_MS (1000 / IMU_RATE_HZ)
