# M00.02 — bằng chứng: khóa dùng chung, cập nhật Git an toàn, chạy lại launcher mới

Ngày: 11/10/2026 (Asia/Ho_Chi_Minh). Người thực hiện: Claude. Thiết kế: M00 v2.1 (Owner duyệt), gói M00.02. Trạng thái: **ĐÃ CODE; KIỂM THỬ HÀNH VI CHƯA CHẠY ĐƯỢC CỤC BỘ (không có PowerShell trong container); BẰNG CHỨNG CHÍNH THỨC = CI (PowerShell 7 trên Ubuntu + Windows PowerShell 5.1 trên Windows); REVIEW/OWNER CHƯA CÓ**.

- Phụ thuộc: M00.01 đã merge qua PR #66 (merge commit `6caea00f327cc8b6c8d8376808c9a6af0f98f51d`, đã kiểm là tổ tiên của `main`).
- Base của nhánh `feat/m00-02-lock-git-relaunch`: `main` = `9ffc7c83be7089bc9e7de196e290f18e92f2e3fd` (chỉ khác snapshot đầu phiên ở commit bot `docs/PROGRESS.md`).
- Final SHA và CI đúng final SHA: ghi trong mô tả Draft PR (một file trong PR không thể chứa SHA của chính commit chứa nó).

## Mapping trước khi sửa

| | Trên main |
|---|---|
| ĐÃ CÓ | Launcher nền; cổng `OrchestratorCapabilities` (khóa = chưa sẵn sàng); guard Git cơ bản (dirty tracked, detached, no upstream, diverged, untracked collision); `Invoke-InRepo`; ba lối vào App trả `APP_NOT_READY`; bộ test hành vi + job CI PS7 và Windows PS5.1 |
| THIẾU | Khóa độc quyền dùng chung; ép nhánh `main`/`origin/main`; kiểm thao tác Git dở, fetch lỗi, chế độ UAT pin; chạy lại launcher mới sau Update; tay nắm khóa giữa tiến trình cũ và mới |
| TÁI SỬ DỤNG | `Fail` + mã lỗi, `Invoke-WithEnv`, `Capture`, khung test (sandbox Git thật, fake Docker/npm), `Update-Launcher` hiện có |

## Đã làm

**Khóa dùng chung** (`Use-LaunchLock`): handle độc quyền của hệ điều hành (`FileShare.None`) trên `.11ship-local\launch.lock`, giữ suốt thao tác. Metadata `launch.lock.info.json` chỉ để hiển thị. Chờ tối đa 120 giây, in `LAUNCH_LOCK_WAIT` (đầu tiên rồi mỗi 15 giây), hết hạn `LAUNCH_LOCK_TIMEOUT`. Process crash tự nhả khóa. Không chiếm khóa theo tuổi file, không tắt tiến trình đang giữ khóa. Gọi lồng nhau trong cùng process dùng bộ đếm độ sâu nên không tự khóa chết. Bọc: Start, Update, Test, Stop, cài dependency, migration. Status, InstallShortcut và nhánh từ chối của App **không** lấy khóa.

**Cập nhật Git an toàn**: chế độ main chỉ nhận nhánh `main` theo dõi `origin/main` (`NOT_MAIN_BRANCH`, `UPSTREAM_MISMATCH`), kiểm thêm thao tác dở (`GIT_OPERATION_IN_PROGRESS`), fetch lỗi dừng (`GIT_FETCH_FAILED`), `merge --ff-only` theo SHA, kiểm HEAD sau merge; file sẽ bị upstream thêm vào được đối chiếu với đĩa nên file bị ignore như `.env` cũng được bảo vệ; biến `GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE` của terminal bị bỏ trong lúc Update. Chế độ UAT: `.11ship-local\uat-pin.json` `{ "sha": "<40 hex>" }`, chỉ kiểm HEAD đúng SHA (`UAT_SHA_MISMATCH`), không fetch/pull/checkout; pin hỏng là `UAT_PIN_INVALID`, không quay về main. `Status` có dòng "Chế độ cập nhật".

