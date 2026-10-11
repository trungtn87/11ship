# M00.03 — bằng chứng: định danh artifact/process và xác minh quyền sở hữu process/cổng

Ngày: 12/10/2026 (Asia/Ho_Chi_Minh). Người thực hiện: Claude. Thiết kế: M00 v2.1, gói M00.03. Trạng thái: **ĐÃ CODE; KIỂM THỬ HÀNH VI CHƯA CHẠY ĐƯỢC CỤC BỘ (không có PowerShell trong container); BẰNG CHỨNG CHÍNH THỨC = CI (PowerShell 7 trên Ubuntu + Windows PowerShell 5.1 trên Windows) TRÊN ĐÚNG FINAL SHA; SMOKE CỦA OWNER CHƯA CHẠY; REVIEW CHƯA CÓ**.

- Phụ thuộc: M00.02 đã review PASS và merge qua PR #67 (merge commit `a7a3ffb88710f6385d530a9353c865dc5f51e0a0`, đã kiểm là tổ tiên của `main`).
- Base của nhánh `feat/m00-03-artifact-process-identity`: `main` = `9a4534910926c4280bc2abd43e6a859975bb36c3`.
- Final SHA và CI đúng final SHA: ghi trong mô tả Draft PR (một file trong PR không thể chứa SHA của chính commit chứa nó).
- Nguồn thiết kế: gói thiết kế M00.03 chỉ có trên nhánh PR #48 (head `f135f45`), **chưa nằm trên `main`**; code bám đúng hợp đồng đó. Cần ChatGPT/Owner xác nhận đó là bản đã duyệt.

## Mapping trước khi sửa

| | Trên main |
|---|---|
| ĐÃ CÓ | Khóa độc quyền dùng chung (M00.02) và `Use-LaunchLock`; guard Git/UAT pin/relaunch; redaction; pause; mã thoát; `backend.json` chỉ có `pid` + `startedUtc`; `Get-OwnedBackendProcess` (PID + giờ khởi động + tên `node`); `Wait-Backend` chỉ nhìn HTTP 200; cổng năng lực `ArtifactIdentity.Ready = $false` |
| THIẾU | Manifest của artifact; bản ghi process có repo/script/host/cổng/commit/fingerprint; chứng minh quyền sở hữu cổng; phân biệt nguồn mới với artifact và process đang chạy; mã lỗi cho process/cổng không xác minh được; Update không được báo thành công khi vẫn phục vụ bản cũ |
| TÁI SỬ DỤNG | `Fail` + mã lỗi, `Use-LaunchLock`, `Capture`, `Invoke-InRepo`, `Confirm-DevMigrations`, `Invoke-WithEnv`, khung test (sandbox Git thật + fake Docker/npm) và harness hai tiến trình của M00.02 |

## Đã làm (chỉ M00.03; không đụng source backend, health, Food/Ship runtime, migration hay deploy remote)

**Bốn lớp tách bạch**: nguồn (`git HEAD`), artifact (`apps\backend\dist` + `build-manifest.json`: `app_id`, `source_sha`, `build_fingerprint` = SHA-256 trên mọi file build, `built_at`, `design_version`), process (bản ghi `.11ship-local\backend.json` ghi lúc khởi động) và cổng (socket lắng nghe do hệ điều hành báo). Manifest chỉ được ghi **sau** build thành công và bị xóa trước khi build, nên build lỗi không để lại fingerprint nhầm.

**Quyền sở hữu process** (`Get-TargetOwnership`): NONE / STALE / UNVERIFIED / OWNED. OWNED chỉ khi bản ghi đầy đủ và đúng kiểu, cùng checkout/script/host/cổng, PID còn sống với **đúng giờ khởi động đã ghi**, chương trình là `node` và đối số script là đúng `dist\main.js` của checkout. PID bị dùng lại (khác giờ khởi động) hay process đã thoát = STALE (không dừng ai). Bản ghi thiếu/hỏng/cũ (kể cả `backend.json` của launcher trước), thuộc checkout khác, không đọc được, process không kiểm tra được, hoặc đúng giờ nhưng không phải node chạy script này = UNVERIFIED: **dừng an toàn, mã `PROCESS_IDENTITY_UNVERIFIED`, không build/migration/dừng/khởi động, giữ nguyên bản ghi**.

