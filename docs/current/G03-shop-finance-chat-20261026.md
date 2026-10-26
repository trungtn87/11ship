# PR #225 — thanh toán quán và trao đổi tài chính

Tiếp tục #198/#199 trên Business Dashboard của main sau PR #224; tham khảo phần quyền thực đơn từ Claude `45cc4094`, không nhập hệ thống thanh toán/chat song song của nhánh cũ.

## Hành vi

- Quán nhập số tiền và mục đích trong nội dung, tạo yêu cầu, xem tài khoản nhận thực đang bật, chuyển khoản ngoài ứng dụng rồi báo đã chuyển. Báo cáo chỉ ghi thời điểm và mốc trao đổi; không ghi tiền, tăng ví, cấp quyền hay kích hoạt quán.
- Admin có `shop.payment.read` xem thanh toán quán; `shop.payment.record` ghi nhận thực nhận hoặc từ chối và gửi trao đổi. `wallet.read` / `wallet.topup.record` chỉ áp dụng nạp ví shipper. `shop.entitlement.manage` quản lý quyền mở rộng riêng, bắt buộc lý do; cấp/thu hồi thủ công hoàn toàn độc lập với yêu cầu hoặc chứng từ thanh toán. Quyền không có thời hạn. Xác nhận tiền không tự cấp quyền.
- Giữ registry ngân hàng hiện tại, chống tính trùng giữa nạp ví và thanh toán quán. Giữ tự kích hoạt theo setup #190/#209, không thêm cửa duyệt tài khoản.
- Mặc định 20 món VISIBLE; HIDDEN không chiếm chỗ. Thêm/hiện món kiểm tra trong khóa quán; cấp/thu hồi cùng khóa. Thu hồi không xóa/ẩn món đang có; vẫn chỉnh sửa/ẩn/xóa được. Giới hạn kỹ thuật 300 món giữ nguyên.
- Chat dùng phòng tài chính hiện có, tối đa 500 grapheme Unicode trên backend, Web Admin và Flutter. Chống gửi trùng qua idempotency; retry phải bấm lại khi offline, giữ nội dung/key trong bộ nhớ, không lưu tài chính xuống đĩa. Giới hạn kỹ thuật mặc định 5 tin/người/phút trên mọi phòng, SYSTEM có thể cấu hình cùng quota. Đóng phòng và gửi tin cùng khóa; đọc lịch sử vẫn được. Sự kiện cấp/thu hồi được ghi riêng sau khi đóng, không mở lại chat.
- Web Push/inbox admin lọc quyền theo loại hồ sơ và kiểm tra lại trước gửi. M08 dùng sự kiện outbox thật, chỉ báo chủ hồ sơ, không chứa nội dung chat/ngân hàng, mở đúng phòng và kiểm tra lại chủ/context. Không bật purge lịch sử chat.

## Routes thực tế

Dùng prefix `/v1`; không tạo `/shop-payments` admin song song.

| Bên | Route | Tác dụng |
| --- | --- | --- |
| Client | POST `/finance/me/shop-payments` | Tạo yêu cầu `{amount_vnd,note}` |
| Client | GET `/finance/me/receiving-accounts` | Tài khoản đang bật nhận |
| Client | POST `/finance/me/requests/:id/report-transfer` | Báo đã chuyển `{}` |
| Hai bên | GET `/{finance/me,admin/business}/requests[/:id]` | Danh sách, hồ sơ/phân trang tin |
| Hai bên | POST `/{finance/me,admin/business}/requests/:id/messages` | Gửi `{body}` nếu đúng quyền và phòng mở |
| Admin | POST `/admin/business/requests/:id/{confirm,reject}` | Thực nhận/từ chối quán; nạp ví giữ route wallet cũ |
| Admin | GET `/admin/business/receiving-accounts` | Tài khoản nhận cho form thực nhận |
| Admin | GET/POST `/admin/business/shops/:id/entitlement` | Cấp/thu hồi độc lập: `{action,reason,expected_version}`; không nhận payment ID |
| Admin | GET/POST `/admin/business/policy` | Xem; SYSTEM đổi quota/tần suất ở version hiện tại và lý do |

Admin: Business → Tài chính/Chat → hồ sơ → xác nhận thực nhận riêng; phần Quản lý quyền thực đơn dựa vào shop_id và trạng thái quyền thực tế, không dựa vào thanh toán. Có tra cứu/cấp/thu hồi quyền bằng mã quán; lịch sử thu tiền và lịch sử quyền độc lập. Food/Ship: mục Trao đổi thanh toán hiện có; thông báo M08 mở thẳng hồ sơ.

## Migration và rollout

Migration mới `1796860800000_shop-finance-entitlements`, không sửa migration cũ. Thêm reported_at, policy và lịch sử quyền bất biến (không có payment_request_id); nới kiểu body giữ nguyên tin cũ; thay bộ lọc push và mở rộng target M08. Runtime cần grants policy/grants/identity sequence. Helper Down-chain hạ migration mới trước Business Dashboard và giữ nguyên chặn xóa bằng chứng.

Chưa deploy/migrate máy chủ. Rollout cần bản mobile hiểu target `FINANCE_REQUEST` đi cùng backend; không gửi target mới cho app cũ trước khi chuẩn bị cập nhật phù hợp. Code rollback phải tạm dừng ghi tài chính cho tới khi có code tương thích chính sách mới; không dùng Down để xóa báo chuyển khoản/lịch sử cấp quyền/tin dài.

## Kiểm chứng

Cục bộ: typecheck/lint và build Admin; focused unit 285 test đạt trước bổ sung integration cuối. Full unit một lần có lỗi registry đã sửa và các lỗi môi trường process identity/test clock ngoài phạm vi; không coi full unit cục bộ đã xanh. Tests mới kiểm tra quota đồng thời, hidden/show/revoke, report khác receipt khác grant, quyền/replay bị thu hồi, ngân hàng trùng đồng thời, gửi-vs-đóng, M08 chủ hồ sơ và idempotency. Flutter widget tests cho tạo/báo tách bước, retry giữ key, phòng đóng và parse target. PostgreSQL 17, full CI và Flutter/APK cần xác nhận trên SHA mới.

## Chưa chốt

Không đặt mức thu, thuê bao, 29k hay tự thu phí. Không bật retention/purge chat. Quyền cấp/thu hồi chỉ có shop_id, người thao tác, lý do và thời điểm; không gắn giao dịch ngân hàng hoặc phòng chat thanh toán. Nội dung hướng dẫn thanh toán cần được rà theo chính sách store trước phát hành store. CI/APK không thay nghiệm thu thiết bị của Owner.
