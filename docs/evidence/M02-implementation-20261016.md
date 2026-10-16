# M02 — triển khai: hồ sơ/lịch, thực đơn, khách xem quán, khám phá (11Food, điện thoại)

Phạm vi: [M02-workstreams](../current/M02-workstreams-20261014.md), [UI v3 chốt tạm](../ui/m02/v3/README.md) và [bổ sung khám phá/tìm/lọc 16/10](../current/M02-discovery-UI-LOCKED-20261016.md). Chỉ app điện thoại 11Food; web chỉ Admin. Không đặt đơn, giỏ, gọi shipper, ví, thanh toán. **Triển khai xong trong code ≠ đã chạy trên VPS**: xem mục "Trạng thái".

## Nguyên nhân 403 khi lưu hồ sơ/lịch từ Android (đã sửa)
`apps/backend/src/app.setup.ts` chỉ giữ body gốc (rawBody) cho chữ ký thiết bị trên `client-auth`, `customer/me/profile`, `onboarding`. `PUT /v1/shop/me/profile` và `/business-hours` không nằm trong danh sách, nên guard xác minh chữ ký trên body rỗng → `DEVICE_PROOF_*` 403 (GET không bị vì không có body). Sửa: thêm `shop/me` vào các route bắt rawBody (cùng bộ phân tích JSON, chỉ thêm hook `verify`) và header `no-store`. **Không bỏ kiểm tra nào**: xác thực phiên, chữ ký thiết bị, quyền chủ quán dưới khóa vẫn nguyên. Bằng chứng: test tích hợp native (`native-remaining-flows`) — bỏ phần sửa thì 403, có phần sửa thì lưu hồ sơ/lịch/ảnh/món bằng chữ ký thiết bị đều 200; thiếu chữ ký vẫn `DEVICE_PROOF_REQUIRED`.

## Đã làm trong code
**Backend** (module `apps/backend/src/menu`, migration `1793059200000_create-menu`):
- Bảng `menu_categories` (nhóm hệ thống, version, tên duy nhất không phân biệt hoa/dấu), `menu_images` (ảnh bất biến trong PostgreSQL, ≤ 2 MiB, JPEG/PNG/WebP kiểm bằng byte đầu, ≤ 400 ảnh/quán), `menu_items` (VISIBLE/HIDDEN/DELETED, version riêng, xóa mềm, ≤ 300 món/quán), hàm `app.fold_vi` (bỏ dấu, thuần SQL).
- Chủ quán (phiên SHOP + ownership + khóa như M02-A): `GET /v1/shop/me/menu`, `POST /v1/shop/me/menu/images`, `POST/PUT /v1/shop/me/menu/items[/:id]`, `POST .../hide|show|delete`. Idempotency-Key + `expected_version`, audit + outbox, replay trả đúng kết quả cũ; món/ảnh của quán khác = "không tìm thấy"; quán DISABLED chỉ đọc; nhóm INACTIVE chỉ được giữ liên kết, không chọn mới.
- Công khai (không phiên): `GET /v1/shops/:id` (chỉ trường công khai; quán không tồn tại 404, không khả dụng 403 không nêu lý do; quán đóng cửa vẫn xem được), `GET /v1/menu-images/:id`, `GET /v1/service-areas`, `GET /v1/menu-categories`, `GET /v1/discovery/shops`, `GET /v1/discovery/dishes` (khu vực bắt buộc, nhóm, chỉ quán mở, từ khóa không phân biệt hoa/dấu/khoảng trắng, toàn bộ dữ liệu khớp, phân trang `offset/limit` + `has_more`, mở cửa trước rồi theo tên).
- Ranh giới module có test: Shop không đọc bảng menu, Menu không đọc bảng shop; khám phá ghép hai module trong một giao dịch đọc.
- nginx: route upload ảnh nới `client_max_body_size 3600k`, các route khác giữ `1m` (`ops/vinahost/nginx-11ship-staging.conf`). Grants + runbook triển khai: [m02-menu-deploy-20261016.md](../../ops/runbooks/m02-menu-deploy-20261016.md).

**Flutter** (`mobile/packages/n11_shared/lib/src/m02/`, `mobile/food`):
- Tab **Quán** (chủ quán theo vai trò máy chủ, không tự cấp quyền; vào chế độ quản lý bằng thao tác của người dùng): Q01 Quản lý, Q02 Hồ sơ, Q03/Q04 Giờ hoạt động, Q05 Thực đơn, Q06-A/B Thêm/Sửa món (chọn ảnh hệ thống, tải lên, nhóm, hiện/ẩn/xóa mềm), Q07 Xem trước. Không có mục "Quản lý cửa hàng" trong Tài khoản.
- **Trang chủ khám phá** (khu vực, nhóm, bộ lọc, danh sách quán), **Tìm quán/món**, thực đơn quán có tìm món và nhảy tới món, K02 giờ hoạt động. Kết nối API thật qua `HttpMenuApi`, `HttpPublicShopApi`, `HttpDiscoveryApi`.
- Pending/retry (đã có test): timeout / mất mạng / 502-504 giữ nguyên key + body, khóa chỉnh sửa và ghi khác, chỉ "Thử lại" gửi lại đúng thao tác; chỉ giải phóng khi máy chủ trả 2xx hoặc từ chối dứt khoát; hết phiên xóa nháp, không replay dưới tài khoản khác. Conflict giữ nháp, tải bản mới xác nhận hai lần. Tìm kiếm: kết quả của từ khóa cũ không chớp lên từ khóa mới.

## Trạng thái kiểm tra
| Hạng mục | Mức |
|---|---|
| Backend: unit, lint, typecheck; tích hợp PostgreSQL thật cho menu, khám phá, native (chữ ký thiết bị), ranh giới module | **chạy local**; CI áp dụng trên PR |
| Flutter: analyze + test (n11_shared, food, ship), 360/390px, bàn phím, vùng chạm ≥ 44px; parse JSON thật của backend bằng client Dart | **chạy local + CI** |
| APK 11Food | build bởi CI trên PR (applicationId/khóa ký giữ nguyên, versionCode tăng) |
| **Trên VPS** (migration, grants, nginx, nhóm món, route mới) | **CHƯA** — cần ủy quyền triển khai; APK trỏ endpoint VPS hiện hành sẽ báo "Không tải được dữ liệu" ở thực đơn/khám phá cho tới khi VPS chạy bản mới |
| Máy thật (GPS, chọn ảnh, TalkBack, chữ ký phần cứng) | **chưa** |

## Còn thiếu / cần Owner quyết định
- **D01/D02 (Admin quản lý nhóm món)**: chưa làm. Mô hình quyền Admin hiện chỉ có cờ theo ứng dụng (xem/duyệt hồ sơ/khóa), không có quyền "danh mục"; thêm quyền mới là quyết định nghiệp vụ. Phương án: (a) chỉ tài khoản SYSTEM; (b) thêm quyền danh mục vào lời mời Admin. Trong lúc chờ, nhóm được cấp bằng SQL vận hành (runbook mục 2); không có nhóm thì chủ quán chưa thêm được món (đúng đặc tả).
- Giới hạn giá/tên/ảnh do backend đặt (tên ≤ 120, giá 1–99.999.999 đ, ảnh ≤ 2 MiB): Owner xác nhận nếu cần số khác.
- Chưa có giới hạn tần suất cho route công khai (khám phá/ảnh) — cần quyết định hạ tầng (nginx/limit) nếu mở rộng.
- Ảnh mồ côi (tải lên nhưng chưa gắn món) không bị dọn tự động; có trần số ảnh/quán.
