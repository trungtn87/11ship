# M01-D — UI xác thực quản trị v1
Ngày 09/10/2026. DRAFT UI chờ Owner duyệt; chưa code sản phẩm.
Nguồn: M01-D-business-design.md và brand guideline main. M00 tạm dừng; không coi ảnh là test nghiệp vụ.
ChatGPT thiết kế/ảnh/review; Claude code/test sau duyệt; Owner duyệt UI, test local/thiết bị và quyết định merge.

## Màn 01 — đăng nhập chung
Một link/form SYSTEM và ADMIN, không chọn role/đăng ký công khai.
Logo mẹ 11 + “Quản trị”; heading “Đăng nhập quản trị”; mô tả “Dành cho tài khoản được cấp quyền.”
Số điện thoại: input “Nhập số điện thoại”, kiểm backend/chuẩn hóa theo contract hiện hành.
Mật khẩu: input ẩn, nút hiện/ẩn accessible; CTA “Tiếp tục”.
SĐT sai: lỗi dưới field “Số điện thoại không hợp lệ.” Không hiển thị mã thử SMS trên luồng này.
Sai credential: “Thông tin đăng nhập không đúng.” Không lộ số tồn tại/role trước xác thực.
Loading: nút “Đang kiểm tra…” disabled chống bấm lặp, giữ SĐT. Không lưu mật khẩu.
Backend xác định role, trạng thái 2FA; trước đủ 2FA không được vào nghiệp vụ.

## Màn 02 — thiết lập 2FA lần đầu
Heading “Thiết lập Authenticator”. Hướng dẫn mở Google Authenticator, quét QR hoặc xem khóa thiết lập theo thao tác rõ ràng, nhập mã 6 số.
QR trong ảnh chỉ minh họa, không credential thật. Production QR/khóa từ backend, không log/telemetry/cache.
Input một ô hỗ trợ paste mã 6 số; CTA “Xác nhận và tiếp tục”. Không tự gửi khi đủ 6 số.
Loading/error tương tự challenge. Rời màn phải xử lý challenge theo backend, không coi đã enroll.
Backend chỉ đánh dấu enroll hoàn tất sau verify đúng. Các màn recovery/đổi mật khẩu tạm bổ sung sau contract nghiệp vụ được duyệt.

## Màn 03 — challenge 2FA
Heading “Xác thực hai bước”; mô tả “Nhập mã từ Google Authenticator.”
Input “Mã xác thực 6 số”; CTA “Xác nhận đăng nhập”; secondary “Quay lại đăng nhập”.
Sai/hết hiệu lực mã: “Mã không đúng hoặc đã hết hiệu lực.”
Challenge hết hạn: “Phiên xác thực đã hết hạn. Vui lòng đăng nhập lại.” và quay về login.
Giới hạn lượt nhập: thông báo thời gian/chính sách từ backend; không hardcode TTL/cooldown mới trong UI.
Loading “Đang xác thực…”; chống submit lặp. Thành công router theo role/scope backend.
Không hiển thị OTP thử thay SMS để vượt Authenticator. Recovery chưa khóa thì chưa mở link recovery.

## Visual và responsive
Vàng #D8AD18, than #2A2A2E, trắng #FFFFFF, nền #F2F1EE. Font Plus Jakarta Sans; label/body 14–16px, heading 24–28px. Card radius16, input/button12, target>=44px.
Desktop header nhỏ, form card giữa trang; mobile một cột, form vừa viewport, không cuộn ngang.
Focus visible, label thật, lỗi accessible, keyboard Enter submit, eye button có tên.
Ảnh đầu trình bày ba màn normal và hai ví dụ lỗi; chưa phải bộ ảnh tất cả trạng thái.
Mỗi trạng thái UI quan trọng còn cần Owner duyệt trước code; chưa tự đánh UI_LOCKED.

## Gate
Web SYSTEM/ADMIN: đang thiết kế UI, code/review/local/thiết bị/nghiệm thu chưa kiểm chứng.
App quản lý và Khách/Quán/Xế: UI riêng ở task sau, không coi bộ ảnh web là đã đạt.
Liên thông chưa kiểm chứng. Không merge/đóng M01 từ ảnh.
