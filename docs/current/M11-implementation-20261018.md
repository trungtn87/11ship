# M11 — Đánh giá và phản ánh: triển khai (19/10/2026)

Nguồn thiết kế: `11Ship-M11-Functional-UI-LOCKED-v1.0.md` (OWNER_APPROVED / DESIGN_LOCKED 16/10/2026), ba ảnh `11Ship-M11-*-UI-APPROVED.png`; bản sao ở `docs/current/` và `docs/ui/m11/`. Văn bản ưu tiên hơn ảnh. Nhánh `claude/practical-ptolemy-ujm8ol`. Không merge, không deploy, không chạy migration trên môi trường thật.

## 1. Gói và nơi làm

| Gói | Nội dung | Code |
|---|---|---|
| M11.01 | Đánh giá quán (khách) / shipper (khách, quán); tổng hợp điểm; phản hồi của quán có lịch sử; trang đánh giá công khai của quán; điểm theo nguồn cho shipper | `database/migrations/1794355200000_create-m11-reviews-complaints.sql`, `apps/backend/src/feedback/review-*.ts`, `review.controller.ts`, `mobile/.../m11/m11_rating_views.dart` |
| M11.02 | Gửi phản ánh (6 nhóm), ảnh minh chứng (≤5 ảnh, ≤5 MB, kiểm chữ ký tệp), theo dõi, bổ sung, giải trình của bên liên quan, yêu cầu xem xét lại trong 7 ngày | `feedback/complaint-*.ts`, `complaint.controller.ts`, `m11_complaint_views.dart` |
| M11.03 | Admin Web **Đánh giá** và **Phản ánh**: lọc/tìm, tiếp nhận, phân công, ghi chú nội bộ, yêu cầu bổ sung, kết luận, đóng, quyết định xem xét lại, ẩn/khôi phục đánh giá, điều chỉnh kết quả giao, điều chỉnh hoa hồng (cổng M04) | `apps/backend/src/admin-feedback/`, `apps/admin-web/src/dom/feedback-view.ts`, `core/feedback*.ts` |
| M08 | Nhắc đánh giá **một lần** (thông báo thường, không popup) sau giao thành công/thất bại; thông báo hồ sơ phản ánh (đã tiếp nhận/cần bổ sung/kết luận/mở lại) và mục tiêu `COMPLAINT` | `notification-composer.ts`, `notification-complaint-composer.ts`, `notification-event-service.ts` |

## 2. Quyết định kỹ thuật (không đổi nghiệp vụ đã duyệt)