**Chạy lại launcher mới**: nếu Update làm đổi `11ship-launcher.ps1`, tiến trình cũ giữ "cổng" `launch.gate`, khởi động bản mới (tham số `-RelaunchToken/-RelaunchFromSha/-RelaunchToSha/-RelaunchLauncherHash`, giữ Command/App/`-Yes`/`-KeepDatabases`/`-ForceDependencies`, thêm `-NoPause`), nhả khóa trong khi còn giữ cổng, chờ tới khi bản mới đã cầm khóa rồi mới nhả cổng. Không launcher nào khác chen vào giữa vì mọi lần thử lấy khóa đều phải qua cổng. Bản mới lấy khóa trực tiếp, kiểm lại HEAD/SHA/hash file launcher/trạng thái Git, **không fetch lại**, không thể chạy lại lần nữa (`RELAUNCH_LIMIT`). Tiến trình cũ sau bàn giao là "cũ" (`LAUNCHER_RELOAD_REQUIRED` cho mọi lệnh), không giữ khóa khi chờ con; exit code của con được giữ (`RELAUNCH_CHILD_FAILED`); không khởi động được hoặc không nhận khóa trong 60 giây thì kill con, lấy lại khóa, `RELAUNCH_FAILED`. npm/build/backend luôn chạy với cwd là repo chứa script.

**Cổng năng lực**: `ExclusiveLock.Ready = $true` (đã tích hợp và có test từ bên trong từng bước); `ArtifactIdentity` vẫn chưa sẵn sàng. Ba lối vào Admin/Food/Ship vẫn trả `APP_NOT_READY` trước mọi tác động, không tạo file khóa.

**Test**: `tests/local-launcher/launcher.Tests.ps1` (các mục M00.02 mới: khóa; tích hợp khóa; Git main; UAT; chạy lại trong tiến trình với con giả; hai tiến trình thật qua `support/relaunch-harness.ps1`; ba tiến trình tranh khóa và tiến trình bị kill qua `support/lock-holder.ps1`); `launcher.test.mjs` (kiểm tĩnh); runbook cập nhật.

## Kiểm thử đã chạy

Môi trường container: Node v22.22.0 (repo ghim 24.21.0), **không có PowerShell** (không pwsh, không Windows PowerShell; tải từ GitHub release bị chặn 403 theo chính sách egress, npm registry không tới được).

| Việc | Kết quả |
|---|---|
| `node --test tests/local-launcher/launcher.test.mjs` | các kiểm tra tĩnh PASS (8 pass, 1 skip: bộ hành vi cần PowerShell) |
| Kiểm cân bằng ngoặc/chuỗi/here-string cho launcher, test và hai script hỗ trợ (công cụ tự viết, đã thử đột biến) | OK |
| Kiểm các file test/hỗ trợ là ASCII, launcher còn BOM UTF-8 và LF | OK |
| Bộ hành vi PowerShell (PS7 / PS5.1) | **CHƯA CHẠY CỤC BỘ — BLOCKED**; chạy ở CI |

Lịch sử CI (không phải kết quả cuối): lần chạy đầu đỏ vì lỗi cú pháp trong test (`"$case:"`); lần hai tìm ra lỗi thật trên Linux: `Invoke-WithEnv` để lại biến rỗng `GIT_DIR=` (Git đọc là đường dẫn rỗng) — đã sửa bằng cách xóa hẳn biến; và lỗi thật khác: tham số chạy lại chưa phân biệt hoa/thường (`-notmatch` mặc định không phân biệt) — đã sửa bằng `-cnotmatch`. Commit `2b67a979ddf2e239499105cf1a52f86be7526c13`: job Windows PowerShell 5.1 `pass=460 fail=0 skip=1` (skip: không đổi được giờ của file đang bị giữ mở), job Ubuntu (PowerShell 7 + toàn bộ verify) xanh. Con số cuối cùng trên final SHA nằm trong mô tả PR.

### Chưa chạy
- Smoke của Owner trên Windows thật (hai cửa sổ tranh khóa, Update đổi launcher, UAT pin): **CHƯA CHẠY**.
- Kiểm tra điện thoại: không áp dụng ở gói này.

## Sửa theo review ChatGPT (F1, F2) trên head `531afb6578ad37f5a764ea1de838b099fda2836d`

