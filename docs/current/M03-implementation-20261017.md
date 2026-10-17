# M03 — Quản lý Shipper: bàn giao triển khai (17/10/2026)

Nguồn yêu cầu: `docs/current/M03-UI-LOCKED-2026-10-15.md` (UI + nghiệp vụ đã khóa) và `docs/current/11-brand-guideline-v1.0.md`. Tài liệu này ghi **cái đã làm thật**, **cái đang bị chặn bởi M04**, các **quyết định kỹ thuật cần Owner biết**, và cách chạy/triển khai. Không tự đánh dấu Owner nghiệm thu; không chạy migration production hay deploy VPS.

Mã nguồn: nhánh `claude/inspiring-heisenberg-7wamt1`. Migration: `database/migrations/1793318400000_create-shipper-management.sql`.

## 1. Đã hoàn thành (chạy thật, nối dữ liệu thật)

| Nhóm | Chức năng | Ở đâu |
|---|---|---|
| M03-A | Hồ sơ Shipper: họ tên + SĐT (từ tài khoản M01), mã Shipper `SHxxxxxx`, biển số; sửa khi `Chưa gửi` / `Bị từ chối`; **không** đăng ký lại | App Android · `GET/PUT /v1/driver/me…` |
| M03-A | Tài khoản ngân hàng: chọn ngân hàng (danh sách đóng), số TK (6–20 chữ số), tên chủ TK **phải khớp họ tên** (không phân biệt hoa/thường/dấu); trạng thái xác minh `Chờ xác minh / Đã xác minh / Bị từ chối`; **đổi ngân hàng ⇒ về `Chờ xác minh` và tắt nhận đơn** | App + Admin |
| M03-A | Trạng thái hồ sơ: `Chưa gửi` → `Chờ xét duyệt` → `Đã duyệt` hoặc `Bị từ chối` (kèm lý do, sửa và gửi lại) | App + Admin |
| M03-B | Bật/tắt nhận đơn: server kiểm tra *hồ sơ đã duyệt + ngân hàng đã xác minh + ví đủ điều kiện*; tắt luôn được, không đụng đơn đã nhận | `POST /v1/driver/me/accepting` |
| M03-B | Ngừng hoạt động: gửi yêu cầu (ngừng nhận đơn mới **ngay**), hủy yêu cầu khi chưa được xử lý, Admin từ chối hoặc hoàn tất; **không mất số dư** | App + Admin |
| Admin | Danh sách Shipper: tìm theo họ tên (không dấu) / SĐT / mã, lọc trạng thái, phân trang | Web Admin · `Vận hành › Shipper` |
| Admin | Chi tiết: hồ sơ, ngân hàng (số TK đầy đủ để đối chiếu), điều kiện nhận đơn, phân loại nội bộ, **lịch sử thao tác** | idem |
| Admin | Duyệt, Từ chối (bắt buộc lý do), Khóa hoạt động (bắt buộc lý do), Mở lại, Xác minh / Từ chối ngân hàng (từ chối cần lý do), Từ chối / Hoàn tất yêu cầu ngừng hoạt động | idem |
| Admin | Phân loại nội bộ `EXTERNAL` (mặc định) / `PLATFORM` — chỉ Admin có quyền `review` trên app DRIVER hoặc SYSTEM; **chỉ hiện trên Web Admin**, không có trong API/app/web của Shipper; không cấp quyền Admin | idem |
| Admin | Cài đặt → Tham số hệ thống → **Ví Shipper**: nạp tối thiểu (mặc định 100.000) / rút tối thiểu (mặc định 10.000); số nguyên VND dương ≤ 1 tỷ; lưu DB; log người sửa + thời gian + giá trị cũ/mới; áp dụng cho yêu cầu mới | `Hệ thống › Tham số hệ thống › Ví Shipper` |
| Nền tảng | Audit log (`admin.shipper.*`, `driver.*`), outbox `driver.state_changed.v1` & `shipper.wallet_parameter.changed.v1` (cho M13), idempotency + `expected_version` + khóa dòng ⇒ không duyệt trùng / xử lý đồng thời sai trạng thái; Admin **không** tự duyệt / tự đổi phân loại hồ sơ của chính mình | backend |
| API cho M04 | `ShipperWalletParametersReader.limits(ctx)` (đọc DB mỗi lần, không cache) và `GET /v1/driver/wallet-limits` (chỉ để app gợi ý số tối thiểu khi nạp/rút; **không** có trang cài đặt trong app) | `apps/backend/src/driver/shipper-wallet-parameters.ts` |