**Quyền sở hữu cổng** (`Get-TargetPortState`): FREE / OURS / FOREIGN / UNREADABLE. HTTP không được dùng để chứng minh quyền sở hữu: dịch vụ lạ trả 200 với đúng body vẫn là `PORT_IN_USE`; không đọc được = `PORT_OWNER_UNREADABLE` (không bao giờ coi là trống). Sau khi khởi động, `Wait-Backend` chờ tới khi **đúng process vừa khởi động** giữ cổng và cả hai health trả đúng body (`{"data":{"status":"ok"}}` / `{"data":{"status":"ready"}}`; body backend không đổi).

**Start**: kiểm định danh process/cổng trước mọi build -> build + manifest -> (migration: hỏi Owner, chỉ **sau khi đồng ý** mới dừng backend cũ của launcher rồi áp dụng) -> dùng lại backend chỉ khi đã chứng minh của launcher + cùng commit + cùng fingerprint + giữ đúng cổng + health đúng; ngược lại dừng đúng PID đó và khởi động lại. Script chạy bằng đường dẫn tuyệt đối để dòng lệnh của process nói rõ đang chạy build nào.

**Stop**: chỉ dừng khi OWNED, chứng minh lại ngay trước khi dừng (PID có thể bị dùng lại), chỉ `Stop-Process -Id <PID>`; không dừng theo tên image, theo cổng hay theo PID đơn lẻ; lỗi hoặc không dừng được là `PROCESS_STOP_FAILED`, bản ghi được giữ, không leo thang. Bản ghi của process đã thoát chỉ được dọn.

**Update**: chỉ cập nhật nguồn + dependency. Nếu backend của launcher còn chạy artifact build từ commit cũ: cảnh báo `BACKEND_RUNNING_OLD_VERSION` (kèm commit/fingerprint của process); thông báo thành công nói rõ chỉ là mã nguồn. Bản ghi không chứng minh được: cảnh báo `PROCESS_IDENTITY_UNVERIFIED`, không đụng gì.

**Khóa dùng chung**: `Assert-LockHeld` ở mọi hàm đổi manifest, bản ghi hay process (`LAUNCH_LOCK_REQUIRED` nếu gọi ngoài khóa). Ghi trạng thái nguyên tử (tệp tạm + đổi tên, lỗi = `STATE_WRITE_FAILED`, tệp cũ nguyên vẹn).

**Status**: một dòng cho mỗi lớp (nguồn, artifact, process, cổng), chỉ đọc, không khóa.

**Cổng năng lực**: `ArtifactIdentity.Ready = $true` (hợp đồng đã code và có test; chờ CI xác nhận). Thêm một cổng trung thực `AppLaunchSequence.Ready = $false` (mã `APP_LAUNCH_SEQUENCE_MISSING`, gói M00.05: HTTPS local, máy chủ riêng của bề mặt, trình duyệt) để ba lối vào Admin/Food/Ship vẫn từ chối `APP_NOT_READY`, không mở gì.

### Hành vi thay đổi cần ChatGPT/Owner biết

1. **Chi phí một lần**: `backend.json` của launcher cũ không đủ để chứng minh, nên nếu backend cũ còn chạy lúc nâng cấp thì Start/Stop dừng với `PROCESS_IDENTITY_UNVERIFIED` cho tới khi Owner đóng process node đó và xóa `backend.json` (runbook có hướng dẫn).
2. Start luôn build lại (như trước) và so fingerprint; Update **không** build/restart (chỉ cảnh báo).
3. `design_version` ghi cố định `2.0.1` (giả định theo gói thiết kế; cần xác nhận).
4. Một dòng lệnh Start vẫn có thể thất bại ở bước build mà không dừng backend đang chạy (cố ý: build lỗi không được làm mất phiên bản đang chạy).

## Mapping yêu cầu -> sửa -> test

