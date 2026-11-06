# Phase 3 — Các quyết định cần Owner (gom riêng)

SHA `549572696efb4bbc18af3c362b7f56a5fcd335e6`. Mỗi mục: câu hỏi ngắn, đề xuất của Lead, tham chiếu. Lead không tự quyết xóa hay giữ. Đề xuất không có hiệu lực cho tới khi Owner trả lời.

| # | Câu hỏi | Đề xuất của Lead | Tham chiếu |
|---|---|---|---|
| OD-1 | Bốn route legacy `/v1/auth/register`, `/login`, `/role/select`, `/me` (không client nào trong repo gọi, đường login legacy không qua `ClientLoginLimiter`) giữ hay gỡ? | Gỡ ở Phase 8 sau khi Codex xác nhận không còn client; trong lúc chờ, ghi vào Phase 5 kiểm giới hạn đăng nhập | open-questions Q1, public-routes #7-#8 |
| OD-2 | 52 handler ghi dữ liệu không đòi `Idempotency-Key` (vd. `PUT location`, giỏ hàng, thông báo, logout): chấp nhận như ngoại lệ có chủ ý hay bắt buộc khóa? | Cho phép ngoại lệ có chủ ý cho đo vị trí, OTP, đăng nhập, logout, preview; bắt buộc khóa cho phần còn lại sau khi Codex duyệt danh sách 52 | M00-R-02 |
| OD-3 | `wallet.adjustment.post` hiện không cấp được cho ADMIN (chỉ SYSTEM post điều chỉnh). Cho phép cấp hay ghi baseline là SYSTEM-only? | Ghi baseline là SYSTEM-only cho tới khi có nhu cầu; không mở quyền tiền mới ở Phase 8 | M04-R-09, M11-R-06 |
| OD-4 | Mã giao dịch ngân hàng duy nhất khi Admin xác nhận nạp (M04-R-05) có bắt buộc không? | Hoãn; chỉ làm khi có quy trình đối soát thủ công (B04-08) | M04-R-05, M04-R-07 |
| OD-5 | `POST /v1/shop/me/deliveries` còn tạo DIRECT mới và `ShopCallScreen` chưa nối: khóa route mới (giữ đọc DIRECT cũ) và xóa màn? | Khóa tạo mới ở backend, đọc/xử lý DIRECT cũ giữ nguyên; xóa `ShopCallScreen` ở dọn dẹp Phase 4 | M07-R-05, C-11 |
| OD-6 | Đơn đã xác nhận mà chưa gọi shipper (C-22): mốc nhắc quán và mốc vào hàng đợi Admin là bao nhiêu phút? Source chưa có chức năng này | Cấu hình bởi SYSTEM, không đặt mặc định; nếu cần con số khởi đầu thì đề xuất 20 phút nhắc quán, 40 phút vào hàng đợi, nhưng chỉ khi Owner duyệt | M10-R-26 |
| OD-7 | Khôi phục tài khoản DELETE_REQUEST sau OTP + mật khẩu mới đưa về ACTIVE ngay. Baseline nói "không tự kích hoạt lại". Giữ hành vi code hay đổi? | Sửa baseline cho khớp (OTP + mật khẩu mới là xác nhận chủ tài khoản) | M01-R-20 |
| OD-8 | Mặc định `pickup_service_seconds`=120 và `handoff_service_seconds`=60 của ghép đơn chưa được duyệt: duyệt, đổi, hay tạm giữ? | Tạm giữ, ghi rõ chưa duyệt, đo thực tế ở Phase 6 | M06-R-07 |
| OD-9 | Ngưỡng vị trí: 120 s (live, lọc đơn) và 600 s (stale, bản đồ Admin) cùng tồn tại. Chuẩn hóa vào baseline? | Ghi cả hai ngưỡng vào M06-R-10 và M14-R-02 | M06-R-10, M14-R-02 |
| OD-10 | Nhắc lấy hàng mỗi 5 phút không có số lần tối đa riêng (bị chặn gián tiếp bởi hủy tự động phút 60). Chấp nhận? | Chấp nhận nhưng ghi rõ trong baseline | M08-R-04, delivery-sweeper.md |
| OD-11 | `IdempotencyCleanup` không được gọi theo lịch: lên lịch (job nền hoặc lệnh ops) hay bỏ? | Lên lịch dọn hằng ngày ở Phase 8 (bảng `idempotency_records` chỉ tăng) | open-questions Q7 |
| OD-12 | Quyền riêng cho từng thao tác ngoại lệ đơn (C-28, vd. hủy đơn): code đang dựa quyền app VIEW/review. Tách khóa quyền riêng? | Tách `admin.order.cancel` ở Phase 8 | M12-R-13 |
| OD-13 | `NotIntegratedCommissionAdjustmentPort` là ứng viên mã chết duy nhất: xóa? | Xóa ở dọn dẹp (Phase 4) sau Codex xác nhận 0 tham chiếu | Q4 |
| OD-14 | Hai ý nghĩa của "Skip": route `fee/skip` (bỏ qua đề nghị phí) có phải vi phạm "không có nút Bỏ qua" không? | Không vi phạm; sửa baseline nói rõ "không bỏ qua đơn" | M07-R-10 |
| OD-15 | Sau lấy hàng, đổi địa chỉ bị chặn (`CANNOT_CHANGE_AFTER_PICKUP`) trong khi baseline M10-R-18 mô tả nhánh "sau lấy": thống nhất hành vi | Giữ code (chặn), sửa baseline | M10-R-18 |
| OD-16 | Giới hạn liên kết liên hệ quán: 160 hay 300 ký tự | Sửa baseline theo code (300) nếu Owner không có lý do cho 160 | M02-R-08 |
| OD-17 | Thêm yêu cầu vào baseline cho chức năng đã có mà chưa có hàng: mức nạp/rút tối thiểu, chính sách hoa hồng, ẩn/khôi phục đánh giá, đối soát lệch sổ, middleware truyền tải admin/client | Thêm vào baseline v0.8 theo đúng hành vi đã đọc | b00-semantic-review.md |
| OD-18 | Chuẩn hóa nơi lưu giỏ hàng và mô tả hai mặc định địa chỉ trong baseline (M10-R-01, M05-R-03) | Sửa baseline theo code | discrepancies.md §6 |


