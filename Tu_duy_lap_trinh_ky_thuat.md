tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
1 / 68TỔNG HỢP CÁ C VÍ DỤ C/C++
Theo tư duy lập trình cho kỹ sư (Điện – Điện tử – Tự động hóa)
Tài liệu này tổng hợp toàn bộ các ví dụ đã sử dụng tr ong giáo trình , nhằm minh họa cách xuất phát
từ bài toán thực tế → thiết kế str uct → lựa chọn if / loop / function / const .
Mỗi ví dụ được trình bày theo flow chuẩn 8 bước  (xem file mẫu:
vi_dụ_mẫu_hoan_chỉnh_tư_duy_thiết_kế_struct_trong_c.md ):
1. Bài toán thực tế → 2. Phân tích → 3. Thiết kế struct → 4. Public/Private → 5. Const/Non-const →
6. Code chạy được → 7. Phân tích tư duy → 8. Câu hỏi cho sinh viên
VÍ DỤ 1: RƠ-LE QU Á ÁP (IF / ELSE)
1. Bài toán thực tế
Trong các hệ thống phân phối điện , rơ-le bảo vệ quá áp (overvoltage relay) được lắp đặt để giám sát điện áp
trên đường dây. Khi điện áp vượt ngưỡng cho phép:
Rơ-le sẽ tác động  (trip) để ngắt tải
Bảo vệ thiết bị khỏi hư hỏng do quá áp
Một rơ-le quá áp cơ bản có các đặc điểm:
Đo điện áp liên tục
So sánh với ngưỡng cài đặt
Quyết định ngắt hoặc duy trì
Yêu cầu b ài toán: Xây dựng mô hình phần mềm mô phỏng hoạt động của rơ-le quá áp:
Cập nhật giá trị điện áp đo được
Kiểm tra điều kiện quá áp
Hiển thị trạng thái bảo vệ
Lưu ý: Đây là mô phỏng logic , không phải mô hình điện từ chi tiết.
2. Phân tích
2.1 Xác định đối tượng
Đối tượng cần mô hình hóa: Rơ-le quá áp (V oltage R elay)
2.2 Phân tích thuộc tính (Data)

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
2 / 68Thuộc tính Ý nghĩa Thay đổi theo thời gian
voltage Giá trị điện áp đo được (V) Có
threshold Ngưỡng quá áp cho phép (V) Không (cấu hình)
isTripped Trạng thái đã tác động hay chưa Có
→ voltage  thay đổi liên tục theo tín hiệu đầu vào. → threshold  là thông số cấu hình , không nên bị thay đổi
khi hệ thống đang chạy.
2.3 Phân tích hành vi (Function)
Hành vi Mô tả Thay đổi trạng thái
updateV oltage() Cập nhật giá trị đo mới Có
isOverV oltage() Kiểm tra điện áp có vượt ngưỡng Không
trip() Tác động rơ-le (ngắt tải) Có
reset() Reset rơ-le sau khi sửa lỗi Có
displayS tatus() Hiển thị trạng thái Không
3. Thiết kế struct
Ta thiết kế struct VoltageRelay  đại diện cho một rơ-le quá áp , gom:
Dữ liệu nội bộ: voltage, threshold, isT ripped
Hành vi: update, check, trip, reset, display
4. Phân biệt public / private
Nguyên tắc áp dụng
private : trạng thái nội bộ mà người dùng không được phép truy cập trực tiếp
public : giao diện giám sát và điều khiển
Áp dụng cho bài toán
private :
voltage (phải cập nhật qua hàm updateV oltage)
threshold (cấu hình cố định, gán lúc khởi tạo)
isTripped (chỉ thay đổi qua trip/reset)
public :
updateV oltage() — cập nhật đo lường
isOverV oltage() — kiểm tra điều kiện

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
3 / 68trip(), reset() — điều khiển
displayS tatus() — giám sát
→ Nếu cho phép gán trực tiếp voltage = -100  → sai logic hệ thống , cần kiểm soát.
5. Member function: const / non-const
Hàm const Giải thích
isOverV oltage() ✔ Chỉ đọc và so sánh
displayS tatus() ✔ Chỉ hiển thị
getVoltage() ✔ Chỉ trả về giá trị
updateV oltage() ❌ Thay đổi voltage
trip() ❌ Thay đổi isT ripped
reset() ❌ Thay đổi isT ripped
const  đảm bảo rằng khi gọi isOverVoltage() , ta cam kết không làm thay đổi  bất kỳ thuộc tính nào của
rơ-le.
6. Code mô phỏng chạy được
#include <iostream>
using namespace  std; 
 
struct VoltageRelay  {
private: 
    float voltage;  
    const float threshold;  
    bool isTripped;  
 
public: 
    // Constructor  
    VoltageRelay( float thresh)  
        : voltage( 0), threshold(thresh), isTripped( false) {} 
 
    void updateVoltage (float v) { 
        if (v < 0) { 
            cout << "Invalid voltage value!\n" ; 
            return; 
        }  
        voltage = v;  
    } 
 
    bool isOverVoltage () const { 
        return voltage > threshold;  
    } 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
4 / 68 
    float getVoltage () const { 
        return voltage;  
    } 
 
    void trip() { 
        isTripped = true; 
        cout << " ⚠ RELAY TRIPPED! Load disconnected.\n" ; 
    } 
 
    void reset() { 
        if (!isOverVoltage()) {  
            isTripped = false; 
            cout << "Relay reset. System normal.\n" ; 
        } else { 
            cout << "Cannot reset: voltage still above threshold!\n" ; 
        }  
    } 
 
    void displayStatus () const { 
        cout << "Voltage: "  << voltage << " V | " 
             << "Threshold: "  << threshold << " V | " 
             << "Status: "  << (isTripped ? "TRIPPED"  : "NORMAL" ) << "\n"; 
    } 
}; 
 
int main() { 
    VoltageRelay relay(240.0); 
 
    relay.displayStatus();  
 
    relay.updateVoltage( 220.0); 
    relay.displayStatus();  
    if (relay.isOverVoltage()) relay.trip();  
 
    relay.updateVoltage( 245.0); 
    relay.displayStatus();  
    if (relay.isOverVoltage()) relay.trip();  
 
    relay.updateVoltage( 230.0); 
    relay.reset();  
    relay.displayStatus();  
 
    return 0; 
} 
7. Phân tích tư duy kỹ thuật
Sinh viên rút ra được:
if / else  phát sinh tự nhiên từ logic bảo vệ: vượt ngưỡng → tác động

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
5 / 68threshold  là const  → ngưỡng không được phép thay đổi  khi hệ thống đang chạy
Kiểm tra điều kiện trước khi reset → defensiv e programming
Struct gom gọn: dữ liệu + logic liên quan đến rơ-le = một đơn vị
8. Câu hỏi tư duy cho sinh viên
1. Vì sao threshold  nên là const ? Điều gì xảy ra nếu cho phép thay đổi ngưỡng khi đang vận hành?
2. Vì sao hàm reset()  cần kiểm tra isOverVoltage()  trước khi reset?
3. Nếu cần mở rộng cho rơ-le 3 pha (đo 3 điện áp), struct cần thay đổi như thế nào?
4. Làm thế nào để thêm chức năng đếm số lần tác động  (trip counter)?
📌 Ví dụ này minh họa: cấu trúc điều kiện (if/else) + const + encapsulation
VÍ DỤ 2: PL C SCAN CY CLE (WHILE)
1. Bài toán thực tế
Trong hệ thống tự động hó a công nghiệp , PLC (Programmable Logic Controller) là bộ điều khiển trung tâm.
PLC hoạt động theo chu kỳ quét (scan cy cle):
1. Đọc tín hiệu đầu vào (input scan)
2. Xử lý logic (program execution)
3. Cập nhật đầu ra (output update)
4. Lặp lại liên tục cho đến khi nhận lệnh ST OP
Một PL C cơ bản có các đặc điểm:
Chạy liên tục 24/7
Có nút ST OP vật lý để dừng hệ thống
Đếm số chu kỳ quét đã thực hiện
Thời gian quét mỗi chu kỳ cần được giám sát
Yêu cầu b ài toán: Mô phỏng vòng quét PL C đơn giản:
Chạy liên tục cho đến khi nhấn ST OP
Ghi nhận số chu kỳ đã thực hiện
Hiển thị trạng thái mỗi chu kỳ
2. Phân tích
2.1 Xác định đối tượng
Đối tượng cần mô hình hóa: PLC Contr oller

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
6 / 682.2 Phân tích thuộc tính (Data)
Thuộc tính Ý nghĩa Thay đổi theo thời gian
stopButton Trạng thái nút ST OP Có (do tác động bên ngoài)
cycleCount Số chu kỳ quét đã chạy Có (tăng mỗi chu kỳ)
maxCycles Giới hạn chu kỳ (cho mô phỏng) Không
→ stopButton  là tín hiệu từ bên ngo ài, thay đổi bất cứ lúc nào.
2.3 Phân tích hành vi (Function)
Hành vi Mô tả Thay đổi trạng thái
isRunning() Kiểm tra PL C có đang chạy Không
executeCycle() Thực thi 1 chu kỳ quét Có
pressS top() Nhấn nút ST OP Có
getCycleCount() Đọc số chu kỳ Không
displayS tatus() Hiển thị trạng thái Không
3. Thiết kế struct
Thiết kế struct PLC  đại diện cho một bộ điều khiển PL C, gom:
Dữ liệu: stopButton, cycleCount, maxCycles
Hành vi: isRunning, executeCycle, pressS top, getCycleCount, displayS tatus
4. Phân biệt public / private
Áp dụng cho bài toán
private :
stopButton (chỉ thay đổi qua pressS top())
cycleCount (chỉ tăng qua executeCycle())
public :
isRunning() — kiểm tra trạng thái
executeCycle() — chạy 1 chu kỳ
pressS top() — tác động nút ST OP
getCycleCount() — đọc thông tin
displayS tatus() — giám sát
→ Không cho phép cycleCount = -1  hay stopButton = random()  từ bên ngoài.

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
7 / 685. Member function: const / non-const
Hàm const Giải thích
isRunning() ✔ Chỉ kiểm tra trạng thái
getCycleCount() ✔ Chỉ đọc dữ liệu
displayS tatus() ✔ Chỉ hiển thị
executeCycle() ❌ Tăng cycleCount
pressS top() ❌ Thay đổi stopButton
6. Code mô phỏng chạy được
#include <iostream>
using namespace  std; 
 
struct PLC {
private: 
    bool stopButton;  
    int cycleCount;  
 
public: 
    // Constructor  
    PLC() : stopButton( false), cycleCount( 0) {} 
 
    bool isRunning () const { 
        return !stopButton;  
    } 
 
    void executeCycle () { 
        cycleCount++;  
        // Simulate: Input scan → Process → Output update  
        cout << "Cycle "  << cycleCount  
             << ": [Input] → [Process] → [Output]\n" ; 
    } 
 
    void pressStop () { 
        stopButton = true; 
        cout << " ⛔ STOP button pressed!\n" ; 
    } 
 
    int getCycleCount () const { 
        return cycleCount;  
    } 
 
    void displayStatus () const { 
        cout << "PLC Status: "  
             << (stopButton ? "STOPPED"  : "RUNNING" ) 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
8 / 68             << " | Cycles completed: "  << cycleCount << "\n"; 
    } 
}; 
 
int main() { 
    PLC plc;  
 
    plc.displayStatus();  
 
    // PLC scan cycle — chạy liên tục  
    while (plc.isRunning()) {  
        plc.executeCycle();  
 
        // Mô phỏng: sau 5 chu kỳ, nhấn STOP  
        if (plc.getCycleCount() == 5) 
            plc.pressStop();  
    } 
 
    plc.displayStatus();  
 
    return 0; 
} 
7. Phân tích tư duy kỹ thuật
Sinh viên rút ra được:
while  phát sinh tự nhiên từ chu kỳ quét PL C: chạy liên tục cho đến khi có lệnh dừng
Điều kiện dừng ( stopButton ) là tín hiệu từ bên ngo ài, không phải từ logic nội bộ
Mô hình PL C = super loop: Input → Process → Output → lặp lại
Đây chính là pattern cơ bản của mọi hệ thống nhúng  (embedded main loop)
8. Câu hỏi tư duy cho sinh viên
1. Vì sao while phù hợp hơn for cho bài toán này?
2. Trong PL C thật, điều kiện dừng đến từ đâu? (nút nhấn, watchdog, lỗi hệ thống…)
3. Nếu muốn thêm thời gian quét  cho mỗi chu kỳ, cần bổ sung gì?
4. Làm thế nào để phân biệt dừng bình thường (ST OP) và dừng khẩn cấp (E-ST OP)?
📌 Ví dụ này minh họa: vòng lặp while + encapsulation + mô hình super loop
VÍ DỤ 3: QUÉT ADC NHIỀU KÊNH (FOR + ARRA Y)
1. Bài toán thực tế

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
9 / 68Trong hệ thống đo lường v à giám sát , bộ chuyển đổi tương tự – số (ADC) được dùng để đọc tín hiệu từ
nhiều cảm biến (nhiệt độ, áp suất, dòng điện…). Một module ADC thường có nhiều kênh:
Mỗi kênh nối đến một cảm biến khác nhau
Cần quét tuần tự tất cả các kênh
Tính giá trị trung bình, tìm giá trị lớn nhất / nhỏ nhất để đánh giá
Yêu cầu b ài toán: Mô phỏng module ADC 8 kênh:
Lưu trữ giá trị đo từ 8 kênh
Tính giá trị trung bình
Tìm kênh có giá trị lớn nhất / nhỏ nhất
Hiển thị kết quả tất cả các kênh
2. Phân tích
2.1 Xác định đối tượng
Đối tượng cần mô hình hóa: Module ADC nhiều k ênh
2.2 Phân tích thuộc tính (Data)
Thuộc tính Ý nghĩa Thay đổi theo thời gian
channel[8] Giá trị điện áp đo được từng kênh Có (mỗi lần quét)
numChannels Số kênh hiện dùng Không (cấu hình)
vref Điện áp tham chiếu (V) Không (cấu hình)
→ channel[]  là mảng giá trị , phù hợp để quét bằng vòng lặp for.
2.3 Phân tích hành vi (Function)
Hành vi Mô tả Thay đổi trạng thái
updateChannel() Cập nhật giá trị 1 kênh Có
scanAll() Quét tất cả các kênh Có
average() Tính trung bình Không
maxChannel() Tìm kênh có giá trị lớn nhất Không
minChannel() Tìm kênh có giá trị nhỏ nhất Không
displayAll() Hiển thị toàn bộ Không
3. Thiết kế struct

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
10 / 68Thiết kế struct ADC_Module  đại diện cho một module ADC đa k ênh:
Mảng channel[]  chứa giá trị đo
Các hàm tính toán thống kê trên mảng
4. Phân biệt public / private
Áp dụng cho bài toán
private :
channel[] (chỉ cập nhật qua hàm update/scan)
numChannels (cấu hình cố định)
public :
updateChannel(), scanAll() — cập nhật dữ liệu
average(), maxChannel(), minChannel() — truy vấn
displayAll() — giám sát
→ Không cho phép truy cập channel[100]  trực tiếp (out of bounds).
5. Member function: const / non-const
Hàm const Giải thích
average() ✔ Chỉ đọc mảng, tính toán
maxChannel() ✔ Chỉ tìm giá trị lớn nhất
minChannel() ✔ Chỉ tìm giá trị nhỏ nhất
displayAll() ✔ Chỉ hiển thị
updateChannel() ❌ Thay đổi channel[]
scanAll() ❌ Thay đổi channel[]
6. Code mô phỏng chạy được
#include <iostream>
#include <iomanip>
using namespace  std; 
 
