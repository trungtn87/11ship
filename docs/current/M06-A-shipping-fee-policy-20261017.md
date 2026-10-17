# M06-A — Bảng giá ship linh hoạt (Gói 1)

Thiết kế: [M06-design-UI-LOCKED-2026-10-16.md](M06-design-UI-LOCKED-2026-10-16.md) mục 2. Gói này chỉ làm **bảng giá + phiên bản + Admin Web + tính phí thuần**. Chưa làm: điều kiện nhận/ghép (M06-B/C), báo giá lưu trữ `shipping_quotes`, UI 11Food/11Ship (M06-D), tuyến/GPS (M14), delivery (M07), ví (M04).

## Quy tắc tính phí (một nơi duy nhất: `apps/backend/src/shipping-policy/shipping-fee-policy.ts`)

- Khoảng cách là **mét gốc** (số M14 trả về); không làm tròn km. UI nhập km tối đa 3 chữ số thập phân → mét nguyên.
- Mốc nửa mở `[từ, đến)`: đúng mốc biên thuộc mốc tiếp theo. Mốc đầu bắt đầu từ 0; các mốc liên tục (không hở, không chồng); 1–50 mốc; phí nguyên 0–10.000.000đ; mốc cuối ≤ 1.000 km.
- Sau mốc cuối: `phí nền + floor((d − mốc_cuối) / bước_m) × phí_mỗi_bước` (bước ≥ 1 m). Mọi quãng đường có đúng một phí.
- **Không có công thức hay giá mặc định trong code/DB**: chưa áp dụng phiên bản nào thì không tính được phí (`UNPRICED`, `fee = null`, không bao giờ 0đ).
- Không có tuyến/khoảng cách (null, NaN, âm) → `UNPRICED / ROUTE_DATA_UNAVAILABLE`, không đoán.
- `recheckQuote`: quote chưa chốt phải tính lại khi hết TTL, đổi quán/điểm giao hoặc đổi policy version (`EXPIRED` / `LOCATION_CHANGED` / `POLICY_CHANGED`). `evaluateQuote`/`recheckQuote` là hàm thuần để M07/M06-D dùng; bảng `shipping_quotes` sẽ tạo ở gói nối M07/M14.

## Dữ liệu (migration `1793577600000_create-shipping-fee-policy.sql`)

- `app.shipping_fee_policy_versions`: mỗi lần "Áp dụng" một dòng **bất biến** (trigger chặn UPDATE/DELETE/TRUNCATE mọi role): số phiên bản liên tục, mốc (jsonb), phần sau mốc cuối, ghi chú, người áp dụng, thời gian. Bảng giá đang hiệu lực = phiên bản số lớn nhất.
- `app.shipping_fee_policy_drafts`: đúng một dòng (seed rỗng), `version` luôn tăng (màn hình cũ luôn bị báo xung đột, không ghi đè).
- CHECK `app.shipping_fee_tiers_valid(jsonb)` ở cả hai bảng: DB tự từ chối bảng hở/chồng/âm/không bắt đầu từ 0.
- Grants runtime: versions `SELECT, INSERT`; drafts `SELECT, UPDATE` (đã thêm vào `ops/selfhosted/02-runtime-grants.sql` và runbook).
- **Đơn/quote đã chốt giữ nguyên giá**: chúng lưu số phiên bản + phí lúc chốt; phiên bản cũ không bao giờ đổi. Module khác đọc bảng giá hiện hành qua `ShippingFeePolicyReader.active(context)` (đọc DB mỗi lần, không cache) trong transaction định giá.

## API (Admin, cookie + CSRF, `/v1/admin/shipping-fee-policy`)

| Method | Đường dẫn | Quyền | Ý nghĩa |
|---|---|---|---|
| GET | `/` | mọi Admin | `active`, `draft` (+`version`), `history` (50 phiên bản mới nhất), `limits` |
| POST | `/draft` | SYSTEM | Lưu nháp `{expected_version, tiers:[{from_m,to_m,fee_vnd}], tail:{base_fee_vnd,step_m,step_fee_vnd}}`; cần `Idempotency-Key` |
| POST | `/apply` | SYSTEM | Áp dụng bản nháp đã lưu `{expected_version, note?}` → phiên bản mới; cần `Idempotency-Key` |
| POST | `/preview` | mọi Admin | Thử tính `{distance_m, tiers?, tail?}`: có `tiers/tail` → tính theo bảng đang sửa, không có → theo bảng đang áp dụng. Không ghi gì |

Quyền theo quy tắc tham số hệ thống (`system-parameter-access.ts`): SYSTEM ghi, Admin khác chỉ đọc/thử tính; server quyết định mỗi lần (Admin ghi → `ADMIN_FORBIDDEN`). Mã lỗi: `SHIPPING_POLICY_INVALID` (400), `ADMIN_INPUT_INVALID` (400, sai hình dạng), `SHIPPING_DRAFT_VERSION_CONFLICT` (409), `SHIPPING_DRAFT_EMPTY` (409), `SHIPPING_POLICY_UNCHANGED` (409). Mỗi lần lưu nháp/áp dụng ghi audit (actor, thời gian, số mốc/phiên bản); áp dụng phát outbox `shipping.fee_policy.applied.v1`.

## Admin Web

Menu **Hệ thống › Phí & điều kiện giao** (`/system/shipping-fee-policy`), ba tab theo thiết kế đã khóa:

- **Bảng giá ship**: thêm/sửa/xóa mốc, phần sau mốc cuối, báo lỗi ngay khi nhập, "Thử tính phí" (tính ở server), "Lưu bản nháp", "Áp dụng bảng giá" (hộp xác nhận, ghi chú, tóm tắt thay đổi). Admin không phải SYSTEM: ô chỉ đọc, không có nút ghi.
- **Điều kiện nhận & ghép**: hiển thị mặc định đã duyệt (bán kính 5 km khóa, EXTERNAL 3, PLATFORM không giới hạn, chậm 5 phút) và nói rõ **chưa kết nối** — chỉnh sửa/áp dụng thật thuộc M06-B/C.
- **Lịch sử chính sách**: các phiên bản bất biến, người áp dụng, thời gian, ghi chú, thay đổi so với bản trước, chi tiết các mốc.

## Kiểm thử

- Unit: `apps/backend/src/shipping-policy/shipping-fee-policy.spec.ts` (mốc biên, mét gốc, không phải công thức cố định, validate, quote không tuyến, recheck, parser), `apps/admin-web/src/core/shipping-policy.spec.ts`.
- PostgreSQL thật: `tests/integration/m06-shipping-fee-policy.int.spec.ts` (bắt đầu rỗng/fail-closed, Admin không sửa được, bảng sai bị chặn ở API và DB, mốc biên qua API, phiên bản bất biến, đơn cũ không đổi, hai "áp dụng" đồng thời chỉ một thắng, replay idempotent).
- Chrome thật: `tests/integration/admin-shipping-policy-browser.int.spec.ts` (nhập → báo lỗi → thử tính → lưu nháp → áp dụng → lịch sử; Admin chỉ đọc).
