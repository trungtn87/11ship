# 11Ship Local Test Launcher — Windows

Task M00-L. Chỉ hỗ trợ Windows; chạy từ `tools\local`. Repo hiện chỉ có backend, nên web/app hiển thị N/A.

## Dùng hằng ngày

- `11Ship.cmd`: menu một cửa. Nhập số rồi Enter; sau mỗi việc menu hiện lại kèm kết quả THÀNH CÔNG/THẤT BẠI, chọn `0` để thoát.
- `11Ship-Start.cmd`: bật hai DB, build, xác minh artifact và process rồi chạy (hoặc dùng lại) backend. Launcher đọc trạng thái migration **trực tiếp trong PostgreSQL DEV** (bảng `public.pgmigrations`), liệt kê migration còn thiếu và luôn hỏi trước khi áp dụng.
- `11Ship-Update.cmd`: fetch và chỉ fast-forward nhánh `main` theo `origin/main` (hoặc kiểm tra pin ở checkout UAT); dừng nếu local changes không an toàn. Nếu bản mới thay chính launcher, launcher cũ chạy bản mới đúng một lần (xem "Khóa dùng chung, cập nhật Git an toàn và chạy lại launcher"). Tự chạy `npm ci` khi lockfile khác lần cài đã ghi nhận, thiếu `node_modules` hoặc launcher chưa ghi nhận lần cài nào (lần chạy đầu).
- `11Ship-Test.cmd`: chạy kiểm tra kỹ thuật với riêng `ship11_test` cổng 5433, lưu log đã ẩn secret trong `.11ship-local\logs`.
- `11Ship-Stop.cmd`: chỉ dừng đúng backend đã được chứng minh là của launcher, rồi dừng DB nhưng giữ volume DEV. Thêm `-KeepDatabases` để chỉ dừng backend. Không chứng minh được thì **không dừng gì cả** (xem "Định danh artifact và process").
- `11Ship-Status.cmd`: xem Git, toolchain, DB, backend (bốn lớp: nguồn, artifact, process, cổng) và test gần nhất. Status chỉ đọc: không khóa, không ghi, không dừng gì.
- `11Ship-Admin.cmd`, `11Ship-Food.cmd`, `11Ship-Ship.cmd` (gói M00.01): ba lối vào riêng cho Web Admin, 11Food (khách + quán) và 11Ship (xế). **Hiện chưa mở được ứng dụng nào**: lệnh dừng ngay với exit code 1 và mã `APP_NOT_READY`, nói rõ còn thiếu gì và chưa làm gì cả. Xem mục "Ba lối vào ứng dụng".

