# M00-L — Local Test Launcher cho Owner trên Windows

Ngày thiết kế: 2026-10-10. Trạng thái: **OWNER ĐÃ DUYỆT THIẾT KẾ; SẴN SÀNG GIAO CLAUDE**.

Quyết định Owner: Owner yêu cầu bộ launcher một cửa và xác nhận “duyệt thiết kế” trong phiên Codex ngày 2026-10-10. Tài liệu này không phải bằng chứng đã code, đã test hay đã nghiệm thu.

Base thiết kế: `46d21a92e9657bd16e4e64994c4c0023bc80288f` (`main`). Repo kiểm kê tại `D:\11Ship`.

## 1. Mục tiêu và hiện trạng đã kiểm tra

Owner có thể khởi động, cập nhật, test, dừng và xem trạng thái backend local bằng thao tác đơn giản, không cần nhớ lệnh Docker/npm.

Hiện trạng Windows lúc kiểm kê:

- Node `24.21.0`; đúng `.node-version`.
- npm `11.19.0`; khác bản khóa `npm@11.9.0`, launcher phải báo sai lệch và dùng `npm.cmd` để không vướng PowerShell ExecutionPolicy.
- Docker client/server `29.8.2`; Compose `5.5.1`.
- `db-dev` và `db-test` chạy healthy; backend chưa chạy, hai health endpoint không kết nối được.
- `test-integration.log` rỗng; không dùng làm bằng chứng PASS.
- Working tree có untracked `tore package.json`; không sửa, xóa, move, add hay overwrite file này.
- Repo hiện chỉ có backend. Không có web quản trị hoặc app Khách/Quán/Xế/App quản lý để launcher chạy. Không dựng giả và không gọi mock/ảnh là test nghiệp vụ.

## 2. Phạm vi đã duyệt

### 2.1 Giao diện Owner

Tạo một menu Windows `11Ship.cmd` với năm lựa chọn và năm entry point độc lập:

- `11Ship-Start.cmd`
- `11Ship-Update.cmd`
- `11Ship-Test.cmd`
- `11Ship-Stop.cmd`
- `11Ship-Status.cmd`

Các file `.cmd` chỉ là wrapper ổn định, gọi logic PowerShell trong repo. Thông báo hướng tới Owner dùng tiếng Việt, có exit code chuẩn và giữ cửa sổ mở khi khởi chạy bằng double-click để Owner đọc kết quả.

Shortcut Desktop là bước cài đặt tùy chọn, idempotent, không commit đường dẫn tuyệt đối hoặc file `.lnk` của riêng máy phát triển.

### 2.2 Start

Theo thứ tự fail-fast:

1. Xác định repo từ vị trí script, không phụ thuộc current directory.
2. Kiểm tra Windows, Node đúng `24.21.0`, npm major 11 và cảnh báo nếu khác `11.9.0`, Docker engine/Compose, `.env` và chỉ tên các biến bắt buộc; không in giá trị.
3. Bật `db-dev` và `db-test` bằng `docker compose up -d`, không recreate không cần thiết; chờ health có timeout hữu hạn.
4. Không tự chạy `npm ci` trong Start. Nếu dependencies thiếu/không khớp trạng thái lock đã ghi, hướng dẫn chạy Update.
5. Build backend. Nếu có migration DEV chưa áp dụng, hiển thị rõ và hỏi Owner trước khi chạy `npm run db:migrate`; không migrate staging/production/remote.
6. Chạy một backend duy nhất, lưu PID/state local có xác minh command/process; không giết process khác chỉ vì trùng PID hoặc cổng.
7. Chờ `/v1/health/live` và `/v1/health/ready`, báo URL và kết quả. Không tự mở hay báo web/app vì chưa tồn tại.

### 2.3 Update

