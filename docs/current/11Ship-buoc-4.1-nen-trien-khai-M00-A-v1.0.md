# 11Ship — Bước 4.1: Nền triển khai, M00-A

Ngày: 06/10/2026, giờ Việt Nam. Phiên bản tài liệu: 1.0.
Trạng thái: DESIGN — hoàn thành bản chuẩn hóa để rà soát; chưa CODE_READY, chưa triển khai code.

## 1. Mục tiêu và phạm vi

Bước 1 là nghiệp vụ, Bước 2 là database/workflow, Bước 3 là thiết kế API. Bước 4 được tổ chức thành thiết kế triển khai và chuẩn bị gói công việc nhỏ, bắt đầu bằng M00-A theo mục 7 của nguồn tổng hợp. Số bước không thay thế ID module: Bước 4.1 thực hiện M00-A; các module M01–M12 vẫn giữ ID đã có.

Nguồn hiện hành đã đọc: `11Ship-ra-soat-buoc-1-2-3-va-chia-module-v1.1.md`, mục 1–7. Nguồn là bản rà soát thiết kế, không phải DDL hoặc OpenAPI đầy đủ. Nội dung dưới đây chuẩn hóa tên và ranh giới kỹ thuật, không bổ sung chức năng kinh doanh mới.

Kết quả của 4.1: chỉ mục đặc tả, quy tắc phiên bản, schema manifest logic, ánh xạ tên cũ, ranh giới module, giao dịch liên module và điều kiện bàn giao. Chưa tạo migration, chưa khẳng định repository/hạ tầng đã tồn tại, chưa gửi việc cho Claude.

## 2. Chỉ mục nguồn và quản lý phiên bản

| Mã | Tài liệu/đầu ra | Vai trò | Tình trạng |
|---|---|---|---|
| S01 | 11Ship-ra-soat-buoc-1-2-3-va-chia-module-v1.1.md | Baseline nghiệp vụ/workflow/API và test A01–A58 | Nguồn hiện hành |
| S02 | Tài liệu Bước 4.1 này | Chuẩn hóa nền triển khai M00-A | DESIGN |
| S03 | Schema vật lý và migration từng module | Cột, FK, index, CHECK, migration | Chưa có bản đã xác minh |
| S04 | OpenAPI từng module | Request/response/lỗi/quyền đầy đủ | Phải hoàn thiện theo task |
| S05 | Event contract từng module | Payload, version, consumer, dedupe | Phải hoàn thiện theo task |
| S06 | Test fixtures và test evidence | Input/expected và kết quả thực chạy | Chưa chạy |
| S07 | UI theo task có màn hình | Màn/luồng và trạng thái lỗi/offline | Chưa xác minh bản được duyệt |

Các tài liệu kế hoạch/M0/gọi ship cũ được giữ làm lịch sử. Khi chúng mâu thuẫn S01, áp dụng S01; chỉ dẫn mới của Owner có ưu tiên cao hơn. Không dùng nội dung cũ để khôi phục giới hạn một đơn/xế, COD ledger, khách tự sửa/hủy hoặc Android trước rồi iOS sau.

Phiên bản độc lập:

- `document_version`: phiên bản của từng tài liệu, không giả là phiên bản phần mềm.
- `api_version`: `/v1`; thay đổi tương thích phải cập nhật contract và kiểm client, thay đổi phá vỡ phải có kế hoạch chuyển đổi.
- `schema_migration_id`: ID tăng theo thứ tự khi tạo migration; migration đã dùng không sửa tại chỗ.
- `policy_version`: phiên bản chính sách; snapshot khi nhận đơn hoặc tạo đối tượng theo S01.
- `resource_version`: số nguyên tăng theo từng resource, phục vụ concurrency và event cũ; không so giữa order với delivery.
- `build_version` và `commit_sha`: chỉ ghi khi có build/source thật.

Một thay đổi phải nêu rule/test liên quan, lý do, contract/schema/UI bị ảnh hưởng và khả năng tương thích. Đổi tên kỹ thuật không tự tạo quyền hoặc transition mới.

## 3. Kiến trúc triển khai

Một repository 11Ship riêng; một backend chia module; một PostgreSQL nghiệp vụ; bốn app Flutter (khách, quán, xế, quản lý); một web quản trị React. NestJS là phương án backend kế thừa từ nguồn. Đây là phương án thiết kế; phiên bản thư viện/runtime cần kiểm tra và khóa ở M00-B, chưa có kết quả build xác minh.

