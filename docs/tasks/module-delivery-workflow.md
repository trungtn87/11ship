# Quy trình triển khai module — nghiệp vụ đến bản dùng thử
Ngày 08/10/2026. DRAFT trong PR #20; thay thế kế hoạch R01 trước đó. Chỉ sửa kế hoạch, checklist, dashboard và test của kế hoạch; chưa triển khai tính năng ứng dụng.

## Các bước bắt buộc của từng gói
| Bước | Người làm | Đầu ra / điều kiện kết thúc |
|---|---|---|
| 1. Nghiệp vụ | ChatGPT + Owner | Actor, luồng chính/lỗi, quy tắc, phạm vi loại trừ, quyết định còn mở; Owner duyệt |
| 2. Thiết kế backend | ChatGPT | Schema/migration, API, ownership, quyền/session, transaction/replay, acceptance; design PR được khóa |
| 3. Thiết kế UI | ChatGPT/Figma + Owner | Luồng màn hình, nội dung tiếng Việt, trạng thái lỗi/loading/empty, frame/node được Owner duyệt; UI_SCOPE=NONE phải có lý do |
| 4. Backend | Claude | Implementation + unit/PG integration/concurrency/fault/migration tests; CI đúng SHA; ChatGPT audit; Owner merge |
| 5. UI chạy thật | Claude | Frame đã khóa được nối API thật; visual QA; xử lý lỗi/session; bản chạy có SHA |
| 6. E2E | Claude; ChatGPT review | Trình duyệt → API → DB thật trên môi trường test; regression; evidence và hạn chế thật/giả |
| 7. Owner UAT | Owner thao tác; Claude sửa | Dùng trên thiết bị thật; ghi lỗi, retest và xác nhận đúng bản chạy |
| 8. Khóa gói | Owner | Nghiệp vụ/backend/UI/test/UAT đạt trong phạm vi; việc hoãn có task riêng |

Unit/integration là phần bắt buộc của từng PR backend, không đợi UI mới test. E2E và UAT là các bàn giao riêng. Task backend DONE không đồng nghĩa module hoàn thành. Thiết kế UI chạy đồng thời với backend sau khi luồng nghiệp vụ/API đủ ổn định; frontend chỉ code sau UI_LOCKED. Thay API ảnh hưởng UI phải cập nhật contract và checklist liên quan.

## Lịch song song
| Đợt | Luồng backend kế tiếp | Luồng đưa sản phẩm vào test |
|---|---|---|
| Hiện tại | Audit/chốt M02-A (#18) trên nền M01-R1 đã merge | M00-LOCAL; khóa UI M01 (#14); chuẩn bị test M01 |
| Sau khi M02-A khóa | Claude code M02-A-BE; thiết kế menu M02-B | M01-UI-AUTH → M01-UI-ONBOARD → M01-E2E → M01-UAT |
| Sau backend M02-A | Chốt backend menu khi có spec; thiết kế gói tiếp theo theo dependency | M02-A-UI → E2E → UAT; M01-B/C/D lên thiết kế theo ưu tiên |
| Sau backend menu | Thiết kế Driver/Wallet theo ADR đã khóa | M02-B-UI → E2E → UAT |

M02-A-BE phụ thuộc M01-R1 và design M02-A, không chờ toàn bộ M01-UAT/B/C/D. Lỗi UAT cũ ảnh hưởng dependency dùng chung phải xử lý trước phần code bị ảnh hưởng. Không tự bắt các luồng độc lập chờ nhau.
UI có thể thiết kế khi runtime chưa xong; depends_on trong manifest là gate bàn giao implementation. Owner duyệt Figma được ghi trong evidence/design, không suy từ một design PR chung đã merge.

## Checklist và phạm vi
- [M00: local và vận hành](M00-delivery-checklist.md)
- [M01: Auth/onboarding và các gói còn thiếu](M01-delivery-checklist.md)
- [M02: hồ sơ/lịch hoạt động và menu](M02-delivery-checklist.md)
- [Dashboard sinh từ GitHub](../PROGRESS.md)

Mỗi checklist là danh sách acceptance, không phải status tự động. Dấu đã làm cho lịch sử backend dựa PR đã merge; các mục chưa có evidence để trống. Dashboard theo task/PR/CI, không đếm số dấu tick trong markdown.

## Cách dashboard ghi nhận
Giữ nguyên 9 leaf backend/sửa lỗi lịch sử. Thêm 33 leaf local/vận hành/UI/test/UAT/backend thiếu: tổng 42 leaf cho phạm vi M00–M02 hiện đã lập kế hoạch. Trọng số đều 1 là số gói bàn giao, không phải thời gian/công sức. roadmap_complete=false: chưa phải toàn bộ dự án, không được dùng 100% một slice để tuyên bố full M01/production.
Group thể hiện thiết kế nghiệp vụ/backend và roll-up; leaf có tên rõ Backend / UI / E2E / Owner UAT. M00-LOCAL là môi trường dùng lại cho mọi module, không đặt ở M01 hoặc R01 nữa.
Pins: #20 thiết kế M00-LOCAL; #14 thiết kế group M01-UI; #18 thiết kế group M02-A. Các gói chưa có thiết kế giữ PLANNED; thêm PR thiết kế thật trước khi code, không gán #20 cho mọi task để giả vờ đã đủ spec.
Evidence paths cho task tương lai là đầu ra yêu cầu, có thể chưa tồn tại. Không tạo evidence trống để làm bằng chứng đạt.
Schema v1 cố định owner_role=CLAUDE: với UAT, đó là người chuẩn bị bản thử/hướng dẫn/sửa lỗi; Owner là người chấp nhận. CI không chứng minh Owner đã test. PR evidence UAT chỉ được merge sau xác nhận Owner có SHA, thiết bị và kết quả; không dùng combined flag cho các gói mới.

## Mẫu checklist dùng cho mọi module sau M02
- [ ] Phạm vi và nghiệp vụ được Owner duyệt; liệt kê điểm còn mở.
- [ ] Data/API/quyền/transaction/replay và acceptance đã khóa.
- [ ] UI_SCOPE và frame/node UI_LOCKED, hoặc NONE có lý do.
- [ ] Backend + test tự động + migration + audit + CI đúng SHA.
- [ ] UI nối API thật + visual QA + lỗi/loading/empty/session.
- [ ] Bản chạy local có seed, hướng dẫn và SHA.
- [ ] E2E và regression trên DB thật.
- [ ] Owner test thiết bị thật, xử lý lỗi và xác nhận.
- [ ] Cập nhật evidence/dashboard; ghi rõ việc hoãn và dependency.

M03 Driver, M04 Wallet và các module Order/Delivery/Notifications/Admin/Customer về sau dùng cùng mẫu. Phải đọc lại spec/ADR hiện hành để chia slice trước khi thêm implementation task; kế hoạch này không khóa các quy tắc tài chính chưa duyệt. PLATFORM/EXTERNAL là loại xế, không phải quyền Auth; không khôi phục vùng hoạt động xế.

## Giao việc ngay sau khi khóa kế hoạch
ChatGPT hoàn thiện contract M00-LOCAL và frame M01 song song audit M02-A; các quyết định nền còn mở được ghi trong checklist. Claude triển khai từng leaf đã đủ spec, PR riêng, không sửa schema/resolver progress chỉ để bỏ gate. Không mua host/SMS hoặc mở dịch vụ production trong gói kế hoạch.
