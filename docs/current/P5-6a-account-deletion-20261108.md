# P5-6a — Yêu cầu xóa tài khoản công khai (OD-26)

Phạm vi: backend + trang web `/delete-account`. Không gồm Admin Web, mobile. Chưa deploy; chưa chạy trên VPS.

## Hành vi

`POST /v1/account-deletion/confirm` — body đúng `{ phone, password }`, header `Idempotency-Key` bắt buộc, công khai (không cookie/Bearer/CSRF), chỉ tìm tài khoản `APP_USER`.

| Tình huống lúc xác nhận | Kết quả (`data.result`) |
|---|---|
| Không còn việc đang chạy, không có dữ liệu phải lưu | `DELETED` — xóa vật lý (cùng hàm `app.purge_app_user` như Admin delete) |
| Không còn việc đang chạy, có dữ liệu phải lưu | `LOCKED` — `DISABLED`, `lock_reason = DELETE_REQUEST`, thu hồi mọi session; khôi phục bằng OTP như hiện nay (M01-R-20) |
| Còn việc đang chạy (đơn/chuyến/tiền đang xử lý) | `PENDING` — `users.delete_requested_at` được ghi; vẫn ACTIVE, giữ session; **chặn mọi việc mới** (xem dưới); sweeper hoàn tất khi hết việc |
| Đã PENDING / đã `LOCKED` theo yêu cầu xóa | trả lại `PENDING` / `LOCKED`, không ghi audit lặp |

Mọi lỗi xác thực (SĐT không tồn tại, sai mật khẩu, tài khoản admin/fixture, tài khoản bị khóa VIOLATION/SECURITY) là **một** lỗi `401 INVALID_CREDENTIALS`, cùng lượng việc băm Argon2, cùng số lần ghi bộ đếm. Sai mật khẩu chỉ tiêu hạn mức, không khóa tài khoản. Không có hủy yêu cầu sau khi xác nhận (OD-26). Admin không duyệt từng yêu cầu: chi tiết user của Admin chỉ đọc thêm `lifecycle.delete_requested_at` và audit `account.delete.requested.v1` / `account.delete.finalized.v1`.

### Điểm chặn việc mới khi PENDING (`ACCOUNT_DELETE_PENDING`, 409)

Khách đặt đơn, đặt lại đơn, tạo giao hàng; quán gọi lại giao hàng, tạo yêu cầu thanh toán (tạo giao hàng trực tiếp đã đóng bởi OD-5); shipper nhận chuyến, thương lượng phí chuyến chưa nhận, nạp mới (danh sách chuyến trả rỗng); **rút tiền KHÔNG bị chặn** (OD-31, xem dưới); tạo hồ sơ shipper, tạo quán mới. Quán của chủ đang PENDING đọc như quán của chủ bị khóa (không nhận đơn mới; danh sách công khai ẩn). Việc đang chạy (xác nhận/chuẩn bị đơn, giao, hoàn tất, hủy, hoa hồng, khoản tiền đang xử lý) **không bị chặn**. Hợp đồng nằm ở `apps/backend/src/account-deletion/new-work-gate.spec.ts`: route mới tạo việc mới phải gọi `assertNewWorkAllowed` và được thêm vào danh sách đó.

### Rút số dư ví (OD-31)

Chủ tài khoản đã yêu cầu xóa vẫn **yêu cầu rút** để lấy lại số dư, thay cho điều kiện hồ sơ Shipper `CLOSING`: khi tài khoản đang **PENDING** (ACTIVE + `delete_requested_at`) hoặc đã **khóa `DELETE_REQUEST`**. Khóa VIOLATION/SECURITY (kể cả khi có yêu cầu xóa đi kèm) **không** có ngoại lệ này. Mọi kiểm tra khác của `DriverWithdrawalService.create` giữ nguyên: rút TOÀN BỘ số dư, một yêu cầu mở, không còn `activeWork`/`pendingFinance`/nạp chờ/số tiền đang giữ. Nạp tiền mới vẫn bị chặn (PENDING: 409 `ACCOUNT_DELETE_PENDING`; khóa: `ACCOUNT_DISABLED`). Tài khoản khóa `DELETE_REQUEST` đăng nhập app Ship ở chế độ ví-giới-hạn (`WALLET_ONLY`, chính sách sẵn có cho Shipper bị khóa), không mở chức năng nào khác. Số dư và yêu cầu rút đang mở là dữ liệu phải giữ: tài khoản không bị xóa vật lý; yêu cầu rút đang mở là "tiền đang xử lý" nên giữ tài khoản ở PENDING cho đến khi xong. Điều này nới quy tắc M03-R-05 (chỉ CLOSING) cho ngoại lệ OD-31; baseline sẽ sửa bằng PR docs riêng khi Owner ra lệnh.

### Khóa quản trị trên tài khoản có yêu cầu xóa (OD-26: không hủy)

