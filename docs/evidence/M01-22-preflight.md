# M01.22 — preflight trước khi sửa code

Ngày 11/10/2026 (Asia/Ho_Chi_Minh). Người thực hiện: Claude. Gói duy nhất: hộp OTP test local và công cụ lấy mã trên PC.
Tài liệu này ghi nguồn, SHA, mapping file thật và các khác biệt tìm thấy **trước** khi viết code. Không có kết luận kiểm thử nào ở đây.

## 1. Nguồn và SHA

| Nguồn | SHA / ref | Ghi chú |
|---|---|---|
| main (base của branch implementation) | `db1b4a571a78b9d688dfa05b2204931e1d728fd0` | Chỉ hơn `7c92507` đúng 1 commit, chỉ đổi `docs/PROGRESS.md` (bot). Không ảnh hưởng gói. |
| Base ghi trong task doc | `7c9250731cfb2615cfec600af72505a0caeb9fe6` | `compare` với main: ahead_by 1, file đổi `docs/PROGRESS.md`. |
| PR #63 (task doc) | head `1146a8effa165a876bebeda92a0e8d508ac93fe2` | Khớp head thiết kế yêu cầu. Chỉ thêm `docs/tasks/M01-22-test-sms-local-handoff.md`. Draft, base main. |
| PR #48 (thiết kế v2) | head `f135f4562513718555d67b605690f296f6455ec8` | 129 file. Không kéo vào branch. Chỉ đọc. |
| revision09 §5 | `docs/design/system-v2-20261011/09-m01-user-admin-test-sms.md` @ `f135f45` | Không đổi giữa `eedb55d` và `f135f45`. |
| task .22 trong #48 | `claude-tasks/M01.22.md` @ `eedb55d366b4b066529502ce268f76c7fd2addb4` và @ `f135f45` | Hai bản **giống hệt từng byte**. |
| contract10 / contract11 | `docs/design/system-v2-20261011/10-m01-client-contract.md`, `11-m01-session-device-contract.md` trên main | Có trên main. Contract10 chỉ nhắc `TEST_INBOX … chỉ local; SMS vendor M12.12`; không mâu thuẫn. |
| M01.02 schema (dependency của M01.01) | merge `88c3d3d39c96c78a79fa2823a7587eb216c81739` | Gói .22 không cần bảng/migration mới. |

Đã đọc đủ `AGENTS.md`, `CLAUDE.md`, `docs/process/11ship-delivery-workflow.md` trên main (gồm mục “Bổ sung Owner 11/10/2026 — merge từng gói nhỏ”).

## 2. Đối chiếu dependency với code thật

**M01.01.** Là gói contract (tài liệu), đã trên main. .22 không gọi endpoint `client-auth` nào của .03/.04 (chưa có). OTP core hiện có là nguồn duy nhất:
`auth/verification-service.ts` sinh OTP 6 số (`OTP_LENGTH = 6`), gọi `OtpProvider.sendRegisterOtp` **ngoài transaction** với timeout `OTP_PROVIDER_TIMEOUT_MS = 5000`, lỗi/timeout → `markDeliveryFailed` + 503 đã sanitize.
`admin-activation/admin-activation-service.ts` gọi `ActivationOtpProvider.send` ngoài transaction, timeout `ADMIN_ACTIVATION_OTP_PROVIDER_TIMEOUT_MS`, mọi exception/timeout → `UNKNOWN`.

**M00.08.** Trong PR #48, `M00.08` là gói **“Tích hợp Admin login và Authenticator”** (INTEGRATION), không phải nền local. Task doc #63 tự dặn “không suy từ số gói”. Nền local thật trên main là **M00-L Local Test Launcher**: `tools/local/11ship-launcher.ps1`, 6 wrapper `.cmd`, `ops/runbooks/local-test-launcher-windows.md`, `docs/evidence/M00-L.md`, job CI `launcher-windows` (windows-2022, PowerShell 5.1).
Điểm tương thích đã kiểm trong code launcher:
- Backend được chạy bằng `node --env-file-if-exists=.env apps/backend/dist/main.js`, `WorkingDirectory = repo`, nên cấu hình mới đi qua `.env`; **launcher không cần sửa**.
- Launcher bắt `APP_ENV=development` và `DATABASE_URL` đúng `ship11_dev@127.0.0.1:5432` (`DEV_TARGET_GUARD`).
- Launcher nhận diện process sở hữu bằng PID + `StartTime` UTC (`Get-OwnedBackendProcess`), cùng nguyên tắc ownership/PID/start-time mà .22 yêu cầu.
- Thư mục trạng thái local là `.11ship-local/` (đã có trong `.gitignore`).
Kết luận: có bằng chứng tương thích (M00-L), **không có blocker**. Owner acceptance của M00-L không phải điều kiện của gói này.