- Fetch origin trước, không pull mù.
- Chỉ cho phép branch đã cấu hình; mặc định branch hiện tại phải có upstream và không detached.
- Nếu có thay đổi tracked, merge/rebase đang dở hoặc Git operation đang dở: dừng và giải thích. Không stash tự động.
- Không xóa/di chuyển/add untracked. Nếu untracked có nguy cơ bị file từ upstream ghi đè, dừng an toàn. `tore package.json` luôn được bảo toàn.
- Chỉ cập nhật bằng fast-forward; cấm reset, force, checkout phá hủy và merge commit tự động.
- Ghi hash `package-lock.json` đã cài. Chỉ chạy `npm.cmd ci` khi lock đổi, `node_modules` thiếu hoặc Owner yêu cầu `-ForceDependencies`. Chỉ cập nhật state sau khi thành công.
- So sánh migration trước/sau. Nếu có migration mới, chỉ đề nghị migration DEV và yêu cầu xác nhận; không tự chạy remote migration.
- Khi bất kỳ bước nào thất bại, dừng với exit code khác 0 và không tuyên bố đã cập nhật xong.

### 2.4 Test

- Chỉ dùng `db-test`/`ship11_test`; xác minh guard `APP_ENV=test`, database, user và cổng trước khi test.
- Không chạy integration suite vào DB DEV, staging hay production.
- Pipeline phù hợp repo hiện tại: lint → typecheck → build → deploy:test → unit → integration local mode → progress:test → progress:check.
- Dừng hoặc tiếp tục sau lỗi phải được chốt nhất quán; báo tổng hợp cuối cùng từng bước PASS/FAIL/SKIP và exit code khác 0 nếu có FAIL.
- Log UTF-8 theo timestamp trong thư mục local đã gitignore. Redact secrets/URL credential; không ghi toàn bộ `.env`.
- Integration local cho phép đúng các pending được CI mô tả; launcher không tuyên bố tương đương CI mode vì không có fixture admin/wrong-user/remote-path.
- Không reset/xóa DB DEV. TEST vẫn là tmpfs riêng theo `compose.dev.yml`.

### 2.5 Stop và Status

Stop:

- Dừng đúng backend do launcher quản lý sau khi xác minh state/process.
- Dùng `docker compose stop`; không `down -v`, không xóa volume `ship11_dev_data`.
- Có lựa chọn giữ DB chạy để test nhanh; mặc định dừng backend và hai service nhưng giữ dữ liệu DEV.

Status:

- Báo branch/upstream/ahead-behind và dirty state nhưng không liệt kê nội dung secret.
- Báo phiên bản Node/npm/Docker/Compose, trạng thái `db-dev`/`db-test`, backend PID/port và live/ready HTTP.
- Web quản trị, Khách, Quán, Xế, App quản lý: `N/A — chưa có trong repo`, không báo FAIL.
- Báo log test gần nhất và PASS/FAIL chỉ khi có summary hợp lệ gắn với commit SHA.

## 3. An toàn dữ liệu và bảo mật

- DEV giữ volume bền vững; TEST tách riêng và có thể bị dựng lại.
- Cấm `git reset --hard`, force push, tự stash, xóa untracked, `docker compose down -v`, chỉnh production, `db:migrate:remote` và mọi thao tác Supabase/Render.
- Không log password, token, crypto key, OTP secret, `DATABASE_URL` đầy đủ hoặc nội dung `.env`.
- Mọi prompt migration ghi rõ đích DEV, database/user/host đã redact và commit chứa migration.
- Script phải xử lý đường dẫn có khoảng trắng và ký tự đặc biệt; không giả định repo luôn ở `D:\11Ship`.

## 4. Cấu trúc triển khai đề xuất

