# 11Ship Local Test Launcher — Windows

Task M00-L. Chỉ hỗ trợ Windows; chạy từ `tools\local`. Repo hiện chỉ có backend, nên web/app hiển thị N/A.

## Dùng hằng ngày

- `11Ship.cmd`: menu một cửa. Nhập số rồi Enter; sau mỗi việc menu hiện lại kèm kết quả THÀNH CÔNG/THẤT BẠI, chọn `0` để thoát.
- `11Ship-Start.cmd`: bật hai DB, build và chạy backend. Launcher đọc trạng thái migration **trực tiếp trong PostgreSQL DEV** (bảng `public.pgmigrations`), liệt kê migration còn thiếu và luôn hỏi trước khi áp dụng.
- `11Ship-Update.cmd`: fetch và chỉ fast-forward nhánh `main` theo `origin/main` (hoặc kiểm tra pin ở checkout UAT); dừng nếu local changes không an toàn. Nếu bản mới thay chính launcher, launcher cũ chạy bản mới đúng một lần (xem "Khóa dùng chung, cập nhật Git an toàn và chạy lại launcher"). Tự chạy `npm ci` khi lockfile khác lần cài đã ghi nhận, thiếu `node_modules` hoặc launcher chưa ghi nhận lần cài nào (lần chạy đầu).
- `11Ship-Test.cmd`: chạy kiểm tra kỹ thuật với riêng `ship11_test` cổng 5433, lưu log đã ẩn secret trong `.11ship-local\logs`.
- `11Ship-Stop.cmd`: dừng backend và DB nhưng giữ volume DEV. Thêm `-KeepDatabases` để chỉ dừng backend.
- `11Ship-Status.cmd`: xem Git, toolchain, DB, backend và test gần nhất.
- `11Ship-Admin.cmd`, `11Ship-Food.cmd`, `11Ship-Ship.cmd` (gói M00.01): ba lối vào riêng cho Web Admin, 11Food (khách + quán) và 11Ship (xế). **Hiện chưa mở được ứng dụng nào**: lệnh dừng ngay với exit code 1 và mã `APP_NOT_READY`, nói rõ còn thiếu gì và chưa làm gì cả. Xem mục "Ba lối vào ứng dụng".

Có thể tạo shortcut bằng mục 6 trong menu hoặc:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\local\11ship-launcher.ps1 -Command InstallShortcut
```

## Ba lối vào ứng dụng (M00.01)

Ba file `.cmd` chỉ chọn app rồi gọi **cùng một** launcher (`11ship-launcher.ps1 -Command App -App <tên>`). Repo được xác định từ vị trí script, nên chạy từ thư mục nào, kể cả đường dẫn có dấu hoặc khoảng trắng, đều dùng đúng checkout chứa wrapper.

| Lối vào | Ứng dụng | Địa chỉ dự kiến | Trạng thái hiện tại |
|---|---|---|---|
| `11Ship-Admin.cmd` | Web Admin | https://localhost:8443 | Chưa mở được: `ARTIFACT_IDENTITY_MISSING` (M00.03) |
| `11Ship-Food.cmd` | 11Food (khách + quán) | https://localhost:8444 | Chưa mở được: mã trên và `APP_RUNTIME_MISSING` (chưa có máy chủ chạy thật; M00.05/M00.06) |
| `11Ship-Ship.cmd` | 11Ship (xế) | https://localhost:8445 | Chưa mở được: mã trên và `APP_RUNTIME_MISSING` (M00.05/M00.07) |

- Khi chưa sẵn sàng, launcher thoát với **exit code 1** trước mọi tác động: không cập nhật mã, không bật database hoặc backend, không mở trình duyệt, không đụng tới `.env` hay database (chỉ ghi bản ghi kết quả `.11ship-local\last-run.json`). Nó không bao giờ báo "đã chạy".
- Không có app "Quán" riêng: quán thuộc 11Food, 11Ship chỉ dành cho xế.
- Web Admin chưa mở dù đã có `scripts/admin-web-dev.mjs`: khóa dùng chung (M00.02) đã có nhưng chưa xác minh được process/cổng thuộc launcher (M00.03), một dịch vụ lạ trên cổng 8443 có thể bị nhận nhầm là Admin. Bản xem thử `Xem-Giao-Dien.cmd` (dữ liệu minh họa) không phải ứng dụng và không được dùng thay.
- Double-click: cửa sổ giữ lại để đọc lỗi; từ terminal lệnh kết thúc ngay; `-NoPause` dùng được như các lệnh khác. Kết quả ghi ở `.11ship-local\last-run.json` với `command` là `App Admin`, `App Food` hoặc `App Ship`.
- Ba lối vào này vẫn từ chối **trước khi** lấy khóa: không Update, không Start, không tạo `launch.lock`. Các gói sau (M00.03, M00.05 đến M00.09) lần lượt thêm định danh artifact/process và máy chủ rồi mới bật việc mở ứng dụng.

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

Chưa nằm trong gói này: định danh artifact/process và restart đúng tiến trình (M00.03), HTTPS local (M00.05). Ba lối vào `Admin/Food/Ship` vẫn từ chối bằng `APP_NOT_READY`.

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
- Ba lối vào ứng dụng thêm các mã: `APP_NOT_READY` (kèm danh sách còn thiếu), `APP_RUNTIME_MISSING`, `ARTIFACT_IDENTITY_MISSING`, `APP_NOT_SPECIFIED`, `APP_UNKNOWN`, `APP_LAUNCH_NOT_IMPLEMENTED`.
- `11Ship-Test` luôn xóa tạm `TEST_WRONG_USER_DATABASE_URL`, `TEST_REMOTE_PATH_DATABASE_URL`, `TEST_REMOTE_PATH_RUNTIME_URL` và `PGPASSWORD` khỏi môi trường của mọi bước npm (kể cả khi terminal của bạn đang đặt các biến này) rồi khôi phục nguyên trạng sau khi xong hoặc khi lỗi. Các biến này chỉ dành cho CI; Test local chỉ chạm `ship11_test` cổng 5433.
- Mật khẩu DB TEST có thể chứa ký tự đặc biệt (`@ / # : %`...). Launcher lấy mật khẩu từ container `ship11-db-test` đang chạy và mã hóa URI trước khi tạo `DATABASE_URL`.

Launcher không chạy remote migration, không dùng staging/production, không tự stash/reset và không xóa volume. Khi FAIL, đọc đường dẫn log được in; không gửi `.env` cho người khác.
