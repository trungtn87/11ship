# 11Ship Local Test Launcher — Windows

Task M00-L. Chỉ hỗ trợ Windows; chạy từ `tools\local`. Repo hiện chỉ có backend, nên web/app hiển thị N/A.

## Dùng hằng ngày

- `11Ship.cmd`: menu một cửa. Nhập số rồi Enter; sau mỗi việc menu hiện lại kèm kết quả THÀNH CÔNG/THẤT BẠI, chọn `0` để thoát.
- `11Ship-Start.cmd`: bật hai DB, build và chạy backend. Launcher đọc trạng thái migration **trực tiếp trong PostgreSQL DEV** (bảng `public.pgmigrations`), liệt kê migration còn thiếu và luôn hỏi trước khi áp dụng.
- `11Ship-Update.cmd`: fetch và chỉ fast-forward; dừng nếu local changes không an toàn. Tự chạy `npm ci` khi lockfile khác lần cài đã ghi nhận, thiếu `node_modules` hoặc launcher chưa ghi nhận lần cài nào (lần chạy đầu).
- `11Ship-Test.cmd`: chạy kiểm tra kỹ thuật với riêng `ship11_test` cổng 5433, lưu log đã ẩn secret trong `.11ship-local\logs`.
- `11Ship-Stop.cmd`: dừng backend và DB nhưng giữ volume DEV. Thêm `-KeepDatabases` để chỉ dừng backend.
- `11Ship-Status.cmd`: xem Git, toolchain, DB, backend và test gần nhất.

Có thể tạo shortcut bằng mục 6 trong menu hoặc:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\local\11ship-launcher.ps1 -Command InstallShortcut
```

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
- Mật khẩu DB TEST có thể chứa ký tự đặc biệt (`@ / # : %`...). Launcher lấy mật khẩu từ container `ship11-db-test` đang chạy và mã hóa URI trước khi tạo `DATABASE_URL`.

Launcher không chạy remote migration, không dùng staging/production, không tự stash/reset và không xóa volume. Khi FAIL, đọc đường dẫn log được in; không gửi `.env` cho người khác.