- `tools/local/11Ship*.cmd`: wrapper/menu.
- `tools/local/11ship-launcher.ps1`: orchestration chính với subcommand.
- `tools/local/lib/*.ps1`: helper nhỏ nếu cần, tránh duplicate logic.
- `tests/local-launcher/*.Tests.ps1` hoặc test harness không cần module ngoài, tùy toolchain sẵn có.
- `.11ship-local/`: PID, lock hash, summary và log local; thêm vào `.gitignore`.
- `ops/runbooks/local-test-launcher-windows.md`: hướng dẫn Owner và troubleshooting.

Claude được phép điều chỉnh tên/thư mục nếu chứng minh phù hợp convention hiện có, nhưng không được đổi hợp đồng hành vi hoặc mở rộng phạm vi.

## 5. Test và bằng chứng bắt buộc

- Unit/behavior tests cho command construction, secret redaction, PID ownership, timeout và exit code.
- Guard tests: tracked dirty, untracked collision, detached/no-upstream, non-fast-forward, lock không đổi/đổi, migration prompt từ chối/chấp nhận, sai DB test, Docker unavailable, backend already running, stale PID.
- Chứng minh Stop không xóa volume và DEV data marker còn sau stop/start.
- Chứng minh integration chỉ trỏ `ship11_test` cổng 5433; negative test phải từ chối DB DEV.
- Smoke trên Windows thật: năm entry point, đường dẫn có khoảng trắng, double-click/menu, health endpoints.
- Chạy repository CI suite theo `.github/workflows/ci.yml`; phân biệt local mode và CI mode.
- Evidence ghi base SHA, code head, final head, Windows/Node/npm/Docker versions, câu lệnh, test count, PASS/FAIL/SKIP, log path, CI URL và giới hạn chưa kiểm chứng.

## 6. Gate và phân công

| Giai đoạn | Trạng thái | Người thực hiện / gate |
|---|---|---|
| Kiểm kê và thiết kế | Đã hoàn thành | Codex; Owner duyệt ngày 2026-10-10 |
| UI | N/A có lý do | Đây là launcher CLI Windows; thông điệp/menu trong hợp đồng trên, Owner đã duyệt |
| Code/test/build | Chưa thực hiện | Claude trên nhánh riêng từ base đã xác minh |
| Review | Chưa thực hiện | Codex review đúng final head; Claude sửa finding |
| Local Windows | Chưa nghiệm thu | Owner chạy đủ 5 entry point sau review |
| Thiết bị thật | N/A cho task launcher | Không có app mobile trong repo; Owner xác nhận N/A khi nghiệm thu task |
| Merge/đóng | Chưa được phép | Chỉ Owner quyết định |

## 7. Ma trận ứng dụng

| Ứng dụng | Phạm vi M00-L | Thiết kế | Code/CI/review | Local | Thiết bị thật | Owner nghiệm thu |
|---|---|---|---|---|---|---|
| Backend local | Start/Update/Test/Stop/Status | Đã duyệt | Chưa kiểm chứng | Chưa kiểm chứng | N/A | Chưa kiểm chứng |
| Web quản trị | Chưa có trong repo | N/A | N/A | N/A | N/A | Chưa kiểm chứng N/A |
| Khách | Chưa có trong repo | N/A | N/A | N/A | N/A | Chưa kiểm chứng N/A |
| Quán | Chưa có trong repo | N/A | N/A | N/A | N/A | Chưa kiểm chứng N/A |
| Xế | Chưa có trong repo | N/A | N/A | N/A | N/A | Chưa kiểm chứng N/A |
| App quản lý | Chưa có trong repo | N/A | N/A | N/A | N/A | Chưa kiểm chứng N/A |
| Liên thông | DB DEV/TEST và backend | Đã duyệt | Chưa kiểm chứng | Chưa kiểm chứng | N/A | Chưa kiểm chứng |

## 8. Điều kiện bàn giao lại

Claude giữ PR Draft, không merge/Ready. Bàn giao final SHA và evidence. Codex review độc lập; Owner chỉ test local sau khi review head hiện tại đạt. Không tuyên bố M00 hoàn thành từ việc launcher CI xanh.