- Khóa quản trị (VIOLATION/SECURITY) lên tài khoản đang PENDING **giữ** `delete_requested_at` (constraint `users_delete_request_ck` cho phép ACTIVE hoặc khóa VIOLATION/SECURITY, không bao giờ cùng khóa `DELETE_REQUEST`); ghi thêm audit `account.lock.on_delete_request.v1`.
- Khi hết việc đang chạy, sweeper giữ **khóa mạnh hơn** (không ghi đè sang `DELETE_REQUEST`), thu hồi lại session, **không xóa vật lý**, xóa yêu cầu và ghi audit `account.delete.finalized.v1` kết quả `LOCK_KEPT` (không có outbox: trạng thái tài khoản không đổi).
- Mở khóa quản trị khi yêu cầu còn: tài khoản về ACTIVE nhưng vẫn PENDING (chặn việc mới, sweeper hoàn tất); audit `account.unlock.on_delete_request.v1`. Không có đường nào hủy yêu cầu ngầm.
- Khóa `DELETE_REQUEST` do chính chủ là điểm kết thúc của yêu cầu; Admin mở khóa đó (khôi phục) là hành vi hiện có và chưa mở rộng: tài khoản về ACTIVE, không còn yêu cầu, không audit thêm. Cần Lead xác nhận đây có phải "khôi phục" hợp lệ theo OD-26.

### Hoàn tất

Fast path ngay lúc xác nhận; sau đó `AccountDeletionSweeper` (`setInterval` + `unref`, không `@Cron`, mặc định 60 s, không chạy khi `APP_ENV=test`). Mỗi tài khoản một transaction, `FOR UPDATE SKIP LOCKED`, kiểm lại trạng thái và `activeWork` dưới khóa; audit/outbox chỉ ghi khi tài khoản thật sự đi đến cuối → chạy lặp hoặc nhiều instance vẫn đúng một lần.

## Cấu hình

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PUBLIC_WEB_ORIGIN` | không đặt | origin công khai https của backend. **Tùy chọn**; khi KHÔNG đặt thì không kiểm `Origin` gì cả (route không có cookie/token để lạm dụng nên đây chỉ là lớp phòng vệ phía trình duyệt), **production nên khai báo**. Nếu đặt, trình duyệt gọi `confirm` phải gửi đúng `Origin` này (app không gửi `Origin` vẫn qua). Không có hostname trong code; trang gọi API bằng đường dẫn tương đối. |
| `ACCOUNT_DELETE_IP_LIMIT` / `_WINDOW_SECONDS` | 20 / 600 | hạn mức theo địa chỉ client |
| `ACCOUNT_DELETE_PHONE_LIMIT` / `_WINDOW_SECONDS` | 5 / 900 | hạn mức theo SĐT (lớp chính) |
| `ACCOUNT_DELETE_SWEEP_INTERVAL_MS` | 60000 | chu kỳ sweeper |

Giới hạn theo IP chỉ chính xác khi cấu hình proxy tin cậy đúng (`ADMIN_AUTH_TRUSTED_PROXY_IPS`; OD-30 chưa deploy): nếu không, mọi client cùng một địa chỉ — lúc đó lớp theo SĐT là lớp bảo vệ chính. Bảng hạn mức riêng `app.account_delete_limits` (khóa HMAC), tách khỏi `client_login_limits` và các hạn mức OTP.

## Triển khai (chưa thực hiện)

1. Migration `1797724800000_account-delete-request` (thêm cột `users.delete_requested_at` + CHECK + chỉ mục một phần + bảng `account_delete_limits`; không đổi migration cũ/enum/ràng buộc `lock_reason`). Mục đánh giá nằm trong `ops/selfhosted/reviewed-migrations.json`.
2. Cấp quyền cho role runtime: `GRANT SELECT, INSERT, UPDATE ON app.account_delete_limits TO ship11_app;` (đã thêm vào `ops/selfhosted/02-runtime-grants.sql` và kiểm ở `04-check-runtime-grants.sql`).
3. (Nên làm ở production) đặt `PUBLIC_WEB_ORIGIN`. nginx hiện tại đã `proxy_pass` mọi đường dẫn nên `/delete-account` tới được backend.

## Cách Owner thử (local)

Mở `<origin backend>/delete-account`, đọc cảnh báo, nhập SĐT + mật khẩu của một tài khoản thử, tick xác nhận, bấm nút. Tài khoản chưa có dữ liệu → "đã xóa vĩnh viễn"; có đơn đã xong → "đã bị khóa… khôi phục bằng OTP"; có đơn đang chạy → "đã ghi nhận… không nhận/tạo được việc mới", đơn vẫn xác nhận/giao bình thường, hết việc thì tài khoản tự bị khóa/xóa trong ≤ 1 chu kỳ sweeper.

## Chờ Owner

Số dư ví còn lại của tài khoản bị khóa là dữ liệu phải giữ (khóa, không xóa vật lý). **Cách người dùng lấy lại số dư sau khi khóa chưa được thiết kế** — chờ quyết định của Owner.
