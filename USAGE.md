# Hướng dẫn sử dụng Hệ thống Robot AMR

## Yêu cầu hệ thống
- **Hệ điều hành**: Ubuntu 20.04 hoặc cao hơn.
- **RAM**: Tối thiểu 8GB.
- **CPU**: Intel i5 hoặc tương đương.
- **Đồ họa**: GPU hỗ trợ OpenGL 3.3.

## Bước cài đặt
1. **Cài đặt ROS2**:  
   - [Hướng dẫn cài đặt ROS2 trên Ubuntu](https://docs.ros.org/en/foxy/Installation/Ubuntu-Install-Debians.html)  
2. **Cài đặt ESP32 Firmware**:  
   - Tải firmware qua [ESP-IDF](https://github.com/espressif/esp-idf) và làm theo hướng dẫn cài đặt.
3. **Cài đặt Ứng dụng Desktop**:  
   - Chạy lệnh sau để cài đặt phần mềm đã biên dịch.
   ```bash
   sudo apt install <tên gói>
   ```

## Cách chạy ứng dụng
- Sau khi cài đặt, bạn có thể chạy ứng dụng bằng lệnh sau:
```bash
ros2 launch amr_launch.launch.py
```

## Tính năng chính
- Điều khiển robot tự động.
- Theo dõi vị trí và điều hướng.
- Tích hợp giao diện người dùng đồ họa để dễ sử dụng.

## Cấu hình
- Thay đổi các tham số trong file cấu hình nằm tại `src/amr/config.yaml`

## Khắc phục sự cố
- Nếu robot không khởi động: 
   - Kiểm tra kết nối điện./n- Nếu ứng dụng không khởi động:  
   - Kiểm tra các gói đã cài đặt đúng cách.

## Ví dụ sử dụng
- **Chạy thử nghiệm đường**:
   ```bash
   ros2 run amr run_test
   ```
- **Kết nối với ESP32**:
   - Đảm bảo rằng ESP32 đã được lập trình với firmware đúng. Sử dụng kết nối Wi-Fi để liên kết với robot.

---
Hãy tham khảo tài liệu ROS2 và tài liệu SDK ESP32 để biết thêm thông tin chi tiết.