Có thể tạo shortcut bằng mục 6 trong menu hoặc:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\local\11ship-launcher.ps1 -Command InstallShortcut
```

## Ba lối vào ứng dụng (M00.01)

Ba file `.cmd` chỉ chọn app rồi gọi **cùng một** launcher (`11ship-launcher.ps1 -Command App -App <tên>`). Repo được xác định từ vị trí script, nên chạy từ thư mục nào, kể cả đường dẫn có dấu hoặc khoảng trắng, đều dùng đúng checkout chứa wrapper.

| Lối vào | Ứng dụng | Địa chỉ dự kiến | Trạng thái hiện tại |
|---|---|---|---|
| `11Ship-Admin.cmd` | Web Admin | https://localhost:8443 | Chưa mở được: `APP_LAUNCH_PACKAGE_MISSING` (gói M00.08) |
| `11Ship-Food.cmd` | 11Food (khách + quán) | https://localhost:8444 | Mở được từ M00.05 (cần chứng chỉ local, xem `local-https-runtime.md`) |
| `11Ship-Ship.cmd` | 11Ship (xế) | https://localhost:8445 | Mở được từ M00.05 (như trên) |

- Food/Ship (M00.05): launcher kiểm tra chứng chỉ trước, lấy khóa dùng chung, bảo đảm backend chạy, build đúng commit, chạy máy chủ HTTPS local của app, **chứng minh** nó (đúng chứng chỉ, đúng định danh `/__11ship/runtime`, health qua proxy) rồi mới mở trình duyệt. Cổng đang bị tiến trình lạ giữ thì dừng (`PORT_IN_USE`), không dừng tiến trình lạ. `SHIP11_NO_BROWSER=1` bỏ bước mở trình duyệt. Hướng dẫn và bảng mã lỗi: `ops/runbooks/local-https-runtime.md`.
- Khi không mở được, launcher thoát với **exit code 1** và nói rõ chưa làm gì; nó không bao giờ báo "đã chạy" khi chưa chứng minh được.
- Không có app "Quán" riêng: quán thuộc 11Food, 11Ship chỉ dành cho xế.
- Web Admin chưa mở dù đã có `scripts/admin-web-dev.mjs`: máy chủ Admin cần cùng cơ chế định danh/artifact và trình tự mở (gói M00.08), nên lối vào Admin vẫn từ chối. Một dịch vụ lạ trên cổng 8443 có thể bị nhận nhầm là Admin nếu mở bây giờ. Bản xem thử `Xem-Giao-Dien.cmd` (dữ liệu minh họa) không phải ứng dụng và không được dùng thay.
- Double-click: cửa sổ giữ lại để đọc lỗi; từ terminal lệnh kết thúc ngay; `-NoPause` dùng được như các lệnh khác. Kết quả ghi ở `.11ship-local\last-run.json` với `command` là `App Admin`, `App Food` hoặc `App Ship`.
- Lối vào Admin vẫn từ chối **trước khi** lấy khóa (không Update, không Start, không `launch.lock`) cho tới gói M00.08.

## Khóa dùng chung, cập nhật Git an toàn và chạy lại launcher (M00.02)

**Khóa dùng chung.** Mỗi checkout có một khóa độc quyền (`.11ship-local\launch.lock`, handle độc quyền của hệ điều hành) giữ suốt thao tác Start, Update, Test, Stop, cài dependency (`npm ci`), build và migration. Hai launcher cùng checkout (ví dụ hai cửa sổ, hoặc Update cạnh Start) không bao giờ chạy các bước này cùng lúc.

- Đang có launcher khác giữ khóa: launcher mới in `LAUNCH_LOCK_WAIT` (kèm thao tác/PID/giờ của bên giữ khóa, chỉ để tham khảo) rồi chờ tối đa **120 giây**. Hết hạn: lỗi `LAUNCH_LOCK_TIMEOUT`, chưa làm gì cả. Hãy đợi thao tác kia xong rồi chạy lại.
- Launcher **không** chiếm khóa theo tuổi file và **không** tắt tiến trình đang giữ khóa. Process bị crash tự nhả khóa (hệ điều hành đóng handle); `launch.lock.info.json` chỉ là chữ hiển thị, xóa hay sửa nó không mở khóa cho ai.
- **Mã launcher cũ không chạy bước nào.** Mỗi launcher nhớ dấu vân tay (SHA-256) của file `11ship-launcher.ps1` lúc nó nạp. Ngay sau khi lấy được khóa, trước mọi thao tác Docker/npm/build/migration/process/Git, nó so lại với file trên đĩa. Nếu khác (một launcher khác đã Update trong lúc cửa sổ này đang chờ, hoặc menu mở từ trước khi Update), nó nhả khóa ngay và dừng với `LAUNCHER_RELOAD_REQUIRED`: chưa làm gì cả, hãy đóng cửa sổ rồi mở lại launcher. Menu cũ cũng từ chối từng mục (Start/Update/Test/Stop) theo cách này; Status chỉ đọc nên vẫn trả lời. Nếu lúc đó không đọc được file launcher (ví dụ chương trình khác đang giữ file), launcher dừng với `LAUNCHER_IDENTITY_UNREADABLE`, trả khóa ngay và không làm gì; khi file đọc được lại thì chính cửa sổ đó chạy bình thường.
- `Status` và các lối vào ứng dụng bị từ chối không lấy khóa nên luôn trả lời ngay. `LAUNCH_LOCK_UNAVAILABLE` nghĩa là không mở được file khóa (thường do quyền ghi thư mục `.11ship-local`).
- `SHIP11_LOCK_TIMEOUT_SECONDS` (1 đến 119) chỉ để **rút ngắn** thời gian chờ khi kiểm thử; không thể kéo dài quá 120 giây.

**Cập nhật Git.**

| Chế độ | Khi nào | Hành vi |
|---|---|---|
| main (mặc định) | không có file pin | Chỉ nhánh `main` theo dõi `origin/main`; `git fetch` rồi `merge --ff-only`. Không reset, không stash, không xóa hay ghi đè file untracked (kể cả file bị ignore như `.env`), không tự đổi nhánh. |
| UAT | có `.11ship-local\uat-pin.json` | Dùng checkout UAT riêng. File chứa đúng một SHA đầy đủ: `{ "sha": "<40 ký tự hex>" }`. Update chỉ kiểm tra `HEAD` đúng SHA đó; **không** fetch/pull/checkout. HEAD detached được chấp nhận nếu đúng SHA. |

Lỗi dừng an toàn (không đổi gì): `DIRTY_TRACKED`, `DETACHED_HEAD`, `NO_UPSTREAM`, `NOT_MAIN_BRANCH`, `UPSTREAM_MISMATCH`, `NON_FAST_FORWARD`, `UNTRACKED_COLLISION`, `GIT_OPERATION_IN_PROGRESS` (merge/rebase/cherry-pick/revert/bisect đang dở), `GIT_FETCH_FAILED` (fetch lỗi thì không báo thành công), `GIT_UPDATE_FAILED`, `GIT_STATE_UNREADABLE` (không đọc được `git status` hoặc quan hệ lịch sử: lỗi đọc **không** được coi là "sạch"), `GIT_DIFF_UNREADABLE` (không đọc được danh sách file bản cập nhật sẽ thêm: dừng trước khi merge để không ghi đè `.env`/file local), `UAT_SHA_MISMATCH`, `UAT_PIN_INVALID` (file pin hỏng thì **không** quay về main). `Status` có dòng `Chế độ cập nhật:` cho biết đang ở main hay UAT.

**Chạy lại launcher sau Update.** Nếu bản vừa kéo về thay đổi chính `11ship-launcher.ps1`, launcher cũ (vẫn đang chạy mã cũ) bàn giao khóa không có khoảng hở và chạy bản mới đúng **một lần** với `Update`, giữ nguyên các tùy chọn (`-Yes`, `-KeepDatabases`, `-ForceDependencies`) và exit code. Bản mới kiểm lại branch, SHA và nội dung launcher dưới khóa, không fetch lại, không tự chạy lại lần nữa; lệch gì là dừng (`RELAUNCH_SHA_MISMATCH`, `RELAUNCH_LAUNCHER_MISMATCH`, `RELAUNCH_LIMIT`, `RELAUNCH_ARGUMENTS_INVALID`). Cửa sổ hiện tại sau đó **không chạy thêm lệnh nào** (`LAUNCHER_RELOAD_REQUIRED`): đóng và mở lại launcher (nếu đang ở menu, chọn `0`). Lỗi của tiến trình mới trả về là `RELAUNCH_CHILD_FAILED` cùng exit code của nó; `RELAUNCH_FAILED` nghĩa là không khởi động/bàn giao được bản mới, khóa đã được trả.

Nếu không đọc được số migration mới sau Update, launcher in `MIGRATION_COUNT_UNREADABLE` (không phải "0 migration"); Start vẫn kiểm tra DB DEV và hỏi trước khi áp dụng.

HTTPS local và trình tự mở 11Food/11Ship nằm ở gói M00.05; Admin chờ M00.08.

## Định danh artifact và process (M00.03)

Launcher tách **bốn lớp** và không bao giờ coi chúng là một:

| Lớp | Là gì | Lưu ở đâu |
|---|---|---|
| Nguồn | commit đang checkout (`git HEAD`) | Git |
| Artifact | kết quả build `apps\backend\dist` | `apps\backend\dist\build-manifest.json`: `app_id`, `source_sha`, `build_fingerprint` (SHA-256 của mọi file build), `built_at`, `design_version`. Chỉ được ghi **sau** build thành công; build lỗi thì manifest cũ bị xóa trước khi build, không để lại fingerprint nhầm. |
| Process | tiến trình backend đang chạy | `.11ship-local\backend.json` (ghi lúc khởi động): `pid`, `started_utc`, `repo`, `executable`, `script`, `host`, `port`, `source_sha`, `build_fingerprint`, `built_at`, `design_version` |
| Cổng | ai đang lắng nghe `127.0.0.1:3000` | hệ điều hành (`Get-NetTCPConnection`) |

**Một process chỉ là "của launcher" khi tất cả đều đúng:** bản ghi đầy đủ và đúng kiểu, thuộc checkout này, cùng script/host/cổng hiện tại; PID còn sống **với đúng giờ khởi động đã ghi**; chương trình là `node` và đối số script là đúng `apps\backend\dist\main.js` của checkout này. Process còn tồn tại nhưng **không đọc được định danh** là chưa xác minh (`PROCESS_IDENTITY_UNVERIFIED`), không phải đã thoát; chỉ việc process biến mất hoặc có giờ khởi động khác (đọc được) mới chứng minh đã thoát. Stop và dọn dẹp nhắm đúng process đã xác minh (cùng handle, so giờ khởi động); nếu PID đã thuộc process khác thì không đụng tới, nếu không dừng được thì `PROCESS_STOP_FAILED` và chặn migration/restart. **Cổng là của launcher** chỉ khi mọi socket lắng nghe loopback/wildcard trên cổng đó đều thuộc đúng PID ấy. PID còn tồn tại, hoặc cổng trả HTTP 200 đúng nội dung `{"data":{"status":"ok"}}`, **không phải bằng chứng**: một dịch vụ lạ trả 200 vẫn bị từ chối.

**Start** làm theo thứ tự: kiểm tra định danh process/cổng (lỗi thì dừng, chưa build, chưa migration) -> build và ghi manifest -> (nếu còn migration) hỏi Owner, **sau khi Owner đồng ý** mới dừng backend cũ của launcher rồi áp dụng migration -> dùng lại backend nếu đã chứng minh là của launcher, đúng commit, đúng fingerprint, lắng nghe đúng cổng và health đúng nội dung; ngược lại dừng đúng process đó rồi khởi động lại -> chờ cho tới khi **chính process vừa khởi động** giữ cổng và cả hai health trả đúng nội dung. Mọi bước đổi artifact/process nằm dưới khóa dùng chung (M00.02).

**Update chỉ cập nhật mã nguồn và dependency.** Nó không build lại, không khởi động lại backend. Nếu backend của launcher đang chạy artifact build từ commit cũ, Update in `BACKEND_RUNNING_OLD_VERSION` (backend vẫn là bản cũ); chạy `11Ship-Start` để build, xác minh và khởi động lại đúng process đó. Update không bao giờ báo "đã chạy bản mới".

| Mã | Nghĩa | Việc cần làm |
|---|---|---|
| `PROCESS_IDENTITY_UNVERIFIED` | không chứng minh được backend đang ghi nhận là của launcher (bản ghi thiếu/hỏng/cũ, thuộc checkout khác, không đọc được, PID đúng giờ nhưng không phải node chạy script này) | launcher **không build, không migration, không dừng, không khởi động**, giữ nguyên bản ghi. Nếu chắc chắn không còn backend 11Ship nào: đóng process node đang giữ cổng 3000 (nếu có), xóa `.11ship-local\backend.json` rồi chạy lại |
| `PORT_IN_USE` | cổng 3000 do process không thuộc launcher giữ (kể cả khi nó trả HTTP 200) | tự đóng dịch vụ đó rồi chạy lại; launcher không bao giờ dừng nó |
| `PORT_OWNER_UNREADABLE` | không đọc được ai đang giữ cổng | chạy lại bằng PowerShell/Windows đủ quyền; launcher không coi cổng là trống |
| `APP_BUILD_FAILED` | `npm run build` lỗi hoặc không tạo ra file chạy | backend đang chạy (nếu có) không bị đụng tới; sửa lỗi build rồi Start lại |
| `ARTIFACT_UNREADABLE` | không đọc được file build để tính fingerprint | đóng chương trình đang giữ file rồi chạy lại |
| `BACKEND_START_FAILED` / `BACKEND_NOT_READY` | không khởi động được; process thoát sớm; không giữ cổng; health sai nội dung hoặc quá `45` giây | xem log trong `.11ship-local\logs` |
| `PROCESS_STOP_FAILED` | Windows từ chối dừng, hoặc process vẫn chạy sau 10 giây | bản ghi được giữ; không dùng cách mạnh hơn, không đụng process khác |
| `STATE_WRITE_FAILED` | không ghi được manifest/bản ghi (ghi tạm rồi đổi tên; tệp cũ giữ nguyên) | kiểm tra quyền ghi `.11ship-local` và `apps\backend\dist` |
| `LAUNCH_LOCK_REQUIRED` | lỗi lập trình: một bước đổi artifact/process bị gọi khi chưa giữ khóa | báo lại; chưa làm gì cả |

**Chi phí một lần khi nâng cấp từ launcher cũ:** `backend.json` cũ chỉ có `pid` và `startedUtc` nên không đủ để chứng minh. Nếu lúc nâng cấp backend vẫn đang chạy, Start và Stop sẽ dừng với `PROCESS_IDENTITY_UNVERIFIED` (đúng thiết kế: launcher không tắt process mà nó không chứng minh được). Hãy đóng cửa sổ/process node của backend cũ, xóa `.11ship-local\backend.json`, rồi Start lại một lần.

Giới hạn hiện tại: định danh áp dụng cho **backend**. Các bề mặt web (Admin/Food/Ship) dùng cùng cơ chế khi chúng có máy chủ riêng (M00.05 trở đi). Smoke test trên máy Owner chưa chạy; xem `docs/evidence/M00-03-artifact-process-identity.md`.

## Mở bằng double-click hay từ terminal

- Double-click (hoặc shortcut Desktop): khi lệnh xong, cửa sổ dừng ở dòng `Nhấn Enter để đóng cửa sổ` cả khi THÀNH CÔNG lẫn THẤT BẠI.
- Chạy từ terminal đang mở (cmd, PowerShell, VS Code) hoặc khi output/input bị redirect: lệnh kết thúc ngay, không chờ phím.
- Muốn chắc chắn không chờ (script tự động): thêm `-NoPause` hoặc đặt `SHIP11_NO_PAUSE=1`.
- Kết quả lệnh gần nhất cũng được ghi ở `.11ship-local\last-run.json`.

## Lần đầu

1. Tạo `.env` từ `.env.example`, điền secret local; không commit file này.
2. Chạy `11Ship-Update.cmd` (không cần cờ nào; launcher tự cài dependency và ghi nhận lockfile).
3. Chạy `11Ship-Start.cmd`, đọc đúng đích `ship11_dev` và danh sách migration rồi xác nhận.
4. Mở `http://127.0.0.1:3000/v1/health/ready` hoặc chạy Status.

