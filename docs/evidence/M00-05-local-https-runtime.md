# M00.05 — Build và HTTPS runtime cho ba entry PC: bằng chứng

- Base: `236172e6dbb698beef8151c19310075fc0d4b251` (main). Phụ thuộc: M00.04 `d5576816d01cbd49ff45dcbda5f4ac623cf7e375`. Gói thiết kế: PR #48 (head `f135f45…`).
- Nhánh: `feat/m00-05-local-https-runtime`. Final SHA và CI: ghi ở bình luận PR (SHA cuối chỉ biết sau khi push).

## Bản đồ trước khi sửa
Tái sử dụng: `scripts/client-web-build.mjs` (build + manifest), `scripts/admin-web-dev.mjs`/`admin-web-cert.mjs` (mẫu server/cert), launcher `tools/local/11ship-launcher.ps1` (khóa M00.02, registry/process/artifact M00.03, `AppCatalog`, `Open-AppLauncher`). Thêm mới: máy chủ chạy Food/Ship, kiểm tra chứng chỉ/probe, thuật toán fingerprint dùng chung, nối launcher.

## Yêu cầu → thay đổi → kiểm thử

| Yêu cầu | Thay đổi | Kiểm thử |
|---|---|---|
| HTTPS 8443/8444/8445 | `scripts/client-web-dev.mjs`, `food-web-dev.mjs`, `ship-web-dev.mjs` (8444/8445; Admin 8443 giữ `admin-web-dev.mjs`) | `tests/client-shell/runtime.test.mjs`, `tests/integration/client-runtime.int.spec.ts` |
| Build + manifest đúng artifact | `client-web-build.mjs` thêm `build_fingerprint`, `design_version`, ISO `built_at`; `scripts/lib/artifact-fingerprint.mjs` | runtime.test (thuật toán, giá trị ghim); PS pin cùng giá trị |
| `/__11ship/runtime` read-only, không secret | `client-web-dev.mjs` | runtime.test, int.spec |
| Proxy allowlist chỉ live/ready | `client-web-dev.mjs` (route chính xác, header dựng lại, hạn thời gian 4 s, giới hạn body) | runtime.test (405/404, upstream lỗi/timeout), M00.04 HealthMonitor qua front thật |
| Khóa/xác minh M00.02/M00.03 | Launcher: `Open-ClientApp*`, `Test-AppRuntime`, `Stop-AppTarget`, tổng quát hóa target | `launcher.Tests.ps1` mục M00.05 |
| Chứng chỉ một lần, không tự cài CA, không tắt TLS | `scripts/lib/local-tls.mjs`, `client-web-check.mjs`, runbook | runtime.test (7 lỗi chứng chỉ), static test cấm các cách tắt xác minh |
| Cổng lạ bị từ chối | Launcher `PORT_IN_USE`, server exit 5 | PS + runtime.test |
| Capability chỉ bật khi đủ | `AppLaunchSequence.Ready = $true`; Admin vẫn `APP_LAUNCH_PACKAGE_MISSING` (M00.08) | `launcher.test.mjs`, PS |

## Đã chạy ở đâu
- Local (cloud container, không có PowerShell): `node --test tests/client-shell/*.test.mjs` (29 test runtime PASS), `launcher.test.mjs` (static). Bộ PowerShell và integration **chưa chạy local** — chỉ có CI.
- CI: xem bình luận PR.
- Owner: **CHƯA CHẠY** (chạy trên máy Windows thật, cert thật, trình duyệt thật). Điện thoại: CHƯA CHẠY.

## Câu hỏi mở cho ChatGPT/Owner
1. Admin 8443 chưa mở qua launcher (cần M00.08).
2. Proxy trả 502/504 khi backend lỗi; client M00.04 hiển thị "phản hồi chưa đúng" thay vì offline.
3. Chứng chỉ dùng chung `.local/admin-web-tls`; Owner tự quyết định tin cậy.
4. Update không khởi động lại front đang chạy.
5. `design_version` cố định `2.0.1`.