## Quyết định của Owner (2026-11-05)

**Phase 3: ACCEPTED CÓ GIỚI HẠN.** Phạm vi chỉ là đối chiếu tĩnh Graph ↔ Baseline tại SHA `549572696efb4bbc18af3c362b7f56a5fcd335e6`. Các số 80/91/7/1/19 không phải PASS chức năng; nghiệm thu chức năng 11Ship vẫn **NOT ACCEPTED**; hành vi thiết bị/runtime còn NOT TESTED. PR #302 chưa được merge cho tới khi required CI trên head xanh và Owner ra lệnh merge. Mỗi quyết định dưới đây là quyết định của Owner, thay cho "đề xuất của Lead" ở bảng trên.

| OD | Quyết định của Owner | Việc theo sau (không làm trong PR này) |
|---|---|---|
| OD-1 | Gỡ 4 route auth legacy, không chờ Phase 8: làm ở cleanup sau Phase 3 khi xác nhận APK/client còn hỗ trợ không gọi chúng. Trong thời gian chưa gỡ, đường login legacy phải có cùng limiter/bảo vệ như đường hiện hành (không né `ClientLoginLimiter`) | cleanup + bảo mật |
| OD-2 | Không bắt `Idempotency-Key` máy móc cho 52 handler. Bắt buộc cho thao tác retry có thể gây hậu quả kép (tiền, chuyển trạng thái order/delivery, tạo resource/side-effect quan trọng). Miễn: location/telemetry, OTP/login/logout, preview, PUT tự idempotent thật sự. Cần lập allowlist/required-list rõ | Phase sau |
| OD-3 | Giữ `wallet.adjustment.post` SYSTEM-only; sửa baseline. Không cấp điều chỉnh tiền trực tiếp cho ADMIN; nếu cần chỉnh tay thì làm workflow có chứng từ/audit riêng | sửa baseline |
| OD-4 | Hoãn mã giao dịch ngân hàng duy nhất tới khi hoàn thiện đối soát thủ công B04-08; khi làm thật, reference ngân hàng phải chống xử lý trùng. Không chặn Phase 3 | hoãn |
| OD-5 | Khóa tạo DIRECT mới qua `POST /v1/shop/me/deliveries`; giữ đọc/xử lý DIRECT lịch sử; xóa `ShopCallScreen` ở cleanup; luồng Gọi shipper chế độ Khách hàng giữ nguyên (đúng M07-R-05) | cleanup |
| OD-6 | Mặc định 20 phút nhắc quán, 40 phút vào hàng đợi Admin; giữ mốc tự hủy 60 phút. Khi làm phải nối M10 → M08 → M12 Action Queue, không chỉ gửi thông báo | triển khai sau |
| OD-7 | OTP + mật khẩu mới được khôi phục DELETE_REQUEST về ACTIVE; sửa baseline. Chỉ khôi phục trạng thái tài khoản, không tự gỡ SUSPENDED của role shipper/chủ quán | sửa baseline |
| OD-8 | Tạm giữ 120 s pickup + 60 s handoff, ghi là tham số provisional, chưa phải hằng số nghiệp vụ đã nghiệm thu; Phase 6 đo rồi chốt | Phase 6 |
| OD-9 | Giữ cả hai ngưỡng: 120 s = vị trí đủ mới cho nghiệp vụ live/nhận đơn; 600 s = stale cho theo dõi/Admin. Sửa baseline mô tả hai ý nghĩa riêng | sửa baseline |
| OD-10 | Không chấp nhận nhắc mỗi 5 phút vô hạn tới phút 60. Tối đa 3 lần nhắc cho cùng một giai đoạn, sau đó để timeout/escalation xử lý | sửa code sau |
| OD-11 | Lên lịch `IdempotencyCleanup` chạy hằng ngày, không chờ Phase 8; dùng tiêu chí expiry hiện có, không tạo retention mới | cleanup/ops sớm |
| OD-12 | Tách quyền `admin.order.cancel` riêng; không dựa quyền VIEW/review chung. Rà các thao tác phá hủy/ảnh hưởng tiền tương tự theo cùng nguyên tắc | sửa code sau |
| OD-13 | Xóa `NotIntegratedCommissionAdjustmentPort` ở cleanup sau khi xác nhận lại 0 tham chiếu production/test cần giữ | cleanup |
| OD-14 | `fee/skip` không vi phạm "không có nút Bỏ qua". Baseline ghi rõ: cấm bỏ qua cuốc/đơn; `fee/skip` chỉ là bỏ qua đề nghị điều chỉnh phí | sửa baseline |
| OD-15 | Giữ code: sau pickup không tự sửa điểm giao. M10-R-18 đã nói "giữ khóa phí, không tự cho sửa điểm giao"; chỉ chỉnh câu chữ nếu cần, không mở flow đổi địa chỉ sau lấy hàng | sửa baseline (chữ) |
| OD-16 | Chốt 300 ký tự cho liên kết/liên hệ quán; sửa baseline 160 → 300 | sửa baseline |
| OD-17 | Không thêm hàng loạt mọi thứ trong code vào Functional Baseline. Chính sách hoa hồng là nghiệp vụ thật → thêm requirement; review moderation nếu là chức năng Admin chủ đích → thêm vào M11; reconciliation và transport middleware → baseline kỹ thuật/ops/bảo mật. **Mức nạp/rút tối thiểu không được hợp thức hóa chỉ vì bảng DB có sẵn**: coi là policy chưa được Owner duyệt cho tới khi có quyết định kinh doanh cụ thể | sửa baseline |
| OD-18 | Sửa baseline theo kiến trúc hiện hành: giỏ hàng server-authoritative theo tài khoản, app chỉ giữ cache cục bộ; địa chỉ mô tả rõ `pickup default` và `delivery default`, không ghi "chỉ một default" | sửa baseline |