struct ADC_Module  {
private: 
    float channel[ 8]; 
    const int numChannels;  
 
public: 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
11 / 68    // Constructor  
    ADC_Module() : numChannels( 8) { 
        for (int i = 0; i < numChannels; i++)  
            channel[i] = 0.0; 
    } 
 
    void updateChannel (int ch, float value) { 
        if (ch < 0 || ch >= numChannels) {  
            cout << "Invalid channel: "  << ch << "\n"; 
            return; 
        }  
        if (value < 0 || value > 3.3) { 
            cout << "Value out of ADC range (0 - 3.3V)!\n" ; 
            return; 
        }  
        channel[ch] = value;  
    } 
 
    float average() const { 
        float sum = 0; 
        for (int i = 0; i < numChannels; i++)  
            sum += channel[i];  
        return sum / numChannels;  
    } 
 
    int maxChannel () const { 
        int maxIdx = 0; 
        for (int i = 1; i < numChannels; i++) {  
            if (channel[i] > channel[maxIdx])  
                maxIdx = i;  
        }  
        return maxIdx;  
    } 
 
    int minChannel () const { 
        int minIdx = 0; 
        for (int i = 1; i < numChannels; i++) {  
            if (channel[i] < channel[minIdx])  
                minIdx = i;  
        }  
        return minIdx;  
    } 
 
    float getChannel (int ch) const { 
        if (ch >= 0 && ch < numChannels)  
            return channel[ch];  
        return -1; 
    } 
 
    void displayAll () const { 
        cout << "=== ADC Readings ===\n" ; 
        for (int i = 0; i < numChannels; i++) {  
            cout << "  CH" << i << ": " 
                 << fixed << setprecision( 2) 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
12 / 68                 << channel[i] << " V\n"; 
        }  
        cout << "  Average: "  << average() << " V\n"; 
        cout << "  Max: CH"  << maxChannel()  
             << " (" << channel[maxChannel()] << " V)\n"; 
        cout << "  Min: CH"  << minChannel()  
             << " (" << channel[minChannel()] << " V)\n"; 
    } 
}; 
 
int main() { 
    ADC_Module adc;  
 
    // Mô phỏng quét 8 kênh  
    float readings[] = { 1.1, 1.0, 1.2, 0.9, 1.3, 1.1, 1.0, 1.2}; 
    for (int i = 0; i < 8; i++) {  
        adc.updateChannel(i, readings[i]);  
    } 
 
    adc.displayAll();  
 
    // Test: giá trị ngoài phạm vi  
    adc.updateChannel( 3, 5.0); 
    adc.updateChannel( 10, 1.0); 
 
    return 0; 
} 
7. Phân tích tư duy kỹ thuật
Sinh viên rút ra được:
for phát sinh tự nhiên khi quét nhiều kênh ADC có cùng cấu trúc
Mảng  là cách biểu diễn tự nhiên cho tập hợp kênh đồng nhất
Kiểm tra range (0–3.3V) = input v alidation , rất quan trọng trong embedded
Các hàm thống kê (average, max, min) đều là const  → không ảnh hưởng trạng thái
8. Câu hỏi tư duy cho sinh viên
1. Tại sao for phù hợp hơn while khi quét ADC nhiều kênh?
2. Nếu ADC có resolution 12-bit (0–4095), cần thay đổi gì trong struct?
3. Làm thế nào để thêm chức năng lọc tr ung bình trượt  (moving average)?
4. Nếu cần quét liên tục (mỗi 10ms), cần kết hợp thêm yếu tố nào? (timer, interrupt…)
📌 Ví dụ này minh họa: vòng lặp for + mảng + validation + const functions

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
13 / 68VÍ DỤ 4: ĐỘNG CƠ ĐIỆN (TRẠNG THÁI + MEMBER
FUNCTION)
1. Bài toán thực tế
Trong các hệ thống tự động hó a công nghiệp , động cơ DC thường được sử dụng để:
Kéo băng tải
Quay trục robot
Điều khiển tốc độ quạt, bơm
Một động cơ DC cơ bản có các đặc điểm:
Có thể bật / tắt
Có tốc độ quay (rpm)
Có giới hạn tốc độ an toàn
Yêu cầu b ài toán: Xây dựng một mô hình phần mềm đơn giản để mô phỏng:
Bật / tắt động cơ
Thay đổi tốc độ
Quan sát trạng thái động cơ
Lưu ý: Đây là mô phỏng logic , không phải mô hình vật lý chi tiết.
2. Phân tích
2.1 Xác định đối tượng
Đối tượng cần mô hình hóa: Động cơ DC (DC Mot or)
2.2 Phân tích thuộc tính (Data)
Thuộc tính Ý nghĩa Thay đổi theo thời gian
speed Tốc độ hiện tại (rpm) Có
maxSpeed Tốc độ tối đa cho phép Không
isRunning Trạng thái ON/OFF Có
→ Đây là trạng thái nội bộ , cần được kiểm soát.
2.3 Phân tích hành vi (Function)
Hành vi Mô tả Thay đổi trạng thái

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
14 / 68Hành vi Mô tả Thay đổi trạng thái
start() Bật động cơ Có
stop() Tắt động cơ Có
setSpeed() Đặt tốc độ Có
getSpeed() Đọc tốc độ Không
displayS tatus() Hiển thị trạng thái Không
3. Thiết kế struct
Thiết kế struct DCMotor  đại diện cho một động cơ DC duy nhất , gồm:
Dữ liệu nội bộ: speed, maxSpeed, isRunning
Hành vi điều khiển và giám sát
4. Phân biệt public / private
Áp dụng cho bài toán
private :
speed (phải thay đổi qua setSpeed, có kiểm tra)
maxSpeed (cấu hình cố định)
isRunning (chỉ thay đổi qua start/stop)
public :
start(), stop() — điều khiển
setSpeed() — đặt tốc độ (có validation)
getSpeed() — đọc tốc độ
displayS tatus() — giám sát
→ Người dùng không được phép  gán speed = 99999  trực tiếp.
5. Member function: const / non-const
Hàm const Giải thích
getSpeed() ✔ Chỉ đọc dữ liệu
displayS tatus() ✔ Không thay đổi trạng thái
start() ❌ Thay đổi isRunning
stop() ❌ Thay đổi isRunning, speed
setSpeed() ❌ Thay đổi speed

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
15 / 68const  thể hiện cam kết thiết kế , giúp compiler phát hiện lỗi sớm.
6. Code mô phỏng chạy được
#include <iostream>
using namespace  std; 
 
struct DCMotor {
private: 
    int speed; 
    const int maxSpeed;  
    bool isRunning;  
 
public: 
    // Constructor  
    DCMotor( int maxSpd)  
        : speed( 0), maxSpeed(maxSpd), isRunning( false) {} 
 
    void start() { 
        isRunning = true; 
        cout << "Motor started.\n" ; 
    } 
 
    void stop() { 
        isRunning = false; 
        speed = 0; 
        cout << "Motor stopped.\n" ; 
    } 
 
    void setSpeed (int spd) { 
        if (!isRunning) {  
            cout << "Motor is OFF. Cannot set speed.\n" ; 
            return; 
        }  
        if (spd < 0 || spd > maxSpeed) {  
            cout << "Speed out of range! (0 - "  << maxSpeed << ")\n"; 
            return; 
        }  
        speed = spd;  
    } 
 
    int getSpeed () const { 
        return speed; 
    } 
 
    void displayStatus () const { 
        cout << "Motor: " ; 
        if (isRunning)  
            cout << "ON, Speed = "  << speed  
                 << " / " << maxSpeed << " rpm\n" ; 
        else 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
16 / 68            cout << "OFF\n"; 
    } 
}; 
 
int main() { 
    DCMotor motor(3000); 
 
    motor.displayStatus();  
 
    motor.start();  
    motor.setSpeed( 1500); 
    motor.displayStatus();  
 
    motor.setSpeed( 5000);  // Out of range  
 
    motor.stop();  
    motor.displayStatus();  
 
    motor.setSpeed( 1000);  // Motor is OFF  
 
    return 0; 
} 
7. Phân tích tư duy kỹ thuật
Sinh viên rút ra được:
Struct là mô hình hó a thực thể kỹ thuật  — mỗi motor = một object
Dữ liệu không được phép truy cập tùy tiện → encapsulation
const maxSpeed  = thông số kỹ thuật cố định, gán 1 lần duy nhất
Logic kiểm tra: không cho đặt tốc độ khi motor OFF, không vượt maxSpeed
Cách viết này chuyển sang class  gần như không thay đổi
8. Câu hỏi tư duy cho sinh viên
1. Vì sao không nên để speed  là public?
2. Điều gì xảy ra nếu bỏ const  ở displayStatus() ?
3. Làm thế nào để mở rộng struct này cho điều khiển PID?
4. Nếu có nhiều động cơ (mảng motor), ta quản lý thế nào?
📌 Ví dụ này minh họa: state management + validation + const + encapsulation
VÍ DỤ 5: CẢM BIẾN NHIỆT ĐỘ (C ONST / NON-C ONST)

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
17 / 681. Bài toán thực tế
Trong hệ thống giám sát nhiệt độ công nghiệp , cảm biến nhiệt độ (thermocouple, PT100, NT C…) được gắn
tại các điểm đo trên máy móc. Hệ thống cần:
Đọc nhiệt độ liên tục
So sánh với ngưỡng an t oàn
Phát cảnh báo khi vượt ngưỡng (overheat)
Một cảm biến nhiệt độ cơ bản có:
Giá trị đo hiện tại
Ngưỡng cảnh báo (cố định theo thiết kế)
Trạng thái có đang vượt ngưỡng hay không
Yêu cầu b ài toán: Mô phỏng cảm biến nhiệt độ:
Cập nhật giá trị đo
Kiểm tra quá nhiệt
Hiển thị trạng thái
2. Phân tích
2.1 Xác định đối tượng
Đối tượng cần mô hình hóa: Cảm biến nhiệt độ (T emperatur e Sensor)
2.2 Phân tích thuộc tính (Data)
Thuộc tính Ý nghĩa Thay đổi theo thời gian
value Nhiệt độ hiện tại (°C) Có (cập nhật liên tục)
limit Ngưỡng cảnh báo (°C) Không (cấu hình)
unit Đơn vị đo (°C, °F) Không (cấu hình)
→ value  thay đổi liên tục. limit  là thông số thiết kế , không nên bị thay đổi.
2.3 Phân tích hành vi (Function)
Hành vi Mô tả Thay đổi trạng thái
update() Cập nhật giá trị đo mới Có
read() Đọc giá trị hiện tại Không
isOverheat() Kiểm tra quá nhiệt Không
getLimit() Đọc ngưỡng cảnh báo Không

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
18 / 68Hành vi Mô tả Thay đổi trạng thái
displayS tatus() Hiển thị trạng thái Không
→ Phần lớn hành vi là đọc → phần lớn hàm nên là const .
3. Thiết kế struct
Thiết kế struct TemperatureSensor :
Dữ liệu: value, limit
Hành vi: update, read, isOverheat, displayS tatus
Đặc điểm : tỷ lệ const/non-const nghiêng về const → sensor chủ yếu để đọc
4. Phân biệt public / private
Áp dụng cho bài toán
private :
value (phải cập nhật qua hàm update, có kiểm tra phạm vi)
limit (const, gán lúc khởi tạo)
public :
update() — cập nhật đo lường
read(), isOverheat(), getLimit() — truy vấn
displayS tatus() — giám sát
→ Nếu cho gán trực tiếp value = -1000  → nhiệt độ vô lý, cần kiểm soát.
5. Member function: const / non-const
Hàm const Giải thích
read() ✔ Chỉ trả về value
isOverheat() ✔ Chỉ đọc và so sánh
getLimit() ✔ Chỉ trả về limit
displayS tatus() ✔ Chỉ hiển thị
update() ❌ Thay đổi value
→ 4 const vs 1 non-const → cảm biến là thiết bị chủ yếu để đọc , ít khi ghi.
6. Code mô phỏng chạy được

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
19 / 68#include <iostream>
using namespace  std; 
 