## 2. Bị chặn bởi M04 (an toàn, đã ghi rõ — không giả lập số dư)

M04 (ví) chưa có. M03 chỉ phụ thuộc vào M04 qua **một cổng** `DriverWalletPort` (`apps/backend/src/driver/driver-wallet-port.ts`, token `DRIVER_WALLET_PORT`). Bản mặc định `NotIntegratedDriverWalletPort` trả lời *“ví chưa sẵn sàng / chưa tất toán”*:

1. **Bật nhận đơn** luôn bị server từ chối `DRIVER_WALLET_NOT_READY`; app hiển thị lý do “Ví chưa sẵn sàng (chờ module Ví)”. Mọi điều kiện còn lại (hồ sơ đã duyệt, ngân hàng đã xác minh) đã làm và kiểm tra thật.
2. **Hoàn tất ngừng hoạt động** (`CLOSING → CLOSED`) bị từ chối `DRIVER_WALLET_NOT_SETTLED` cho tới khi M04 báo đã tất toán. Yêu cầu ngừng vẫn ngừng nhận đơn mới ngay; số dư không bị mất.
3. Kiểm tra “đơn đang giao” khi hoàn tất ngừng dùng `AccountActivityRegistry.activeWork` (M07/M08 đăng ký kiểm tra của họ ở đó khi có đơn).

Khi M04 xong: bind `DRIVER_WALLET_PORT` sang bản thật (`readinessForOrders`: số dư ≥ ngưỡng nhận đơn của M04; `settlementForClosure`: không còn số dư/giao dịch treo). Không cần sửa code M03.

## 3. Quyết định kỹ thuật (nêu để Owner/ChatGPT biết; đổi được nhanh)

- **Quyền sửa tham số ví = chỉ tài khoản SYSTEM** (giống nhóm “Xác thực SĐT”). Admin thường nhận `ADMIN_FORBIDDEN`. Lý do: tham số tiền; hệ thống quyền Admin hiện chưa có quyền “tham số”. Nếu Owner muốn Admin thường sửa được: thêm quyền riêng ở M01-ADMIN trước.
- **Quyền thao tác Shipper**: SYSTEM, hoặc ADMIN có dòng quyền app `DRIVER`: `can_view` (xem), `can_review_profile` (duyệt/từ chối/ngân hàng/phân loại/ngừng hoạt động), `can_lock` (khóa/mở lại). Không thêm quyền mới.
- **Mở lại hoạt động** yêu cầu ngân hàng còn `Đã xác minh`. Mở lại **không** tự bật nhận đơn.
- **Duyệt** yêu cầu hồ sơ đã gửi và có tài khoản ngân hàng đúng tên Shipper (ngân hàng được xác minh riêng, trước hoặc sau duyệt). “Hồ sơ thiếu thông tin không được duyệt.”
- **Họ tên** chỉ sửa khi `Chưa gửi / Bị từ chối` (vì tên là căn cứ khớp tên chủ TK). Sửa tên đưa ngân hàng về `Chờ xác minh`.
- **`/v1/driver/me` và `POST /v1/onboarding/driver` không còn trả `driver_type`** (yêu cầu “không công khai phân loại”). Đây là thay đổi hợp đồng M01 có chủ đích; web `ship-web` (LOCAL_WEB) đã bỏ dòng “Loại shipper” và tab đọc phân loại. Test M01 liên quan đã sửa theo.
- **Mã Shipper** `SH000001…` cấp bằng hàm `app.next_shipper_code()` (SECURITY DEFINER) để role runtime không cần quyền sequence; cần `GRANT EXECUTE` trong `ops/selfhosted/03-runtime-function-grants.sql` (đã thêm).
- Ràng buộc DB chỉ chiều “lý do chỉ tồn tại ở trạng thái mà nó giải thích”; việc bắt buộc có lý do khi vào trạng thái do service đảm bảo, để công cụ cũ đổi `status` trực tiếp vẫn chạy (các test M01 cũ vẫn xanh).
- Không thêm khu vực hoạt động, CCCD/GPLX/email/ngày sinh, “+ Thêm shipper”, trang tham số trong app, thuật toán nhận đơn/GPS (đúng danh sách “tuyệt đối không làm”).

