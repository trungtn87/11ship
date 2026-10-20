# M03 — Quy trình shipper đơn giản (Owner 20/10/2026)

Quyết định này thay thế yêu cầu onboarding M03 trước đây có xung đột. DRIVER trong API/database là vai trò SHIPPER của sản phẩm.

## Đăng ký và nhận đơn

11Ship đăng ký bằng họ tên, SĐT, mật khẩu và xác thực M01 theo cấu hình OTP hiện hành. Cùng transaction đăng ký: giữ CUSTOMER, tạo DRIVER/ACTIVE, tạo ví 0đ và chọn phiên DRIVER. Không chọn khu vực, nhập ngân hàng hay chờ Admin duyệt. 11Food và SHOP không đổi. Giữ duy nhất SĐT, device proof và cơ chế một thiết bị online.

Ví và Nạp tiền mở ngay. Nạp theo `topup_min_vnd` hiện hành; chỉ xác nhận giao dịch hợp lệ mới ghi tiền. Shipper mới phải có tổng nạp đã xác nhận đạt mức nạp đầu theo cấu hình, sau đó nhận đơn theo hoa hồng dự kiến/số dư khả dụng. Không yêu cầu duyệt hồ sơ hoặc ngân hàng để bật hoạt động. Không hủy đơn đang giao khi số dư giảm; reserve/capture/release hoa hồng và chống ghi trùng giữ nguyên.

## Dừng hoạt động / Rút số dư

Yêu cầu dừng chuyển ACTIVE → CLOSING và tắt nhận đơn ngay, không hủy đơn đang giao. Sau khi hoàn tất đơn, sự cố giữ hàng chưa đóng, giao dịch chờ và điều chỉnh khiếu nại PENDING_FINANCE: nhập ngân hàng chính chủ trong luồng đóng shipper; Admin xác minh thụ hưởng. Yêu cầu rút trong CLOSING phải bằng toàn bộ số dư, không có tiền đang giữ, không có giao dịch nạp chờ. Ngoại lệ mức rút tối thiểu cho phép mọi số dư dương, kể cả dưới 10.000đ.

Yêu cầu rút giữ toàn bộ tiền bằng hold WITHDRAWAL, không trừ ngay. Admin có quyền tài chính tiếp nhận/xử lý, xác nhận đích nhận và chứng từ chuyển tiền; PAID mới capture hold và ghi đúng một WITHDRAWAL_DEBIT. Kết quả thất bại/không rõ giữ CLOSING và xử lý đối soát, không tự đóng. Không đổi ngân hàng, hủy đóng hoặc mở lại bằng từ chối đóng khi còn yêu cầu rút đang xử lý. Admin hoàn tất đóng chỉ khi không còn đơn, số dư, hold, giao dịch nạp chờ hoặc yêu cầu rút mở. Ví 0đ không cần một yêu cầu rút 0đ. Không xóa tài khoản, CUSTOMER, đơn hay lịch sử; CLOSED hết quyền hoạt động shipper.

## Giao diện và Admin

Trang chủ: ví/Nạp tiền, lý do chưa đủ điều kiện và công tắc hoạt động từ trạng thái server. Tài khoản: thông tin cá nhân, ví/lịch sử, đổi mật khẩu và dừng/rút. Ngân hàng không xuất hiện trong luồng hoạt động bình thường. Admin giữ khóa/mở khóa, dữ liệu xét duyệt cũ, ví/giao dịch và danh sách CLOSING; xử lý hoàn tiền ở Tài chính → Rút tiền rồi hoàn tất đóng. Mọi lệnh dùng audit/outbox/idempotency hiện có.

## Migration và tương thích

Tái sử dụng phần nền ví/rút tiền của PR #137, SHA `4ec714e574ab3e8a677ea698eb268e07455b5796`; PR đó không bị thay đổi/merge. Migration rút tiền chưa áp dụng được đặt sau main hiện tại thành `1795132800000_create-wallet-withdrawals.sql`, giữ gate ADJUSTMENT hiện có và không từ chối lịch sử điều chỉnh hợp lệ.

`1795219200000_simplify-shipper-onboarding.sql`: chuyển PENDING cũ sang ACTIVE, công tắc tắt; giữ nguyên review_state/reason/events/ngân hàng; tạo ví 0đ chỉ khi thiếu; không sửa ví đã tồn tại. `initial_funding_required=false` cho shipper hiện hữu, mặc định true cho shipper tạo sau migration. Không đổi số dư hoặc ledger hiện hữu. Rollback onboarding không xóa ví hoặc đưa shipper đang hoạt động về chờ duyệt; rollback tài chính từ chối khi đã có dữ liệu rút tiền. Không apply migration remote trong nhiệm vụ này.

Không phát hiện kiểm soát pháp lý bắt buộc được mô hình hóa trong các chốt duyệt hồ sơ đã sửa. Xác minh thụ hưởng vẫn bắt buộc trước chi trả.

## Kiểm chứng

Test tập trung M03/M04/M01: đăng ký SHIP tự cấp quyền/ví; không ngân hàng; ví 0; nạp chờ không cộng; đủ tiền bật online; không đủ hoa hồng; khóa Admin; rút toàn bộ 5.000đ; giữ tiền và replay; đóng chỉ sau PAID; giữ CUSTOMER. Các test M04 có sẵn bao phủ tranh chấp hold, quyền tài chính, chuyển tiền lặp và đối soát thất bại. PostgreSQL và Flutter được xác minh trên CI khi công cụ tương ứng không có trong môi trường local. Chưa merge, deploy, apply remote migration hoặc phát hành APK.