Các app dùng cùng hợp đồng và có phần dùng chung, nhưng đóng gói/quyền/luồng riêng. App quản lý ưu tiên theo dõi vận hành; web quản trị phục vụ cấu hình và quản trị theo quyền. Backend quyết định điều kiện nghiệp vụ. Không nhân bản thuật toán ví, ghép đơn hay quyền vào từng app.

Cấu trúc repository dự kiến:

```text
apps/backend/
apps/customer_app/
apps/merchant_app/
apps/driver_app/
apps/management_app/
apps/admin_web/
packages/contracts/
packages/mobile_shared/
docs/current/
docs/history/
docs/tasks/
database/migrations/
database/fixtures/
tests/integration/
ops/runbooks/
```

Đây là cấu trúc dự kiến, không phải mô tả thư mục đã tạo. Dev, staging và production có dữ liệu/secrets riêng. OTP/map fake chỉ chạy môi trường test được gắn nhãn; không được fallback sang fake trong production.

## 4. Schema manifest logic

Các tên sau được chọn làm tên chuẩn để viết schema vật lý. Manifest chỉ xác định ownership và ràng buộc bắt buộc; không thay cho DDL. Module sở hữu bảng cung cấp service cho module khác; không được ghi trực tiếp chéo bảng nghiệp vụ.

| Module | Bảng chuẩn dự kiến | Ràng buộc chính |
|---|---|---|
| M00 | `idempotency_records`, `audit_logs`, `outbox_events` | Actor/operation/key unique; request hash; audit không chứa secret; outbox ghi cùng transaction nghiệp vụ |
| M01 | `users`, `user_roles`, `admin_scopes`, `admin_permissions`, `phone_verifications`, `verification_proofs`, `sessions` | SĐT chuẩn hóa unique; OTP/proof đúng purpose dùng một lần; thu hồi phiên/quyền thực thi phía server |
| M02 | `service_areas`, `shops`, `shop_members`, `shop_business_hours` | Membership đúng quán; vùng lấy hàng; khung giờ nửa mở; trạng thái quán và bật nhận tách riêng |
| M03 | `drivers`, `driver_service_areas`, `driver_bank_accounts`, `driver_closure_requests` | Một driver/user; type mặc định EXTERNAL; ngân hàng đổi mất verification; closure không xóa ví |
| M04 | `driver_wallets`, `wallet_ledger_entries`, `wallet_holds`, `wallet_topups`, `wallet_withdrawals`, `wallet_adjustments` | Một ví/xế; ledger append-only; giữ/capture/release một lần; unique giao dịch ngân hàng; available không âm |
| M05 | `customers`, `customer_addresses` | Customer tối giản; địa chỉ thuộc người đặt; tối đa một default active; lat/lng có cùng nhau hoặc đều null |
| M06 | `shipping_quotes`, `driver_routing_states`, `route_evaluations`, `policy_versions` | Quote bind/version/TTL; khóa aggregate xế; policy snapshot; ETA gốc thuộc assignment bất biến |
| M07 | `deliveries`, `delivery_items`, `delivery_assignments`, `delivery_events`, `delivery_incidents` | Một active delivery/order; một active assignment/delivery; hạn tìm cố định; incident bảo vệ hàng sau fail |
| M08 | `driver_location_samples`, `driver_current_locations`, `device_bindings`, `notification_deliveries`, `reminder_jobs` | Mẫu cũ không ghi đè mới; binding user/session/installation; job dedupe và kiểm trạng thái lúc chạy |
| M09 | `system_categories`, `shop_categories`, `menu_items` | Hai lớp category độc lập; category đúng shop; active khác available; giá nguyên VND |
| M10 | `orders`, `order_items`, `order_events` | Snapshot người đặt/người nhận riêng; chỉ sửa trước confirm; tổng do backend kiểm; version/khóa nội dung |
| M11 | `driver_ratings`, `driver_rating_reports`, `shop_ratings`, `shop_rating_replies`, `shop_rating_reply_history`, `delivery_outcome_reports`, `delivery_outcome_adjustments` | Rating unique theo delivery/order; đúng actor/subject; reply có lịch sử; correction không replay complete |
| M12 | `operational_cases` | Case vận hành có actor/trạng thái/lý do; dashboard đọc projection từ module sở hữu |

Ghi chú ownership:

- M01 sở hữu quyền; M12 cung cấp giao diện quản trị quyền, không sở hữu bộ quyền thứ hai.
- M00 sở hữu hạ tầng upload/metadata đối tượng; tên bảng upload sẽ chốt khi viết contract upload. Không nhận URL tùy ý làm bằng chứng ownership.
- M06 sở hữu policy version; M12 sửa qua command có quyền. Snapshot phải chứa giá trị cần thực thi, không chỉ ID trỏ về chính sách đang thay đổi.
- M07 sở hữu lịch sử delivery; M10 sở hữu lịch sử order. Outbox là kênh truyền sự kiện, không thay cho lịch sử nghiệp vụ.
- M11 sở hữu quyết định sửa kết quả; delta tiền do M04 ghi vào `wallet_adjustments`. Hai bản ghi liên kết, không ghi hai lần tiền.
- M12 không tạo bảng bản sao ví/order/delivery để làm nguồn chuẩn. Projection/cache nếu cần phải có cơ chế dựng lại.

