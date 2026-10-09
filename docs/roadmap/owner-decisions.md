# Quyết định cần Owner duyệt

Yêu cầu ngày 09/10 đã quyết định: staging Render/Supabase trước; nghiệm thu M01 mở M02; HTML/CSS ngay, Figma cuối; SMS thật cuối trước production. Không hỏi lại các quyết định này. PR roadmap giữ Draft để review các điểm dưới.

| ID | Vấn đề / nguồn | Đề xuất và gate ảnh hưởng |
|---|---|---|
| O01 | Scope/kế hoạch tổng thể chưa chốt | Duyệt coverage 13 module/121 task và cách giữ ID; chia thêm slice sau contract có thể đổi task count. Chỉ PR chốt sau đó mới roadmap_complete=true |
| O02 | Shop/Xế: yêu cầu 4 app, brand guideline mô tả chung app 11Ship | Giữ đủ 4 bề mặt chức năng + web; Owner chốt phân phối 2 package Shop/Xế hay app chung chọn role trước native packaging; không tự loại scope |
| O03 | FE0 #24 chưa khóa React/TS/Vite, memory token/reload và hosting same-origin | Duyệt contract thực thi app HTML/CSS. Token/retry/HTTPS phải rõ trước code FE0/hosting; frontend không truy cập Supabase DB trực tiếp |
| O04 | Chưa có read vùng active phục vụ onboarding M01 | Cho phép M02-AREA-READ prerequisite tối thiểu trước M01-UAT; quản lý vùng/M02 khác vẫn chờ. Không tự tạo ranh giới Cao Bằng |
| O05 | M03/M04 PR7 Draft không đủ physical schema/API | Review ADR004/case/lock ports; giữ draft status, viết contract từng slice rồi mới giao Claude. Không gọi bản copy đã locked |
| O06 | Nguồn memory quy định khách hủy trước confirm và quán tự bật/tắt; baseline/4.1 chọn không khách hủy, M02 #18/#21 không switch | Giữ hành vi đã merge, không tự thêm lại. Owner chốt quyền khách hủy và switch quán trước thiết kế M10/availability. Roadmap không giải quyết bằng suy đoán |
| O07 | Memory GPS 1p/retention7d/nhắc5-15-30; baseline đề xuất15/30s/30d, reminder/timeout khác | Giữ các giá trị là source conflict; chốt policy version trước M06/M08. Không hard-code proposal như rule đã khóa |
| O08 | Phí biên5km: memory ≤5km10k, baseline floor(5000/5000)15k | Chốt đúng rule4999/5000/9999/10000m và fee mode trước M06-A. Không coi giá hiển thị tròn km là nguồn |
| O09 | Một tài khoản1 thiết bị (memory) khác ADR002/code chỉ SHOP replacement, DRIVER không bị thu hồi cùng cách | Review policy từng role trong M01-B; nếu đổi cần contract/race/migration và regression. Không tự siết trong FE0 |
| O10 | Chưa có asset logo/font byte chuẩn trong repo; 3 ảnh đính kèm không tồn tại ở đường dẫn được cung cấp | Xác định nguồn asset đúng để đưa vào gói app; guideline màu/font đã LOCKED dùng ngay. Không nhận là đã inspect 3 ảnh hoặc tự vẽ logo |
| O11 | Provider SMS/map/push, polygon pilot, iOS/Android test, ngân hàng nhận nạp chưa có nguồn cấu hình được xác minh | Chuẩn bị sớm; chốt riêng trước slice dùng provider, tích hợp SMS thật cuối. Không đưa credential/SĐT/mật khẩu vào docs public |
| O12 | Release: RPO/RTO/load mục tiêu, topology dự phòng/ngân sách, test field và Owner release chưa có | Chốt trước M12-RESTORE/LOAD, thử số liệu thật; không cam kết HA/không mất dữ liệu. Không deploy trong PR này |

Các quyết định mở chặn slice liên quan, không chặn mọi thiết kế. UAT/comment Owner trên evidence PR không đồng nghĩa cấp quyền merge/deploy các PR khác. Không chỉnh PR7/14/20/23/24/26/27 trong PR roadmap; reconcile chúng trước merge triển khai tương ứng.
