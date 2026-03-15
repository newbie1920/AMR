# Báo cáo Công nghệ: Dự án Xe tự hành AMR (Autonomous Mobile Robot)

## 1. Tổng Quan Dự Án
Dự án AMR là một hệ thống robot tự hành tích hợp đa nền tảng, cho phép robot tự xây dựng bản đồ, định vị và di chuyển tới các vị trí mục tiêu. Hệ thống được thiết kế theo kiến trúc 3 lớp:
*   **Lớp điều khiển cấp cao (High-level Control):** Sử dụng hệ điều hành robot ROS2.
*   **Lớp giao diện và quản lý (User Interface):** Ứng dụng Desktop (Electron + React).
*   **Lớp điều khiển tầng thấp (Low-level Control):** Firmware chạy trên Vi điều khiển ESP32.

---

## 2. Kiến Trúc Hệ Thống

### 2.1. Lớp Điều khiển Cấp cao (ROS2)
Đây là "bộ não" của robot, xử lý các tác vụ phức tạp liên quan đến không gian:
*   **SLAM (Simultaneous Localization and Mapping):** Sử dụng SLAM Toolbox để xây dựng bản đồ môi trường 2D từ dữ liệu cảm biến Laser (LiDAR).
*   **Navigation (Nav2):** Tính toán quỹ đạo di chuyển từ vị trí hiện tại đến đích, đồng thời tránh các chướng ngại vật tĩnh và động.
*   **Robot Description:** Sử dụng file URDF để mô tả cấu trúc vật lý, kích thước và các khớp nối của robot trong môi trường mô phỏng và thực tế.

### 2.2. Lớp Giao diện (Desktop Application)
Giao diện người dùng được xây dựng hiện đại nhằm mục đích giám sát và vận hành:
*   **Công nghệ:** Electron kết hợp ReactJS, tạo ra ứng dụng đa nền tảng.
*   **Chức năng:**
    *   Hiển thị bản đồ thời gian thực (Real-time Map).
    *   Quản lý danh sách nhiệm vụ (Task Manager) và lộ trình (Waypoints).
    *   Điều khiển thủ công qua Joystick ảo hoặc bàn phím.
    *   Hiển thị thông số telemetry (tốc độ, dung lượng pin, vị trí x-y).

### 2.3. Lớp Điều khiển Tầng thấp (ESP32 Firmware)
Chịu trách nhiệm trực tiếp điều khiển chấp hành và phản hồi từ phần cứng:
*   **Đọc Encoder:** Sử dụng ngắt (Interrupts) để đếm xung từ động cơ với độ chính xác cao.
*   **Thuật toán PID:** Duy trì tốc độ ổn định của từng bánh xe dựa trên sai số giữa tốc độ thực tế và mục tiêu.
*   **Cơ chế Bù (Compensation):**
    *   **Feedforward:** Nhạy bén trong việc cung cấp điện áp mồi giúp robot phản ứng tức thời.
    *   **Deadband Compensation:** Vượt qua lực ma sát tĩnh của động cơ khi bắt đầu di chuyển.
    *   **Virtual Axle (Khóa đồng bộ):** Một thuật toán thông minh so sánh dữ liệu từ hai encoder để đảm bảo robot luôn đi thẳng tắp, không bị lệch hướng do sự khác biệt giữa hai động cơ.
*   **Ramp Speed:** Tự động điều chỉnh gia tốc mục tiêu để robot khởi động và dừng lại một cách mượt mà, tránh bị rung lắc cơ khí.

---

## 3. Công Nghệ Truyền Thông (Communication)

Hệ thống sử dụng các giao thức kết nối linh hoạt tùy theo nhu cầu:
1.  **WebSockets:** Được sử dụng để truyền dữ liệu Telemetry và điều khiển thủ công giữa Desktop App và ESP32 với độ trễ cực thấp qua WiFi.
2.  **ROS Bridge:** Chuyển đổi dữ liệu giữa môi trường ROS2 (thường chạy trên Linux) và ứng dụng Desktop (thường chạy trên Windows) thông qua các thông điệp JSON.
3.  **HTTP/JSON:** Sử dụng để cấu hình các tham số vật lý của robot (bán kính bánh xe, khoảng cách trục, hệ số PID) mà không cần nạp lại code.

---

## 4. Thành Phần Phần Cứng

*   **Vi điều khiển chính:** ESP32 (Khả năng xử lý mạnh mẽ, tích hợp WiFi/Bluetooth).
*   **Động cơ:** Động cơ DC có gắn Encoder (Phản hồi tốc độ và vị trí).
*   **Mạch công suất:** Driver động cơ (như L298N hoặc các dòng tương đương) điều khiển bằng tín hiệu PWM.
*   **Cơ cấu truyền động:** 2 bánh chủ động (Differential Drive) và 1 hoặc 2 bánh tự do (Caster wheels).
*   **Cảm biến khoảng cách:** Cảm biến LiDAR (dùng cho SLAM) hoặc các cảm biến siêu âm/hồng ngoại hỗ trợ tránh va chạm.

---

## 5. Quy Trình Hoạt Động Đặc Trưng

1.  **Khởi tạo:** Người dùng mở App Desktop, kết nối với robot qua mạng nội bộ. Thiết lập các thông số PID và kích thước bánh xe thông qua giao diện UI.
2.  **Điều khiển di chuyển:** 
    *   Khi có lệnh di chuyển thẳng, bộ điều khiển cấp thấp trên ESP32 sẽ kích hoạt tính năng **Virtual Axle** để giữ robot không bị lệch.
    *   Dữ liệu từ Encoder được lọc qua bộ lọc nhiễu tự động để làm mượt số liệu vận tốc.
3.  **Điều hướng tự động:** ROS2 tính toán đường đi, gửi lệnh vận tốc xuống Robot. Robot phản hồi vị trí Odometry ngược lại để ROS2 cập nhật tọa độ trên bản đồ.
4.  **Giám sát:** Mọi biến động về sai số PID, điện năng và trạng thái di chuyển đều được "vẽ" ra trên ứng dụng Desktop dưới dạng đồ thị và bản đồ trực quan.

---
*Báo cáo được tổng hợp dựa trên cấu trúc thực tế của mã nguồn và kiến trúc hệ thống hiện tại.*
