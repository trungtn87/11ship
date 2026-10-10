# Kiểm DDL hợp đồng M01-D-ADMIN-1C (tài liệu kiểm chứng, có thể chạy lại)

Mục đích: chứng minh DDL trong `docs/tasks/M01-D-ADMIN-1C-technical-contract.md` §5 hợp lệ trên PostgreSQL 16. **Không phải CI, không phải test sản phẩm, không nằm trong pipeline.** Không file nào ở đây được import bởi code sản phẩm.

## Chạy

```bash
PGHOST=<socket-hoặc-host> PGPORT=<port> PGUSER=<role-có-quyền-CREATE-DATABASE> \
  bash docs/verification/m01-d-admin-1c-ddl/run.sh
```

Yêu cầu: `psql`, `python3`, một server PostgreSQL 16 (superuser tạm là đủ). Script tự tạo hai database `c1v_<pid>_a/_b` và xóa khi xong; không chạm database nào khác.

## Script làm gì

0. Kiểm 6 file SQL trong `sql/` **trùng từng byte** với khối ```sql trong hợp đồng §5 (chống lệch tài liệu ↔ file chạy).
1. DB1: áp phần `Up Migration` của mọi migration trong `database/migrations/` (đúng thứ tự tên file), rồi `A-up`, `B-up`, `C-up`; chạy `scenarios.sql`; đếm `PASS`/`FAIL`.
2. DB1: `B-down` phải **từ chối** khi còn bucket `ACTIVATION_*`.
3. DB2: Up → `C-down`, `B-down`, `A-down` → kiểm 4 bảng 1C đã gỡ → Up lại → chạy lại kịch bản, số PASS phải bằng lần đầu.

Mã thoát 0 và dòng `RESULT: OK` khi mọi bước đạt.

## File

| File | Vai trò |
|---|---|
| `sql/A-up.sql`, `A-down.sql` | Migration A (attempt, OTP challenge, profile, permissions) |
| `sql/B-up.sql`, `B-down.sql` | Migration B (kind limiter) |
| `sql/C-up.sql`, `C-down.sql` | Migration C tùy chọn (origin guard) |
| `sql/scenarios.sql` | 65 kịch bản tự kiểm; mỗi ca in `PASS`/`FAIL` kèm SQLSTATE (và tên constraint khi cần) |
| `last-run.log` | Đầu ra của lần chạy đã ghi trong hợp đồng §5.4 |

## Giới hạn

Chỉ kiểm DDL trên database trống. Không kiểm service, khóa đồng thời nhiều phiên, hay HTTP; các phần đó nằm ở kế hoạch test K1–K22 của hợp đồng và thuộc PR triển khai. Chưa có runner CI cho script này.