## 4. API (tóm tắt)

Shipper (Bearer, `Idempotency-Key` cho ghi, `expected_version` bắt buộc):
`GET /v1/driver/me` · `GET /v1/driver/banks` · `GET /v1/driver/wallet-limits` · `PUT /v1/driver/me/profile` · `PUT /v1/driver/me/bank` · `POST /v1/driver/me/submit` · `POST /v1/driver/me/accepting` · `POST /v1/driver/me/closure-request` · `POST /v1/driver/me/closure-cancel`.

Admin (cookie phiên + CSRF, `Idempotency-Key`): `GET /v1/admin/shippers?q&status&limit&offset` · `GET /v1/admin/shippers/:driver_id` · `POST …/{approve,reject,lock,unlock,classification,bank/verify,bank/reject,closure/reject,closure/finalize}` · `GET|POST /v1/admin/system-settings/shipper-wallet` (SYSTEM).

Mã lỗi mới (đã vào registry + test): `DRIVER_NOT_FOUND`, `DRIVER_STATE_CONFLICT`, `DRIVER_PROFILE_LOCKED`, `DRIVER_PROFILE_INCOMPLETE`, `BANK_HOLDER_MISMATCH`, `DRIVER_BANK_NOT_VERIFIED`, `DRIVER_NOT_ACTIVE`, `DRIVER_WALLET_NOT_READY`, `DRIVER_HAS_ACTIVE_WORK`, `DRIVER_WALLET_NOT_SETTLED`, `DRIVER_SELF_ACTION_FORBIDDEN`, `WALLET_PARAMETER_VERSION_CONFLICT`.

## 5. Dữ liệu / migration (an toàn, chỉ cộng thêm)

`1793318400000_create-shipper-management.sql`: thêm cột vào `app.drivers` (mã Shipper, `review_state`, thông tin duyệt/khóa/ngừng) với giá trị mặc định; bảng mới `driver_bank_accounts`, `driver_events` (lịch sử chuyển trạng thái), `shipper_wallet_parameters` (+2 dòng mặc định 100000/10000), `shipper_wallet_parameter_changes`. Không xóa/sửa dữ liệu cũ; hồ sơ hiện có `PENDING` thành `Chưa gửi` (cần khai báo ngân hàng + gửi duyệt), hồ sơ khác thành `APPROVED`. Có Down Migration. Grants runtime: `ops/selfhosted/02-runtime-grants.sql` (+4 bảng) và `03-runtime-function-grants.sql` (+`app.next_shipper_code()`); bảng ma trận trong `ops/runbooks/render-supabase-staging.md` đã cập nhật (test `tests/deploy/selfhosted-grants.test.mjs` kiểm hai nơi khớp nhau).

## 6. Cách chạy thử

- **Local backend + Admin**: như các module trước (`docs`/README gốc). Đăng nhập Admin → menu `Vận hành › Shipper`; `Hệ thống › Tham số hệ thống › Ví Shipper` (SYSTEM).
- **App Android 11Ship**: *Tài khoản → Hồ sơ shipper* → tạo hồ sơ → *Tài khoản ngân hàng* → *Gửi hồ sơ xét duyệt*; sau khi Admin duyệt + xác minh ngân hàng: *Nhận đơn và ngừng hoạt động*. APK: workflow **Mobile APK** (GitHub Actions) — môi trường này **không có Flutter/Android SDK** nên chưa build được APK ở đây (xem mục 8).

## 7. Triển khai VPS (ngắn gọn — chỉ khi Owner/ChatGPT cho lệnh)

