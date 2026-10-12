# M00.06 — Khung 11Food chạy thử trên PC: bằng chứng

- Base: `main` `0a375cbb488fb59cf778ce20f10658a9f7b5889c` (M00.04 và M00.05 đã merge). Gói thiết kế: PR #48 (head `f135f45`, `claude-tasks/M00.06.md`, catalog §3). Nhánh `feat/m00-06-food-shell-pc`. Final SHA và CI: ghi ở mô tả Draft PR.
- Bản PC chỉ là runtime thử; **chưa thay thế Flutter/Android**.

## Kiểm kê (đã có → không làm lại)
| Yêu cầu | Trên main | Việc làm |
|---|---|---|
| Trang chủ / Đơn hàng / Tài khoản khách, bốn tab, Back, deep-link, F5 | Đã có (router, SPA fallback ở runtime PC, M00.04/05) | Chỉ thêm test trình duyệt xác nhận |
| Diagnostics (F05), offline (F06), health + `/__11ship/runtime` | Đã có (M00.04/05) | Không đổi |
| Tìm kiếm (F02) giữ nội dung | **Thiếu**: ô `readOnly`, không gõ được | Sửa: gõ/xóa, giữ chữ + Món/Quán trong bộ nhớ trang (không URL/storage/không gửi đi), "Về trang chủ", Enter không làm gì, không kết quả giả |
| "Quản lý cửa hàng" trong Tài khoản (F07) | **Thiếu** ở bản khách | Thêm dòng khóa, nêu lý do ("Cần đăng nhập. Chưa nối máy chủ: đăng nhập đang chờ backend (M01.04)"); không role/cửa hàng giả |

Không thêm đăng ký/login/OTP, giỏ hàng, đặt đơn, hồ sơ quán; nhận diện và bố cục giữ nguyên.

## Đã chạy (cục bộ, Chromium headless)
- `tests/client-shell/food-shell-browser.test.mjs` (mới): 6/6 đạt — bốn tab + Back/Forward, deep-link và tải lại từng màn, đường dẫn lạ về trang chủ, `/shop/home` khi khách về `/login`; tìm kiếm giữ chữ qua tab và Back, không request nghiệp vụ, chữ gõ không bị gửi đi; dòng Quản lý cửa hàng không bấm được; 360/390/430 không tràn ngang, mọi điều khiển ≥44px.
- Test hồi quy bắt được lỗi cũ: gỡ bản sửa `screens.ts` → ca tìm kiếm và ca Quản lý cửa hàng ĐỎ; có bản sửa → xanh (chạy cục bộ, không có commit đỏ).
- `shell.test.mjs` và `connection-browser.test.mjs` (flow Food tài khoản → chẩn đoán, tab order, vùng chạm) đạt 35/35 khi hook dọn dẹp không gặp race.
- Giới hạn: máy này không cài được npm (registry chặn) nên dùng TypeScript 6.0.2 có sẵn thay vì bản ghim 5.9.3; lint/typecheck ghim/PowerShell/integration chỉ có ở CI.
- Lưu ý: hook `after()` của `connection-browser.test.mjs` thỉnh thoảng báo `ENOTEMPTY` khi xóa thư mục profile Chrome (cùng code: 1 lần đạt, 1 lần lỗi; main cũng có thể gặp). Không sửa trong gói này; retry job nếu gặp ở CI.
- Owner (Windows thật, trình duyệt thật): **CHƯA CHẠY**. Điện thoại: **CHƯA CHẠY**.

## Ảnh (11Food bản thật, khách)
[Trang chủ 390](M00-06/img/food-390-home.jpg) · [Tìm kiếm đã gõ 390](M00-06/img/food-390-search-typed.jpg) · [Đơn hàng 390](M00-06/img/food-390-orders.jpg) · [Tài khoản khách 390](M00-06/img/food-390-account-guest.jpg) · [Tìm kiếm 360](M00-06/img/food-360-search.jpg) · [Tài khoản 430](M00-06/img/food-430-account.jpg)

## Cách mở
Chạy `tools/local/11Ship-Update.cmd` rồi `tools/local/11Ship-Food.cmd` (build, mở `https://localhost:8444`); Food chưa tự cập nhật Git. Lần đầu cần chứng chỉ theo `ops/runbooks/local-https-runtime.md` (Owner tự quyết tin cậy).