| Yêu cầu | Sửa | Test (`tests/local-launcher/launcher.Tests.ps1`, mục "M00.03 ...") |
|---|---|---|
| Đúng process và đúng artifact | OWNED + reuse chỉ khi cùng commit/fingerprint/cổng/health | Start lần đầu; Start lặp lại dùng lại; artifact đổi thì restart đúng PID, process khác (bystander) không bị đụng |
| Metadata thiếu/hỏng/cũ | `Read-JsonObject`, `Get-RegistryProblem`, `Get-ManifestProblem` | 13 kiểu bản ghi xấu (legacy, không phải JSON, rỗng, mảng, thiếu trường, sai kiểu, app_id lạ, SHA ngắn, schema lạ, checkout/script/cổng khác, không đọc được) -> Start và Stop đều `PROCESS_IDENTITY_UNVERIFIED`, không build/migration/dừng; manifest MISSING/UNREADABLE/INVALID/CHANGED/NO_ARTIFACT |
| PID tái sử dụng hoặc trỏ sang process khác | giờ khởi động + node + script + executable | PID khác giờ = STALE (không kill); không phải node/script khác/không có script/node khác chỗ = UNVERIFIED; process không kiểm tra được; chứng minh lại ngay trước khi kill (TOCTOU) |
| Cổng bị process lạ chiếm, kể cả HTTP 200 | `Get-TargetPortState` không dùng HTTP | listener lạ trên 127.0.0.1 / 0.0.0.0 / :: / ::1 (fake vẫn trả health đúng) -> `PORT_IN_USE`, không build/start/kill, `HttpCalls = 0`; process của ta + listener lạ; owner không đọc được -> `PORT_OWNER_UNREADABLE`; `Wait-Backend` từ chối câu trả lời của process khác |
| Health/version không khớp | `Test-HealthBody`, `Get-RestartReasons` | body sai, HTML, ready 503, không phản hồi -> `BACKEND_NOT_READY`; backend đúng nhưng health sai bị restart |
| Update khi backend đang chạy | `Write-BackendUpdateNotice` | cảnh báo `BACKEND_RUNNING_OLD_VERSION`, không dừng/khởi động gì; Start sau đó thay bằng bản đúng commit dù fingerprint trùng; không cảnh báo khi đã khớp HEAD; bản ghi không chứng minh được chỉ cảnh báo |
| Start lặp lại | reuse | `BackendStarts` không tăng, không kill |
| Stop đúng process | `Stop-TargetProcess` | chỉ PID đã ghi; node khác (kể cả backend của checkout khác) còn sống; Stop hai lần; Stop khi kill bị từ chối / không có hiệu lực -> `PROCESS_STOP_FAILED`, giữ bản ghi; dưới khóa |
| Lỗi đọc trạng thái | UNREADABLE != MISSING | registry là thư mục, danh sách process/listener không đọc được, manifest không đọc được |
| Lỗi build/start | `Build-BackendArtifact`, `Start-NewBackendProcess` | build lỗi (xóa manifest, backend cũ nguyên vẹn, không migration), build không ra file, manifest không ghi được, node không chạy, process biến mất, process sai script (bị dừng đúng PID, không ghi), không lắng nghe (lần Start sau thay thế), registry không ghi được (process vừa tạo bị dừng) |
| Migration + backend cũ | hook `BeforeApply` | từ chối: backend giữ nguyên; đồng ý: backend cũ đã dừng trước `db:migrate` |
| Hai launcher đồng thời | khóa M00.02 | `support/identity-harness.ps1` (bảng process giả dùng chung bằng file): ba Start cùng lúc -> đúng 1 backend, mọi build/start/stop trong khóa; Start/Stop/Start -> trạng thái cuối nhất quán |
| Mọi thao tác đổi artifact/process dùng khóa | `Assert-LockHeld` | gọi từng hàm ngoài khóa -> `LAUNCH_LOCK_REQUIRED`, không đổi gì; quan sát khóa tại build/start/stop |
| Không đổi guard Git/UAT/relaunch/redaction/pause/exit code | không sửa các phần đó | toàn bộ test M00.01/M00.02 giữ nguyên (F1/F2/F3 gồm); chỉ đổi các kỳ vọng nêu dưới |
| Process/cổng thật trên Windows | seam thật `Get-ProcessDetails`/`Get-PortListeners`/`Stop-OwnedProcess` | mục "real Windows seams" (chỉ job Windows): node thật, đường dẫn có khoảng trắng và chữ Việt, owner PID của listener thật, OWNED/STALE/UNVERIFIED, dừng đúng process và không đụng node khác |