struct TemperatureSensor  {
private: 
    float value; 
    const float limit; 
 
public: 
    // Constructor  
    TemperatureSensor( float lim) 
        : value( 0), limit(lim) {}  
 
    void update(float v) { 
        if (v < -40 || v > 200) { 
            cout << "Sensor reading out of range!\n" ; 
            return; 
        }  
        value = v;  
    } 
 
    float read() const { 
        return value; 
    } 
 
    bool isOverheat () const { 
        return value > limit;  
    } 
 
    float getLimit () const { 
        return limit; 
    } 
 
    void displayStatus () const { 
        cout << "Temperature: "  << value << " °C" 
             << " | Limit: "  << limit << " °C" 
             << " | " << (isOverheat() ? " ⚠ OVERHEAT!"  : "OK") 
             << "\n"; 
    } 
}; 
 
int main() { 
    TemperatureSensor sensor(80.0); 
 
    sensor.update( 25.0); 
    sensor.displayStatus();  
 
    sensor.update( 75.0); 
    sensor.displayStatus();  
 
    sensor.update( 90.0); 
    sensor.displayStatus();  
 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
20 / 68    if (sensor.isOverheat()) {  
        cout << "Action: Shutdown system to protect equipment.\n" ; 
    } 
 
    // Test: giá trị ngoài phạm vi  
    sensor.update( 300.0); 
 
    return 0; 
} 
7. Phân tích tư duy kỹ thuật
Sinh viên rút ra được:
Cảm biến là thiết bị đọc nhiều, ghi ít  → phần lớn hàm là const
const  không phải cú pháp thừa  — nó phản ánh đặc tính vật lý: sensor chủ yếu cung cấp dữ liệu
limit  là const  → ngưỡng cảnh báo do thiết kế quy định, không thay đổi runtime
Kiểm tra -40 → 200  = phạm vi vật lý hợp lý của sensor → input v alidation
8. Câu hỏi tư duy cho sinh viên
1. Vì sao phần lớn hàm của sensor là const? Điều này phản ánh đặc tính gì?
2. Nếu cần đổi đơn vị °C → °F, nên thêm hàm gì? Hàm đó có const không?
3. Làm thế nào để thêm lịch sử đo  (lưu 10 giá trị gần nhất)?
4. Nếu ghép sensor với controller (on/off), cấu trúc code sẽ ra sao?
📌 Ví dụ này minh họa rõ nhất: const chiếm đa số → phản ánh bản chất "read-mostly" của sensor
VÍ DỤ 6: R OBOT 1D (TRẠNG THÁI + WHILE)
1. Bài toán thực tế
Trong hệ thống robot công nghiệp đơn giản , một robot di chuyển trên ray 1 chiều  (1D) dùng để:
Vận chuyển sản phẩm giữa các trạm
Tuần tra kiểm tra đường ống
Quét barcode dọc băng tải
Robot 1D cơ bản có:
Vị trí hiện tại trên trục
Vận tốc (có thể dương = tiến, âm = lùi)
Cần cập nhật vị trí liên tục theo thời gian

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
21 / 68Yêu cầu b ài toán: Mô phỏng robot di chuyển trên trục 1D:
Đặt vận tốc
Cập nhật vị trí theo thời gian
Kiểm tra giới hạn hành trình
Hiển thị vị trí qua từng bước thời gian
2. Phân tích
2.1 Xác định đối tượng
Đối tượng cần mô hình hóa: Robot di chuyển 1 chiều (R obot 1D)
2.2 Phân tích thuộc tính (Data)
Thuộc tính Ý nghĩa Thay đổi theo thời gian
position Vị trí hiện tại (m) Có (cập nhật mỗi bước)
velocity Vận tốc (m/s) Có (có thể thay đổi)
minP os Giới hạn hành trình trái Không (cấu hình)
maxP os Giới hạn hành trình phải Không (cấu hình)
→ position  thay đổi liên tục theo công thức: pos += vel × dt
2.3 Phân tích hành vi (Function)
Hành vi Mô tả Thay đổi trạng thái
setVelocity() Đặt vận tốc mới Có
update() Cập nhật vị trí theo dt Có
getPosition() Đọc vị trí hiện tại Không
getVelocity() Đọc vận tốc hiện tại Không
isAtLimit() Kiểm tra chạm giới hạn Không
displayS tatus() Hiển thị vị trí Không
3. Thiết kế struct
Thiết kế struct Robot1D :
Dữ liệu: position, velocity, minP os, maxP os
Hành vi: setV elocity, update, getP osition, isAtLimit, displayS tatus
Công thức vật lý cơ bản : position += velocity × dt

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
22 / 684. Phân biệt public / private
Áp dụng cho bài toán
private :
position (chỉ thay đổi qua update, có kiểm tra giới hạn)
velocity (thay đổi qua setV elocity)
minP os, maxP os (const, cấu hình cố định)
public :
setVelocity() — đặt tốc độ
update() — bước thời gian
getPosition(), getV elocity() — đọc trạng thái
isAtLimit() — kiểm tra giới hạn
displayS tatus() — giám sát
→ Nếu cho gán trực tiếp position = 99999  → robot "dịch chuyển tức thời", sai logic.
5. Member function: const / non-const
Hàm const Giải thích
getPosition() ✔ Chỉ đọc dữ liệu
getVelocity() ✔ Chỉ đọc dữ liệu
isAtLimit() ✔ Chỉ kiểm tra
displayS tatus() ✔ Chỉ hiển thị
setVelocity() ❌ Thay đổi velocity
update() ❌ Thay đổi position
6. Code mô phỏng chạy được
#include <iostream>
#include <iomanip>
using namespace  std; 
 
struct Robot1D {
private: 
    float position;  
    float velocity;  
    const float minPos;  
    const float maxPos;  
 
public: 
    // Constructor  

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
23 / 68    Robot1D( float vel, float minP, float maxP) 
        : position( 0), velocity(vel), minPos(minP), maxPos(maxP) {}  
 
    void setVelocity (float vel) { 
        velocity = vel;  
    } 
 
    void update(float dt) { 
        position += velocity * dt;  
 
        // Clamp to limits  
        if (position < minPos) {  
            position = minPos;  
            velocity = 0; 
            cout << " ⚠ Reached min limit!\n" ; 
        }  
        if (position > maxPos) {  
            position = maxPos;  
            velocity = 0; 
            cout << " ⚠ Reached max limit!\n" ; 
        }  
    } 
 
    float getPosition () const { return position; }  
    float getVelocity () const { return velocity; }  
 
    bool isAtLimit () const { 
        return (position <= minPos) || (position >= maxPos);  
    } 
 
    void displayStatus () const { 
        cout << "Position = "  << fixed << setprecision( 1) 
             << position << " m" 
             << " | Velocity = "  << velocity << " m/s" 
             << (isAtLimit() ? " [AT LIMIT]"  : "") 
             << "\n"; 
    } 
}; 
 
int main() { 
    Robot1D robot(1.5, 0.0, 10.0); 
 
    cout << "=== Robot 1D Simulation ===\n" ; 
 
    // Tiến về phải  
    for (int i = 0; i < 8; i++) {  
        robot.update( 1.0); 
        robot.displayStatus();  
    } 
 
    // Đổi hướng  
    cout << "\n--- Reversing ---\n" ; 
    robot.setVelocity( -2.0); 
    for (int i = 0; i < 7; i++) {  

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
24 / 68        robot.update( 1.0); 
        robot.displayStatus();  
    } 
 
    return 0; 
} 
7. Phân tích tư duy kỹ thuật
Sinh viên rút ra được:
Vòng lặp for  mô phỏng thời gian rời rạc  — mỗi iteration = 1 bước dt
Công thức pos += vel × dt  là tích phân Euler , nền tảng mô phỏng vật lý
Clamping  (giới hạn giá trị) = pattern rất phổ biến trong embedded/control
Khi chạm limit, tự động dừng (velocity = 0) = safety mechanism
8. Câu hỏi tư duy cho sinh viên
1. Nếu dt thay đổi (không cố định), kết quả mô phỏng có khác không?
2. Làm thế nào để thêm gia tốc  (acceleration) vào mô hình?
3. Nếu robot cần dừng chính xác tại một vị trí (target position), cần logic gì?
4. So sánh mô hình 1D này với bài toán điều khiển băng tải — có gì giống / khác?
📌 Ví dụ này minh họa: simulation loop + physics model + clamping + const/non-const
VÍ DỤ 7: BỘ ĐIỀU KHIỂN ON–OFF
1. Bài toán thực tế
Trong hệ thống HVAC (Heating, V entilation, Air Conditioning) , bộ điều khiển ON–OFF là dạng đơn giản
nhất:
Nếu nhiệt độ thấp hơn  setpoint → bật sưởi (ON)
Nếu nhiệt độ cao hơn  setpoint → tắt sưởi (OFF)
Đây là nguyên lý cơ bản của bộ điều nhiệt (thermostat) trong gia đình.
Bộ điều khiển ON–OFF có:
Giá trị setpoint (mong muốn)
Đầu vào: giá trị đo thực tế (process variable)
Đầu ra: ON hoặc OFF
Yêu cầu b ài toán: Mô phỏng bộ điều khiển ON–OFF cho hệ thống sưởi:

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
25 / 68Đặt setpoint
Nhận giá trị đo
Tính toán đầu ra ON/OFF
Có hysteresis để tránh ON/OFF liên tục (chattering)
2. Phân tích
2.1 Xác định đối tượng
Đối tượng cần mô hình hóa: Bộ điều khiển ON–OFF (On-Off Contr oller)
2.2 Phân tích thuộc tính (Data)
Thuộc tính Ý nghĩa Thay đổi theo thời gian
setpoint Giá trị mong muốn Có (có thể điều chỉnh)
hysteresis Vùng chết (deadband) Không (cấu hình)
outputS tate Trạng thái ON/OFF hiện tại Có
→ hysteresis  tránh hiện tượng chatt ering (ON/OFF liên tục khi giá trị dao động quanh setpoint).
2.3 Phân tích hành vi (Function)
Hành vi Mô tả Thay đổi trạng thái
setSetpoint() Đặt giá trị mong muốn Có
compute() Tính đầu ra ON/OFF Có
getOutput() Đọc trạng thái đầu ra Không
getSetpoint() Đọc setpoint Không
displayS tatus() Hiển thị trạng thái Không
3. Thiết kế struct
Thiết kế struct OnOffController :
Dữ liệu: setpoint, hysteresis, outputS tate
Hành vi: setSetpoint, compute, getOutput, displayS tatus
Logic : dùng hysteresis band để quyết định ON/OFF
4. Phân biệt public / private
Áp dụng cho bài toán

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
26 / 68private :
outputS tate (chỉ thay đổi qua compute())
hysteresis (const, cấu hình cố định)
public :
setSetpoint() — điều chỉnh
compute() — tính toán
getOutput(), getSetpoint() — đọc trạng thái
displayS tatus() — giám sát
→ Không cho phép gán trực tiếp outputState = true  từ bên ngoài — phải qua logic compute.
5. Member function: const / non-const
Hàm const Giải thích
getOutput() ✔ Chỉ đọc trạng thái
getSetpoint() ✔ Chỉ đọc dữ liệu
displayS tatus() ✔ Chỉ hiển thị
setSetpoint() ❌ Thay đổi setpoint
compute() ❌ Thay đổi outputS tate
6. Code mô phỏng chạy được
#include <iostream>
#include <iomanip>
using namespace  std; 
 
struct OnOffController  {
private: 
    float setpoint;  
    const float hysteresis;  
    bool outputState;  
 
public: 
    // Constructor  
    OnOffController( float sp, float hyst) 
        : setpoint(sp), hysteresis(hyst), outputState( false) {} 
 
    void setSetpoint (float sp) { 
        setpoint = sp;  
    } 
 
    void compute(float processVariable)  { 
        // Hysteresis logic:  

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
27 / 68        // ON  when PV < setpoint - hysteresis  
        // OFF when PV > setpoint + hysteresis  
        // Unchanged when in deadband  
        if (processVariable < setpoint - hysteresis) {  
            outputState = true;   // Turn ON (heat)  
        } else if (processVariable > setpoint + hysteresis) {  
            outputState = false;  // Turn OFF  
        }  
        // Else: keep current state (deadband)  
    } 
 
    bool getOutput () const { 
        return outputState;  
    } 
 
    float getSetpoint () const { 
        return setpoint;  
    } 
 
    void displayStatus (float pv) const { 
        cout << "PV=" << fixed << setprecision( 1) << pv 
             << " | SP="  << setpoint  
             << " | Output: "  << (outputState ? "ON 🔥" : "OFF ❄") 
             << "\n"; 
    } 
}; 
 