## Đọc kết quả

- `Test gần nhất: PASS/FAIL` chỉ hiện khi summary thuộc đúng commit đang checkout. Sau Update hoặc commit mới, Status hiện `STALE` cho tới khi chạy lại Test.
- Mỗi lỗi có `mã lỗi` cố định, ví dụ `DIRTY_TRACKED`, `UNTRACKED_COLLISION`, `DETACHED_HEAD`, `NO_UPSTREAM`, `NON_FAST_FORWARD`, `LAUNCH_LOCK_TIMEOUT`, `DOCKER_UNAVAILABLE`, `MIGRATION_DECLINED`, `PORT_IN_USE`, `TEST_TARGET_GUARD`. Gửi mã này khi cần hỗ trợ.
- Ba lối vào ứng dụng thêm các mã: `APP_NOT_READY` (kèm danh sách còn thiếu), `APP_RUNTIME_MISSING`, `APP_LAUNCH_SEQUENCE_MISSING`, `APP_NOT_SPECIFIED`, `APP_UNKNOWN`, `APP_LAUNCH_NOT_IMPLEMENTED`.
- `11Ship-Test` luôn xóa tạm `TEST_WRONG_USER_DATABASE_URL`, `TEST_REMOTE_PATH_DATABASE_URL`, `TEST_REMOTE_PATH_RUNTIME_URL` và `PGPASSWORD` khỏi môi trường của mọi bước npm (kể cả khi terminal của bạn đang đặt các biến này) rồi khôi phục nguyên trạng sau khi xong hoặc khi lỗi. Các biến này chỉ dành cho CI; Test local chỉ chạm `ship11_test` cổng 5433.
- Mật khẩu DB TEST có thể chứa ký tự đặc biệt (`@ / # : %`...). Launcher lấy mật khẩu từ container `ship11-db-test` đang chạy và mã hóa URI trước khi tạo `DATABASE_URL`.

Launcher không chạy remote migration, không dùng staging/production, không tự stash/reset và không xóa volume. Khi FAIL, đọc đường dẫn log được in; không gửi `.env` cho người khác.