Ghi chú của Owner về #294: nguyên nhân kiến trúc đã giải thích được (Home đo GPS → quán; quote/đơn đo quán → địa chỉ giao; định tuyến có hướng nên hai số không cùng một phép đo). Yêu cầu lớn hơn về đồng bộ ý nghĩa khoảng cách và tuyến hiển thị vẫn **chưa nghiệm thu**, nhất là M14-R-11 MISMATCH.

## Quyết định bổ sung của Owner (2026-11-06)

Ba mục "chưa có OD" ở Phase 3: Owner chọn phương án A cho cả ba và **giữ nguyên baseline, không hạ yêu cầu để khớp code hiện tại**.

| OD | Quyết định của Owner | Phase thực hiện |
|---|---|---|
| OD-19 (M01-R-11 / C-20) | Người dùng tự gửi yêu cầu xóa tài khoản từ app/web; Admin là người thực hiện xóa | Phase 5 — Functional & Authorization Fixes |
| OD-20 (M04-R-15 / C-27) | Toàn bộ `wallet.*` và các bộ đếm liên quan phải kiểm scope DRIVER; có permission nhưng không có scope DRIVER thì 403. Làm cùng đợt rà phân quyền Admin | Phase 5 — Functional & Authorization Fixes |
| OD-21 (M14-R-11 / #294) | Backend trả và lưu `geometry` + `route_version` của chính tuyến dùng để báo giá; app chỉ vẽ geometry đó. Nguyên tắc: tuyến hiển thị = tuyến báo giá đã lưu; routing engine mới không được đổi hình tuyến của báo giá/đơn cũ. Liên quan M14-R-10 | Phase 6 — M14 Routing & Quote Geometry |

**M08 `STALE_EVENT` (quyết định Owner 2026-11-06):** không chấp nhận quy tắc "quá 24 giờ thì âm thầm bỏ" cho mọi loại sự kiện. Giữ ngưỡng 24 giờ cho thông báo thời điểm (offer/reminder đã hết ý nghĩa). Sự kiện tài chính, tài khoản và trạng thái kết thúc của order/delivery không được mất âm thầm: phải lưu audit, đối chiếu trạng thái hiện tại và đưa vào inbox hoặc hàng đợi xử lý phù hợp. Ghi metric/cảnh báo cho `STALE_EVENT`. Triển khai ở phase kỹ thuật M08, không nằm trong PR cleanup đầu tiên.

**Trạng thái áp dụng vào baseline:** OD-3, 6, 7, 8, 9, 10, 14, 15, 16, 18, 19, 20, 21 đã được ghi vào `docs/baseline/requirements.md`. OD-17 đã được xử lý bằng OD-22..24 (xem mục dưới); mức nạp/rút tối thiểu vẫn là policy chưa duyệt. OD-1, 2, 4, 5, 11, 12, 13 là việc code/vận hành, không phải sửa baseline (OD-13 đã xong ở PR #303).

## Quyết định bổ sung của Owner (2026-11-06) — OD-17

| OD | Quyết định của Owner | Ghi vào |
|---|---|---|
| OD-22 | Hoa hồng là số tiền cố định mỗi đơn; **mức 1 000 VND là mức chính thức**; hoa hồng cố định không hiển thị mỗi lần shipper nhận đơn | `requirements.md` M04-R-16 |
| OD-23 | Giữ chức năng Admin ẩn/khôi phục đánh giá (phương án A) | `requirements.md` M11-R-11 |
| OD-24 | Đối soát lệch sổ ví và header truyền tải lưu trong `docs/process/` | `docs/process/technical-ops-security-baseline.md` |
| OD-25 | Khi Admin ẩn hoặc khôi phục đánh giá, thông báo cho bên được đánh giá (Owner 06/11). Chưa quyết: nội dung thông báo, có nêu lý do hay không; khách không được thông báo (suy ra từ "bên được đánh giá", cần Owner xác nhận) | M11-R-11 |

Còn mở (chưa có quyết định, không chặn): khi đánh giá bị ẩn/khôi phục, có thông báo cho người bị đánh giá hoặc khách hay không.
