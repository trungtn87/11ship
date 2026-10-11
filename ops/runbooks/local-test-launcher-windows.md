# 11Ship Local Test Launcher — Windows

Task M00-L. Chỉ hỗ trợ Windows; chạy từ `tools\local`. Repo hiện chỉ có backend, nên web/app hiển thị N/A.

## Dùng hằng ngày

- `11Ship.cmd`: menu một cửa. Nhập số rồi Enter; sau mỗi việc menu hiện lại kèm kết quả THÀNH CÔNG/THẤT BẠI, chọn `0` để thoát.
- `11Ship-Start.cmd`: bật hai DB, build và chạy backend. Launcher đọc trạng thái migration **trực tiếp trong PostgreSQL DEV** (bảng `public.pgmigrations`), liệt kê migration còn thiếu và luôn hỏi trước khi áp dụng.
- `11Ship-Update.cmd`: fetch và chỉ fast-forward; dừng nếu local changes không an toàn. Tự chạy `npm ci` khi lockfile khác lần cài đã ghi nhận, thiếu `node_modules` hoặc launcher chưa ghi nhận lần cài nào (lần chạy đầu).
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
| `11Ship-Admin.cmd` | Web Admin | https://localhost:8443 | Chưa mở được: `LAUNCH_LOCK_MISSING` (M00.02), `ARTIFACT_IDENTITY_MISSING` (M00.03) |
| `11Ship-Food.cmd` | 11Food (khách + quán) | https://localhost:8444 | Chưa mở được: hai mã trên và `APP_RUNTIME_MISSING` (chưa có máy chủ chạy thật; M00.05/M00.06) |
| `11Ship-Ship.cmd` | 11Ship (xế) | https://localhost:8445 | Chưa mở được: hai mã trên và `APP_RUNTIME_MISSING` (M00.05/M00.07) |

- Khi chưa sẵn sàng, launcher thoát với **exit code 1** trước mọi tác động: không cập nhật mã, không bật database hoặc backend, không mở trình duyệt, không đụng tới `.env` hay database (chỉ ghi bản ghi kết quả `.11ship-local\last-run.json`). Nó không bao giờ báo "đã chạy".
- Không có app "Quán" riêng: quán thuộc 11Food, 11Ship chỉ dành cho xế.
- Web Admin chưa mở dù đã có `scripts/admin-web-dev.mjs`: khi chưa có khóa dùng chung và chưa xác minh được process/cổng thuộc launcher, một dịch vụ lạ trên cổng 8443 có thể bị nhận nhầm là Admin. Bản xem thử `Xem-Giao-Dien.cmd` (dữ liệu minh họa) không phải ứng dụng và không được dùng thay.
- Double-click: cửa sổ giữ lại để đọc lỗi; từ terminal lệnh kết thúc ngay; `-NoPause` dùng được như các lệnh khác. Kết quả ghi ở `.11ship-local\last-run.json` với `command` là `App Admin`, `App Food` hoặc `App Ship`.
- Các gói sau (M00.02, M00.03, M00.05 đến M00.09) lần lượt thêm khóa, định danh artifact/process và máy chủ rồi mới bật việc mở ứng dụng; gói M00.01 không làm các việc đó.

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
- Mỗi lỗi có `mã lỗi` cố định, ví dụ `DIRTY_TRACKED`, `UNTRACKED_COLLISION`, `DETACHED_HEAD`, `NO_UPSTREAM`, `NON_FAST_FORWARD`, `DOCKER_UNAVAILABLE`, `MIGRATION_DECLINED`, `PORT_IN_USE`, `TEST_TARGET_GUARD`. Gửi mã này khi cần hỗ trợ.
- Ba lối vào ứng dụng thêm các mã: `APP_NOT_READY` (kèm danh sách còn thiếu), `APP_RUNTIME_MISSING`, `LAUNCH_LOCK_MISSING`, `ARTIFACT_IDENTITY_MISSING`, `APP_NOT_SPECIFIED`, `APP_UNKNOWN`, `APP_LAUNCH_NOT_IMPLEMENTED`.
- `11Ship-Test` luôn xóa tạm `TEST_WRONG_USER_DATABASE_URL`, `TEST_REMOTE_PATH_DATABASE_URL`, `TEST_REMOTE_PATH_RUNTIME_URL` và `PGPASSWORD` khỏi môi trường của mọi bước npm (kể cả khi terminal của bạn đang đặt các biến này) rồi khôi phục nguyên trạng sau khi xong hoặc khi lỗi. Các biến này chỉ dành cho CI; Test local chỉ chạm `ship11_test` cổng 5433.
- Mật khẩu DB TEST có thể chứa ký tự đặc biệt (`@ / # : %`...). Launcher lấy mật khẩu từ container `ship11-db-test` đang chạy và mã hóa URI trước khi tạo `DATABASE_URL`.

Launcher không chạy remote migration, không dùng staging/production, không tự stash/reset và không xóa volume. Khi FAIL, đọc đường dẫn log được in; không gửi `.env` cho người khác.