## 5. Ánh xạ tên và trạng thái

| Tên cũ/khái niệm | Tên chuẩn hoặc cách xử lý |
|---|---|
| `wallets` / `wallet_accounts` | `driver_wallets` |
| `transactions` / wallet entries | `wallet_ledger_entries` khi là bút toán ví; không đổi mọi transaction kỹ thuật thành ledger |
| `holds` | `wallet_holds` |
| Assignment chung | `delivery_assignments` |
| `SEARCHING` | `waiting_driver` |
| `ASSIGNED` | `accepted` |
| `DELIVERING` | `delivering`, giữ event `location_confirmed` và `picked_up` |
| `DELIVERED` | `completed` |
| `FAILED` | `failed` |
| `CANCELLED` | Chỉ map sang `cancelled_by_merchant` khi biết đúng nguyên nhân; không tự map mọi lịch sử cancel |
| Thiếu terminal tìm xế | Bổ sung `search_stopped` |
| `cancelled_by_customer` | Chỉ đọc lịch sử nếu có; không mở API khách hủy |
| Một `delivery_id` trên order | Projection `active_delivery_id`, `latest_delivery_id` và history; không unique toàn bộ order_id |
| `driver_type=SYSTEM` và quản trị SYSTEM | Enum và phép kiểm quyền riêng; không dùng chung `isSystem()` |

Order dùng `pending_confirmation`, `confirmed`, `rejected`, `cancelled_by_merchant`, `completed`. Delivery dùng `waiting_driver`, `accepted`, `location_confirmed`, `picked_up`, `delivering`, `completed`, `failed`, `cancelled_by_merchant`, `search_stopped`. Không thêm `preparing`/`ready`.

Chọn chuẩn mới cho các enum phụ chưa có hợp đồng đầy đủ: hold `active/captured/released`; withdrawal `pending/processing/reconciliation/paid/cancelled`. Đây là chuẩn tên đề xuất của M00-A, phải được cụ thể hóa transition/quyền trong M04-C, không dùng bảng này để mở mutation tự do. Nếu source thật đã có tên khác, lập mapping và migration có test, không đổi dữ liệu mù.

## 6. Hợp đồng chung

Giữ `/v1`, JSON snake_case, ID chuỗi bất biến, số nguyên VND, mét gốc, ISO 8601 UTC và UI giờ Việt Nam. Không thay unknown bằng 0. Cấu hình lấy từ policy theo nguồn mục 4, không rải số vào app/code.

Mutation có Idempotency-Key, same-key/different-body trả 409; quyền hiện hành được kiểm trước replay nhạy cảm. Command trạng thái dùng `expected_version` khi có resource đã tồn tại. Register/create không bịa version của đối tượng chưa có. Actor từ phiên server; unknown/forbidden fields bị từ chối.

Error gồm code/message/request_id/details đã whitelist. Dùng 401/403/404/409/422/429/503 theo S01; từng endpoint phải liệt kê lỗi cụ thể. GET không có tác động. Contract endpoint gồm operation_id, schema, security, response/error và examples trước CODE_READY.

Event envelope chuẩn có `event_id`, `event_type`, `event_schema_version`, `resource_type`, `resource_id`, `resource_version`, `occurred_at`. Đây là tên chuẩn hóa thêm cho M00; event payload nội bộ phải chốt riêng theo task. Push/WS chỉ phát phần metadata được phép theo S01; client fetch dữ liệu sau kiểm quyền. Consumer dedupe, bỏ event cũ và đồng bộ lại khi reconnect; outbox không bảo đảm gửi đúng một lần nên nghiệp vụ phải chống lặp.

## 7. Tích hợp và giao dịch nguyên tử