### Kỳ vọng test cũ đã đổi (và lý do)

- Mục "Start when a backend is already running / stale PID / foreign service" (dùng `Write-BackendState`, `$script:HttpCode`, process node thật và `Get-OwnedBackendProcess` kiểu cũ) được thay bằng các mục M00.03 chặt hơn (bản ghi cũ chỉ có `pid + startedUtc` giờ là UNVERIFIED, HTTP không còn được dùng làm bằng chứng). Fake `Http-Status`/`Start-BackendProcess` cũ thay bằng bảng process/cổng giả.
- Mục lối vào ứng dụng: không còn mã `ARTIFACT_IDENTITY_MISSING` (đã sẵn sàng); thêm kỳ vọng `APP_LAUNCH_SEQUENCE_MISSING`; kiểm `ArtifactIdentity.Ready = $true` và `AppLaunchSequence.Ready = $false`. Kiểm tĩnh `launcher.test.mjs` tương ứng.
- Hai kiểm "Update không báo hoàn tất khi lỗi" đổi chuỗi dò sang `(fast-forward)` vì thông báo thành công đổi lời.

## Kiểm thử đã chạy

Môi trường container: Node v22.22.0 (repo ghim 24.21.0), **không có PowerShell** (không pwsh, không Windows PowerShell; tải từ GitHub release bị chặn 403 theo chính sách egress — không vượt chính sách; npm registry không tới được).

| Việc | Kết quả |
|---|---|
| `node --test tests/local-launcher/launcher.test.mjs` | 9 pass, 1 skip (bộ hành vi cần PowerShell); gồm kiểm tĩnh M00.03 mới: mã lỗi, chỉ một `Stop-Process -Id`, không dừng theo tên/cổng, hàm sở hữu không gọi HTTP, mọi hàm đổi trạng thái assert khóa |
| Kiểm cân bằng ngoặc/chuỗi/here-string cho launcher, bộ test, harness mới | OK |
| Launcher còn BOM UTF-8 + LF; bộ test và harness là ASCII | OK |
| Bộ hành vi PowerShell (PS7 / PS5.1) | **CHƯA CHẠY CỤC BỘ — BLOCKED**; chạy ở CI trên final SHA |

### Chưa chạy
- Bộ hành vi PowerShell cục bộ (PS7 và PS5.1), `npm run lint`, `typecheck`, `test:unit`, `test:integration`, `launcher:test` đầy đủ: không có PowerShell và npm registry không tới được trong container; CI là bằng chứng chính thức.
- **Smoke của Owner trên Windows thật (backend thật, port 3000 thật, hai cửa sổ launcher, Update với backend đang chạy): CHƯA CHẠY.**
- Kiểm tra điện thoại, UI: không áp dụng ở gói này.

## Giới hạn và việc mở

- Định danh áp dụng cho **backend**; các bề mặt web dùng cùng cơ chế khi có máy chủ riêng (M00.05 trở đi).
- Không đóng #50, không đóng toàn bộ M00; không runtime Food/Ship, không deploy/migration remote.
- Câu hỏi mở cho review: (1) launcher giữ một file duy nhất (chưa tách `11ship-app-launch.ps1`); (2) bản ghi legacy fail-closed với chi phí một lần cho Owner; (3) `design_version = 2.0.1`; (4) Update chỉ cảnh báo chứ không tự build/restart; (5) thêm cổng `AppLaunchSequence` để giữ `APP_NOT_READY` — xác nhận đây là cách đúng.

| Cổng | Trạng thái |
|---|---|
| Code theo hợp đồng thiết kế | XONG (chờ review) |
| CI trên đúng final SHA | xem mô tả PR |
| Owner smoke trên PC | **CHƯA CHẠY** |
| ChatGPT review | CHƯA CÓ |
