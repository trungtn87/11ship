# M02-A-UI — Hồ sơ quán và lịch hoạt động

Trạng thái: DRAFT — chưa UI_LOCKED, chưa được phép implementation frontend.
UI_SCOPE: FIGMA_REQUIRED.
Backend đã merge PR #21 tại 6515bbbb78fe715b05ee3f25bf5680ce5df440cb.
Nguồn nghiệp vụ/API: docs/tasks/M02-A-shop-management.md và code đã merge.
Nhận diện: docs/current/11-brand-guideline-v1.0.md.
Kế hoạch/checklist song song: PR #20; workflow Figma: PR #14, đều chưa merge khi lập bản này.
Môi trường staging đang thiết kế riêng trong PR #22; tài liệu UI này không quyết định hạ tầng hoặc thay cơ chế OTP/Auth.

## 1. Phạm vi và gate

Web responsive dùng thử Windows/Android trong vai trò SHOP của 11Ship.
Chỉ xem/sửa hồ sơ và lịch tuần qua ba endpoint M02-A. Không menu, Order, gọi xế, dashboard doanh thu hoặc công tắc nhận đơn giả.
Frontend framework, session storage, route shell và API client phải theo ADR/frontend foundation M01 được duyệt; tài liệu này không tự chọn stack.
Có thể dựng Figma ngay. Chỉ code khi foundation M01 và frame/node/copy được Owner duyệt; bản chạy/E2E cần môi trường test có API thật.
Không coi thiết kế chung đã merge là đã duyệt từng frame.

## 2. Các màn cần dựng Figma

| ID | Màn | Nội dung và hành động |
|---|---|---|
| SHOP-PROFILE | Hồ sơ quán | Tên, trạng thái hồ sơ, trạng thái theo lịch, liên hệ, địa chỉ/GPS, khu vực; Sửa hồ sơ và Giờ hoạt động |
| SHOP-PROFILE-EDIT | Sửa hồ sơ | Tên, SĐT liên lạc, Zalo, Facebook, địa chỉ, tọa độ, khu vực; Lưu thay đổi |
| SHOP-HOURS | Lịch biểu hàng tuần | Cả tuần phía trên T2–CN, nhiều khoảng giờ, ngày đóng cửa; Lưu lịch |
| SHOP-HOURS-EDITOR | Chỉnh giờ | Giờ mở/đóng, ngày kết thúc, 24 giờ; thêm/xóa khoảng trong draft |
| SHOP-CONFLICT | Dữ liệu đã thay đổi | Giữ draft để xem; tải bản mới, xác nhận thay draft; không ghi đè âm thầm |

Bắt buộc variants: loading, load failure/retry, saving, validation, no schedule, outside hours, ONLINE, DISABLED read-only, session revoked/expired, version conflict.
INCOMPLETE chuyển tới onboarding M01 để hoàn tất; không gửi PUT M02-A.
Viewport QA: Android 360/390 px và desktop 1280 px; không tràn ngang. Form mobile một cột, vùng chạm tối thiểu 44 px.
Dùng nền #F2F1EE, card trắng, chữ #2A2A2E, CTA #D8AD18, Plus Jakarta Sans, radius card 16/input-button 12, spacing bội 4. Không lấy màu tím trong ảnh tham khảo thay brand đã khóa.

## 3. Trạng thái quán

Hiển thị trạng thái hồ sơ riêng với availability. ACTIVE không có nghĩa đang ONLINE.
Copy chính: “Đang trong giờ hoạt động” / “Ngoài giờ hoạt động”.
Mô tả: “Quán tự hoạt động theo lịch đã lưu. Bạn không cần bật/tắt mỗi ngày.”
Không có switch ONLINE/OFFLINE hoặc nút accepting-orders.