| Command | Coordinator | Thành phần cùng transaction |
|---|---|---|
| Register | M01 | Consume proof + user + session + audit/outbox cần thiết |
| Nạp và duyệt xế | M03-B | M04 kiểm giao dịch ngân hàng + credit; M03 kích hoạt; audit |
| Accept delivery | M07 | Delivery + assignment + M04 reserve + M06 routing version + event/outbox |
| Return/cancel | M07 | State + assignment ended + M04 release + route invalidation + job/outbox |
| Pickup | M07 | Ghim/phí + mốc location/pickup/delivering + snapshot hướng dẫn tiền + event/outbox |
| Complete | M07 | Delivery terminal + assignment ended + M04 capture/debit + M10 order sync nếu có + job/outbox |
| Fail | M07 | Delivery terminal + assignment ended + M04 release + incident + M10 attention + job/outbox |
| Checkout địa chỉ nhanh | M10 | M05 địa chỉ/default + order/items/snapshot + outbox |
| Hủy order trước pickup | M10 | Order cancel + M07 cancel delivery/assignment + M04 release + event/outbox |
| Correction kết quả | M11 | Adjustment decision + M04 delta + effective outcome/eligibility + audit; không chạy lại complete |

Các service nhận transaction context chung. M07 hỗ trợ order adapter khi có M10; đơn ngoài app không phụ thuộc M10. Không ghép bằng nhiều HTTP call độc lập rồi giả rằng tất cả đã commit cùng nhau.

Routing provider gọi ngoài transaction; khi commit kiểm lại tuổi kết quả, version/quyền/policy/ví/đơn. Thứ tự khóa và bounded retry phải thiết kế ở M00-B/C và task concurrency; chưa có DDL nên chưa tuyên bố đã giải quyết deadlock. Khóa aggregate xế và ví cần bảo vệ nhận song song hai delivery khác nhau.

## 8. Thứ tự công việc tiếp theo

| Phần Bước 4 | Task | Đầu ra | Trạng thái sau tài liệu này |
|---|---|---|---|
| 4.1 | M00-A | Chỉ mục/version/manifest/mapping/boundary | DESIGN: bản đã lập |
| 4.2 | M01-A contract | Auth/register/onboarding chi tiết, schema logic, fixtures, test A01–A03 liên quan | TODO; có thể làm tiếp chưa cần OTP thật |
| 4.3 | M00-B/C | Repo/commit, runtime, migration/CI/idempotency/audit/outbox triển khai | TODO; cần xác định repo và kiểm stack |
| 4.4 | Gói code đầu tiên | Task cụ thể đủ đầu vào, phạm vi và nghiệm thu | Chưa CODE_READY |

Sau nền: Đợt A M01→M02→M03-A→M04→M03-B; Đợt B M06/lõi M08→M07→tracking/dashboard; Đợt C M05→M09→M10; Đợt D M11/M12, restore, test liên thông và pilot. Không giao cả 13 module trong một prompt.

## 9. Quy trình giao Claude và nghiệm thu

Mỗi task dùng trạng thái TODO→DESIGN→CODE_READY→CODING→REVIEW→USER_TEST→LOCKED; BLOCKED ghi nguyên nhân và chỉ chặn phần phụ thuộc.

Trước CODE_READY phải có: task ID/mục tiêu; baseline spec; repository và base commit thật; file đọc/phạm vi sửa; schema/migration phần cần; OpenAPI/event/quyền/transaction; fixtures và test expected; UI duyệt nếu có màn; lệnh kiểm; yêu cầu bàn giao diff/commit/log/build/lỗi còn lại.

Claude triển khai trong phạm vi; ChatGPT kiểm diff và sự phù hợp contract, ghép hệ thống theo từng task; Owner giám sát, test bản chạy và duyệt. Chưa có bàn giao thực thì không ghi Claude đang code. ChatGPT chỉ đánh PASS khi có bằng chứng test thực.

## 10. Kiểm tra thiết kế M00-A

| Kiểm tra | Kết quả rà soát tài liệu |
|---|---|
| Một tên chuẩn cho ví/ledger/hold | Đã chọn trong manifest |
| SYSTEM driver không mang quyền admin | Tách namespace và quyền |
| Ghép/gọi lại và order–delivery không bị mất lịch sử | Giữ assignment riêng và một active delivery/order |
| Tiền hàng/ship không đi vào ví | Ví chỉ nạp/rút/hoa hồng/adjustment |
| Policy mới không sửa snapshot cũ | Quy định version/snapshot |
| Không nhân bản nguồn chuẩn sang app quản lý | Backend và module sở hữu dữ liệu |
| Không vòng phụ thuộc M03–M04 | M03-A trước, M03-B sau M04 |
| DDL/OpenAPI/source/build/thiết bị | Chưa xác minh; không đánh PASS runtime |

M00-A đã có đầu ra thiết kế để tiếp tục 4.2. Chưa khóa schema vật lý hoặc version công nghệ; chưa nghiệm thu phần mềm. Việc tiếp theo cụ thể là viết gói M01-A, bắt đầu xác thực SĐT, đăng ký và onboarding đúng quyền.