int main() { 
    OnOffController heater(25.0, 1.0);  // SP=25°C, hysteresis=±1°C  
 
    cout << "=== ON-OFF Controller Simulation ===\n" ; 
    cout << "Setpoint: 25.0 °C | Hysteresis: ±1.0 °C\n\n" ; 
 
    // Simulate temperature varying around setpoint  
    float temperatures[] = {  
        20.0, 22.0, 23.5, 24.0, 25.0, 
        25.5, 26.5, 25.8, 25.0, 24.0, 
        23.5, 23.0, 24.5, 25.5, 26.0 
    }; 
 
    for (int i = 0; i < 15; i++) {  
        heater.compute(temperatures[i]);  
        heater.displayStatus(temperatures[i]);  
    } 
 
    return 0; 
} 
7. Phân tích tư duy kỹ thuật
Sinh viên rút ra được:

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
28 / 68if / else if  với vùng chết (deadband) = pattern rất phổ biến trong điều khiển
Hyst eresis tránh chattering — một bài toán thực tế quan trọng
Bộ điều khiển ON–OFF là nền tảng  trước khi học PID
Cách tách compute()  ra khỏi displayStatus()  = separation o f concer ns
8. Câu hỏi tư duy cho sinh viên
1. Nếu không có hysteresis, điều gì xảy ra khi nhiệt độ dao động quanh setpoint?
2. Hysteresis nên lớn hay nhỏ? T rade-off là gì?
3. So sánh controller ON–OFF với PID: ưu nhược điểm gì?
4. Nếu muốn thêm delay  (trễ) giữa ON và OFF (minimum on-time), cần bổ sung gì?
📌 Ví dụ này minh họa: if/else nâng cao + hysteresis + control theory cơ bản
VÍ DỤ 8: PL C MINI (SENSOR – C ONTR OLLER –
ACTUATOR)
1. Bài toán thực tế
Trong hệ thống tự động hó a, một vòng điều khiển tiêu chuẩn gồm 3 thành phần:
1. Sensor : đo lường giá trị thực (process variable)
2. Contr oller : so sánh với setpoint, tính toán tín hiệu điều khiển
3. Actuat or: thực thi lệnh điều khiển (bật/tắt van, motor…)
Đây là mô hình Input → Pr ocessing → Output  trong tự động hóa:
Sensor (Input) → Controller (Processing) → Actuator (Output)  
Yêu cầu b ài toán: Mô phỏng một hệ thống điều khiển mức nước trong bồn chứa:
Sensor đo mức nước
Controller so sánh với mức đặt, quyết định bơm ON/OFF
Actuator (bơm) thực hiện lệnh
Chạy nhiều chu kỳ, quan sát tương tác giữa 3 thành phần
2. Phân tích
2.1 Xác định đối tượng
3 đối tượng cần mô hình hóa riêng biệt:

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
29 / 68Sensor  — cảm biến mức nước
Contr oller  — bộ điều khiển logic
Actuat or — bơm nước
→ Mỗi đối tượng = 1 struct riêng. Ba struct phối hợp  thành hệ thống.
2.2 Phân tích thuộc tính (Data)
Sensor :
Thuộc tính Ý nghĩa Thay đổi
value Giá trị đo hiện tại (%) Có
name Tên cảm biến Không
Contr oller :
Thuộc tính Ý nghĩa Thay đổi
setpoint Mức đặt (%) Có (điều chỉnh)
hysteresis Vùng chết Không
Actuat or:
Thuộc tính Ý nghĩa Thay đổi
state Trạng thái ON/OFF Có
name Tên thiết bị Không
2.3 Phân tích hành vi (Function)
Object Hành vi Thay đổi trạng thái
Sensor update(), read() update: Có, read: Không
Controller compute() Không (trả về kết quả)
Actuator on(), off(), getS tate() on/off: Có, getS tate: Không
3. Thiết kế struct
Thiết kế 3 str uct r iêng biệt , mỗi struct đại diện một thực thể:
struct Sensor  — đo lường
struct Controller  — ra quyết định
struct Actuator  — thực thi
→ Tư duy mỗi str uct = 1 thực thể , hệ thống = sự phối hợp.

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
30 / 684. Phân biệt public / private
Sensor
private : value (kiểm soát cập nhật), name
public : update(), read(), getName()
Controller
private : setpoint, hysteresis
public : setSetpoint(), compute(), getSetpoint()
Actuator
private : state (chỉ thay đổi qua on/off), name
public : on(), off(), getS tate(), getName()
→ Không object nào được phép truy cập trực tiếp trạng thái nội bộ của object khác.
5. Member function: const / non-const
Struct Hàm const
Sensor read() ✔
Sensor getName() ✔
Sensor update() ❌
Controller compute() ✔
Controller getSetpoint() ✔
Controller setSetpoint() ❌
Actuator getState() ✔
Actuator getName() ✔
Actuator on(), off() ❌
6. Code mô phỏng chạy được
#include <iostream>
#include <iomanip>
#include <string>
using namespace  std; 
 
// ====================== SENSOR ======================
struct Sensor {
private: 
    float value; 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
31 / 68    const string name; 
 
public: 
    Sensor( const string& n) 
        : value( 0), name(n) {}  
 
    void update(float v) { 
        if (v < 0 || v > 100) { 
            cout << name << ": Value out of range!\n" ; 
            return; 
        }  
        value = v;  
    } 
 
    float read() const { return value; }  
    const string& getName() const { return name; }  
}; 
 
// ====================== CONTROLLER ======================
struct Controller  {
private: 
    float setpoint;  
    const float hysteresis;  
 
public: 
    Controller( float sp, float hyst) 
        : setpoint(sp), hysteresis(hyst) {}  
 
    // Returns true = ON, false = OFF  
    bool compute(float pv, bool currentState)  const { 
        if (pv < setpoint - hysteresis) return true;   // ON 
        if (pv > setpoint + hysteresis) return false;   // OFF 
        return currentState;  // Keep current in deadband  
    } 
 
    void setSetpoint (float sp) { setpoint = sp; }  
    float getSetpoint () const { return setpoint; }  
}; 
 
// ====================== ACTUATOR ======================
struct Actuator  {
private: 
    bool state; 
    const string name; 
 
public: 
    Actuator( const string& n) 
        : state( false), name(n) {}  
 
    void on()  { state = true;  } 
    void off() { state = false; } 
    bool getState () const { return state; }  
    const string& getName() const { return name; }  
}; 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
32 / 68 
// ====================== MAIN ======================
int main() { 
    // Tạo 3 thành phần  
    Sensor levelSensor ("Level Sensor" ); 
    Controller levelController (60.0, 5.0);  // SP=60%, hyst=±5%  
    Actuator pump("Water Pump" ); 
 
    cout << "=== PLC MINI: Water Level Control ===\n" ; 
    cout << "Setpoint: "  << levelController.getSetpoint()  
         << "% | Hysteresis: ±5%\n\n" ; 
 
    // Simulate water level over time  
    float levels[] = {  
        30, 35, 40, 45, 50, 55, 58, 62, 65, 68, 
        65, 62, 58, 55, 52, 48, 45, 50, 55, 60 
    }; 
 
    cout << left << setw( 8) << "Step" 
         << setw( 12) << "Level(%)"  
         << setw( 12) << "Decision"  
         << setw( 12) << "Pump" << "\n"; 
    cout << "--------------------------------------------\n" ; 
 
    for (int i = 0; i < 20; i++) {  
        // STEP 1: Sensor reads  
        levelSensor.update(levels[i]);  
 
        // STEP 2: Controller computes  
        bool shouldBeOn = levelController.compute(  
            levelSensor.read(), pump.getState());  
 
        // STEP 3: Actuator acts  
        if (shouldBeOn) pump.on(); else pump.off();  
 
        // Display  
        cout << left << setw( 8) << i 
             << setw( 12) << fixed << setprecision( 1) 
             << levelSensor.read()  
             << setw( 12) << (shouldBeOn ? "FILL" : "STOP") 
             << setw( 12) << (pump.getState() ? "ON 💧" : "OFF") 
             << "\n"; 
    } 
 
    return 0; 
} 
7. Phân tích tư duy kỹ thuật
Sinh viên rút ra được:

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
33 / 68Chia hệ thống thành 3 str uct = mô hình hóa thành phần (component modeling)
Dòng chảy dữ liệu: Sensor → Controller → Actuator = Input → Pr ocessing → Output
Mỗi struct độc lập , giao tiếp qua giao diện public  → loosely coupled
Thay thế Controller bằng PID controller mà không cần sửa Sensor hay Actuat or → modular design
Đây chính là kiến trúc cơ bản của mọi hệ thống điều khiển tự động
8. Câu hỏi tư duy cho sinh viên
1. Tại sao chia thành 3 struct thay vì 1 struct lớn?
2. Nếu muốn thay Controller bằng PID, cần thay đổi những gì? Sensor và Actuator có ảnh hưởng không?
3. Nếu có 3 bồn nước, mỗi bồn có sensor + controller + pump riêng, code cần tổ chức thế nào?
4. So sánh mô hình Sensor–Controller–Actuator với Input–Processing–Output: tương đồng ở điểm nào?
📌 Ví dụ này minh họa: multi-struct design + I-P-O pattern + modular architecture
VÍ DỤ 9: SINGL Y LINKED LIST (DỮ LIỆU ĐỘNG)
1. Bài toán thực tế
Trong hệ thống nhúng v à truyền thông , dữ liệu thường đến không đều  và số lượng không biết trước :
Gói tin (packet) nhận qua U ART / Ethernet
Hàng đợi sự kiện (event queue) trong hệ thống tự động
Danh sách thiết bị trên bus I2C / CAN
Mảng tĩnh có kích thước cố định  → không linh hoạt khi số phần tử thay đổi. Linked list  cho phép thêm / xóa
phần tử mà không cần biết trước kích thước.
Yêu cầu b ài toán: Mô phỏng hàng đợi gói tin (packet queue):
Thêm gói tin mới vào cuối danh sách
Xử lý (lấy ra) gói tin đầu tiên
Duyệt danh sách để hiển thị
Giải phóng bộ nhớ đúng cách
2. Phân tích
2.1 Xác định đối tượng
2 đối tượng cần mô hình hóa:
Node  — một phần tử trong danh sách (chứa dữ liệu + liên kết)
LinkedList  — cấu trúc quản lý toàn bộ danh sách

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
34 / 682.2 Phân tích thuộc tính (Data)
Node:
Thuộc tính Ý nghĩa Thay đổi
data Dữ liệu chứa trong node Không (gán lúc tạo)
next Con trỏ đến node tiếp theo Có (khi nối/xóa)
LinkedList:
Thuộc tính Ý nghĩa Thay đổi
head Con trỏ đến node đầu Có (khi thêm/xóa)
count Số phần tử hiện có Có (khi thêm/xóa)
2.3 Phân tích hành vi (Function)
Hành vi Mô tả Thay đổi trạng thái
pushBack() Thêm node cuối danh sách Có
popFront() Xóa node đầu, trả về data Có
print() Duyệt và hiển thị toàn bộ Không
size() Số phần tử Không
isEmpty() Kiểm tra rỗng Không
clear() Xóa toàn bộ, giải phóng bộ nhớ Có
3. Thiết kế struct
Thiết kế 2 struct:
struct Node  — đơn vị chứa data + con trỏ next
struct LinkedList  — quản lý head, thực hiện thêm/xóa/duyệt
→ Node  là building block , LinkedList  là manager .
4. Phân biệt public / private
Node
public : data, next — vì LinkedList cần truy cập trực tiếp (kiểu dữ liệu nội bộ)
LinkedList
private :

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
35 / 68head (chỉ thay đổi qua pushBack/popFront)
count (chỉ thay đổi nội bộ)
public :
pushBack(), popFront() — thao tác
print(), size(), isEmpty() — truy vấn
clear(), ~LinkedList() — dọn dẹp
→ Người dùng chỉ tương tác qua Link edList , không thao tác trực tiếp trên Node.
5. Member function: const / non-const
Hàm const Giải thích
print() ✔ Chỉ duyệt, không thay đổi
size() ✔ Chỉ trả về count
isEmpty() ✔ Chỉ kiểm tra
pushBack() ❌ Thêm node mới
popFront() ❌ Xóa node đầu
clear() ❌ Xóa toàn bộ
6. Code mô phỏng chạy được
#include <iostream>
using namespace  std; 
 
struct Node { 
    int data; 
    Node* next;  
 
    Node( int d, Node* n = nullptr) 
        : data(d), next(n) {}  
}; 
 
struct LinkedList  {
private: 
    Node* head;  
    int count; 
 
public: 
    // Constructor  
    LinkedList() : head( nullptr), count( 0) {} 
 
    // Destructor — giải phóng bộ nhớ  
    ~LinkedList() {  

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
36 / 68        clear();  
    } 
 
    void pushBack (int value) { 
        Node* newNode = new Node(value);  
 
        if (head == nullptr) { 
            head = newNode;  
        } else { 
            Node* current = head;  
            while (current->next != nullptr) { 
                current = current->next;  
            }  
            current->next = newNode;  
        }  
        count++;  
    } 
 
    int popFront () { 
        if (isEmpty()) {  
            cout << "List is empty!\n" ; 
            return -1; 
        }  
 
        Node* temp = head;  
        int value = temp->data;  
        head = head->next;  
        delete temp; 
        count--;  
        return value; 
    } 
 
    void print() const { 
        Node* current = head;  
        cout << "List: " ; 
        while (current != nullptr) { 
            cout << current->data << " -> "; 
            current = current->next;  
        }  
        cout << "null"; 
        cout << " (size="  << count << ")\n"; 
    } 
 
    int size() const { return count; }  
 
    bool isEmpty() const { return head == nullptr; } 
 
    void clear() { 
        while (head != nullptr) { 
            Node* temp = head;  
            head = head->next;  
            delete temp; 
        }  
        count = 0; 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
37 / 68    } 
}; 
 
