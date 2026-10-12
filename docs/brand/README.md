# Tài nguyên thương hiệu (logo, icon)

Nguồn gốc: 5 ảnh Owner đã duyệt ngày 12/10/2026, đặt nguyên vẹn (không sửa pixel) ở `originals/`:
`logo-11.png`, `logo-11food.png`, `logo-11ship.png`, `icon-11food.png`, `icon-11ship.png`. Mọi file khác chỉ là **cắt vùng trong suốt, thu nhỏ hoặc đặt lên canvas**,
sinh bằng `python3 tools/brand/build-brand-assets.py` (cần Pillow, numpy). Kết quả được commit; `brand-assets.json` ghi sha256 của file gốc/file sinh ra và số đo alpha.
Test: `tests/client-shell/brand-assets.test.mjs` (chạy trong `npm run client-shell:test`).

## Alpha của logo (đo trên file gốc)

| File | Kích thước | Nền | Mực |
|---|---|---|---|
| logo-11 | 1254×1254 | trong suốt thật (4 góc alpha 0, ~75% điểm ảnh trong suốt) | alpha trung vị 254 |
| logo-11food | 1983×793 | trong suốt thật (~78%) | alpha trung vị 254 |
| logo-11ship | 1774×887 | trong suốt thật (~79%) | alpha trung vị 253 |

Mực hầu như đặc (alpha 240–254 là viền khử răng cưa và độ đặc ~99%); có một ít điểm mờ alpha 1–15 nằm ngoài vùng nhìn thấy, bị bỏ khi cắt. Logo là bản **Primary** (mực đen, swoosh vàng):
chỉ đặt trên nền trắng/sáng. Trên nền tối (thanh bên admin) logo nằm trong ô nền sáng; không có bản reverse riêng ngoài `icon-11ship` (đã là nền xám than).

## Nơi dùng

| Nơi | File |
|---|---|
| Web 11Food/11Ship (bản xem trên PC) | `apps/client-shared/public/brand/logo-11food-ui.png`, `logo-11ship-ui.png` |
| Bản PC admin | `apps/admin-web/public/logo-11-ui.png` (ở thư mục gốc vì server chỉ phục vụ PNG ở gốc theo allowlist) |
| Flutter | `mobile/packages/n11_shared/assets/brand/` (bản sao giống hệt bản web, có test) |
| Android launcher + splash | `mobile/food/android_overlay/res/`, `mobile/ship/android_overlay/res/` (adaptive icon: logo nằm trong vùng an toàn của mặt nạ tròn/bo góc) |
