# M01-B-RESET — Thiết kế reset mật khẩu (USER / ADMIN / SYSTEM)

**Ngày chốt nghiệp vụ:** 10/10/2026  
**Quyết định:** Owner duyệt các quy tắc dưới đây trong trao đổi thiết kế 11Ship.  
**Trạng thái:** **OWNER_APPROVED_BUSINESS / WAITING_IMPLEMENTATION** — chỉ lưu thiết kế, chưa code, chưa có CI/test/triển khai/Owner nghiệm thu chức năng.  
**Module:** M01 — Authentication. Đây là phần bổ sung cho mục «quên mật khẩu» từng chuyển sang M01-B trong [đặc tả M01-A](../current/11Ship-buoc-4.2-auth-onboarding-M01-A-v1.0.md).  
**Phân công:** ChatGPT thiết kế và review; Claude triển khai code/test theo gói được giao; Owner test local, điện thoại thật và quyết định merge/nghiệm thu.

> Quyết định ngày 10/10/2026 **thay thế phần định hướng "đổi/quên mật khẩu"** trong các tài liệu M01 cũ: không xây dựng tính năng đổi mật khẩu riêng, chỉ có reset mật khẩu. Không sửa ngược bằng chứng/history của các task Auth đã code.

## 1. Phạm vi đã chốt

| Loại tài khoản | Reset mật khẩu | Xác minh |
|---|---|---|
| USER (gồm khách, quán, xế và các vai trò nghiệp vụ thông thường) | Một form reset chung, không cần đăng nhập trước | OTP qua SMS đến **số đăng ký tài khoản** |
| ADMIN | **Cùng form và luồng OTP SMS của USER**; không có form đổi mật khẩu riêng | OTP qua SMS đến **số đăng ký tài khoản ADMIN** |
| SYSTEM (tài khoản cao nhất, duy nhất) | **Quy trình khôi phục đặc quyền bằng công cụ bảo mật trên server**, không dùng form reset công khai | Quyền vận hành server; **email đã xác minh** là bước OTP bổ sung nếu đã cấu hình |

Không cần mật khẩu cũ trong bất kỳ luồng reset nào. Không thêm chức năng **Đổi mật khẩu** tại trang cá nhân/cài đặt. Quá trình reset chỉ đặt mật khẩu mới cho **chính tài khoản hiện có**; không tạo tài khoản, không thay số điện thoại, không cấp/đổi role, không xóa dữ liệu nghiệp vụ.

## 2. Form và luồng chung cho USER / ADMIN

Giao diện gồm các bước trên **cùng một form/luồng** (có thể hiển thị theo bước, dùng lại thành phần giữa các app):

1. Nhập số điện thoại đã đăng ký.
2. Chọn **Gửi OTP**; hệ thống gửi SMS đến đúng số điện thoại gắn với tài khoản.
3. Nhập OTP; xác minh OTP đúng mục đích **RESET_PASSWORD**, còn hạn và chưa dùng.
4. Nhập **Mật khẩu mới** và **Xác nhận mật khẩu mới**.
5. Bấm **Đặt lại mật khẩu**; backend cập nhật mật khẩu và vô hiệu hóa các phiên cũ.
6. Báo thành công, trở về đăng nhập. ADMIN vẫn phải qua bước **Google Authenticator/TOTP** như trước khi đăng nhập lại.

**Ràng buộc đã duyệt:**
- OTP hiệu lực **5 phút**, chỉ sử dụng **một lần**, không nhận lại OTP đã dùng/hết hạn.
- Có giới hạn gửi lại và số lần nhập sai; giá trị chi tiết tuân theo cấu hình Auth hiện hành hoặc được khóa trong gói kỹ thuật trước khi code, không để vô hạn.
- Không yêu cầu đăng nhập hoặc mật khẩu cũ.
- Không dùng OTP/verification proof cho mục đích REGISTER để reset; tách purpose **RESET_PASSWORD**.
- Không tiết lộ việc số điện thoại có tồn tại hay là USER/ADMIN qua thông điệp yêu cầu OTP.
- Password mới tuân thủ quy tắc độ dài/hash Auth đang dùng (Argon2id), không lưu/log password plaintext.
- Reset thành công **thu hồi tất cả phiên và bước xác thực đang chờ** của tài khoản trên mọi ứng dụng/thiết bị; các token/phiên cũ không tiếp tục dùng được.
- Giữ nguyên role, hồ sơ, dữ liệu, trạng thái tài khoản và cấu hình TOTP; reset không tự động mở khóa hoặc kích hoạt tài khoản bị vô hiệu hóa.
- Không tự đăng nhập sau reset; mã TOTP vẫn là lớp xác thực đăng nhập của ADMIN.

## 3. Khôi phục SYSTEM qua server; email phụ tùy chọn

1. SYSTEM chỉ được bootstrap khi thiết lập lần đầu, đảm bảo một SYSTEM duy nhất. **Không dùng lại lệnh bootstrap để đổi/reset mật khẩu**: hiện cơ chế bootstrap trả `unchanged` với tài khoản SYSTEM đã tồn tại và không động vào password.
2. Khôi phục SYSTEM đi qua công cụ/quy trình vận hành bảo mật **trên server**, không có endpoint tự phục vụ dùng OTP SMS hoặc form USER/ADMIN.
3. SYSTEM **có thể đăng ký một email khôi phục tùy chọn**. Email phải được xác minh bằng OTP trước khi trở thành email khôi phục hợp lệ; không cho phép địa chỉ chưa xác minh dùng để reset.
4. **Nếu đã có email khôi phục được xác minh**, reset SYSTEM qua server phải sử dụng xác minh OTP email như bước bảo mật bổ sung, **không phải cách thay thế quyền vận hành server**. Nếu chưa cấu hình email, dùng quy trình khôi phục bảo mật qua server; email không phải điều kiện bootstrap.
5. Nếu không còn truy cập email đã đăng ký, cần có đường khôi phục khẩn cấp **qua server** có kiểm soát quyền vận hành và audit, tuyệt đối không bỏ xác minh chỉ bằng cách đổi email chưa kiểm chứng hoặc dùng SMS.
6. Khi khôi phục thành công: tạo mật khẩu mới, thu hồi toàn bộ session/preauth cũ, giữ nguyên chính tài khoản SYSTEM, vai trò, dữ liệu và Google Authenticator/TOTP hiện có; không tạo SYSTEM thứ hai.
7. Mọi thao tác thêm/đổi/xác minh email hoặc khôi phục khẩn cấp phải được audit. Không ghi email OTP, mật khẩu, mã TOTP, token/khóa bí mật vào log hoặc audit.

