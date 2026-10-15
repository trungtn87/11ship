# M01 UI — bằng chứng chuỗi PR #56 → #57 → #58 → #61 (Draft, chỉ UI)

UI chưa phải kết quả nghiệp vụ; **M01 chưa đóng**. Chưa merge/deploy. Bộ ảnh tổng hợp bên dưới chụp từ mã tại `2ce81b6…` (trước vòng sửa F1–F3); riêng ảnh F1/F2 chụp từ mã sau sửa (xem mục "Vòng sửa review"). Commit tài liệu không đổi mã sản phẩm.

## Chuỗi PR

| PR | Base | Head | Final SHA (mã) |
|---|---|---|---|
| [#56](https://github.com/trungtn87/11ship/pull/56) nền UI | `main` | `feat/ui-m01-foundation` | `04629bc0a6352d6c238dc44711f19bc0dce27515` |
| [#57](https://github.com/trungtn87/11ship/pull/57) 11Food | `feat/ui-m01-foundation` | `feat/ui-m01-food` | `5e137fb1ecd94ac20ab5389360cb388fc9e53f59` |
| [#58](https://github.com/trungtn87/11ship/pull/58) 11Ship | `feat/ui-m01-food` | `feat/ui-m01-ship` | `e3a8d07e6c0ced5c4df3a6140ffbfcb44d73c797` |
| [#61](https://github.com/trungtn87/11ship/pull/61) Web quản trị | `feat/ui-m01-ship` | `feat/ui-m01-admin` | mã `32c9635ab0cfed4deb0d89b8dc5831aa1357ee01` |

## Vòng sửa review (F1–F3)

| Finding | Sửa | Kiểm tra |
|---|---|---|
| **F1** (#61) thu gọn desktop làm drawer mobile hiện rail, không mở được "Danh sách / Đang khóa" | Tách hai chế độ: chế độ "thu gọn" chỉ áp dụng cho rail desktop (`compactSidebar(collapsed, drawerMode)`); ở ≤900 px menu luôn đầy đủ; vượt ngưỡng thì vẽ lại và đóng drawer; lựa chọn thu gọn được giữ khi quay về desktop. Bỏ các ghi đè CSS chết. | `admin-web:test` (2 test chế độ sidebar); test tích hợp CDP trên CI (`admin-web-browser`: thu gọn → 390 px → drawer hiện Danh sách/Đang khóa → bấm "Đang khóa" → quay lại 1280 px → rail trở lại); chạy Playwright cục bộ cả hai chiều desktop→phone và phone→desktop. Ảnh: [F1_sidebar_modes](img/F1_sidebar_modes.jpg) |
| **F2** (#56 → #57/#58/#61) thiếu C08 | `LeaveController` + `guardForm`: bấm Quay lại, đổi màn hình trong app, nút Back của trình duyệt và đóng/tải lại trang đều hỏi "Bỏ thay đổi?" khi đang nhập. "Ở lại" (hoặc Esc) giữ nguyên nội dung; "Thoát" xóa mật khẩu/OTP và kết thúc luồng trong bộ nhớ. Back của trình duyệt được hoàn tác đúng vị trí lịch sử trong lúc hỏi. Không lưu gì vào URL, localStorage, sessionStorage, cookie hay `history.state` (chỉ số vị trí). Áp dụng cho đăng nhập, đăng ký, OTP đăng ký/đặt lại, quên mật khẩu, đặt lại mật khẩu (cả hai app), hồ sơ cá nhân và hồ sơ cửa hàng (11Food), hồ sơ shipper (11Ship). Màn xem thiết kế **C08**. | `client-shell:test` (7 test C08 gồm: không hỏi khi chưa nhập, Ở lại giữ nội dung, Thoát xóa mật khẩu/OTP/flow, không mở hộp thứ hai, release khi thành công, không dùng storage); Playwright trên bản thật 11Ship (12 kiểm tra: hỏi khi Back trong app, hỏi khi bấm liên kết, hỏi khi Back trình duyệt và URL được giữ, Ở lại giữ nội dung, Thoát xóa trường mật khẩu, `beforeunload` chỉ hỏi khi đang nhập, không có gì trong URL/storage/cookie). Ảnh: [F2_C08_dirty_leave](img/F2_C08_dirty_leave.jpg) |
| **F3** (#61) test catalog nuốt lỗi import | Bỏ `catch`-và-`return`; import lỗi làm test FAIL; kiểm đủ mã D00–D09, D81, D86–D89, C01–C10 và D89 = `administrators`, nhóm Tài khoản | `admin-web:test` |

Lưu ý phạm vi: C08 chưa áp dụng cho form lời mời của Web quản trị (catalog ghi C08 cho Back/logout của app; Web quản trị dùng trang riêng) — nếu Owner muốn áp dụng, cần quyết định riêng.

## Cách mở bản thử

`Xem-Giao-Dien.cmd` (Windows) hoặc `npm run ui:preview`, rồi chọn Web quản trị / 11Food / 11Ship. Chế độ xem thiết kế luôn có nhãn "Dữ liệu minh họa", không tạo phiên, không gọi máy chủ. Bản thật: `npm run build:admin-web`, `npm run build:food-web`, `npm run build:ship-web`.

## Phạm vi và giới hạn của kiểm tra (đọc kỹ)

- **Kiểm tra UI/transport bằng API stub, KHÔNG phải hồi quy end-to-end với backend thật.** Bản build thật của Web quản trị được chạy trong trình duyệt với một máy chủ stub cục bộ (không nằm trong repo) trả các phản hồi `/v1/admin-auth/*`, `/v1/admin/invitations`. Đã đạt trên desktop 1440 px và điện thoại 390 px, cho SYSTEM và ADMIN: login → TOTP → khung quản trị → F5 giữ phiên → danh sách lời mời (SYSTEM) → trang Quản trị viên "chưa kết nối" → trang Người dùng (ADMIN bị chặn, SYSTEM "chưa kết nối") → đăng xuất bằng menu tài khoản → F5 ở lại màn login; không lỗi console.
- **Hồi quy với backend thật** do bộ test tích hợp trên CI thực hiện (`tests/integration/admin-web-*.int.spec.ts`, backend + PostgreSQL thật, trình duyệt thật). Trên SHA `2ce81b6…` CI mode 80 suite / 1300 test đạt; test `M01-D-LOGIN-UI` đã được cập nhật cho menu tài khoản mới và đạt.
- **Luồng kích hoạt đầy đủ (lời mời → SMS OTP → mật khẩu → TOTP) CHƯA được chạy lại thủ công ở phiên này.** Màn D07 không đổi mã; độ bao phủ hiện có là bộ test tích hợp CI nêu trên.
- Log thô của GitHub Actions bị proxy chặn (403); kết quả lấy từ trạng thái từng bước và chú thích của job trên đúng SHA.
- Lint/jest không chạy được cục bộ (npm registry bị chặn); dựa vào CI.

## Ảnh chụp (kèm mã màn)

Ảnh gộp, mỗi ô ghi mã màn_id. "Bản thật" = build thật (không có dữ liệu minh họa); "xem thiết kế" = preview.

| Ứng dụng | Ảnh |
|---|---|
| Web quản trị — bản thật, desktop (SYSTEM + ADMIN) | [admin_real_desktop](img/admin_real_desktop.jpg) |
| Web quản trị — bản thật, điện thoại | [admin_real_phone](img/admin_real_phone.jpg) |
| Web quản trị — xem thiết kế, desktop | [admin_design_desktop](img/admin_design_desktop.jpg) |
| Web quản trị — xem thiết kế, điện thoại | [admin_design_mobile](img/admin_design_mobile.jpg) |
| 11Food — bản thật, điện thoại / desktop | [food_real_mobile](img/food_real_mobile.jpg), [food_real_desktop](img/food_real_desktop.jpg) |
| 11Food — xem thiết kế, điện thoại | [food_design_mobile](img/food_design_mobile.jpg) |
| 11Ship — bản thật, điện thoại / desktop | [ship_real_mobile](img/ship_real_mobile.jpg), [ship_real_desktop](img/ship_real_desktop.jpg) |
| 11Ship — xem thiết kế, điện thoại | [ship_design_mobile](img/ship_design_mobile.jpg) |

Ảnh bản thật chụp ở trạng thái chưa đăng nhập (khách), nên các nút nghiệp vụ hiện khóa kèm lý do.

## Bảng đối chiếu màn hình

Trạng thái nối API: **Đã nối** = luồng và API đã có trong repo; **Chờ BE** = UI xong, nút khóa kèm lý do; **Thông tin** = chỉ hiển thị. Mã theo `docs/design/system-v2-20261011/03-ui-catalog.md` (PR #48), D89 vừa được thêm vào đó.

### Web quản trị

| Mã | Màn | Route | Trạng thái |
|---|---|---|---|
| D00 / D01 / D02 | Đăng nhập / TOTP / đăng ký Authenticator | `/` | Đã nối |
| D03 | Khung quản trị (sidebar 240/64, drawer, menu tài khoản) | sau đăng nhập | Menu theo quyền; **quyền ADMIN chờ BE** |
| D04 / D05 / D06 | Lời mời Admin: danh sách / tạo / chi tiết | `/invitations…` | Đã nối (SYSTEM) |
| D07 | Kích hoạt | `/activate` | Đã nối |
| D08 | Đặt lại mật khẩu ADMIN | `/reset` | Chờ BE (M01.16/.19) |
| D09 | Khôi phục SYSTEM | chỉ preview | Thông tin (M01.20) |
| D81 | Người dùng: danh sách / đang khóa | `/accounts/users[?status=LOCKED]` | Chờ BE (M01.30/.31) |
| D86 | Chi tiết người dùng | `/accounts/users/:id` | Chờ BE (M01.30) |
| D87 / D88 | Hộp khóa / mở khóa | trong D86 | Chờ BE (M01.32/.33) |
| D89 | Quản trị viên (SYSTEM-only) | `/accounts/administrators` | Chờ BE (chưa có hợp đồng API đọc) |
| C01–C10 | Trạng thái chung | trong các trang | UI |

### 11Food (id xem thiết kế → route thật)

| Mã | Màn | Route | Trạng thái |
|---|---|---|---|
| F00 | Chào mừng | `/welcome` | UI |
| F01 / F02 / F03 | Trang chủ / Tìm kiếm / Đơn hàng | `/` `/search` `/orders` | UI, trạng thái trống "Sắp có" |
| F04–F16 | Tài khoản (khách / chủ quán) | `/account` | Chờ BE (M01.04/.05) |
| F10 / F11 / F12 | Đăng nhập / Đăng ký / OTP | `/login` `/register` `/register/otp` | Chờ BE (M01.04 / M01.03) |
| F13 / F14 / F15 | Quên / OTP / đặt lại mật khẩu | `/reset…` | Chờ BE (M01.16) |
| F17 | Thông tin cá nhân | `/account/profile` | Chờ BE |
| F20 / F21 / F22 / F23 | Bán hàng / hồ sơ quán / vị trí lấy hàng (GPS tại chỗ) / cửa hàng của tôi | `/shop/*` | Chờ BE |

### 11Ship

| Mã | Màn | Route | Trạng thái |
|---|---|---|---|
| S00 | Chào mừng | `/welcome` | UI |
| S01 / S02 / S03 / S04 | Trang chủ / Đơn hàng / Thu nhập / Ví | `/` `/orders` `/income` `/wallet` | UI; "—" khi chưa có dữ liệu; nhận đơn, nạp/rút khóa |
| S05 / S14 | Tài khoản (khách / shipper) | `/account` | Chờ BE |
| S10 / S11 / S18 | Đăng nhập / Đăng ký / OTP | `/login` `/register` `/register/otp` | Chờ BE |
| S15 / S16 / S17 | Quên / OTP / đặt lại mật khẩu | `/reset…` | Chờ BE (M01.16) |
| S12 / S13 | Hồ sơ shipper / trạng thái hồ sơ | `/driver/onboarding` `/driver/status` | Chờ BE (M01.10) |
| S19 | Hộp đăng xuất | trong S14 | Chờ BE |

## Finding còn lại

1. **Logo gốc**: chưa có asset trong phiên; file Owner nêu (`1000002796.jpg`) không truy cập được từ phiên này. Giữ chữ "11" tạm; khi có file sẽ dùng làm nguồn logo hệ 11, không vẽ lại wordmark.
2. **Grants ADMIN**: backend chưa gửi → ADMIN thật chỉ thấy "Tổng quan"; nối sau (không mở rộng backend trong PR UI).
3. **D89**: chưa có ảnh duyệt riêng và chưa có hợp đồng API đọc.
4. Hồ sơ cá nhân trong menu tài khoản Web: "Sắp có"; đặt lại mật khẩu SYSTEM: khóa.
5. Luồng kích hoạt đầy đủ chưa chạy lại thủ công (xem trên).