int main() { 
    LinkedList packetQueue;  
 
    cout << "=== Packet Queue Simulation ===\n\n" ; 
 
    // Thêm gói tin  
    cout << "Adding packets...\n" ; 
    packetQueue.pushBack( 101); 
    packetQueue.pushBack( 102); 
    packetQueue.pushBack( 103); 
    packetQueue.pushBack( 104); 
    packetQueue.print();  
 
    // Xử lý gói tin (FIFO)  
    cout << "\nProcessing packets...\n" ; 
    while (!packetQueue.isEmpty()) {  
        int packet = packetQueue.popFront();  
        cout << "Processed packet: "  << packet << "\n"; 
        packetQueue.print();  
    } 
 
    // Thêm lại  
    cout << "\nNew packets arriving...\n" ; 
    packetQueue.pushBack( 201); 
    packetQueue.pushBack( 202); 
    packetQueue.print();  
 
    // Destructor tự giải phóng khi ra khỏi scope  
    return 0; 
} 
7. Phân tích tư duy kỹ thuật
Sinh viên rút ra được:
Linked list  giải quyết bài toán dữ liệu kích thước không biết trước  — rất phổ biến trong embedded
(event queue, packet buffer)
new / delete  = quản lý bộ nhớ động  — nếu quên delete = memory leak
Destr uctor đảm bảo dọn dẹp khi object hết scope → tránh leak
Pattern FIFO  (First In, First Out) = cơ bản cho hàng đợi xử lý sự kiện
Trong embedded thực tế, nên dùng pool allocat or thay vì malloc/new
8. Câu hỏi tư duy cho sinh viên
1. So sánh linked list và mảng tĩnh: khi nào dùng cái nào trong embedded?
2. Nếu quên gọi clear()  và không có destructor, chuyện gì xảy ra?

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
38 / 683. Trong hệ thống nhúng RAM hạn chế, có nên dùng new/delete  không? Có giải pháp thay thế gì?
4. Làm thế nào để biến linked list này thành circular buffer  cho U ART receive?
📌 Ví dụ này minh họa: dynamic memory + pointer + FIFO pattern + destructor
VÍ DỤ 10: MÁ Y TRẠNG THÁI BĂNG TẢI (SWIT CH-CASE
+ ENUM)
1. Bài toán thực tế
Trong nhà máy sản xuất, băng tải (conv eyor belt)  vận chuyển sản phẩm giữa các trạm gia công. Băng tải
hoạt động theo các trạng thái r õ ràng :
IDLE : chờ sản phẩm
RUNNING : đang chạy, vận chuyển sản phẩm
LOADING : đang nạp sản phẩm lên băng tải
ERROR: gặp sự cố (kẹt, quá tải…)
Tại mỗi thời điểm:
Băng tải chỉ ở đúng 1 trạng thái
Có các sự kiện  (event) kích hoạt chuyển trạng thái
Mỗi trạng thái có hành vi r iêng
Đây chính là Finit e State Machine (F SM) — pattern cốt lõi của hệ thống nhúng.
Yêu cầu b ài toán: Mô phỏng máy trạng thái cho băng tải:
Định nghĩa các trạng thái bằng enum
Xử lý sự kiện chuyển trạng thái
Mỗi trạng thái có hành vi riêng
Phát hiện chuyển trạng thái không hợp lệ
2. Phân tích
2.1 Xác định đối tượng
Đối tượng cần mô hình hóa: Hệ thống b ăng tải (Conv eyor System)
2.2 Phân tích thuộc tính (Data)
Thuộc tính Ý nghĩa Thay đổi theo thời gian
currentS tate Trạng thái hiện tại Có (khi nhận sự kiện)

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
39 / 68Thuộc tính Ý nghĩa Thay đổi theo thời gian
itemCount Số sản phẩm đã vận chuyển Có (tăng khi hoàn thành)
errorCode Mã lỗi nếu có Có (khi gặp sự cố)
name Tên băng tải Không
→ currentState  là biến trạng thái chính , quyết định hành vi của hệ thống.
2.3 Phân tích hành vi (Function)
Hành vi Mô tả Thay đổi trạng thái
handleEvent() Xử lý sự kiện, chuyển trạng thái Có
executeS tate() Thực thi hành vi của trạng thái hiện tại Không
getStateName() Trả về tên trạng thái Không
getItemCount() Đọc số sản phẩm Không
displayS tatus() Hiển thị trạng thái Không
reset() Đưa về trạng thái IDLE Có
3. Thiết kế struct
Thiết kế struct Conveyor :
Dữ liệu: currentS tate (enum), itemCount, errorCode
Hành vi: handleEvent (switch-case trên state + event), executeS tate (switch-case trên state)
Đặc điểm : switch-case phát sinh tự nhiên  từ việc xử lý nhiều trạng thái rời rạc
4. Phân biệt public / private
Áp dụng cho bài toán
private :
currentS tate (chỉ thay đổi qua handleEvent — phải qua logic chuyển trạng thái hợp lệ)
itemCount (chỉ tăng khi hoàn thành vận chuyển)
errorCode (chỉ gán khi phát hiện lỗi)
public :
handleEvent() — nhận sự kiện
executeS tate() — thực thi hành vi
getStateName(), getItemCount() — truy vấn
displayS tatus() — giám sát
reset() — khôi phục

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
40 / 68→ Nếu cho gán trực tiếp currentState = RUNNING  mà bỏ qua logic chuyển trạng thái → sai logic F SM.
5. Member function: const / non-const
Hàm const Giải thích
executeS tate() ✔ Chỉ hiển thị hành vi, không thay đổi trạng thái
getStateName() ✔ Chỉ trả về chuỗi
getItemCount() ✔ Chỉ đọc dữ liệu
displayS tatus() ✔ Chỉ hiển thị
handleEvent() ❌ Thay đổi currentS tate, itemCount, errorCode
reset() ❌ Thay đổi currentS tate, errorCode
6. Code mô phỏng chạy được
#include <iostream>
#include <string>
using namespace  std; 
 
// Định nghĩa trạng thái
enum class ConveyorState  { 
    IDLE,  
    LOADING,  
    RUNNING,  
    ERROR  
}; 
 
// Định nghĩa sự kiện
enum class Event { 
    ITEM_DETECTED,  
    LOADING_DONE,  
    ITEM_DELIVERED,  
    FAULT,  
    RESET  
}; 
 
struct Conveyor  {
private: 
    ConveyorState currentState;  
    int itemCount;  
    int errorCode;  
    const string name; 
 
public: 
    Conveyor( const string& n) 
        : currentState(ConveyorState::IDLE),  
          itemCount( 0), errorCode( 0), name(n) {}  

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
41 / 68 
    void handleEvent (Event event)  { 
        switch (currentState) {  
            case ConveyorState::IDLE:  
                switch (event) {  
                    case Event::ITEM_DETECTED:  
                        currentState = ConveyorState::LOADING;  
                        cout << "→ IDLE → LOADING\n" ; 
                        break; 
                    case Event::FAULT:  
                        currentState = ConveyorState::ERROR;  
                        errorCode = 1; 
                        cout << "→ IDLE → ERROR\n" ; 
                        break; 
                    default: 
                        cout << " ⚠ Invalid event in IDLE\n" ; 
                }  
                break; 
 
            case ConveyorState::LOADING:  
                switch (event) {  
                    case Event::LOADING_DONE:  
                        currentState = ConveyorState::RUNNING;  
                        cout << "→ LOADING → RUNNING\n" ; 
                        break; 
                    case Event::FAULT:  
                        currentState = ConveyorState::ERROR;  
                        errorCode = 2; 
                        cout << "→ LOADING → ERROR\n" ; 
                        break; 
                    default: 
                        cout << " ⚠ Invalid event in LOADING\n" ; 
                }  
                break; 
 
            case ConveyorState::RUNNING:  
                switch (event) {  
                    case Event::ITEM_DELIVERED:  
                        itemCount++;  
                        currentState = ConveyorState::IDLE;  
                        cout << "→ RUNNING → IDLE (delivered #"  
                             << itemCount << ")\n"; 
                        break; 
                    case Event::FAULT:  
                        currentState = ConveyorState::ERROR;  
                        errorCode = 3; 
                        cout << "→ RUNNING → ERROR\n" ; 
                        break; 
                    default: 
                        cout << " ⚠ Invalid event in RUNNING\n" ; 
                }  
                break; 
 
            case ConveyorState::ERROR:  

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
42 / 68                switch (event) {  
                    case Event::RESET:  
                        currentState = ConveyorState::IDLE;  
                        errorCode = 0; 
                        cout << "→ ERROR → IDLE (reset)\n" ; 
                        break; 
                    default: 
                        cout << " ⚠ In ERROR state, only RESET accepted\n" ; 
                }  
                break; 
        }  
    } 
 
    void executeState () const { 
        switch (currentState) {  
            case ConveyorState::IDLE:  
                cout << "[" << name << "] Waiting for items...\n" ; 
                break; 
            case ConveyorState::LOADING:  
                cout << "[" << name << "] Loading item onto belt...\n" ; 
                break; 
            case ConveyorState::RUNNING:  
                cout << "[" << name << "] Belt moving, transporting item...\n" ; 
                break; 
            case ConveyorState::ERROR:  
                cout << "[" << name << "] ⛔ ERROR! Code="  << errorCode  
                     << " — belt stopped!\n" ; 
                break; 
        }  
    } 
 
    const char* getStateName () const { 
        switch (currentState) {  
            case ConveyorState::IDLE:    return "IDLE"; 
            case ConveyorState::LOADING: return "LOADING" ; 
            case ConveyorState::RUNNING: return "RUNNING" ; 
            case ConveyorState::ERROR:   return "ERROR"; 
            default: return "UNKNOWN" ; 
        }  
    } 
 
    int getItemCount () const { return itemCount; }  
 
    void displayStatus () const { 
        cout << "=== " << name << " === State: "  << getStateName()  
             << " | Items: "  << itemCount  
             << " | Error: "  << errorCode << "\n"; 
    } 
 
    void reset() { 
        currentState = ConveyorState::IDLE;  
        errorCode = 0; 
        cout << name << " reset to IDLE.\n" ; 
    } 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
43 / 68}; 
 
int main() { 
    Conveyor belt("Conveyor-A" ); 
 
    belt.displayStatus();  
 
    // Chu kỳ 1: vận chuyển thành công  
    belt.handleEvent(Event::ITEM_DETECTED);  
    belt.executeState();  
    belt.handleEvent(Event::LOADING_DONE);  
    belt.executeState();  
    belt.handleEvent(Event::ITEM_DELIVERED);  
    belt.displayStatus();  
 
    // Chu kỳ 2: gặp sự cố khi đang chạy  
    cout << "\n--- Cycle 2 ---\n" ; 
    belt.handleEvent(Event::ITEM_DETECTED);  
    belt.handleEvent(Event::LOADING_DONE);  
    belt.handleEvent(Event::FAULT);  
    belt.executeState();  
 
    // Thử gửi sự kiện khi đang ERROR  
    belt.handleEvent(Event::ITEM_DETECTED);  
 
    // Reset và tiếp tục  
    belt.handleEvent(Event::RESET);  
    belt.displayStatus();  
 
    return 0; 
} 
7. Phân tích tư duy kỹ thuật
Sinh viên rút ra được:
switch-case  phát sinh tự nhiên khi xử lý nhiều trạng thái rời rạc — không phải dạy cú pháp trước
enum class  giúp định nghĩa trạng thái rõ ràng, type-safe (không nhầm state với event)
Nest ed swit ch (state bên ngoài, event bên trong) = pattern FSM chuẩn
Logic chuyển trạng thái phải qua v alidation  → không cho gán trực tiếp state
Mỗi trạng thái chỉ chấp nhận một số ev ent → defensive design
FSM là nền tảng  cho embedded: điều khiển máy, giao thức, UI
8. Câu hỏi tư duy cho sinh viên
1. Vì sao dùng switch-case thay vì if/else cho bài toán nhiều trạng thái?
2. Nếu thêm trạng thái PAUSED  (tạm dừng), cần sửa những gì?
3. Vẽ State Diagram  (sơ đồ trạng thái) cho Conveyor – từ đó suy ra code switch-case.
4. Trong hệ thống thật, trạng thái ERR OR nên có timeout tự reset hay bắt buộc manual reset? V ì sao?

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
44 / 68📌 Ví dụ này minh họa: enum + switch-case + FSM pattern + nested switch
VÍ DỤ 11: BỘ ĐỆM V ÒNG — RING BUFFER (CIR CULAR
BUFFER)
1. Bài toán thực tế
Trong hệ thống truyền thông nhúng  (UART, CAN, Ethernet), dữ liệu đến liên tục v à không đều :
ISR (Interrupt Service R outine) nhận byte nhanh
Main loop xử lý dữ liệu chậm hơn
Cần bộ đệm  giữa ISR và main loop
Mảng tĩnh  thông thường không phù hợp vì:
Khi đầy phải dịch toàn bộ dữ liệu → tốn CPU
Hoặc phải reset → mất dữ liệu
Ring buffer (bộ đệm v òng)  giải quyết:
Ghi vào vị trí head , đọc từ vị trí tail
Khi đến cuối mảng → quay lại đầu (modulo)
Không cần dịch chuyển dữ liệu
Yêu cầu b ài toán: Mô phỏng ring buffer cho U ART receive:
Ghi byte vào buffer (ISR gọi)
Đọc byte từ buffer (main loop gọi)
Kiểm tra đầy / rỗng
Không dùng dynamic memory (embedded-friendly)
2. Phân tích
2.1 Xác định đối tượng
Đối tượng cần mô hình hóa: Bộ đệm v òng (Ring Buffer)
2.2 Phân tích thuộc tính (Data)
Thuộc tính Ý nghĩa Thay đổi theo thời gian
buffer[] Mảng chứa dữ liệu (kích thước cố định) Có (ghi/đọc)
head Vị trí ghi tiếp theo Có (tăng khi ghi)

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
45 / 68Thuộc tính Ý nghĩa Thay đổi theo thời gian
tail Vị trí đọc tiếp theo Có (tăng khi đọc)
count Số byte hiện có trong buffer Có
capacity Kích thước tối đa Không (const)
→ head  và tail  quay v òng (modulo capacity) — đây là bản chất "ring".
2.3 Phân tích hành vi (Function)
Hành vi Mô tả Thay đổi trạng thái
put() Ghi 1 byte vào buffer Có (head++, count++)
get() Đọc 1 byte từ buffer Có (tail++, count--)
isFull() Kiểm tra buffer đầy Không
isEmpty() Kiểm tra buffer rỗng Không
available() Số byte có thể đọc Không
freeSpace() Số byte có thể ghi Không
peek() Xem byte tiếp theo mà không đọc Không
clear() Xóa buffer Có
3. Thiết kế struct
Thiết kế struct RingBuffer :
Mảng tĩnh buffer[]  (không dùng new/malloc → embedded-safe)
head , tail , count  quản lý vị trí đọc/ghi
Toán tử modulo (%)  làm cho index quay vòng
4. Phân biệt public / private
Áp dụng cho bài toán
private :
buffer[] (không cho truy cập trực tiếp → tránh đọc/ghi sai vị trí)
head, tail, count (chỉ thay đổi qua put/get)
capacity (const)
public :
put(), get() — thao tác dữ liệu
isFull(), isEmpty(), available(), freeSpace() — truy vấn

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
46 / 68peek() — xem trước
clear() — reset
→ Truy cập trực tiếp buffer[head]  từ ngoài → có thể đọc/ghi sai index, corr upt dữ liệu .
5. Member function: const / non-const
Hàm const Giải thích
isFull() ✔ Chỉ đọc count, capacity
isEmpty() ✔ Chỉ đọc count
available() ✔ Chỉ trả về count
freeSpace() ✔ Chỉ tính toán
peek() ✔ Chỉ đọc, không thay đổi tail
put() ❌ Thay đổi buffer, head, count
get() ❌ Thay đổi tail, count
clear() ❌ Reset head, tail, count
6. Code mô phỏng chạy được
#include <iostream>
using namespace  std; 
 