## 3. Mapping file thật (so với “dự kiến” trong §8 task doc)

| Dự kiến | Thực tế trên main | Hành động |
|---|---|---|
| `apps/backend/src/test-sms/` | chưa có | tạo mới |
| `auth/otp-provider-binding.ts` | có (`bindOtpProvider`) | thêm nhánh TEST_INBOX, giữ nguyên các nhánh cũ |
| `admin-activation/activation-otp-providers.ts` | có (`bindActivationOtpProvider`) | thêm nhánh TEST_INBOX |
| delivery port type | `auth/otp-provider.ts`, `admin-activation/activation-otp-provider.ts` | **không đổi** port; `ActivationOtpMode` mở rộng thêm `TEST_INBOX` |
| config parser | `config/app-config.ts`, `config/admin-activation-config.ts` | thêm khóa mới, giữ khóa cũ |
| bootstrap | `main.ts`, `app.module.ts` | wiring lifecycle |
| `tools/local/11ship-test-sms.cmd` | `tools/local/` có 6 wrapper launcher | thêm 1 wrapper riêng |
| `scripts/test-sms-inbox.mjs` | `scripts/` có | tạo mới |
| `tests/integration/`, unit | `tests/integration/*.int.spec.ts`, unit `*.spec.ts` cạnh source | thêm |
| `ops/runbooks/`, `docs/evidence/` | có | thêm runbook + evidence |

## 4. Khác biệt và quyết định (cần ChatGPT/Owner biết)

1. **`OTP_PROVIDER` chưa phải biến môi trường.** Trên main nó chỉ là *tên* đưa vào `StartupConfigError(['OTP_PROVIDER'])` khi staging/production không có provider. REGISTER provider hiện được chọn **chỉ** theo `APP_ENV` (development/test → `FakeOtpProvider`). Vì vậy dùng `OTP_PROVIDER=TEST_INBOX` là **thêm biến mới, không đổi nghĩa biến cũ**; không đặt biến thì hành vi cũ giữ nguyên. Giá trị lạ → startup lỗi chỉ nêu tên `OTP_PROVIDER`. Thông báo staging/production hiện có (“OTP_PROVIDER”) vẫn đúng nghĩa.
2. **`ADMIN_ACTIVATION_OTP_MODE`** có enum `FAKE|TEST_DISPLAY|SMS`; thêm `TEST_INBOX`, coi là test mode (chỉ `development|test`). Khi `ADMIN_ACTIVATION_ENABLED` không bật thì chế độ không được dùng (như hiện tại).
3. **“Target local được guard”** được hiện thực là: `APP_ENV` ∈ {development, test} **và** `HOST` là loopback **và** host của `DATABASE_URL` là loopback. Thiếu một điều kiện → startup fail, không fallback. Đây là cách hiểu của Claude cho cụm “guard local”; nếu ChatGPT muốn guard khác thì báo.
4. **`tests/local-launcher/launcher.test.mjs`** khẳng định danh sách `.cmd` trong `tools/local` **đúng bằng** 6 wrapper launcher. Thêm `11ship-test-sms.cmd` bắt buộc đổi assertion này. Cách làm: giữ nguyên assertion cho 6 wrapper launcher, tách riêng assertion cho tool SMS. Không làm yếu kiểm tra nào của launcher; hành vi launcher không đổi. Ghi rõ để review.
5. **Đường dẫn discovery state:** `.11ship-local/test-sms/state.json` trong repo (đã `.gitignore`, là convention local thật của launcher). “Ngoài Git” được hiểu là **không được Git theo dõi**; thư mục `test-sms` được tạo/kiểm private riêng (Unix `0700`/`0600`, Windows ACL chỉ current user).
6. **Môi trường sandbox của Claude không đủ cho bằng chứng chính thức:** Node 22.22.0 (repo cần 24.21.0), không có Docker daemon, chỉ có binary PostgreSQL 16, không có Windows. Hệ quả: CI trên đúng final SHA (Node 24.21.0, PG17.11, `windows-2022`) là bằng chứng chính thức; kết quả chạy tạm trong sandbox được ghi riêng và không dùng để claim PASS.
7. **CI:** thêm step cho tool SMS vào job `launcher-windows` đã có (windows-2022) để có bằng chứng ACL/PID start-time/`cmd` wrapper thật trên Windows. Đây không phải double-click tương tác của Owner; mục đó vẫn **CHƯA CHẠY** cho tới khi test thật.
8. **Phạm vi không làm** (theo task): .03, .04, reset .16, UI Auth, native binding, SMS thật, deploy/migration remote, `PROGRESS.md`/`plan.yml`. RESET_PASSWORD chỉ có trong enum purpose của inbox; **không có adapter reset**.
