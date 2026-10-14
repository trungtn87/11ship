# M02 UI v3 — chốt tạm để triển khai

Owner quyết định ngày 14/10/2026, 15:06 (Asia/Ho_Chi_Minh): “chốt tạm ui và merge vào main. chờ triển khai xong m02 rồi tinh chỉnh lại sau”.

Trạng thái: **UI_PROVISIONALLY_APPROVED**. Đây là mốc thiết kế để Claude triển khai; không phải UI đã hoàn thiện, app đã nghiệm thu hoặc M02 đã đóng.

## Nguồn và phạm vi
- Nguồn: ZIP Owner gửi “11Ship M02 UI module design(2).zip”, chỉ lấy thư mục 11Ship-M02-UI-v3. Giữ nguyên HTML/DC và support.js; assets giống byte với docs/brand/originals.
- [M02 Design.dc.html](M02%20Design.dc.html): catalog màn, trạng thái và prototype.
- [Phone.dc.html](Phone.dc.html): tham chiếu UI app điện thoại.
- [WebView.dc.html](WebView.dc.html): chỉ D01/D02 web Admin thuộc phạm vi. Mã Food web cũ còn trong file nguồn không phải yêu cầu triển khai.
- 11Food (khách + chủ quán) và 11Ship (xế) **chỉ chạy app điện thoại**, không làm web Food/Ship. M02 bổ sung quán/thực đơn trong Food; Ship không có màn M02 mới.
- HTML/DC là định dạng thiết kế, chuyển thành Flutter trên nền M01 hiện hữu; không dùng nó làm WebView sản phẩm.
- [Đặc tả chức năng](../../../tasks/M02-functional-spec-20261014.md) và [kế hoạch theo luồng](../../../current/M02-workstreams-20261014.md).

## Kết quả review và phần còn mở
- Đã đối chiếu chức năng/màn và logic prototype; nhập phút lẻ và giữ giờ sai đã đạt ở v3. Các trạng thái load failure, saving, danh mục và vùng chạm đã bổ sung.
- **Không sao chép lỗi pending từ prototype vào app:** sau kết quả lưu chưa xác định, retry bị mất mạng vẫn phải giữ snapshot/key của thao tác cũ. Prototype v3 hiện xóa P.pend sớm ở finish(), mở ghi mới khi retry lỗi mạng. Chuyển yêu cầu sửa này sang implementation Claude theo quyết định chốt tạm của Owner; không báo finding đã hết.
- Mất mạng/hết phiên không tự chứng minh mutation trước thất bại. Chỉ mở thao tác ghi mới khi kết quả được xác định rõ. Nếu cần đăng nhập lại, dùng đúng identity/context M01; không replay cho tài khoản khác.
- Visual QA 360/390px, bàn phím/footer và thiết bị thật chưa đạt bằng chứng. Xác minh khi dựng Flutter; tinh chỉnh sau khi M02 nối hoàn chỉnh theo Owner. Không yêu cầu thêm vòng thiết kế toàn bộ trước bắt đầu code.
- Dữ liệu/địa chỉ/GPS/ảnh mẫu là minh họa; app dùng API thật. Không đưa chú thích thiết kế hoặc banner test/thử nghiệm vào UI sản phẩm.

Không sửa workflow, migration, APK, backend hoặc dashboard trong gói này. Merge tài liệu không cho phép tự deploy/migrate remote và không đóng M02.