struct RingBuffer  {
private: 
    static const int MAX_SIZE = 8; 
    unsigned  char buffer[MAX_SIZE];  
    int head; 
    int tail; 
    int count; 
 
public: 
    RingBuffer() : head( 0), tail( 0), count( 0) { 
        for (int i = 0; i < MAX_SIZE; i++)  
            buffer[i] = 0; 
    } 
 
    bool put(unsigned  char byte) { 
        if (isFull()) {  
            cout << " ⚠ Buffer FULL! Byte 0x"  
                 << hex << ( int)byte << dec << " dropped.\n" ; 
            return false; 
        }  
        buffer[head] = byte;  
        head = (head + 1) % MAX_SIZE;  // Quay vòng  

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
47 / 68        count++;  
        return true; 
    } 
 
    bool get(unsigned  char& byte) { 
        if (isEmpty()) {  
            cout << " ⚠ Buffer EMPTY!\n" ; 
            return false; 
        }  
        byte = buffer[tail];  
        tail = (tail + 1) % MAX_SIZE;  // Quay vòng  
        count--;  
        return true; 
    } 
 
    bool peek(unsigned  char& byte) const { 
        if (isEmpty()) return false; 
        byte = buffer[tail];  
        return true; 
    } 
 
    bool isFull() const { return count == MAX_SIZE; }  
    bool isEmpty() const { return count == 0; } 
    int available () const { return count; }  
    int freeSpace () const { return MAX_SIZE - count; }  
 
    void clear() { 
        head = 0; 
        tail = 0; 
        count = 0; 
    } 
 
    void displayState () const { 
        cout << "RingBuffer ["  << count << "/" << MAX_SIZE << "] " 
             << "head=" << head << " tail="  << tail << " | Data: " ; 
        if (isEmpty()) {  
            cout << "(empty)" ; 
        } else { 
            int idx = tail;  
            for (int i = 0; i < count; i++) {  
                cout << "0x" << hex << ( int)buffer[idx] << dec << " "; 
                idx = (idx + 1) % MAX_SIZE;  
            }  
        }  
        cout << "\n"; 
    } 
}; 
 
int main() { 
    RingBuffer uart_rx;  
 
    cout << "=== Ring Buffer Simulation (UART RX) ===\n\n" ; 
 
    // ISR nhận dữ liệu  

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
48 / 68    cout << "--- ISR receiving bytes ---\n" ; 
    uart_rx.put( 0x48);  // 'H' 
    uart_rx.put( 0x45);  // 'E' 
    uart_rx.put( 0x4C);  // 'L' 
    uart_rx.put( 0x4C);  // 'L' 
    uart_rx.put( 0x4F);  // 'O' 
    uart_rx.displayState();  
 
    // Main loop đọc dữ liệu  
    cout << "\n--- Main loop reading ---\n" ; 
    unsigned  char byte; 
    while (!uart_rx.isEmpty()) {  
        uart_rx.get(byte);  
        cout << "Read: 0x"  << hex << ( int)byte 
             << " ('" << (char)byte << "')" << dec << "\n"; 
    } 
    uart_rx.displayState();  
 
    // Ghi thêm → quay vòng  
    cout << "\n--- More data (wrapping around) ---\n" ; 
    for (int i = 0; i < 10; i++) {  // Cố ghi 10 byte vào buffer 8  
        uart_rx.put( 0x30 + i); 
    } 
    uart_rx.displayState();  
 
    return 0; 
} 
7. Phân tích tư duy kỹ thuật
Sinh viên rút ra được:
Modulo (%)  là "phép quay vòng" — biến mảng tuyến tính thành vòng tròn
Ring buffer không cần dynamic memor y → rất phù hợp embedded (SRAM hạn chế)
Pattern producer–consumer : ISR ghi (put), main loop đọc (get) → decoupling
isFull()  trả false → byte bị drop (mất dữ liệu) → cần thiết kế buffer đủ lớn
Hàm trả về bool  → caller biết thành công hay thất bại (error handling)
Đây là cấu trúc dữ liệu phổ biến nhất  trong firmware U ART, CAN, USB
8. Câu hỏi tư duy cho sinh viên
1. Vì sao ring buffer phù hợp cho embedded hơn linked list?
2. Nếu ISR và main loop cùng truy cập buffer, cần cơ chế gì để tránh race condition?
3. Kích thước buffer nên chọn là lũy thừa của 2  (8, 16, 32…) — vì sao? (gợi ý: modulo vs bitwise AND)
4. Làm thế nào để mở rộng ring buffer lưu struct (ví dụ: gói tin CAN) thay vì byte?
📌 Ví dụ này minh họa: circular indexing + modulo + static array + producer-consumer pattern
 Ể

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
49 / 68VÍ DỤ 12: BỘ ĐIỀU KHIỂN PID
1. Bài toán thực tế
Trong hệ thống điều khiển tự động , bộ điều khiển ON–OFF (VD7) quá thô: chỉ có bật/tắt, không có trạng
thái trung gian. Để điều khiển mượt mà v à chính xác , kỹ sư sử dụng bộ điều khiển PID :
P (Pr opor tional) : phản ứng tỷ lệ với sai số hiện tại
I (Int egral) : tích lũy sai số theo thời gian → loại bỏ sai lệch tĩnh
D (Der ivative): dự đoán xu hướng sai số → giảm overshoot
PID được dùng trong:
Điều khiển tốc độ động cơ
Ổn định nhiệt độ lò nung
Điều khiển vị trí robot
Ổn định góc drone / quadcopter
Công thức PID:
$$u(t) = K_p \cdot e(t) + K_i \cdot \int e(t),dt + K_d \cdot \frac{de(t)}{dt}$$
Yêu cầu b ài toán: Mô phỏng bộ điều khiển PID điều khiển tốc độ động cơ:
Nhận setpoint (tốc độ mong muốn) và process variable (tốc độ thực)
Tính toán đầu ra điều khiển
Có giới hạn đầu ra (clamp) và anti-windup cho thành phần I
Chạy nhiều chu kỳ, quan sát quá trình hội tụ
2. Phân tích
2.1 Xác định đối tượng
Đối tượng cần mô hình hóa: Bộ điều khiển PID (PID Contr oller)
2.2 Phân tích thuộc tính (Data)
Thuộc tính Ý nghĩa Thay đổi theo thời gian
kp, ki, kd Hệ số PID Không (tuning parameters)
setpoint Giá trị mong muốn Có (có thể điều chỉnh)
integral Tổng tích lũy sai số Có (tích lũy mỗi chu kỳ)
prevError Sai số chu kỳ trước Có (cập nhật mỗi chu kỳ)
outputMin, outputMax Giới hạn đầu ra Không (cấu hình)

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
50 / 68Thuộc tính Ý nghĩa Thay đổi theo thời gian
dt Chu kỳ tính toán (s) Không (cấu hình)
→ integral  và prevError  là trạng thái nội bộ , lưu lại giữa các lần gọi.
2.3 Phân tích hành vi (Function)
Hành vi Mô tả Thay đổi trạng thái
compute() Tính đầu ra PID Có (integral, prevError)
setSetpoint() Đặt giá trị mong muốn Có
setGains() Điều chỉnh hệ số PID Có
reset() Reset trạng thái nội bộ Có
getSetpoint() Đọc setpoint Không
getOutput() Đọc output gần nhất Không
3. Thiết kế struct
Thiết kế struct PIDController :
Hệ số: kp, ki, kd (const hoặc tunable)
Trạng thái nội bộ: integral, prevError
Giới hạn: outputMin, outputMax, integralLimit (anti-windup)
Hàm compute() = trái tim của PID
4. Phân biệt public / private
Áp dụng cho bài toán
private :
integral (không cho truy cập trực tiếp → tránh tích lũy sai)
prevError (trạng thái nội bộ giữa 2 lần gọi)
lastOutput (output gần nhất)
clamp() — hàm nội bộ giới hạn giá trị
public :
compute() — tính đầu ra PID
setSetpoint(), setGains() — cấu hình
getSetpoint(), getOutput() — đọc dữ liệu
reset() — reset trạng thái
→ integral là biến rất nhạy cảm : nếu bị gán sai → output PID phát tán (diverge).

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
51 / 685. Member function: const / non-const
Hàm const Giải thích
getSetpoint() ✔ Chỉ đọc dữ liệu
getOutput() ✔ Chỉ đọc dữ liệu
compute() ❌ Thay đổi integral, prevError, lastOutput
setSetpoint() ❌ Thay đổi setpoint
setGains() ❌ Thay đổi kp, ki, kd
reset() ❌ Reset integral, prevError
6. Code mô phỏng chạy được
#include <iostream>
#include <iomanip>
using namespace  std; 
 
struct PIDController  {
private: 
    float kp, ki, kd;  
    float setpoint;  
    float integral;  
    float prevError;  
    float lastOutput;  
    const float outputMin;  
    const float outputMax;  
    const float integralLimit;  // Anti-windup  
    const float dt; 
 
    float clamp(float value, float minVal, float maxVal)  const { 
        if (value < minVal) return minVal;  
        if (value > maxVal) return maxVal;  
        return value; 
    } 
 
public: 
    PIDController( float p, float i, float d, 
                  float sp, float outMin, float outMax,  
                  float iLimit, float deltaT)  
        : kp(p), ki(i), kd(d), setpoint(sp),  
          integral( 0), prevError( 0), lastOutput( 0), 
          outputMin(outMin), outputMax(outMax),  
          integralLimit(iLimit), dt(deltaT) {}  
 
    float compute(float processVariable)  { 
        float error = setpoint - processVariable;  
 
        // P term  

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
52 / 68        float pTerm = kp * error;  
 
        // I term (with anti-windup)  
        integral += error * dt;  
        integral = clamp(integral, -integralLimit, integralLimit);  
        float iTerm = ki * integral;  
 
        // D term  
        float derivative = (error - prevError) / dt;  
        float dTerm = kd * derivative;  
 
        prevError = error;  
 
        // Total output (clamped)  
        lastOutput = clamp(pTerm + iTerm + dTerm,  
                           outputMin, outputMax);  
        return lastOutput;  
    } 
 
    void setSetpoint (float sp) { setpoint = sp; }  
    float getSetpoint () const { return setpoint; }  
    float getOutput () const { return lastOutput; }  
 
    void setGains (float p, float i, float d) { 
        kp = p; ki = i; kd = d;  
    } 
 
    void reset() { 
        integral = 0; 
        prevError = 0; 
        lastOutput = 0; 
    } 
}; 
 
// Mô hình đơn giản của motor (first-order)
struct MotorModel  { 
    float speed; 
    const float timeConstant;  // Hệ số thời gian  
 
    MotorModel( float tau) : speed( 0), timeConstant(tau) {}  
 
    void update(float input, float dt) { 
        // Mô hình bậc 1: dSpeed/dt = (input - speed) / tau  
        speed += (input - speed) / timeConstant * dt;  
    } 
}; 
 
