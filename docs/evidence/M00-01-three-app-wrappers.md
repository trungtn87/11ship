# M00.01 — bằng chứng: ba wrapper Admin / Food / Ship

Ngày: 11/10/2026 (Asia/Ho_Chi_Minh). Người thực hiện: Claude. Thiết kế: M00 v2.1, Owner duyệt "Ok duyệt" lúc 20:27 ngày 11/10/2026 (gói M00.01 nằm trong phạm vi được duyệt). Trạng thái: **ĐÃ CODE; TEST KỸ THUẬT CỤC BỘ (PowerShell 7) PASS; CI/REVIEW/OWNER CHƯA CÓ; ỨNG DỤNG CHƯA MỞ ĐƯỢC (CHỦ ĐÍCH)**.

- Base khi bắt đầu: `main` = `2823d238432f4e94b3bdf58a66780ba5aad99185` (trùng snapshot thiết kế). Trước khi push, `main` đã tiến tới `624f69ffe98e453471ed0a64656b8a05a8cdfc4e` (PR #65 chỉ sửa `tests/integration/admin-web-hosted-browser.int.spec.ts` và các commit bot `docs/PROGRESS.md`; không trùng file nào của gói này). Nhánh được rebase lên SHA mới đó và test chạy lại trên kết quả; **base của PR = `624f69ffe98e453471ed0a64656b8a05a8cdfc4e`**.
- Final SHA và CI đúng final SHA: ghi trong mô tả Draft PR (một file trong PR không thể chứa SHA của chính commit chứa nó).
- Nguồn đã đối chiếu: issue #50, PR #48 (gói giao `claude-tasks/M00.01.md`), PR #46 (đóng, chỉ tham khảo; không kéo nhánh).

## Mapping trước khi sửa

| | Trên main |
|---|---|
| ĐÃ CÓ | Launcher nền `tools/local/11ship-launcher.ps1` + 6 wrapper; guard Git/DEV/TEST/redaction; quyết định pause khi double-click; bộ test hành vi + job CI PS7 và Windows PS5.1; `scripts/admin-web-dev.mjs` |
| THIẾU | 3 wrapper app; tham số app; test inventory 9 wrapper và hành vi từng wrapper; máy chủ chạy thật cho Food/Ship (chỉ có bản xem thử dữ liệu minh họa); khóa dùng chung (M00.02); định danh artifact/process (M00.03) |
| TÁI SỬ DỤNG | Toàn bộ launcher nền (`Fail` + mã lỗi, `Protect-Text`, `Get-PauseDecision`, ghi `last-run.json`) và khung test |

## Đã làm

- `tools/local/11Ship-{Admin,Food,Ship}.cmd`: cùng khuôn với wrapper hiện có (`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp011ship-launcher.ps1" -Command App -App <tên> %*`, giữ exit code, không `pause`). Launcher nằm cạnh wrapper nên repo xác định từ vị trí script, không từ thư mục gọi.
- `tools/local/11ship-launcher.ps1`: thêm `-Command App` và `-App Admin|Food|Ship`; danh mục ba app (địa chỉ theo bảng đã duyệt 8443/8444/8445); cổng kiểm điều kiện `Get-AppLaunchBlockers`; `Open-AppLauncher`. Dùng chung một launcher, không thêm `11ship-app-launch.ps1` (đường dẫn đó chỉ là "dự kiến" trong gói giao).
- Kết quả ghi `last-run.json` mang tên app (`App Admin`...).
- Test: inventory 9 wrapper; nối đúng app; hành vi trong tiến trình; hành vi qua tiến trình con từ thư mục khác trong đường dẫn có dấu tiếng Việt và khoảng trắng; chạy `.cmd` thật trên Windows (CI).
- Runbook `ops/runbooks/local-test-launcher-windows.md`: mục "Ba lối vào ứng dụng" và các mã lỗi mới.

## Hành vi hiện tại và lý do

Cả ba wrapper **chưa mở được ứng dụng**: thoát exit code 1, mã `APP_NOT_READY`, liệt kê điều kiện còn thiếu, **trước mọi tác động** (không update, không Docker/DB/backend, không trình duyệt, không đụng `.env`). Đây là yêu cầu của gói ("báo chưa sẵn sàng nếu orchestrator/runtime chưa đủ, không báo chạy khi chỉ mở preview"), không phải lỗi.

| App | Còn thiếu |
|---|---|
| Admin | `LAUNCH_LOCK_MISSING` (M00.02), `ARTIFACT_IDENTITY_MISSING` (M00.03) |
| Food, Ship | hai mã trên và `APP_RUNTIME_MISSING` (chưa có máy chủ HTTPS chạy thật; M00.05 và M00.06/.07) |

Admin có `scripts/admin-web-dev.mjs` nhưng vẫn bị từ chối: mở khi chưa có khóa dùng chung và chưa xác minh process/cổng thuộc launcher đi ngược tiêu chí R05 (cổng trả 200 không đủ để coi là đúng ứng dụng). `Get-AppLaunchBlockers` đọc repo thật (Admin hết `APP_RUNTIME_MISSING` vì file tồn tại). Nếu mọi điều kiện được khai báo sẵn sàng mà chưa có trình tự mở, launcher fail đóng với `APP_LAUNCH_NOT_IMPLEMENTED`, không bao giờ báo thành công.

## Đối chiếu yêu cầu issue #50

| Yêu cầu review | Xử lý trong gói này |
|---|---|
| Inventory 6 → 9 wrapper, không xóa test cho xanh | Cập nhật inventory và bổ sung kiểm hành vi từng wrapper |
| Test wrapper contract | Kiểm cả hai lớp: tĩnh (`launcher.test.mjs`) và hành vi (`launcher.Tests.ps1`) |
| Lỗi rõ khi app chưa có | `APP_NOT_READY` kèm danh sách, exit 1 |
| Không lộ secrets | Kiểm output không chứa mật khẩu DEV dù `.env` có sẵn |
| Cửa sổ khi double-click | Dùng lại quyết định pause hiện có; CI Windows chạy `.cmd` thật; **Owner smoke CHƯA CHẠY** |
| cwd cho npm; sở hữu process/cổng; health/version sau Update | **Chưa làm**: gói này không gọi npm/Update/Start; nằm ở M00.02/M00.03 |
| Giữ guard Git/migration, DEV/TEST | Không sửa; các test cũ vẫn PASS |

Con số "pass=209 fail=4" trong issue #50 thuộc nhánh #46; không tái hiện vì không kéo nhánh đó (orchestrator của #46 khác orchestrator ở đây).

## Kiểm thử đã chạy (cục bộ, container Claude, Linux)

Môi trường: PowerShell 7.5.4, Node v22.22.0 (CI dùng 24.21.0), npm 10.9.4. Không có Windows PowerShell 5.1 và không có Windows.

| Lệnh | Kết quả |
|---|---|
| `npm run launcher:test` trên `main` trước khi sửa (baseline) | PASS 5/5; bộ hành vi `pass=187 fail=0 skip=2` |
| Cùng test cũ với mã mới, trước khi sửa test | 2 test đỏ đúng chỗ kỳ vọng (đếm cứng 6 wrapper); mọi hành vi cũ vẫn PASS |
| `npm run launcher:test` sau khi sửa | PASS 6/6; bộ hành vi `pass=250 fail=0 skip=2` (+63 kiểm tra mới) |
| Đột biến: nối nhầm app; báo thành công giả; mở process ở nhánh từ chối; bỏ cổng điều kiện | Cả 4 đột biến làm test **FAIL** đúng chỗ; đã khôi phục, 250/0/2 |
| `npm run deploy:test` / `client-shell:test` / `progress:test` / `admin-web:test` | PASS 74 / 27 / 183 / 14, không FAIL |
| Chạy tay `11ship-launcher.ps1 -Command App -App Admin|Food` và không `-App`, từ thư mục khác | exit 1; thông báo như mô tả; `last-run.json` đúng |

2 SKIP của bộ hành vi: kiểm tra `pg-connection-string` thật (cần `node_modules`) và chạy wrapper Windows (không phải Windows). Cả hai chạy trong CI.

### BLOCKED / chưa chạy

- **BLOCKED** cục bộ: `npm ci`, lint, typecheck, build, unit, integration. Container không tới được npm registry (không phân giải DNS; qua proxy bị 403 theo chính sách). Gói này chỉ sửa `.ps1`, `.cmd`, `.mjs`, `.md`; ESLint chỉ lint `*.ts` và không file TypeScript nào đổi. CI Ubuntu/Windows trên đúng final SHA là bằng chứng chính thức.
- **CHƯA CHẠY** cục bộ: Windows PowerShell 5.1; `.cmd` thật (cmd.exe), đường dẫn có dấu/khoảng trắng và quyết định pause khi double-click. Các kiểm tra này nằm trong bộ test và chạy ở job `launcher-windows` của CI; chưa có kết quả trước khi PR được tạo.
- **CHƯA CHẠY**: smoke double-click trên máy Windows của Owner; kiểm tra điện thoại (không áp dụng ở gói này).

## Gate theo từng bề mặt

| Bề mặt | Thiết kế | Code | CI | Review | Local Owner | Phone | Nghiệm thu |
|---|---|---|---|---|---|---|---|
| Admin Web | Đã duyệt (v2.1) | Wrapper + cổng từ chối | Chưa có | Chưa | CHƯA CHẠY | N/A gói này | Chưa |
| 11Food — khách | Đã duyệt | Wrapper + cổng từ chối | Chưa có | Chưa | CHƯA CHẠY | N/A gói này | Chưa |
| 11Food — quán | Đã duyệt (cùng app Food) | Cùng wrapper Food | Chưa có | Chưa | CHƯA CHẠY | N/A gói này | Chưa |
| 11Ship — shipper | Đã duyệt | Wrapper + cổng từ chối | Chưa có | Chưa | CHƯA CHẠY | N/A gói này | Chưa |
| Liên thông | Đã duyệt | Chưa triển khai | — | — | CHƯA CHẠY | — | Chưa |

Không có bề mặt nào "mở được". Wrapper tồn tại và từ chối an toàn không phải bằng chứng ứng dụng chạy.

## Dependency còn thiếu cho các gói sau

M00.02 (khóa độc quyền, update/re-exec), M00.03 (định danh artifact/process, restart), M00.05 (máy chủ HTTPS/proxy), M00.06/M00.07 (shell Food/Ship), M00.08 (Admin runtime smoke), M00.09 (shortcut/Status/Stop/tích hợp). Khi từng gói hoàn tất, nó đặt `Ready` tương ứng trong `$script:OrchestratorCapabilities` và điền `Runtime` trong `$script:AppCatalog`.

## Không làm

Không migration remote, deploy, seed, restore; không đổi nghiệp vụ M01; không thêm app Quán riêng; không sửa `docs/PROGRESS.md` hay `plan.yml`; không merge, không ghi hộ Owner PASS.