Theo `ops/runbooks/vps-production-update-20261014.md` mục 2–6 (sao lưu → preflight → migrate → grants → đổi release → khởi động lại):

1. Sao lưu `ship11_staging`.
2. `node scripts/db-migrate-remote.js` (chỉ đọc: phải thấy đúng 1 migration pending `1793318400000_create-shipper-management`), rồi `--apply`.
3. `psql … -f ops/selfhosted/02-runtime-grants.sql` và `… -f ops/selfhosted/03-runtime-function-grants.sql` (idempotent).
4. Đổi release, khởi động lại; build lại Web Admin cùng release.
5. Kiểm: đăng nhập Admin → `Vận hành › Shipper` mở được; `Ví Shipper` đọc 100.000 / 10.000; app ship (APK mới) đọc hồ sơ.
Không cần biến môi trường mới.

## 8. Bằng chứng kiểm thử & giới hạn (ghi trung thực)

Chạy cục bộ (Node 22, PostgreSQL 16, đúng quy trình CI): `npm run typecheck`, `npm run lint`, `npm run test:unit` (2548 test), tích hợp M03 `tests/integration/m03-shipper.int.spec.ts` (29 test, Postgres thật: hồ sơ thiếu thông tin không được duyệt; ngân hàng chưa xác minh không bật được nhận đơn; Shipper không đặt được PLATFORM; bật nhận đơn khi chưa đủ điều kiện bị từ chối; tắt nhận đơn không đụng đơn đã nhận; khóa không mất ví/ngân hàng; đổi ngân hàng buộc xác minh lại; yêu cầu ngừng không mất tiền và bị chặn tới khi tất toán; Admin đổi tham số và API/reader đọc đúng giá trị mới; tài khoản Shipper không vào được chức năng Admin; hai Admin duyệt đồng thời chỉ một thắng; replay không ghi lần hai). Toàn bộ bộ test tích hợp cục bộ: 119/123 suite xanh lần đầu; các lỗi còn lại là test lịch sử migration (đã sửa theo migration mới) và `staging-db-upgrade-from-42` (máy thử dùng PostgreSQL 16, CI dùng 17.11 nên báo `SERVER_VERSION` — khác biệt môi trường). Test trình duyệt thật `admin-shippers-browser.int.spec.ts` (danh sách, tìm, chi tiết, duyệt, xác minh ngân hàng, phân loại, khóa/mở lại, từ chối có lý do, trang Ví Shipper, quyền theo vai trò) xanh. Kết quả CI của nhánh là bằng chứng cuối.

Giới hạn / chưa làm được:
- **APK mới chưa build** ở đây (không có Flutter SDK): code Dart + test Dart (`driver_m03_test.dart`, `driver_flow_test.dart`, `flows_test.dart`) đã viết nhưng **chưa chạy được cục bộ**; cần workflow *Mobile APK* / *m14-flutter-runtime* trên CI để xác nhận. Chưa kiểm trên thiết bị.
- Web `ship-web` (LOCAL_WEB) chỉ được sửa để không lộ phân loại và đọc đúng hợp đồng mới; **không** có màn ngân hàng/nhận đơn M03 (phạm vi là app Android + Web Admin).
- Chính sách quyền riêng tư trong app (`account_views.dart`) vẫn nói “hồ sơ shipper lưu họ tên và biển số”; nay còn lưu tài khoản ngân hàng ⇒ cần Owner duyệt văn bản mới trước khi sửa (xem `M01-terms-privacy-20261014.md`).
- Chưa có màn Admin xem tổng quan “yêu cầu ngừng hoạt động” riêng (lọc `Xin ngừng hoạt động` ở danh sách thay thế).

## 9. Checklist ngắn (task)

- [x] Phạm vi duyệt, không đổi thiết kế đã khóa · [x] migration an toàn + down · [x] test hành vi bị ảnh hưởng · [x] audit/outbox tái sử dụng · [x] phân quyền server · [ ] CI xanh trên PR · [ ] APK/Android CI · [ ] Owner nghiệm thu (Owner quyết định)