| reason API | Nội dung |
|---|---|
| ONLINE | Đang trong giờ hoạt động |
| OUTSIDE_BUSINESS_HOURS | Ngoài giờ hoạt động |
| NO_BUSINESS_HOURS | Chưa cài giờ hoạt động; CTA Cài giờ hoạt động |
| SERVICE_AREA_INACTIVE | Khu vực phục vụ hiện không hoạt động |
| SHOP_DISABLED | Quán đã bị vô hiệu hóa; hồ sơ chỉ đọc |
| SHOP_INCOMPLETE | Hồ sơ chưa hoàn tất; CTA Hoàn tất hồ sơ |

Availability là kết quả GET từ DB clock, không suy bằng đồng hồ thiết bị hoặc accepting_orders.
Đề xuất UI: GET khi vào màn, sau save, khi quay lại tab và mỗi 30 giây lúc màn hiển thị; không chạy request chồng nhau, dừng khi tab ẩn. Owner duyệt cadence trước khóa.
Khi mất mạng, giữ dữ liệu gần nhất kèm “Chưa cập nhật trạng thái”; không trình bày trạng thái cũ như hiện tại.
Không hứa chuyển đúng từng giây trên UI; backend xác định đúng biên. Không tự thêm thời gian mở tiếp theo chưa có contract.

## 4. Hồ sơ

SĐT liên lạc độc lập SĐT đăng nhập; nhãn phải rõ. Không có trường đổi SĐT đăng nhập ở màn này.
Zalo/Facebook tùy chọn; để trống gửi null. Tên, SĐT liên lạc, địa chỉ, GPS và khu vực theo validator backend hiện hành.
GPS: “Lấy vị trí hiện tại” do người dùng bấm; giữ tọa độ cũ nếu từ chối/timeout, không thay bằng 0,0. Chỉ chấp nhận tọa độ finite trong giới hạn backend. Hiển thị tọa độ để kiểm tra.
Địa chỉ nhập tay; không tự geocode hay thêm map provider chưa duyệt.
Nguồn danh sách khu vực ACTIVE chưa có API public được khóa trong slice này. Đây là dependency cần giải quyết trước implementation selector: không hard-code ID production hoặc lấy trực tiếp DB từ client. Figma dựng selector với dữ liệu mẫu và đánh dấu nguồn dữ liệu chưa khóa.

## 5. Lịch tuần và Cả tuần

Thứ tự: dòng “Cả tuần” rồi T2,T3,T4,T5,T6,T7,CN. Weekday API là 1..7.
Mỗi ngày thể hiện các khoảng, hoặc “Đóng cửa”. Không toggle nhận đơn; chọn đóng cửa chỉ sửa draft lịch ngày.
“Cả tuần” có danh sách khoảng mẫu và nút “Áp dụng cho cả tuần”. Bấm nút thay draft của cả bảy ngày bằng cùng danh sách khoảng. Nếu ghi đè draft đã sửa, xác nhận “Thay lịch của cả 7 ngày?”.
Không gửi API khi áp dụng. Người dùng vẫn sửa riêng từng ngày sau đó; một nút “Lưu lịch” gửi toàn bộ tuần.
Dòng Cả tuần không tạo weekday=0, không tạo field backend. Nếu lịch bảy ngày khác nhau, hiển thị “Lịch từng ngày khác nhau”; mẫu Cả tuần vẫn là công cụ nhập nhanh, không là lịch thứ tám.
Danh sách mẫu rỗng áp dụng thành đóng cả tuần, cần xác nhận rõ. Lưu [] cũng cần xác nhận “Quán sẽ đóng cửa cả tuần theo lịch này”.
Tối đa 28 khoảng cho toàn tuần, không tự giới hạn 4 khoảng/ngày. Áp dụng mẫu phải tính tổng số khoảng sau nhân bảy và kiểm overlap vòng tuần.
Không tự gộp khoảng liền kề; không tự bỏ trùng/overlap để làm request hợp lệ.

