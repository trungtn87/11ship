# G-4 Vòng phụ thuộc

**SHA khảo sát:** `549572696efb4bbc18af3c362b7f56a5fcd335e6` (`main`, merge PR #298) · **Graphify:** graphifyy 0.9.100 · **Ngày:** 2026-11-02 · **Người lập:** Claude Lead (Executor Phase 2)

**Quy ước độ tin:** `ĐÃ MỞ SOURCE` = người lập đã đọc đoạn mã nêu (file:dòng). `CHỈ TỪ GRAPH` = chỉ thấy trong graph, chưa mở source, không được xếp vào finding. `HEURISTIC` = suy từ script đọc source nhưng chưa đọc từng dòng.


Phương pháp: Graphify (`imports`/`imports_from`) đối chiếu script `imports.py` (7.575 cạnh import tương đối đã resolve, 3 cạnh không resolve, đều là `require('./apps/backend/dist/...')` trong script test/deploy, không phải code sản phẩm); thuật toán Tarjan trên cạnh *runtime* (không tính `import type`, không tính `import()` động).

| Cấp | Số vòng | Trạng thái |
|---|---|---|
| Module NestJS (49 module, 205 cạnh import) | **0** | `HEURISTIC`; không có `forwardRef` (grep) |
| File TypeScript/JS (toàn repo) | 1 nhóm (9 file) | `ĐÃ MỞ SOURCE`: **chỉ là vòng kiểu (type-only), không tồn tại lúc chạy**, xem C-01 |
| File Dart (6 package Flutter) | 1 nhóm (5 file) | `ĐÃ MỞ SOURCE`: **vòng thật**, xem C-02 |
| Package Flutter (6 package) | 0 | `HEURISTIC` (đọc `package:` import); chưa kiểm `pubspec.yaml` |

## C-01 `apps/admin-web/src/core`: 9 file, ĐÃ XÁC NHẬN ở source nhưng KHÔNG phải vòng lúc chạy
File: `accounts.ts`, `deliveries.ts`, `finance-admin.ts`, `finance-ops.ts`, `finance.ts`, `menu.ts`, `routes.ts`, `shippers.ts`, `shops.ts`.
Các cạnh khép vòng: `accounts.ts:8 import { Grants } from './menu.js'` · `menu.ts:2 import { Route } from './routes.js'` · `deliveries.ts:6`, `finance-admin.ts:5`, `finance-ops.ts:6`, `finance.ts:13`, `shippers.ts:5`, `shops.ts:6` đều `import { Failure } from './accounts.js'`.
Đã mở: `Grants` là `export type` (`menu.ts:56`), `Route` là `export type` (`routes.ts:13`), `Failure` là `export type` (`accounts.ts:20`). `apps/admin-web/tsconfig.json` không bật `verbatimModuleSyntax` / `importsNotUsedAsValues` nên TypeScript xóa các import này khi biên dịch. Còn lại `routes.ts` import giá trị (`DELIVERY_GROUPS`, `TOPUP_TABS`…) từ các file kia nhưng **không file nào import giá trị ngược lại** `routes.ts`.
`Kết luận:` không phải finding. Ghi để Phase 3 không báo lại. **Chưa kiểm** trình đóng gói thực tế (nếu dùng bundler khác `tsc` thì cần xem lại): NOT TESTED.

## C-02 `mobile/packages/n11_shared/lib/src`: 5 file, ĐÃ XÁC NHẬN ở source, vòng thật
`shell.dart` → `m08/m08_views.dart` (`shell.dart:12`) → `account/account_views.dart` (`m08_views.dart:7`, dạng `show n11Route`) → `shell.dart` (`account_views.dart:10`).
Cạnh phụ: `account_views.dart` ⇄ `flows/reset_views.dart` (`reset_views.dart:5`, `account_views.dart:18`), `account_views.dart` ⇄ `flows/shop_views.dart` (`shop_views.dart:6`, `account_views.dart:16`), `m08_views.dart:9 → shell.dart` (citation đã sửa theo review Codex: `reset_views.dart:5`, `m08_views.dart:7`).
Dart cho phép import vòng giữa các thư viện, nên đây không phải lỗi biên dịch. Đáng ghi vì: (a) `shell.dart`, `account_views.dart` là hai file trung tâm của cả hai app, (b) một vòng như vậy làm mọi thay đổi ở `account_views.dart` (chứa màn đăng xuất, #295) kéo theo cả `shell`, `m08`, `reset`, `shop`. `Mức:` quan sát cấu trúc, **không** phải finding sai chức năng.
Ghi chú: ở `account_views.dart:16-19` file cũng import `m13_update`, `shop_controller`, `reset_controller`, tức là view biết cả controller của nhiều luồng.

## Không tìm thấy
- Không có vòng giữa các `*.module.ts` nên không cần ghi đường đi.
- Không kiểm vòng ở cấp package npm (repo không dùng workspaces, chỉ một `package.json` gốc).
