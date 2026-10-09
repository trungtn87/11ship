# 11Ship Local Test Launcher — Windows

Task M00-L. Chỉ hỗ trợ Windows; chạy từ `tools\local`. Repo hiện chỉ có backend, nên web/app hiển thị N/A.

## Dùng hằng ngày

- `11Ship.cmd`: menu một cửa.
- `11Ship-Start.cmd`: bật hai DB, build và chạy backend; migration DEV luôn hỏi trước.
- `11Ship-Update.cmd`: fetch và chỉ fast-forward; dừng nếu local changes không an toàn.
- `11Ship-Test.cmd`: chạy kiểm tra kỹ thuật với riêng `ship11_test`, lưu log trong `.11ship-local\logs`.
- `11Ship-Stop.cmd`: dừng backend và DB nhưng giữ volume DEV. Thêm `-KeepDatabases` để chỉ dừng backend.
- `11Ship-Status.cmd`: xem Git, toolchain, DB, backend và test gần nhất.

Có thể tạo shortcut bằng:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\local\11ship-launcher.ps1 -Command InstallShortcut
```

## Lần đầu

1. Tạo `.env` từ `.env.example`, điền secret local; không commit file này.
2. Chạy `11Ship-Update.cmd -ForceDependencies`.
3. Chạy `11Ship-Start.cmd`, đọc đúng đích `ship11_dev` rồi xác nhận migration.
4. Mở `http://127.0.0.1:3000/v1/health/ready` hoặc chạy Status.

Launcher không chạy remote migration, không dùng staging/production, không tự stash/reset và không xóa volume. Khi FAIL, đọc đường dẫn log được in; không gửi `.env` hoặc log chứa credential cho người khác.