int main() { 
    // PID: Kp=2.0, Ki=0.5, Kd=0.1  
    // Setpoint=1000 rpm, output range [0, 100]%  
    PIDController pid(2.0, 0.5, 0.1, 
                      1000.0, 0, 100, 500, 0.01); 
 
    MotorModel motor(0.5);  // tau = 0.5s  

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
53 / 68    float dt = 0.01;        // 10ms cycle  
 
    cout << "=== PID Motor Speed Control ===\n" ; 
    cout << "Setpoint: "  << pid.getSetpoint() << " rpm\n\n" ; 
 
    cout << left << setw( 8) << "Time(s)"  
         << setw( 12) << "Speed" 
         << setw( 12) << "Error" 
         << setw( 12) << "Output"  << "\n"; 
    cout << "--------------------------------------------\n" ; 
 
    for (int i = 0; i <= 200; i++) {  
        float output = pid.compute(motor.speed);  
        motor.update(output * 12.0, dt);  // Scale: 100% → 1200 rpm max  
 
        // In mỗi 20 cycles (0.2s)  
        if (i % 20 == 0) { 
            float time = i * dt;  
            cout << left  
                 << setw( 8) << fixed << setprecision( 2) << time  
                 << setw( 12) << setprecision( 1) << motor.speed  
                 << setw( 12) << setprecision( 1) 
                 << (pid.getSetpoint() - motor.speed)  
                 << setw( 12) << setprecision( 1) << output  
                 << "\n"; 
        }  
    } 
 
    // Thay đổi setpoint  
    cout << "\n--- Setpoint changed to 500 rpm ---\n\n" ; 
    pid.setSetpoint( 500.0); 
 
    for (int i = 201; i <= 400; i++) {  
        float output = pid.compute(motor.speed);  
        motor.update(output * 12.0, dt); 
 
        if (i % 20 == 0) { 
            float time = i * dt;  
            cout << left  
                 << setw( 8) << fixed << setprecision( 2) << time  
                 << setw( 12) << setprecision( 1) << motor.speed  
                 << setw( 12) << setprecision( 1) 
                 << (pid.getSetpoint() - motor.speed)  
                 << setw( 12) << setprecision( 1) << output  
                 << "\n"; 
        }  
    } 
 
    return 0; 
} 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
54 / 687. Phân tích tư duy kỹ thuật
Sinh viên rút ra được:
PID là thuật t oán điều khiển quan trọng nhất  trong kỹ thuật — dùng ở mọi nơi
Struct lưu trữ trạng thái giữa các lần gọi  (integral, prevError) → stateful computation
Anti-windup  ngăn integral tích lũy quá lớn → tránh overshoot nghiêm trọng
Clamp  giới hạn output → bảo vệ actuator (motor không chạy quá công suất)
Combo PID + MotorModel = mô phỏng closed-loop contr ol hoàn chỉnh
Private clamp()  = helper function nội bộ , không thuộc giao diện public
8. Câu hỏi tư duy cho sinh viên
1. Nếu chỉ dùng P (bỏ I, D), hệ thống có bao giờ đạt chính xác setpoint không? V ì sao?
2. Anti-windup là gì? Điều gì xảy ra nếu không có nó?
3. So sánh PID controller (VD12) với ON-OFF controller (VD7): khi nào dùng cái nào?
4. Nếu muốn auto-tune  (tự chỉnh kp, ki, kd), cần thêm logic gì?
📌 Ví dụ này minh họa: stateful computation + anti-windup + closed-loop control + helper function
VÍ DỤ 13: GPIO DRIVER + BIT MANIPUL ATION
1. Bài toán thực tế
Trong lập trình vi điều khiển  (STM32, A VR, PIC…), mọi giao tiếp phần cứng đều thông qua thanh ghi
(regist er). Mỗi thanh ghi là một số nguy ên 32-bit , trong đó mỗi bit (hoặc nhóm bit) điều khiển một chức
năng cụ thể.
Ví dụ thanh ghi GPIO:
Bit 0: Pin 0 output
Bit 1: Pin 1 output
…
Bit 15: Pin 15 output
Để bật 1 pin  mà không ảnh hưởng pin khác, ta cần dùng bit manipulation :
SET bit: reg |= (1 << pin)
CLEAR bit: reg &= ~(1 << pin)
TOGGLE bit: reg ^= (1 << pin)
CHECK bit: (reg >> pin) & 1
Yêu cầu b ài toán: Mô phỏng GPIO driver cho vi điều khiển:
Cấu hình chân (input/output)

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
55 / 68Set, clear, toggle, đọc trạng thái pin
Mỗi port = 1 struct, mỗi pin = 1 bit trong thanh ghi
2. Phân tích
2.1 Xác định đối tượng
Đối tượng cần mô hình hóa: GPIO P ort (một cổng GPIO có 16 chân)
2.2 Phân tích thuộc tính (Data)
Thuộc tính Ý nghĩa Thay đổi theo thời gian
ODR Output Data R egister (thanh ghi đầu ra) Có (khi set/clear/toggle)
IDR Input Data R egister (thanh ghi đầu vào) Có (giả lập tín hiệu)
MODER Mode R egister (input/output/alternate) Có (khi cấu hình)
portName Tên port (A, B, C…) Không
→ Mỗi thuộc tính là thanh ghi 32-bit , mỗi bit đại diện 1 chân.
2.3 Phân tích hành vi (Function)
Hành vi Mô tả Thay đổi trạng thái
configPin() Cấu hình chân (input/output) Có (MODER)
setPin() Bật 1 chân (HIGH) Có (ODR)
clearPin() Tắt 1 chân (L OW) Có (ODR)
togglePin() Đảo trạng thái 1 chân Có (ODR)
readPin() Đọc trạng thái 1 chân Không
writeP ort() Ghi toàn bộ port Có (ODR)
readP ort() Đọc toàn bộ port Không
displayR egister() Hiển thị thanh ghi dạng binary Không
3. Thiết kế struct
Thiết kế struct GPIO_Port :
Các thanh ghi mô phỏng: ODR, IDR, MODER (kiểu uint32_t )
Hàm thao tác bit: set, clear, toggle, read
Đặc điểm : mọi phép toán đều dùng bitwise operat ors (|, &, ~, ^, <<, >>)

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
56 / 684. Phân biệt public / private
Áp dụng cho bài toán
private :
ODR, IDR, MODER (thanh ghi — chỉ thao tác qua hàm driver)
portName
public :
configPin() — cấu hình
setPin(), clearPin(), togglePin() — ghi
readPin(), readP ort() — đọc
writeP ort() — ghi toàn bộ
displayR egister() — debug
→ Truy cập trực tiếp ODR = 0xFF  → ảnh hưởng tất cả 16 pin cùng lúc , rất nguy hiểm.
5. Member function: const / non-const
Hàm const Giải thích
readPin() ✔ Chỉ đọc bit
readP ort() ✔ Chỉ đọc thanh ghi
displayR egister() ✔ Chỉ hiển thị
configPin() ❌ Thay đổi MODER
setPin() ❌ Thay đổi ODR
clearPin() ❌ Thay đổi ODR
togglePin() ❌ Thay đổi ODR
writeP ort() ❌ Thay đổi ODR
6. Code mô phỏng chạy được
#include <iostream>
#include <iomanip>
#include <cstdint>
#include <string>
using namespace  std; 
 
// Bit Manipulation Macros
#define SET_BIT(reg, bit)     ((reg) |=  (1U << (bit)))
#define CLEAR_BIT(reg, bit)   ((reg) &= ~(1U << (bit)))
#define TOGGLE_BIT(reg, bit)  ((reg) ^=  (1U << (bit)))
#define CHECK_BIT(reg, bit)   (((reg) >> (bit)) & 1U)  

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
57 / 68 
// Pin modes
enum class PinMode { INPUT = 0, OUTPUT = 1 }; 
 
struct GPIO_Port  {
private: 
    uint32_t  ODR;     // Output Data Register  
    uint32_t  IDR;     // Input Data Register  
    uint32_t  MODER;   // Mode Register  
    const string portName;  
 
    bool isValidPin (int pin) const { 
        if (pin < 0 || pin > 15) { 
            cout << " ⚠ Invalid pin: "  << pin << " (0-15)\n" ; 
            return false; 
        }  
        return true; 
    } 
 
    bool isOutputPin (int pin) const { 
        return CHECK_BIT(MODER, pin) == 1; 
    } 
 
public: 
    GPIO_Port( const string& name) 
        : ODR( 0), IDR(0), MODER( 0), portName(name) {}  
 
    void configPin (int pin, PinMode mode)  { 
        if (!isValidPin(pin)) return; 
 
        if (mode == PinMode::OUTPUT)  
            SET_BIT(MODER, pin);  
        else 
            CLEAR_BIT(MODER, pin);  
 
        cout << "GPIO" << portName << " Pin " << pin 
             << " → " << (mode == PinMode::OUTPUT ? "OUTPUT"  : "INPUT") 
             << "\n"; 
    } 
 
    void setPin(int pin) { 
        if (!isValidPin(pin)) return; 
        if (!isOutputPin(pin)) {  
            cout << " ⚠ Pin " << pin << " is not OUTPUT!\n" ; 
            return; 
        }  
        SET_BIT(ODR, pin);  
    } 
 
    void clearPin (int pin) { 
        if (!isValidPin(pin)) return; 
        if (!isOutputPin(pin)) return; 
        CLEAR_BIT(ODR, pin);  
    } 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
58 / 68 
    void togglePin (int pin) { 
        if (!isValidPin(pin)) return; 
        if (!isOutputPin(pin)) return; 
        TOGGLE_BIT(ODR, pin);  
    } 
 
    int readPin(int pin) const { 
        if (!isValidPin(pin)) return -1; 
        // Input pin → đọc IDR, Output pin → đọc ODR  
        if (isOutputPin(pin))  
            return CHECK_BIT(ODR, pin);  
        else 
            return CHECK_BIT(IDR, pin);  
    } 
 
    void writePort (uint16_t  value) { 
        ODR = value;  
    } 
 
    uint16_t  readPort () const { 
        return (uint16_t )(ODR & 0xFFFF); 
    } 
 
    // Giả lập tín hiệu input (cho mô phỏng)  
    void simulateInput (int pin, int value) { 
        if (value)  
            SET_BIT(IDR, pin);  
        else 
            CLEAR_BIT(IDR, pin);  
    } 
 
    void displayRegister (const string& regName,  
                         uint32_t  reg) const { 
        cout << "GPIO" << portName << "." << regName << " = "; 
        for (int i = 15; i >= 0; i--) {  
            cout << CHECK_BIT(reg, i);  
            if (i % 4 == 0) cout << " "; 
        }  
        cout << "(0x" << hex << (reg & 0xFFFF) << dec << ")\n"; 
    } 
 
    void displayAll () const { 
        displayRegister( "MODER", MODER);  
        displayRegister( "ODR  ", ODR); 
        displayRegister( "IDR  ", IDR); 
    } 
}; 
 
int main() { 
    GPIO_Port gpioA("A"); 
 
    cout << "=== GPIO Driver Simulation ===\n\n" ; 
 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
59 / 68    // Cấu hình  
    gpioA.configPin( 0, PinMode::OUTPUT);  // LED 
    gpioA.configPin( 1, PinMode::OUTPUT);  // Relay  
    gpioA.configPin( 2, PinMode::OUTPUT);  // Buzzer  
    gpioA.configPin( 5, PinMode::INPUT);   // Button  
 
    cout << "\n--- Initial state ---\n" ; 
    gpioA.displayAll();  
 
    // Bật LED (pin 0)  
    cout << "\n--- Set pin 0 (LED ON) ---\n" ; 
    gpioA.setPin( 0); 
    gpioA.displayAll();  
 
    // Toggle relay (pin 1) 3 lần  
    cout << "\n--- Toggle pin 1 (Relay) x3 ---\n" ; 
    for (int i = 0; i < 3; i++) {  
        gpioA.togglePin( 1); 
        cout << "Relay state: "  << gpioA.readPin( 1) << "\n"; 
    } 
 
    // Thử set pin input → lỗi  
    cout << "\n--- Try set input pin ---\n" ; 
    gpioA.setPin( 5); 
 
    // Giả lập nút nhấn  
    cout << "\n--- Simulate button press ---\n" ; 
    gpioA.simulateInput( 5, 1); 
    cout << "Button (pin 5) = "  << gpioA.readPin( 5) << "\n"; 
 
    if (gpioA.readPin( 5) == 1) { 
        gpioA.togglePin( 2);  // Toggle buzzer  
        cout << "Buzzer toggled!\n" ; 
    } 
 
    gpioA.displayAll();  
 
    return 0; 
} 
7. Phân tích tư duy kỹ thuật
Sinh viên rút ra được:
Bit manipulation  là kỹ năng bắt buộc  trong lập trình nhúng
Macro SET_BIT/CLEAR_BIT/TOGGLE_BIT/CHECK_BIT  = bộ công cụ chuẩn
Kiểm tra isOutputPin()  trước khi ghi → safety : không cho ghi vào pin input
Struct mô phỏng thanh ghi (ODR, IDR, MODER) giống cấu trúc thực tế  của MCU
Mỗi pin = 1 bit → quản lý 16 pin bằng 1 biến uint32_t  → hiệu quả bộ nhớ
Đây là nền tảng  trước khi học HAL/LL driver của STM32

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
60 / 688. Câu hỏi tư duy cho sinh viên
1. Vì sao dùng |= thay vì = khi set bit? Điều gì xảy ra nếu dùng ODR = (1 << pin) ?
2. Vì sao macro dùng 1U (unsigned) thay vì 1?
3. Trên STM32, thanh ghi BSRR (Bit Set/R eset R egister) cho phép set/clear atomic  — khác gì so với cách
dùng |= và &=~?
4. Nếu cần cấu hình pin cho Alternate Function  (UART TX, PWM…), cần mở rộng enum PinMode như thế
nào?
📌 Ví dụ này minh họa: bitwise operators + macro + hardware register model + validation
VÍ DỤ 14: GIA O THỨC TRUYỀN THÔNG (P ACKET
PROTOCOL)
1. Bài toán thực tế
Trong hệ thống nhúng v à IoT , các thiết bị cần trao đổi dữ liệu  qua U ART, RS-485, CAN, hoặc Ethernet. Dữ
liệu truyền đi dưới dạng chuỗi by te, cần có:
Đóng gói (framing) : đánh dấu đầu/cuối gói tin
Kiểm tra lỗi (CR C/checksum) : phát hiện byte bị sai
Phân tích (p arsing) : tách dữ liệu từ gói tin nhận được
Một giao thức đơn giản thường có cấu trúc:
| HEADER | LENGTH | CMD | DATA... | CRC |  
| 0xAA   | N      | ID  | payload | XOR |  
Yêu cầu b ài toán: Thiết kế module truyền thông:
Đóng gói dữ liệu thành packet (build)
Phân tích packet nhận được (parse)
Tính và kiểm tra CR C
Xử lý lỗi (header sai, CR C sai, length sai)
2. Phân tích
2.1 Xác định đối tượng
2 đối tượng cần mô hình hóa:
Packet — cấu trúc gói tin (dữ liệu + metadata)
Protocol — module xử lý đóng gói / phân tích

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
61 / 682.2 Phân tích thuộc tính (Data)
Packet:
Thuộc tính Ý nghĩa Thay đổi
command Mã lệnh Không (gán lúc tạo)
data[] Mảng dữ liệu payload Không (gán lúc tạo)
dataLength Kích thước payload Không
valid Gói tin hợp lệ? Có (sau parse)
Protocol:
Thuộc tính Ý nghĩa Thay đổi
HEADER Byte đánh dấu đầu gói Không (const)
MAX_P AYLOAD Kích thước payload tối đa Không (const)
txCount, rxCount Đếm gói gửi/nhận Có
errorCount Đếm lỗi Có
2.3 Phân tích hành vi (Function)
Hành vi Mô tả Thay đổi trạng thái
buildP acket() Đóng gói dữ liệu Có (txCount)
parseP acket() Phân tích gói tin Có (rxCount, errorCount)
calculateCR C() Tính CR C (XOR) Không
getStats() Đọc thống kê Không
displayP acket() Hiển thị gói tin dạng hex Không
3. Thiết kế struct
Thiết kế 2 struct:
struct Packet  — chứa dữ liệu gói tin (command, payload, valid)
struct Protocol  — xử lý build/parse/CR C + thống kê
4. Phân biệt public / private
Packet
public : command, data[], dataLength, valid — vì Protocol cần truy cập

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
62 / 68Protocol
private :
HEADER (const)
txCount, rxCount, errorCount (chỉ thay đổi qua build/parse)
calculateCR C() — hàm nội bộ
public :
buildP acket() — đóng gói
parseP acket() — phân tích
displayRawBytes() — debug
getStats() — thống kê
→ CR C calculation là chi tiết tr iển khai nội bộ , người dùng không cần biết.
5. Member function: const / non-const
Hàm const Giải thích
calculateCR C() ✔ Chỉ tính toán, trả về kết quả
displayRawBytes() ✔ Chỉ hiển thị
getStats() ✔ Chỉ đọc dữ liệu
buildP acket() ❌ Tăng txCount
parseP acket() ❌ Tăng rxCount hoặc errorCount
6. Code mô phỏng chạy được
#include <iostream>
#include <iomanip>
#include <cstdint>
#include <cstring>
using namespace  std; 
 
