# M01-UI — Web UI chạy thử Auth/Onboarding: evidence

Status: **DRAFT — chờ Owner nghiệm thu M01. Chưa chạy với backend thật.** Không phải M01 DONE, không phải production. M02 chưa bắt đầu.

## Base / dependency

| Item | Value |
| --- | --- |
| main | `5ba378db163dbdd7895dce646345e0d06f3b4e4b` |
| Dependency PR #27 (M00-D2, **chưa merge**, draft) | head `c8b410e`, base `737e66a` — nhánh tích hợp có merge cục bộ commit `ec7f2e7`; **không tự merge #27** |
| PR #26 (đã xem) | head `fe235cc` |
| Branch | `feat/m01-ui-web` |

PR này chỉ nên merge sau khi #27 được merge; diff thật của UI chỉ gồm `apps/web`, `scripts/web-dev-server.mjs`, `tests/web`, README, package.json scripts, eslint block cho `apps/web`.

## Đã chạy thật

| Kiểm tra | Kết quả | Môi trường |
| --- | --- | --- |
| Unit `node --test tests/web/*.test.mjs` (core, API client, projection, validation, mutation, dev server, contract drift guards đọc source backend) | 50/50 pass | Node 22.22 |
| Trình duyệt Playwright/Chromium, desktop 1366 + phone 390, S01–S11 (login→router→onboarding SHOP/DRIVER, sai mật khẩu, lỗi API, session revoked/expired, reload, gửi lặp, mất phản hồi sau commit, stale response, tài khoản bị khóa, layout) | 14/14 pass | **stub API theo hợp đồng** (`tests/web/browser/stub-api.mjs`) — KHÔNG phải backend thật |
| ESLint (cấu hình tạm, `no-unused-vars`/`no-undef`) trên `apps/web`, `scripts/web-dev-server.mjs`, `tests/web` | sạch | eslint cài sẵn trong máy |

Stub chỉ dùng để chạy test tự động, không dùng để báo thành công trên staging. Tài khoản trong test là dữ liệu ngẫu nhiên tạo lúc chạy; không có mật khẩu fixture, credential operator hay allowlist trong repo/log (test kiểm tra token/mật khẩu không rò ra request/log/storage).

## Chưa chạy được (bị chặn)

- npm registry trả 403 → không `npm ci`: không chạy được backend thật, Jest, `npm run lint` chính thức, `tsc`, build. Cần CI/máy Owner. Luồng login → /me → onboarding với API thật **chưa chạy**.
- Node 24 không có trong máy kiểm thử (dùng 22.22).
- Font Plus Jakarta Sans: không tải được → đang dùng font hệ thống, `html[data-font]` báo fallback; hướng dẫn thêm woff2 ở `apps/web/assets/fonts/README.md`.
- Logo chính thức: chưa có asset → wordmark chữ tạm (`data-temp-wordmark`).
- Backend chưa có API liệt kê khu vực phục vụ/provisioning → hoàn tất Quán cần nhập tay "Mã khu vực phục vụ" do operator cấp (trường tạm, dùng đúng field API hiện có).
- Hosting staging (static + rewrite `/v1`, hoặc backend phục vụ bundle) là quyết định của Owner/M00; chưa deploy.
- CI chưa chạy test web (không sửa workflow trong PR này; đề xuất bước `npm run web:test`).
- `docs/progress/plan.yml` không sửa: lá M01-UI do PR #20 (draft) quản lý; PR này gắn label `agent:claude`, `type:implementation`; dashboard tự sinh, không sửa tay `docs/PROGRESS.md`.

## Quyết định cần Owner

1. Token chỉ trong bộ nhớ → reload về đăng nhập (an toàn hơn; đổi nếu muốn giữ phiên).
2. Trường tạm "Mã khu vực phục vụ".
3. Cách host UI trên staging.

## Không làm

Không merge, deploy, migrate hay seed Supabase thật; không tạo SMS bypass/đăng ký/OTP; không bắt đầu M02.
