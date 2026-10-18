# M06-A — Bảng giá ship 3 khung (v1.1)

Thiết kế: [M06-v1.1](M06-v1.1-3km-3tiers-fee-agreement-20261018.md) (thay v1.0: nhiều khung + `tail`). Gói này: **bảng giá 3 khung + phiên bản + Admin Web + tính phí thuần + thỏa thuận phí (dữ liệu/luật)**. Chưa làm: lifecycle/tìm shipper/khóa phí (M07), tuyến/GPS (M14), ví (M04), thông báo (M08).

## Quy tắc tính phí (`apps/backend/src/shipping-policy/shipping-fee-policy.ts`)

- Khoảng cách là **mét gốc** do M14 trả về (không dùng đường chim bay để tính phí).
- **Đúng 3 khung**: `[0,b1)`, `[b1,b2)`, `[b2,b3]` (khung cuối gồm cả mốc b3); `0<b1<b2<b3`; mốc và phí là số nguyên; phí ≥ 0 và ≤ 10.000.000đ; b3 ≤ 1.000 km. Không có phí nền/bước/công thức sau mốc cuối.
- Quãng đường > b3: `UNPRICED / OUT_OF_PRICE_RANGE`, `fee = null` (không bao giờ 0đ, không tự cộng). Thiếu tuyến (null/NaN/âm): `ROUTE_DATA_UNAVAILABLE`. Hai mã khác nhau; không tự chuyển thành thỏa thuận.
- Chưa có phiên bản v2 nào được áp dụng → không tính được phí (`fee = null`). **Không seed giá**; 10k/15k/20k chỉ là ví dụ giao diện.
- `recheckQuote`: quote chưa chốt tính lại khi hết TTL / đổi điểm / đổi policy version.

## Dữ liệu và migration

- `1793750400000_create-shipping-fee-policy.sql` (**đã đổi tên** từ `1793577600000_…` vì trùng tiền tố với `1793577600000_create-wallet-topup-sources.sql` của M04-B1; migration này chưa vào `main` nên chưa chạy ở môi trường nào — nội dung giữ nguyên).
- `1793836800000_m06-v1-1-three-tiers-agreement.sql` (cộng thêm, chạy sau): `schema_version` (1 = cũ N khung + tail, chỉ để xem lịch sử, **không dùng để tính phí**; 2 = 3 khung), cột tail nullable, `shipping_fee_three_tiers_valid`, bảng `shipping_fee_agreements` và `shipping_fee_agreement_events` (xem dưới). Down từ chối khi đã có dữ liệu v2.
- Phiên bản bảng giá bất biến (trigger); snapshot phí đã chốt của đơn cũ không bị tính lại.

## API Admin (`/v1/admin/shipping-fee-policy`)

`GET /` (mọi Admin), `POST /draft` `{expected_version, tiers:[{from_m,to_m,fee_vnd}×3}` (SYSTEM, Idempotency-Key), `POST /apply` (SYSTEM), `POST /preview` `{distance_m, tiers?}` (mọi Admin). Mã lỗi: `SHIPPING_POLICY_INVALID` (kèm mã chi tiết `TIERS_COUNT`, `OVERLAP`, `GAP`, `FEE_NEGATIVE`, `FEE_TOO_HIGH`…), `ADMIN_INPUT_INVALID` (gửi `tail` hoặc khóa lạ), `SHIPPING_DRAFT_VERSION_CONFLICT`, `SHIPPING_DRAFT_EMPTY`, `SHIPPING_POLICY_UNCHANGED`.

## Thỏa thuận phí (`shipping-fee-agreement*.ts`, service `ShippingFeeAgreementService`)

- `fee_mode STANDARD|AGREED`; trạng thái `PROPOSED → COUNTERED → AWAITING_CUSTOMER → ACCEPTED`, hoặc `DECLINED/EXPIRED/LOCKED`. Mỗi thỏa thuận lưu đề xuất, phản đề nghị, phí chốt, lý do (`URGENT|BULKY|BAD_WEATHER|OUTSIDE_TABLE|OTHER`, `OTHER` bắt buộc ghi chú; ghi chú ≤200 ký tự và **không chứa số điện thoại** — ≥8 chữ số bị từ chối `PROPOSAL_INVALID`), người trả, người thao tác, thời gian, `version`.
- Quán đề xuất → shipper đồng ý / bỏ qua / đề xuất mức khác → quán chấp thuận hoặc từ chối. **Từ chối giữ nguyên đề xuất gốc, không kéo dài hạn (`expires_at` không bao giờ lùi/tăng lại), shipper bị từ chối không tự chốt mức đã bị từ chối.** Khách trả và mức khác phí chuẩn → `AWAITING_CUSTOMER`, chỉ chốt khi khách đồng ý.
- Chống trùng/đồng thời/muộn: khóa dòng `FOR UPDATE`, `version`, nhật ký `(agreement_id, request_id)` duy nhất (lặp lại cùng request trả kết quả cũ), phản hồi sau hạn → `EXPIRED`. Trigger DB: bất biến danh tính + đề xuất, hạn không rút ngắn, version +1, đồ thị trạng thái; nhật ký chỉ ghi thêm.
- Sau `picked_up` phí bị khóa (M07 gọi khóa); chỉ Admin có quyền điều chỉnh, có nhật ký. M06 **không** viết lifecycle/tìm shipper: M07 gọi service này.
- Không có phụ phí tự động.

## Admin Web

Menu **Hệ thống › Phí & điều kiện giao**: bảng **3 hàng cố định** (sửa 3 mốc trên + 3 mức phí), không thêm/xóa khung, không `tail`; thử tính hiển thị "Ngoài bảng giá" khi vượt b3; bán kính tìm shipper **3 km chỉ đọc**; lịch sử có nhãn phiên bản cũ (N khung + tail, chỉ xem).

## Kiểm thử

Unit: `shipping-fee-policy.spec.ts`, `shipping-fee-agreement.spec.ts`, `apps/admin-web/src/core/shipping-policy.spec.ts`. PostgreSQL thật: `m06-shipping-fee-policy.int.spec.ts`, `m06-shipping-fee-agreement.int.spec.ts` (đề xuất → phản đề nghị → từ chối giữ hạn, khách trả, trùng/đồng thời/hết hạn), `m06-shipping-eligibility.int.spec.ts` (3000 m vào, >3000 m ngoài). Chrome thật: `admin-shipping-policy-browser.int.spec.ts`.