1. **Gửi một lần, không sửa/xóa.** Ràng buộc duy nhất trên (loại đánh giá, order/delivery); gửi lặp qua `Idempotency-Key` trả đúng kết quả cũ, request song song bị khóa theo thứ tự user → session → shop/driver. Không có giới hạn 500 ký tự và không có ảnh trong đánh giá.
2. **Quyền do server kiểm lại mỗi lần**, dưới khóa: khách đúng người đặt Order hoàn thành; shipper phải là người **thực hiện** (assignment) delivery thành công; quán chỉ đánh giá shipper của delivery của chính quán (thành công hoặc thất bại). Người nhận hộ trùng SĐT không có quyền. Shipper hủy nhận trước lấy hàng không nhận đánh giá của lần đó.
3. **Riêng tư theo kiểu dữ liệu.** Đánh giá shipper chỉ lộ *nguồn* (Khách/Quán), không lộ người viết; không công khai PLATFORM/EXTERNAL. Bên liên quan của phản ánh chỉ thấy phần được gửi cho họ và kết luận (`visibility`: SUBMITTER / PARTIES / PARTY_ONLY / INTERNAL), không thấy nội dung và ảnh của người gửi; ghi chú nội bộ không bao giờ ra app.
4. **Ẩn/khôi phục** có lý do, giữ bản gốc, ghi audit; đánh giá ẩn không tính vào điểm tổng hợp (tổng hợp tính lại trong cùng giao dịch). Không có API sửa sao/nhận xét thay người gửi, không có nút quán báo cáo đánh giá khách.
5. **Xem xét lại 7 ngày** tính theo **đồng hồ máy chủ**, một lần cho mỗi lần đóng (`closure_no`); app chỉ hiện nút khi server trả `can_request_reconsideration`. Hồ sơ trùng đang mở trên cùng đơn được bổ sung vào hồ sơ cũ (`appended: true`).
6. **Điều chỉnh kết quả giao** không đụng delivery, capture hay custody: thêm một dòng điều chỉnh tham chiếu kết quả gốc + sự kiện lịch sử `delivery.result_adjusted`; nếu sau đó còn lần giao khác trong chuỗi thì bắt buộc `history_reviewed`. Đóng phản ánh **không** đổi custody (có test khẳng định).
7. **Quyền tiền tách riêng.** Xử lý phản ánh = xem + quyền duyệt hồ sơ trên SHOP/DRIVER; điều chỉnh hoa hồng cần thêm quyền `wallet.adjustment.post` (SYSTEM mặc định hoặc dòng cấp quyền). Quyền xử lý không kéo theo quyền tiền hay khóa tài khoản. Thiếu số dư → `PENDING_FINANCE`, không bao giờ làm ví âm hay đụng tiền đang giữ.
8. **Ranh giới module**: SQL chỉ qua repository của chủ sở hữu; M11 không ghi ví/sổ cái. Boundary spec hiện có vẫn xanh.
9. Nhãn sản phẩm dùng "Điều chỉnh tài chính"/"Xem tình trạng hàng", không dùng tên module kỹ thuật; từ "shipper" xuyên suốt; không thêm tab (vào từ chi tiết giao hàng và Tài khoản).

## 3. Phần chưa nối — chặn thật, không giả thành công

| Phần | Lý do | Hành vi hiện tại |
|---|---|---|
| Khách đánh giá quán/shipper và khách gửi phản ánh về Order | **M10 (Order) chưa có**: không có Order thật để kiểm "đã hoàn thành" và "người đặt" | Cổng `FEEDBACK_ORDER_PORT` mặc định `NotIntegrated` → API trả `ORDER_MODULE_NOT_READY` (409); app báo "module đặt món chưa sẵn sàng". Kiểm bằng cổng giả trong test, không có dữ liệu giả ở bản chạy. Khi M10 xong chỉ cần cung cấp implementation của cổng (`OrderFact`: orderId, code, shopId, shopName, completed, người đặt) |
| Ghi điều chỉnh hoa hồng vào ví | Cổng ghi M04 cho điều chỉnh chưa có | `COMMISSION_ADJUSTMENT_PORT` mặc định ghi nhận `PENDING_FINANCE` (`M04_UNAVAILABLE`); tuyệt đối không ghi ví. Các nhánh POSTED / INSUFFICIENT_BALANCE được kiểm bằng cổng giả |
| Xem ảnh minh chứng ngay trong app | Kênh `protectedCall` hiện chỉ trả văn bản | App gửi ảnh và hiện "N ảnh minh chứng đính kèm"; **Admin Web xem được ảnh** (có kiểm quyền, `private, no-store`). Máy chủ đã có route `.../attachments/:id` cho từng vai |
| Push thật | Firebase chưa cấp (xem M08) | Thông báo vào hộp thư; push `PROVIDER_NOT_CONFIGURED` như M08 |
| App khách (11Food phía khách) | Chưa có màn Đơn của khách (M10) | Màn đánh giá/phản ánh của khách đã có trong thư viện dùng chung nhưng chưa có đường vào từ đơn |

## 4. Migration (Owner/Ops chạy — tôi chưa chạy trên môi trường thật)

Tệp: `database/migrations/1794355200000_create-m11-reviews-complaints.sql` (Up + Down trong cùng tệp). Chỉ **thêm** bảng/trigger/sequence và mở rộng `notifications_target_ck` thêm `'COMPLAINT'`; không sửa dữ liệu cũ, không seed.

```
npm run db:migrate            # hoặc: npm run db:migrate:remote  (theo quy trình hiện hành, sao lưu trước)
```
Hoàn tác (chỉ khi cần, mất dữ liệu M11): chạy migration down một bước; Down xóa các push của thông báo `COMPLAINT` trước khi gỡ ràng buộc.