// Cấu trúc gói tin
struct Packet { 
    uint8_t command;  
    uint8_t data[32]; 
    int dataLength;  
    bool valid; 
 
    Packet() : command( 0), dataLength( 0), valid( false) { 
        memset(data, 0, sizeof(data));  
    } 
}; 
 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
63 / 68// Module giao thức truyền thông
struct Protocol  {
private: 
    static const uint8_t HEADER = 0xAA; 
    static const int MAX_PAYLOAD = 32; 
    int txCount;  
    int rxCount;  
    int errorCount;  
 
    // CRC: XOR tất cả byte (đơn giản nhưng hiệu quả cho demo)  
    uint8_t calculateCRC (const uint8_t* data, int len) const { 
        uint8_t crc = 0; 
        for (int i = 0; i < len; i++)  
            crc ^= data[i];  
        return crc; 
    } 
 
public: 
    Protocol() : txCount( 0), rxCount( 0), errorCount( 0) {} 
 
    // Đóng gói: HEADER | LENGTH | CMD | DATA... | CRC  
    int buildPacket (uint8_t command, const uint8_t* payload,  
                    int payloadLen, uint8_t* outBuffer)  { 
        if (payloadLen > MAX_PAYLOAD) {  
            cout << " ⚠ Payload too large!\n" ; 
            return 0; 
        }  
 
        int idx = 0; 
        outBuffer[idx++] = HEADER;  
        outBuffer[idx++] = ( uint8_t)(payloadLen + 1);  // +1 for command  
        outBuffer[idx++] = command;  
 
        for (int i = 0; i < payloadLen; i++)  
            outBuffer[idx++] = payload[i];  
 
        // CRC: tính từ LENGTH đến hết DATA  
        outBuffer[idx] = calculateCRC(&outBuffer[ 1], idx - 1); 
        idx++;  
 
        txCount++;  
        return idx;  // Tổng số byte  
    } 
 
    // Phân tích gói tin  
    Packet parsePacket (const uint8_t* rawData, int rawLen)  { 
        Packet pkt;  
 
        // Kiểm tra header  
        if (rawData[ 0] != HEADER) {  
            cout << " ✗ Invalid header: 0x"  
                 << hex << ( int)rawData[ 0] << dec << "\n"; 
            errorCount++;  
            return pkt; 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
64 / 68        }  
 
        // Kiểm tra length hợp lý  
        int length = rawData[ 1]; 
        if (length + 3 > rawLen) {  // HEADER + LENGTH + data + CRC  
            cout << " ✗ Incomplete packet!\n" ; 
            errorCount++;  
            return pkt; 
        }  
 
        // Kiểm tra CRC  
        uint8_t expectedCRC = calculateCRC(&rawData[ 1], length + 1); 
        uint8_t receivedCRC = rawData[length + 2]; 
        if (expectedCRC != receivedCRC) {  
            cout << " ✗ CRC mismatch! Expected=0x"  
                 << hex << ( int)expectedCRC  
                 << " Received=0x"  << (int)receivedCRC << dec << "\n"; 
            errorCount++;  
            return pkt; 
        }  
 
        // Parse thành công  
        pkt.command = rawData[ 2]; 
        pkt.dataLength = length - 1;  // -1 for command byte  
        for (int i = 0; i < pkt.dataLength; i++)  
            pkt.data[i] = rawData[ 3 + i]; 
        pkt.valid = true; 
        rxCount++;  
 
        return pkt; 
    } 
 
    void displayRawBytes (const uint8_t* data, int len) const { 
        cout << "Raw: [" ; 
        for (int i = 0; i < len; i++) {  
            cout << "0x" << hex << setfill( '0') << setw( 2) 
                 << ( int)data[i] << dec;  
            if (i < len - 1) cout << " "; 
        }  
        cout << "]\n"; 
    } 
 
    void getStats () const { 
        cout << "TX: " << txCount  
             << " | RX: "  << rxCount  
             << " | Errors: "  << errorCount << "\n"; 
    } 
}; 
 
int main() { 
    Protocol protocol;  
 
    cout << "=== Communication Protocol Simulation ===\n\n" ; 
 

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
65 / 68    // === SEND ===  
    cout << "--- Sending Packet ---\n" ; 
    uint8_t payload1[] = { 0x01, 0x02, 0x03, 0x04}; 
    uint8_t buffer[ 64]; 
    int len = protocol.buildPacket( 0x10, payload1, 4, buffer);  
    protocol.displayRawBytes(buffer, len);  
 
    // === RECEIVE (valid) ===  
    cout << "\n--- Parsing Valid Packet ---\n" ; 
    Packet pkt = protocol.parsePacket(buffer, len);  
    if (pkt.valid) {  
        cout << " ✔ Valid packet! CMD=0x"  
             << hex << ( int)pkt.command << dec  
             << " DataLen="  << pkt.dataLength << "\n" 
             << "  Payload: " ; 
        for (int i = 0; i < pkt.dataLength; i++)  
            cout << "0x" << hex << ( int)pkt.data[i] << dec << " "; 
        cout << "\n"; 
    } 
 
    // === RECEIVE (corrupted) ===  
    cout << "\n--- Parsing Corrupted Packet ---\n" ; 
    uint8_t corrupted[ 64]; 
    memcpy(corrupted, buffer, len);  
    corrupted[ 3] = 0xFF;  // Corrupt 1 byte  
    protocol.displayRawBytes(corrupted, len);  
    Packet bad = protocol.parsePacket(corrupted, len);  
    cout << "Valid: "  << (bad.valid ? "true" : "false") << "\n"; 
 
    // === RECEIVE (wrong header) ===  
    cout << "\n--- Parsing Wrong Header ---\n" ; 
    uint8_t wrongHeader[] = { 0xBB, 0x02, 0x10, 0x01, 0x13}; 
    protocol.parsePacket(wrongHeader, 5); 
 
    // Stats  
    cout << "\n--- Protocol Stats ---\n" ; 
    protocol.getStats();  
 
    return 0; 
} 
7. Phân tích tư duy kỹ thuật
Sinh viên rút ra được:
Framing  (HEADER + LENG TH + CR C) là cách đánh dấu ranh giới  gói tin trong dòng byte liên tục
CRC/Checksum  phát hiện lỗi truyền → quyết định accept hay reject gói tin
calculateCRC()  là private const  → chi tiết nội bộ, không thay đổi trạng thái
Pattern build → transmit → r eceiv e → p arse = quy trình truyền thông tiêu chuẩn
Thống kê (txCount, rxCount, errorCount) giúp giám sát chất lượng  đường truyền
Đây là nền tảng cho Modbus, MQ TT, custom protocol trên U ART/RS-485

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
66 / 688. Câu hỏi tư duy cho sinh viên
1. Vì sao cần HEADER byte? Nếu không có, receiver biết gói tin bắt đầu từ đâu?
2. XOR checksum đơn giản nhưng có hạn chế gì? CR C-16 tốt hơn ở điểm nào?
3. Nếu truyền qua U ART (nhận từng byte qua ISR), cần kết hợp Ring Buffer (VD11) thế nào?
4. Thiết kế giao thức cho hệ thống có nhiều loại lệnh  (đọc sensor, điều khiển motor, cấu hình PID) — cần
thêm gì vào struct P acket?
📌 Ví dụ này minh họa: framing + CRC + build/parse pattern + protocol design
GHI CHÚ SƯ PHẠM TỔNG HỢP
Flow chuẩn cho mỗi ví dụ
Mỗi ví dụ trong tài liệu này tuân theo 8 bước thống nhất :
Bước Nội dung Mục tiêu
1 Bài toán thực tế Hiểu vấn đề trước khi code
2 Phân tích (Data + Function) Chuyển bài toán → mô hình logic
3 Thiết kế struct Data abstraction
4 Public / Private Encapsulation
5 Const / Non-const Kỷ luật thiết kế
6 Code chạy được Liên kết tư duy → triển khai
7 Phân tích tư duy Rút ra nguyên tắc
8 Câu hỏi tư duy Mở rộng, phản biện
Tóm tắt kỹ thuật lập trình theo ví dụ
VD Đối tượng Kỹ thuật chính Pattern
1 Rơ-le quá áp if/else, const Protection logic
2 PLC Scan Cycle while loop Super loop
3 ADC nhiều kênh for, array Data acquisition
4 Động cơ DC state + validation State management
5 Cảm biến nhiệt const-majority Read-mostly device
6 Robot 1D simulation loop Physics model

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
67 / 68VD Đối tượng Kỹ thuật chính Pattern
7 Controller ON-OFF if/else + hysteresis Control theory
8 PLC Mini multi-struct I-P-O architecture
9 Linked List pointer + dynamic memory FIFO queue
Nguyên tắc sư phạm chung
Mỗi ví dụ bắt nguồn từ một hệ thống kỹ thuật cụ thể
Cấu trúc điều khiển được lựa chọn tự nhiên từ b ài toán, không áp đặt
Phù hợp cho giảng dạy tư duy lập trình , không thuần cú pháp
Có thể dùng làm: bài giảng, lab, bài tập phân tích, đề kiểm tra
Lập trình là cách kỹ sư mô tả thế giới thực bằng logic.
Gợi ý sử dụng cho giảng viên
Yêu cầu sinh viên vẽ sơ đồ str uct trước khi viết code
Cho sinh viên chỉ ra hàm nào nên là const  trước khi xem đáp án
Bài tập: chỉ đưa bước 1 (bài toán) → yêu cầu sinh viên tự phân tích (bước 2-5) → rồi mới code (bước 6)
Thảo luận nhóm: dùng câu hỏi tư duy (bước 8) để thảo luận
Ma trận kỹ thuật: Ví dụ × Khái niệm
Khái niệm VD minh họa chính
if / else VD1 (Rơ-le), VD7 (ON-OFF), VD10 (FSM)
switch-case VD10 (FSM), VD14 (Protocol)
while VD2 (PL C), VD6 (R obot)
for + array VD3 (ADC), VD11 (Ring Buffer)
enum VD10 (FSM), VD13 (GPIO)
const member function VD5 (Sensor), VD12 (PID)
private / encapsulation VD4 (Motor), VD11 (Ring Buffer)
bitwise operators VD13 (GPIO)
macro VD13 (GPIO)
multi-struct design VD8 (PL C Mini), VD14 (Protocol)
dynamic memory VD9 (Linked List)
stateful computation VD12 (PID)
CRC / error detection VD14 (Protocol)

tổng_hợp_vi_dụ_c_c_theo_tư_duy_lập_trinh_kỹ_thuật.md 2026-02-07
68 / 68Khái niệm VD minh họa chính
modulo arithmetic VD11 (Ring Buffer)
📌 Phần tiếp theo có thể mở rộng:
Gắn Bloom T axonomy  cho từng bước
Chuẩn hóa thành templat e bài giảng + lab sheet
Áp dụng tương tự cho class, OOP, Embedded C
Bài tập tổng hợp: kết hợp VD11 (Ring Buffer) + VD14 (Protocol) = U ART receiver hoàn chỉnh
Bài tập nâng cao: kết hợp VD8 (PL C Mini) + VD12 (PID) = closed-loop temperature control

