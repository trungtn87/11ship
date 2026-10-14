# M02 — đầu mối triển khai theo luồng

Owner chốt phạm vi/nghiệp vụ ngày 14/10/2026 09:57; quyết định UI tạm và merge ngày 14/10/2026 15:06 (Asia/Ho_Chi_Minh).

Đọc [UI v3 đã chốt tạm](../ui/m02/v3/README.md) và [đặc tả chức năng](../tasks/M02-functional-spec-20261014.md) theo đúng luồng được giao. Không đọc lại toàn kho hoặc xây lại phần có sẵn.

## Nguồn ưu tiên và phạm vi
Quyết định Owner hiện tại ưu tiên tài liệu cũ: quán nằm trong app Food; quán tự mở/đóng theo lịch, không công tắc; Food/Ship chỉ app điện thoại, Admin giữ web riêng. Không phát triển thêm web Food/Ship hoặc xóa code web cũ ngoài phạm vi task.
Giữ bộ UI v3 để triển khai, tinh chỉnh sau khi M02 nối xong. Không gọi đây là nghiệm thu runtime hoặc M02 LOCK.
Menu/schema/catalog/storage cần đối chiếu hiện trạng một lần và khóa phần còn thiếu trước code phần tương ứng; UI chốt tạm không tự khóa các endpoint/schema đề xuất trong đặc tả.

| Luồng | Phần việc | Tái sử dụng / điều kiện |
|---|---|---|
| M02-QUAN | Q01/Q02 quản lý quán ACTIVE và trạng thái; hồ sơ thiếu dùng M01 | Backend M02-A PR #21 đã merge; shop-management controller/service; onboarding/context M01; Flutter Food/shared hiện có |
| M02-GIO | Q03/Q04 lịch Cả tuần, từng ngày, phút lẻ, qua đêm, 24h, lưu/version/retry | Dùng API profile/hours/availability đã có; không dựng lại schema hay primitive M00 |
| M02-MON | Q05/Q06 thêm/sửa món/ảnh/nhóm, hiện/ẩn/xóa mềm | Đối chiếu menu/catalog/storage, khóa contract chưa có rồi bổ sung; dùng auth/transaction/idempotency hiện hữu |
| M02-XEM | Q07/K01/K02 preview và khách xem quán/menu/lịch | Dữ liệu đã lưu, public fields hợp lệ; không đơn/giỏ hàng/tìm quán công khai |
| M02-ADMIN | D01/D02 danh mục tối thiểu nếu cần | Reuse catalog/Admin capabilities có sẵn; không mặc định cấp quyền mới |
| M02-FINAL | Một review toàn M02 sau nối hoàn chỉnh; sửa delta, tinh chỉnh UI, bản chạy | Kiểm phần ảnh hưởng, reuse CI/bằng chứng lịch; Owner test điện thoại và quyết định đóng |

Thứ tự QUAN → GIO → MON → XEM → FINAL; Admin/catalog phục vụ dependency menu khi cần. Không tạo PR cho từng màn; mỗi gói giao kết quả, base/head, đã có/còn thiếu, mục đọc và kiểm chạy được.

## Yêu cầu implementation không được bỏ
- Giữ pending snapshot và key sau timeout/retry lỗi mạng khi kết quả chưa rõ; prototype v3 còn lỗi mở khóa sớm, Claude phải sửa trong app thật. Không trì hoãn lỗi lưu trùng/mất dữ liệu đến vòng tinh chỉnh hình thức.
- Validate giờ chỉ báo lỗi, không tự đổi giờ; giữ chính xác từng phút và quy tắc 24:00/qua đêm đã chốt.
- Nối backend thật; loại sample quán/menu/GPS và chú thích prototype khỏi sản phẩm; UI không banner test/thử nghiệm.
- Dùng lại shared components và session M01, không thay signing/applicationId; APK cập nhật đè tăng versionCode.
- Visual/bàn phím 360/390px kiểm trong Flutter trước giao bản chạy; ghi rõ phần chưa kiểm. Không cần browser mock để nghiệm thu Android.

ChatGPT thiết kế/tài liệu/review; Claude code/test/migration/build; Owner nghiệm thu. Quy trình AGENTS.md và docs/process/11ship-delivery-workflow.md áp dụng. Không sửa tay PROGRESS.md, không suy module đóng từ merge docs.

