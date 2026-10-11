# Quy trình triển khai và quyền hạn 11Ship
Ngày chốt: 09/10/2026. Nguồn: chỉ đạo trực tiếp của Owner trong phiên này.
Áp dụng cho mọi module, task con và ứng dụng. Bổ sung quy trình, không thay đổi nghiệp vụ/schema/API đã chốt.

## Phân công bắt buộc
| Giai đoạn | Người thực hiện | Đầu ra | Người duyệt / điều kiện chuyển |
|---|---|---|---|
| Kiểm kê, thiết kế nghiệp vụ | ChatGPT | Nguồn đã đọc, phạm vi, quy tắc, API/dữ liệu, ca lỗi, phần còn thiếu | Owner duyệt nghiệp vụ |
| Thiết kế UI chi tiết | ChatGPT | Ảnh từng màn hình, trạng thái, luồng và nội dung tiếng Việt; mẫu HTML khi cần | Owner duyệt UI trước code UI |
| Giao task | ChatGPT | Gói giao Claude: base, phạm vi, file, hợp đồng, checklist, bằng chứng yêu cầu | Đúng thiết kế đã duyệt |
| Code và test kỹ thuật | Claude | Code, migration, build, test, CI, hướng dẫn chạy, bằng chứng đúng SHA | ChatGPT review; Claude sửa finding |
| Review và tích hợp | ChatGPT | Finding và kết luận đúng head SHA; kiểm tra từng app và liên thông | Review đạt trước bản Owner test |
| Test local và chỉnh sửa | Owner test; ChatGPT phân tích; Claude sửa code | Bản chạy local, phản hồi và bằng chứng kiểm tra lại | Owner xác nhận local đạt |
| Triển khai bản test điện thoại | Claude chuẩn bị/build; người vận hành triển khai theo phạm vi được duyệt | Web test, APK, version/SHA, cấu hình môi trường | Local đạt và review bản hiện tại đạt |
| Test thiết bị thật | Owner | Kết quả từng app và liên thông, lỗi thiết bị/mạng/quyền hệ điều hành | Owner xác nhận đạt |
| Nghiệm thu, merge, đóng module | Owner quyết định; ChatGPT cập nhật tài liệu theo quyết định | Bằng chứng, phạm vi nghiệm thu, quyết định đóng | Đủ các gate áp dụng; không suy diễn từ CI/merge |

## Giới hạn vai trò
- ChatGPT được sửa tài liệu thiết kế, kế hoạch, checklist, gói giao việc và evidence dựa trên sự thật; đọc code, chạy kiểm tra để review. Mẫu UI phục vụ duyệt thiết kế không phải code sản phẩm.
- ChatGPT không tự viết/sửa code sản phẩm, test triển khai, migration, cấu hình build/deploy hoặc tự build triển khai thay Claude. Finding phải giao Claude sửa.
- Claude không tự đổi nghiệp vụ, UI đã duyệt hoặc mở rộng phạm vi; gặp thiếu thiết kế thì trả về ChatGPT/Owner.
- Không tự merge, bật auto-merge, đóng module hoặc ghi Owner đã nghiệm thu. Quyền đó thuộc Owner.
- Chỉ đạo rõ ràng mới của Owner có thể cho ngoại lệ cụ thể; ghi phạm vi và nguồn cho task đó, không lan ngoại lệ sang task/module khác. Các lời “tiếp”, “triển khai” trong quy trình này không tự chuyển quyền code từ Claude sang ChatGPT.
- Task cũ hoặc câu “task ưu tiên cao nhất” không được dùng để bỏ qua giới hạn vai trò và gate nghiệm thu mới này. Giữ nguyên bằng chứng lịch sử, không viết lại thành nghiệm thu mới.

## Môi trường test local bắt buộc
M00 phải có task thiết kế và gói giao Claude cho môi trường Owner test: backend + DB local, web quản trị và cách kiểm tra app Khách/Quán/Xế trên máy tính; app quản lý khi tới phạm vi đó.
Yêu cầu hỗ trợ cập nhật nhanh trong vòng sửa UI/nghiệp vụ, dữ liệu thử ổn định và hướng dẫn khởi động dễ dùng. Công nghệ cụ thể phải đối chiếu code hiện có trước khi chốt.
Bản xem trên trình duyệt không thay thế kiểm tra runtime Android. Ghi rõ phương thức local (web dùng chung mã nguồn hay giả lập Android), phần tương đương và giới hạn; không gọi ảnh/mock là test nghiệp vụ.
Tách DB Owner test khỏi DB integration có thể bị reset. Không chạy suite phá dữ liệu vào DB Owner test/staging.
Không cần cài lại APK sau mọi chỉnh sửa local; vẫn phải build/cài lại khi thay đổi native yêu cầu và ở vòng nghiệm thu điện thoại.