Không có biến môi trường mới. Không đổi applicationId, khóa ký, origin hay `ship11_staging`.

## 5. Kiểm tra đã chạy (xem mục 7 cho kết quả cụ thể)

- Backend: lint, typecheck, unit (toàn bộ), integration toàn bộ trên PostgreSQL thật (gồm `m11-feedback.int.spec.ts`, `m11-admin-feedback.int.spec.ts`, các migration spec cập nhật).
- Admin Web: `npm run admin-web:test`.
- Flutter: `flutter analyze` + `flutter test` cho `n11_shared`, `food`, `ship` (bản local với Flutter 3.47.7).
- Ca trọng tâm đã có test: sai actor/đơn/đối tượng; chưa đủ điều kiện; hai request cùng lúc; quán không sửa/xóa đánh giá khách; cập nhật reply có lịch sử; ẩn/khôi phục đổi điểm; phản ánh trùng; quyền đọc minh chứng; thiếu quyền tiền; hết 7 ngày; điều chỉnh không replay complete/capture; thiếu ví giữ chờ; có delivery tiếp theo; đóng hồ sơ không đổi custody; retry không nhân đôi.

## 6. Checklist ngắn cho Owner

**Điều kiện:** đã chạy migration trên môi trường thử; backend mới; Admin Web mới; cài APK 11Food/11Ship từ CI (cùng package + khóa ký nên cập nhật đè). Tài khoản: một quán ACTIVE, một shipper ACTIVE có delivery thành công + một delivery thất bại (M07), một Admin có quyền xử lý phản ánh (SHOP/DRIVER), một Admin có thêm quyền điều chỉnh tài chính.

Điện thoại:
1. **11Ship (shipper)** → Tài khoản → *Đánh giá của tôi*: thấy điểm theo Tất cả/Khách/Quán, lọc sao; chưa có đánh giá thì ghi "Chưa có đánh giá" (không mặc định 5 sao). Không thấy tên người viết.
2. **11Food (chủ quán)** → Đơn → mở delivery đã giao → *Đánh giá shipper*: phải chọn sao mới gửi được, có hộp xác nhận, gửi xong không đánh giá lại được.
3. Tài khoản → *Đánh giá của khách*: danh sách, lọc sao, *Phản hồi*/*Sửa phản hồi* (không có nút sửa/xóa đánh giá của khách).
4. Delivery đã giao → *Gửi phản ánh*: chọn nhóm, nhập nội dung, thêm tối đa 5 ảnh → gửi; gửi lại vấn đề trùng sẽ báo đã bổ sung vào hồ sơ đang mở. Tài khoản → *Phản ánh của tôi*: Đang mở/Đã đóng.
5. 11Ship: một đánh giá về mình → *Phản ánh đánh giá*.
6. Tắt mạng rồi gửi: app báo mất kết nối, giữ nội dung; bật mạng bấm lại → chỉ một bản ghi.

Máy tính (Admin Web): 7. **Vận hành → Phản ánh**: tiếp nhận → phân công → ghi chú nội bộ → yêu cầu bổ sung (người gửi thấy "Đang chờ bạn" trên điện thoại) → kết luận → đóng; điện thoại hiện nút *Yêu cầu xem xét lại* trong 7 ngày, Admin mở lại/từ chối có lý do. 8. **Vận hành → Đánh giá**: ẩn một đánh giá có lý do → điểm trang quán giảm; khôi phục → điểm trở lại. 9. Điều chỉnh kết quả giao (có lịch sử); điều chỉnh hoa hồng: Admin không có quyền tiền không thấy nút; có quyền tiền → "Chờ xử lý tài chính" vì cổng M04 chưa nối.

**Chưa thử được cho tới khi có M10:** khách đánh giá quán/shipper, khách gửi phản ánh.

## 7. Bằng chứng

Điền ở PR theo mã commit cuối: kết quả CI từng job (backend, Admin Web, Mobile APK), liên kết APK/artifact do workflow tạo. Thiết bị thật: **chưa thử**.