**Chưa chốt chi tiết kỹ thuật:** giao diện/công cụ quản lý email SYSTEM, cách xác thực quyền người vận hành, API/CLI chính xác, schema mới, khóa chống chạy trùng và thủ tục khôi phục khi mất email. Claude **không tự suy diễn** các hợp đồng này; ChatGPT thiết kế tiếp trước khi giao code.

## 4. Yêu cầu bảo mật, liên thông và test khi triển khai

- Xác minh OTP/phép đổi mật khẩu và thu hồi session phải chống đua tranh, dùng cơ chế transaction/audit hiện có, không phát hành reset trùng lặp; proof/token mật chỉ lưu dạng băm phù hợp.
- Bảo vệ khỏi brute force, resend flood, dò tài khoản, replay OTP, reset đồng thời và sự cố gửi SMS/email; không trả bí mật trong lỗi.
- Có log audit kết quả reset và thu hồi session an toàn; không lưu SĐT, email, OTP, password hay session token dạng rõ trong payload log/audit.
- Mã xác minh và cơ chế delivery thực tế ở staging/production không được giả lập thành SMS/email thật. Test bằng provider giả lập trong môi trường test theo quy định dự án.
- Sau reset, thử bằng mật khẩu cũ phải thất bại và mọi session cũ trên Web Admin / Khách / Quán / Xế / app quản lý phải bị chặn; mật khẩu mới đăng nhập đúng luồng role và 2FA tương ứng.
- Xác minh xử lý tài khoản disabled, OTP sai/hết hạn/dùng rồi, nhiều request đồng thời, phản hồi mạng bị mất sau commit, email SYSTEM chưa xác minh/mất email và bootstrap lại.

## 5. Ma trận triển khai và nghiệm thu

| Đầu ra / ứng dụng | Thiết kế nghiệp vụ | UI/API chi tiết | Code/CI/review | Owner local | Thiết bị thật | Owner nghiệm thu |
|---|---|---|---|---|---|---|
| API Auth/Reset dùng chung | **Đã duyệt** | **Chưa khóa** | Chưa | Chưa | N/A (backend) | Chưa |
| Web quản trị (ADMIN) | **Đã duyệt** | Chưa có ảnh UI được duyệt | Chưa | Chưa | Chưa | Chưa |
| App Khách | **Đã duyệt** | Chưa có ảnh UI được duyệt | Chưa | Chưa | Chưa | Chưa |
| App Quán | **Đã duyệt** | Chưa có ảnh UI được duyệt | Chưa | Chưa | Chưa | Chưa |
| App Xế | **Đã duyệt** | Chưa có ảnh UI được duyệt | Chưa | Chưa | Chưa | Chưa |
| App quản lý (nếu tài khoản thông thường sử dụng) | **Đã duyệt** | Chưa có ảnh UI được duyệt | Chưa | Chưa | Chưa | Chưa |
| SYSTEM (CLI khôi phục / email phụ) | **Đã duyệt nghiệp vụ** | Công cụ, quy trình chi tiết chưa khóa | Chưa | Chưa | N/A (CLI/server) | Chưa |
| Hồi quy liên thông Auth/2FA/session | **Đã duyệt mục tiêu** | Test contract chưa khóa | Chưa | Chưa | Chưa | Chưa |

N/A là đặc tính không có giao diện thiết bị của backend/CLI, **không** miễn kiểm tra nghiệp vụ và bảo mật.

## 6. Việc tiếp theo — chưa được phép đánh dấu hoàn thành

- [x] Owner chốt nghiệp vụ reset USER / ADMIN dùng chung OTP SMS.
- [x] Owner chốt SYSTEM khôi phục qua server, email phụ tùy chọn đã xác minh.
- [x] Owner chốt bỏ chức năng đổi mật khẩu riêng.
- [ ] ChatGPT hoàn tất hợp đồng API/schema/bảo mật còn mở và ảnh UI chi tiết; Owner duyệt phần chi tiết.
- [ ] ChatGPT giao gói triển khai cho Claude với base/head SHA, test case và phạm vi không mở rộng.
- [ ] Claude code, unit/integration/security tests, CI xanh final head.
- [ ] ChatGPT review độc lập; Claude xử lý finding.
- [ ] Owner kiểm tra local các luồng.
- [ ] Owner kiểm tra web/thiết bị thật và liên thông.
- [ ] Owner quyết định merge, nghiệm thu, đóng task.

**Lưu ý tiến độ:** tài liệu này **không** cập nhật `docs/PROGRESS.md` tự sinh, **không** biến backend M01 đã merge thành bằng chứng chức năng reset mật khẩu đã có; chưa bổ sung task vào `docs/progress/plan.yml` vì cần gói triển khai/ID phụ thuộc riêng được lập trước khi đăng ký vào dashboard.
