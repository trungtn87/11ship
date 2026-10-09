# M01-D — thiết kế nghiệp vụ quản trị, bước 1
Ngày 09/10/2026. DRAFT nghiệp vụ; chưa khóa API/schema/UI, chưa giao Claude code.
Nguồn: roadmap M01 PR #30 head bd213e5ca0b8756c2e858b434679cf0db1eeb7b5; workflow main; chỉ đạo Owner tiếp M01 và tạm dừng M00 chờ triển khai tại máy.
Phân công: ChatGPT thiết kế nghiệp vụ/ảnh UI, handoff và review; Claude code/test/build; Owner duyệt và test local rồi điện thoại.

## Quyết định hiện tại
M00 tạm dừng triển khai; không đóng, không coi môi trường đạt. Owner đã chốt OTP thử: vẫn nhập/kiểm SĐT, backend sinh mã, thay gửi SMS bằng hiển thị mã thử; mọi nghiệp vụ khác giữ nguyên. Quyết định đó không duyệt toàn bộ contract RUN/TLS.
Tiếp M01 phần thiết kế độc lập môi trường. Test local/thiết bị thật còn chờ M00. Không tự merge PR #33 hoặc các PR UI cũ.
Ưu tiên web SYSTEM/ADMIN theo roadmap; không coi shell web ở #31 là có quyền quản trị.

## Nghiệp vụ đã có nguồn
- Đúng một SYSTEM, tài khoản quản trị cao nhất; không đăng ký công khai.
- Chỉ SYSTEM tạo ADMIN; ADMIN không tự đăng ký và không tự nâng quyền.
- SYSTEM dùng Google Authenticator; ADMIN bắt buộc 2FA.
- Quyền quản trị kiểm ở backend theo scope; nhận diện app không cấp role.
- Một tài khoản một thiết bị online theo quy tắc Owner; cách migration/thu hồi cho session legacy phải khóa trong thiết kế kỹ thuật trước code.
- PLATFORM/EXTERNAL là loại xế, không quyền SYSTEM/ADMIN.

## Đề xuất cần Owner duyệt
| Chủ đề | Hành vi đề xuất |
|---|---|
| Khởi tạo SYSTEM | Operator khởi tạo một lần bằng công cụ vận hành; nhập SĐT hợp lệ và mật khẩu; không màn signup SYSTEM, không mật khẩu mặc định |
| Lần đầu SYSTEM login | SĐT + mật khẩu → thiết lập Authenticator → nhập mã xác nhận → vào web; chưa hoàn tất 2FA không có quyền quản trị |
| Tạo ADMIN | SYSTEM nhập tên, SĐT hợp lệ/duy nhất và chọn scope; mật khẩu tạm sinh ngẫu nhiên, chỉ hiển thị một lần để giao riêng |
| ADMIN lần đầu | Đổi mật khẩu tạm → thiết lập 2FA → xác nhận mã → vào phần được cấp; chưa đủ bước không có quyền quản trị |
| Scope ban đầu | Khách / Quán / Xế / Quản lý; chỉ mở màn và API đã triển khai. Scope là phạm vi ứng dụng, không thay thế quyền chi tiết từng module |
| Khóa ADMIN | Khóa quyền quản trị và thu hồi phiên quản trị đang có; bảo toàn audit, không xóa tài khoản hay dữ liệu |
| Thay đổi scope | Kiểm quyền lại trên server; scope bị gỡ mất hiệu lực với phiên cũ; không chỉ ẩn menu |
| Đăng xuất | Thu hồi phiên server; nếu endpoint chưa có cần task M01-B, không dùng xóa token để giả logout |
| Khôi phục 2FA | SYSTEM có mã khôi phục dùng một lần; mất cả mã cần quy trình operator riêng. ADMIN được SYSTEM reset 2FA có audit và thu hồi phiên, bắt enroll lại |

Mật khẩu tạm, TTL/kích hoạt, cách giao credential, scope API enum, recovery và tác động lên tài khoản kiêm role là đề xuất chưa được khóa. Không gửi credential tới người khác trong công việc thiết kế.
OTP SMS thử không thay mã Google Authenticator. Quản trị vẫn cần 2FA thật; không hiện mã TOTP thử để vượt 2FA.

## Luồng màn hình dự kiến — sau duyệt nghiệp vụ sẽ gửi ảnh UI
1. Web login quản trị: SĐT, mật khẩu, nút đăng nhập; lỗi không lộ tồn tại tài khoản.
2. Thiết lập 2FA: QR/khóa thiết lập, nhập mã, xác nhận; secret không log/telemetry.
3. Xác nhận 2FA: mã Authenticator, tùy chọn mã khôi phục theo quyền.
4. SYSTEM quản lý ADMIN: danh sách tên/SĐT/trạng thái/scope; tạo, xem/sửa scope, khóa/mở khóa, reset 2FA.
5. ADMIN shell: tài khoản và phạm vi được cấp; chưa có chức năng module thì hiển thị chưa triển khai, không giả dữ liệu.
Mỗi màn cần ảnh normal/loading/error/empty và hành vi hết phiên. HTML chỉ mẫu duyệt UI, chưa là test nghiệp vụ.

## Checklist và ca lỗi trước handoff
- [ ] Owner duyệt các đề xuất nghiệp vụ trên.
- [ ] Khóa bootstrap concurrency đúng một SYSTEM, session/2FA/recovery, API/schema và migration.
- [ ] Giải quyết account existing/kiêm role và tác động khóa trên role khác.
- [ ] Kiểm SĐT sai/trùng, mật khẩu sai, TOTP sai/hết hạn/replay, mất mã, quyền thiếu.
- [ ] Kiểm double submit, khóa/đổi scope khi mutation đang chờ, thay thiết bị và session cũ.
- [ ] Ảnh UI chi tiết được Owner duyệt.
- [ ] Handoff Claude có base/head/scope/tests và dependency.
- [ ] Claude CI; ChatGPT review đúng SHA.
- [ ] Owner test local sau M00 đạt; test thiết bị và liên thông sau local đạt.
- [ ] Owner quyết định merge/nghiệm thu; không suy ra từ CI.

## Gate ứng dụng hiện tại
| App | Phạm vi bước này | Trạng thái |
|---|---|---|
| Web SYSTEM/ADMIN | Nghiệp vụ quản trị | DRAFT thiết kế; chưa UI/code/review/local/nghiệm thu |
| App quản lý | Kế thừa Auth/2FA/quyền sau web | Chưa thiết kế chi tiết; không mặc định SYSTEM |
| Khách/Quán/Xế | Auth và onboarding ở các bước sau | Chưa nghiệm thu UI/local/thiết bị |
| Liên thông | Phiên/quyền/API chung | Chưa kiểm chứng |
Không ghi N/A khi chưa có quyết định Owner. Không đóng M01.