Giờ hiển thị HH:mm; khi end_day_offset=1 ghi “ngày hôm sau”. Múi giờ hiển thị “Giờ Việt Nam”.
00:00–24:00 dùng start=0,end=1440,offset=0. Ca 24h bắt đầu giờ khác dùng end=start,offset=1. UI phải cho chọn “24 giờ” rõ ràng, không diễn giải mọi start=end thành 24h.
Ca qua đêm là lịch gắn ngày bắt đầu; Chủ nhật sang thứ Hai vẫn được kiểm overlap. Ví dụ CN 22:00–02:00 (ngày hôm sau).
Đề xuất error inline: “Khoảng giờ bị trùng với lịch đã chọn”; chỉ rõ ngày/khoảng liên quan nếu validator client xác định được. Backend vẫn là nguồn kiểm cuối.

## 6. Save, version, retry và session

GET lấy baseline chung version cho profile/hours. Mỗi draft giữ version tại lúc mở editor.
PUT là full replacement đúng schema backend, kèm expected_version và canonical Idempotency-Key.
Một thao tác save tạo một key; timeout/lost response retry giữ cùng key và body. Thay body phải tạo thao tác/key mới. Không tự retry VERSION_CONFLICT bằng version mới.
Trong saving khóa submit và chỉnh payload đang gửi; chống double click. Sau success GET lại cấu hình/availability vì mutation response không chứa trạng thái theo thời gian.
VERSION_CONFLICT: thông báo “Dữ liệu đã được cập nhật ở nơi khác”; giữ draft, cho xem/tải dữ liệu mới. Chỉ thay draft sau xác nhận; không force save ngầm.
Revoked/expired: điều hướng theo foundation Auth, không tiết lộ payload stored result. Sau login lại, chỉ retry cùng logical body/key nếu request cũ còn được lưu an toàn theo ADR client; không tự thêm session_id vào identity.
SHOP_ROLE_REQUIRED quay router vai trò; SHOP_NOT_FOUND không hiển thị hồ sơ quán khác.
Lỗi mạng trước GET thành công không dùng draft rỗng để ghi đè lịch server. Lỗi save giữ draft.
Rời màn có draft khác baseline: xác nhận “Bỏ thay đổi chưa lưu?”. Không lưu draft chứa thông tin liên hệ xuống persistent storage nếu ADR chưa duyệt.
Toast sau PUT thành công: “Đã lưu hồ sơ” hoặc “Đã lưu lịch hoạt động”.

## 7. Checklist bàn giao

- [ ] Đối chiếu payload/error mapping với code trên SHA triển khai.
- [ ] Khóa frontend foundation M01 và nguồn dữ liệu khu vực.
- [ ] Dựng Figma frames/variants/components, ghi URL + node/version.
- [ ] Owner duyệt copy, Cả tuần, editor 24h/qua đêm và refresh cadence.
- [ ] Ghi UI_LOCKED vào evidence; chỉ sau đó giao Claude implementation.
- [ ] Visual QA Android/desktop, keyboard/focus/label/error, màu trạng thái kèm chữ.
- [ ] E2E API/DB thật: roundtrip profile; Cả tuần rồi sửa riêng; đóng cả tuần; overnight/Sunday wrap; overlap/28; retry/double click/version conflict; replacement session.
- [ ] Kiểm availability tại biên bằng test time giới hạn trong test harness, không endpoint đổi clock production.
- [ ] UAT Android thật: GPS cho phép/từ chối, lịch gần giờ thực, rời/mở lại app vẫn tính theo lịch; ghi SHA/thiết bị và Owner acceptance.
- [ ] Chưa có UI/runtime không được đánh dấu E2E/UAT DONE.

## 8. Việc tiếp theo song song

M02-A-UI có thể dựng Figma trong lúc M00 môi trường test và M01 UI foundation hoàn thiện.
Thiết kế backend menu M02-B là gói riêng sau khi đọc contract/schema hiện hành; không tự code menu từ checklist này.