## Gate cho từng app và liên thông
Mỗi giai đoạn phải chỉ rõ ứng dụng liên quan: web quản trị, Khách, Quán, Xế, app quản lý.
Ghi riêng thiết kế/UI/code/CI/review/local/thiết bị thật/nghiệm thu cho từng app. Một app đạt không kéo cả bước đạt.
N/A phải có lý do và được Owner duyệt; backend-only có thể không có màn hình nhưng module nghiệp vụ vẫn cần các task UI và nghiệm thu liên quan.
Nếu local hoặc thiết bị thật có lỗi: ChatGPT phân tích/thiết kế điều chỉnh, Claude sửa/test, ChatGPT review head mới, Owner test lại. Thay đổi nghiệp vụ/UI cần Owner duyệt lại trước code.
Bằng chứng phải ghi version/head SHA, môi trường, ca test, kết quả, người test, ngày và link quyết định Owner. Sửa code sau nghiệm thu phải xác định phạm vi test lại; nghiệm thu SHA cũ không mặc nhiên áp dụng.

## Trạng thái và dashboard
Phân biệt: đã thiết kế; Owner duyệt thiết kế; đã code; CI đạt; review đạt; local đạt; đã deploy bản test; thiết bị thật đạt; Owner nghiệm thu; module đóng.
Schema dashboard v1 hiện suy ra DONE từ task implementation đã merge + CI + dependency, chưa biểu diễn đủ các gate trên. DONE đó chỉ là trạng thái task kỹ thuật, không chứng minh module đóng.
Không sửa tay docs/PROGRESS.md, không thêm trạng thái/field không được parser hỗ trợ vào plan.yml. Claude triển khai mở rộng dashboard sau gói thiết kế riêng; trước đó dùng checklist gate trong module.
Không đánh dấu toàn M00/M01 hoàn thành vì backend đã merge; phần thiếu ghi CHƯA KIỂM CHỨNG hoặc CHƯA TRIỂN KHAI theo bằng chứng.

## Áp dụng vào tài liệu hiện có
Tất cả tài liệu docs/tasks đã được gắn phân công/gate. Module tương lai bắt buộc dùng [mẫu module](../templates/module-delivery-checklist.md).
M00: nền kỹ thuật, môi trường Owner test local, môi trường test từ xa và hướng dẫn vận hành là các đầu việc riêng.
M01: khung ứng dụng, tạo tài khoản/OTP/mật khẩu, login/quyền/phiên, khôi phục mật khẩu, onboarding, quản trị/2FA và hồi quy phải được đối chiếu backend thực tế; chưa có backend thì thiết kế/giao việc bổ sung, không dùng UI giả để đạt.
M02: backend hồ sơ/giờ hoạt động và các task UI/local/điện thoại liên quan phải tách rõ; backend-only slice không đóng toàn module.
PR #31 do ChatGPT triển khai trước chỉ đạo này cần review và Owner quyết định riêng; không coi là Claude thực hiện hoặc tự merge. Tài liệu này không thay đổi PR đó.

## Bổ sung Owner 11/10/2026 — merge từng gói nhỏ

Nguồn chỉ đạo trực tiếp 11/10/2026 10:59 Asia/Ho_Chi_Minh: “Mình muốn xong mỗi module nhỏ merge luôn vào main”. Áp dụng từ đây cho từng gói nhỏ; thay yêu cầu phải xin phép merge lại hoặc chờ nghiệm thu cả module trước tích hợp gói.

Claude triển khai gói riêng và tạo Draft PR; CI/checks phù hợp phải đạt đúng final SHA; ChatGPT review không còn blocker, kiểm tra dependency tương thích và trạng thái merge sạch, rồi được Owner ủy quyền merge gói vào main ngay, không hỏi lại cho từng gói. Không merge khi còn blocker, thiếu contract bắt buộc hoặc CI đỏ. Không bật auto-merge thay review.

Merge là tích hợp mã nguồn, không phải Owner đã test local/điện thoại, không tự đóng/LOCK module lớn. Các gate local, thiết bị thật và nghiệm thu vẫn ghi theo evidence thật và tiếp tục ở gói tương ứng. Không suy ra quyền deploy, apply migration remote hoặc sửa code sản phẩm thay Claude từ ủy quyền merge này.

Áp dụng đầu tiên: PR #53 M01.02, reviewed head a3521ad9109188d9d3c94ea8f793c6df5ea7cf6a, merge commit 88c3d3d39c96c78a79fa2823a7587eb216c81739. M01 chưa đóng; remote migration chưa được áp trong hành động merge.