| Finding | Sửa | Test |
|---|---|---|
| F1 [P1] launcher chờ khóa chạy mã cũ | `$script:LoadedLauncherHash` ghi dấu vân tay file launcher lúc nạp; `Enter-LaunchLock` so với đĩa NGAY sau khi lấy khóa, trước mọi tác động; khác thì nhả khóa, đánh dấu cũ, dừng `LAUNCHER_RELOAD_REQUIRED`. Áp dụng cho Start/Update/Test/Stop, bước dependency và migration, và từng mục của menu mở từ trước. Handover, exit code, pause giữ nguyên (tiến trình mới nạp lại từ đĩa nên khớp) | Trong tiến trình: sửa file launcher sau khi nạp rồi gọi từng lệnh và menu; barrier hai tiến trình thật: ba tiến trình B (Start, Update `-ForceDependencies`, menu nhập 1,2,0) nạp v1 và chờ barrier, A Update lên v2, B được thả khi v2 đang chạy; B không được có dòng Docker/npm/build/backend nào, exit 1 (menu exit 0), `npm ci` đúng 1 lần (v2), 5 tiến trình, 1 lần handover |
| F2 [P2] đọc Git lỗi bị coi là rỗng | `git status` lỗi: `GIT_STATE_UNREADABLE` (trước fetch/merge); diff file thêm lỗi: `GIT_DIFF_UNREADABLE` (trước merge, bảo vệ `.env` ignored); `merge-base` exit khác 1: `GIT_STATE_UNREADABLE` (exit 1 vẫn là `NON_FAST_FORWARD`); `Get-AddedMigrationCount` trả `$null` khi lỗi, Update in `MIGRATION_COUNT_UNREADABLE` thay vì \"0\" | Chèn lỗi bằng wrapper `git.exe` (exit 128) cho status, diff, merge-base, đếm migration; kiểm HEAD, byte `.env`, không có lệnh `merge`/`fetch`, không npm, không launcher thứ hai; chạy lại khi hết lỗi; valid-empty (không file thêm, cây sạch) vẫn cập nhật và báo 0 |

**Chứng minh test bắt lỗi trên bản trước sửa.** Commit chỉ chứa test (launcher chưa sửa) `d807432ef41cf6d59245547fe4f0f2a477fb889e` (SHA trước khi nhánh được rebase lên main mới; run CI của nó vẫn còn trên GitHub Actions, job `Launcher behaviour (Windows PowerShell 5.1)` 114514010758): job Windows PowerShell 5.1 đỏ với `pass=492 fail=44`: Update vẫn merge và relaunch khi `git status` lỗi; `.env` ignored bị ghi đè khi `git diff` lỗi; Start/Update/menu cũ chạy 7/3/7 bước Docker/npm bằng mã v1 và `npm ci` bị chạy bởi v1. Commit sửa launcher làm cùng các test đó xanh (kết quả trên final SHA: mô tả PR).

## Sửa theo re-review (F3) trên head `3fba6fb0cc3751de4ee79d40a52ca971ef3ee029`

| Finding | Sửa | Test |
|---|---|---|
| F3 [P2] đọc identity ném exception sau khi đã lấy handle thì handle không được đóng (nằm chờ GC, khóa kẹt) | `Enter-LaunchLock` giữ handle là biến cục bộ cho tới khi bàn giao sang trạng thái khóa; mọi lỗi trước đó (đọc identity, lệch identity, exception bất ngờ) đóng handle trong `finally`. Lỗi đọc identity có mã `LAUNCHER_IDENTITY_UNREADABLE`, dừng trước mọi thao tác được bảo vệ, không đánh dấu launcher là cũ nên khi file đọc được lại thì chạy tiếp bình thường | Ép `Get-LauncherIdentity` ném lỗi sau khi lấy khóa cho Start/Update/Test/Stop, bước dependency và migration, và menu còn sống: kiểm khóa trống NGAY (không ép GC), không Git/npm/Docker/SQL/backend, HEAD không đổi; một process thật thứ hai lấy khóa ngay; hết lỗi thì Update chạy bình thường. Thêm ca thật: file launcher bị process khác giữ độc quyền |

**Chứng minh đỏ trước sửa**: commit chỉ có test `150d5f3f068aa7ff30f821da31d1ec293ce4f5de` (launcher chưa sửa): job Windows PowerShell 5.1 114522286083 đỏ `pass=561 fail=19` (khóa còn bị giữ, process thứ hai hết hạn chờ, không phục hồi). Test F1/F2 giữ nguyên. Kết quả xanh trên final SHA: mô tả PR/comment.

## Gate theo từng bề mặt

| Bề mặt | Thiết kế | Code | CI | Review | Local Owner | Phone | Nghiệm thu |
|---|---|---|---|---|---|---|---|
| Admin Web | Đã duyệt | Khóa tích hợp; app vẫn từ chối | Xem PR | Chưa | CHƯA CHẠY | N/A | Chưa |
| 11Food (khách + quán) | Đã duyệt | như trên | Xem PR | Chưa | CHƯA CHẠY | N/A | Chưa |
| 11Ship (shipper) | Đã duyệt | như trên | Xem PR | Chưa | CHƯA CHẠY | N/A | Chưa |
| Liên thông | Đã duyệt | Chưa triển khai | — | — | CHƯA CHẠY | — | Chưa |

## Không làm

Không M00.03 (định danh artifact/process, restart), không M00.05 (HTTPS), không mở trình duyệt, không đổi nghiệp vụ M01, không migration/deploy/seed remote, không sửa guard DEV/TEST hay secret, không sửa `docs/PROGRESS.md`/`plan.yml`, không đóng #50 hay M00, không merge.
