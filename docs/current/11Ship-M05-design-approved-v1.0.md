# 11Ship / 11Food — M05 Khách hàng và địa chỉ giao hàng (DESIGN LOCKED)

**Owner chốt chức năng + UI tham khảo:** 2026-10-15  
**Trạng thái:** APPROVED DESIGN / PENDING IMPLEMENTATION  
**Module:** M05-A Customer profile; M05-B Customer addresses  
**LƯU Ý:** Tài liệu **không phải** lệnh code, sửa DB, merge UI, hoặc deploy.

## 0. File thiết kế gốc

Bộ **11Ship-M05-Approved-Design-v1.0.zip** gồm:
- `11Ship-M05-Functional-UI-Approved-v1.0.md` — đặc tả chức năng đầy đủ và acceptance cases.
- `11Ship-M05-UI-Approved-v1.0.png` — **ảnh UI 5 màn hình được Owner duyệt** (ảnh chuẩn cần đối chiếu).

Đã lưu các file tại thư viện tài liệu dự án 11Ship, đường dẫn: **/11Ship/M05/** (ChatGPT Library / hồ sơ dự án). Bản ghi GitHub này là tài liệu chốt phạm vi để developer đọc ngay; phải mở ảnh gốc khi thực hiện UI.

## 1. Phạm vi

M05 chỉ sở hữu customer profile tối giản + danh sách địa chỉ giao hàng. Khách đăng nhập bằng M01. Không tái xây dựng OTP/account/session. M05 không làm giỏ hàng, order, phí/tuyến, nhận đơn của shipper, GPS tracking, menu, CRM, thanh toán/COD hoặc admin web. M10 sử dụng địa chỉ M05 khi checkout sau này.

## 2. Nghiệp vụ đã duyệt

- Một `user_id` có tối đa một `customers` profile. Tạo profile khi cần bằng onboarding tích hợp M01, không buộc đăng ký lại hoặc lấy OTP mới. Họ tên/SĐT tài khoản lấy từ M01; thay số đăng nhập không thuộc M05.
- Khách đặt hộ người khác: `customer`/người đặt vẫn là tài khoản đang đăng nhập. Tên/SĐT **người nhận** là riêng; người nhận không được quyền xem order/địa chỉ chỉ vì SĐT trùng.
- Một khách có thể lưu **nhiều địa chỉ**, không giới hạn cứng ở V1; cho phép địa chỉ trùng nội dung.
- Địa chỉ có: nhãn **Nhà / Cơ quan / Khác**, `recipient_name` (không bắt buộc), `contact_phone` (bắt buộc, gợi ý SĐT M01), `address_description` (bắt buộc), `latitude` + `longitude` (đều null hoặc cùng hợp lệ), `delivery_note` (không bắt buộc).
- **Không bắt buộc ghim GPS**. Chỉ nhập địa chỉ bằng chữ vẫn lưu được. Nếu delivery thiếu tọa độ, điều kiện xác minh map trước pickup thuộc M07 (không làm trong M05).
- Địa chỉ đầu tiên tự làm mặc định. Mỗi khách tối đa **một default active**; đổi default thực hiện nguyên tử, chống hai yêu cầu cùng lúc.
- Xóa địa chỉ **xóa mềm** sau xác nhận; nếu xóa default, chọn default active có `updated_at` mới nhất, hoặc null nếu không còn.
- Sửa/xóa địa chỉ không làm thay đổi snapshot người nhận/địa chỉ của **bất kỳ order cũ**. Quán sửa recipient trước xác nhận order cũng không tự chỉnh sổ địa chỉ khách.
- Địa chỉ nằm ngoài vùng phục vụ vẫn được lưu; kiểm khu vực phục vụ/phí tại thời điểm sử dụng ở module khác.
- API kiểm sở hữu theo tài khoản phiên hiện tại, không tin `customer_id` từ client. Retry thao tác phải chống tạo trùng.

## 3. UI ĐÃ DUYỆT — 5 màn hình 11Food

Màu thương hiệu vàng + đen + trắng; thẻ bo góc, header vàng, CTA vàng, phần xóa viền đỏ. Ảnh minh họa, không phải ứng dụng đã chạy.

1. **Tài khoản:** thêm lối vào **Sổ địa chỉ** ngay trong danh sách mục tài khoản.
2. **Sổ địa chỉ:** thẻ từng địa chỉ (loại, họ tên/SĐT, địa chỉ, ghi chú), badge **Mặc định**, **Sửa**, **Xóa**, mục không mặc định có **Đặt mặc định**; CTA **+ Thêm địa chỉ mới**.
3. **Thêm địa chỉ:** chọn loại Nhà/Cơ quan/Khác, người nhận, SĐT*, địa chỉ chi tiết*, ghim vị trí tùy chọn, ghi chú cho shipper, toggle mặc định, **Lưu địa chỉ**.
4. **Sửa địa chỉ:** form dùng chung với Thêm, preload dữ liệu; **Cập nhật** và **Xóa địa chỉ**.
5. **Chọn địa chỉ giao hàng:** màn hình trong M10 checkout; radio chọn địa chỉ, default lên đầu, **+ Thêm địa chỉ mới**, **Xác nhận địa chỉ**.

**Khóa không được thay đổi khi nhìn ảnh:**
- Ảnh UI tham khảo có một số mục tab dưới cùng của mẫu cũ: **KHÔNG** dùng ảnh để ghi đè quyết định M01. Giao diện khách 11Food giữ **3 tab Trang chủ – Đơn hàng – Tài khoản**; chủ quán giữ **4 tab Trang chủ – Đơn hàng – Quán – Tài khoản**; tab chọn vàng nhạt. Không thêm tab Tìm kiếm, Giỏ hàng, Thông báo hoặc Sổ địa chỉ vào bottom nav chỉ vì xuất hiện ở mockup.
- Giữ các mục đã quyết định bỏ khỏi màn Tài khoản ở M01.
- UI dùng từ **shipper**, không dùng “xế”; không đổi tên kỹ thuật/API/database nếu chỉ sửa ngôn ngữ UI.

## 4. Luồng thao tác

- **Thêm:** Tài khoản → Sổ địa chỉ → Thêm → kiểm dữ liệu → Lưu → hiển thị trong danh sách.
- **Sửa:** Chọn thẻ → Sửa → Cập nhật → danh sách phản ánh dữ liệu mới; snapshot đơn cũ không đổi.
- **Xóa:** Chọn thẻ → Xóa → xác nhận → inactive; tính lại default.
- **Chọn khi đặt:** Checkout M10 đọc các địa chỉ của khách, ưu tiên default, thêm mới được.
- **Đặt hộ / nhập nhanh khi checkout (M10 về sau):** POST /v1/orders chỉ được cung cấp **một** trong `customer_address_id` (đã kiểm sở hữu) **hoặc** `recipient` inline (có `contact_phone`, `address_description` bắt buộc, tên/GPS tùy chọn). Nếu inline: tạo order/items/snapshot + địa chỉ mới/default + outbox **cùng một transaction**. Không code M10 trong M05.

## 5. Schema logic

`customers`: `id`, `user_id` UNIQUE, `created_at`, `updated_at`.

`customer_addresses`: `id`, `customer_id`, `label`, `recipient_name`, `contact_phone`, `address_description`, `latitude`, `longitude`, `delivery_note`, `is_default`, `is_active`, `created_at`, `updated_at`.

Constraint: địa chỉ không rỗng, SĐT nhận hợp lệ, lat/lng cùng null/cùng hợp lệ, tối đa một default active/customer (enforce ở DB/transaction). Lưu order snapshot riêng; không xóa cứng lịch sử.

## 6. API đề xuất (chưa code)

- `GET /v1/customers/me` — hồ sơ khách.
- `GET /v1/customers/me/addresses` — danh sách địa chỉ active.
- `POST /v1/customers/me/addresses` — thêm.
- `PATCH /v1/customers/me/addresses/{id}` — sửa.
- `DELETE /v1/customers/me/addresses/{id}` — xóa mềm.
- `PUT /v1/customers/me/addresses/{id}/default` — đặt mặc định.

Actor luôn lấy từ session. Mutation dùng Idempotency-Key, error contract chuẩn /v1, chống race và unauthorized address ID. Đường dẫn là đề xuất thiết kế, chưa xác nhận backend có endpoint.

## 7. Acceptance cases (CHƯA CHẠY)

| Case | Kết quả mong đợi |
|---|---|
| M05-01 | User mới: danh sách rỗng, có CTA thêm |
| M05-02 | Địa chỉ đầu tiên: auto default |
| M05-03 | Thêm thứ hai không đặt default: giữ mặc định cũ |
| M05-04 | Chuyển default: luôn chỉ 1 |
| M05-05 | Sửa địa chỉ đã dùng: đơn cũ không đổi |
| M05-06 | Xóa default: chọn default thay thế; lịch sử không đổi |
| M05-07 | Không GPS: vẫn lưu |
| M05-08 | Thiếu SĐT/địa chỉ: validation cụ thể |
| M05-09 | Đặt hộ: người đặt và người nhận tách biệt |
| M05-10 | User A truy cập địa chỉ User B: bị chặn |
| M05-11 | Retry create sau mất mạng: không nhân đôi |
| M05-12 | Hai thiết bị đổi default đồng thời: DB bảo toàn |
| M05-13 | Inline recipient checkout thành công: order + địa chỉ atomic |
| M05-14 | Inline recipient checkout lỗi: không tồn tại dữ liệu dở dang |

## 8. Delivery gate

Thiết kế UI và chức năng đã Owner duyệt. **Không triển khai ngay.** Khi có lệnh, tách rõ task **UI-only** và **functional backend + DB**. Nếu yêu cầu UI-only, **tuyệt đối không viết luôn chức năng** (bài học M02). Thực hiện theo quy trình repo, review/CI/Owner test trước khi merge/deploy. Không tự thêm tính năng/phạm vi ngoài M05.

**Status:** DESIGN_LOCKED / IMPLEMENTATION_PENDING.
