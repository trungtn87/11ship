# M01.22 — hộp OTP test local và công cụ PC, gói giao Claude

Ngày 11/10/2026, phiên bản 2.0.3. HANDOFF_READY_LOCAL sau kiểm tra dependency nền local; chưa triển khai.
Base main refresh: 7c9250731cfb2615cfec600af72505a0caeb9fe6. ChatGPT thiết kế/review; Claude code/test/build; Owner local/phone/nghiệm thu.
Áp dụng [workflow](../process/11ship-delivery-workflow.md) và [mẫu gate](../templates/module-delivery-checklist.md).
Nguồn Owner: yêu cầu backend SMS test, SMS vendor cuối dự án; phản hồi “Ok” 11/10/2026 13:48 Asia/Ho_Chi_Minh đồng ý tiếp hoàn thiện M01.22 trước M01.03.
Không coi quyết định tiếp là nghiệm thu code hoặc duyệt UI sản phẩm mới.

## 1. Nguồn và kiểm kê

Nguồn thiết kế [revision09 §5](https://github.com/trungtn87/11ship/blob/docs/three-app-system-design-20261011/docs/design/system-v2-20261011/09-m01-user-admin-test-sms.md) và [task .22](https://github.com/trungtn87/11ship/blob/eedb55d366b4b066529502ce268f76c7fd2addb4/docs/design/system-v2-20261011/claude-tasks/M01.22.md). Claude fetch #48, ghi source SHA hiện hành và diff; ưu tiên các boundary exact §2–6 dưới đây.
M01.01 contract10/11 đã trên main. M00.08 nền local: kiểm implementation launcher/local config thật trước wiring; chưa có evidence tương thích thì báo blocker cụ thể, không suy từ số gói.
Đã đọc fake-otp-provider.ts: REGISTER provider memory, không log, có failure/barrier controls.
Đã đọc activation-otp-providers.ts: FAKE/TEST_DISPLAY; ACCEPTED/REJECTED/UNKNOWN; UNKNOWN vẫn có thể lưu mã. Binding không có TEST_INBOX.
Code cũ hiện đã tạo/verify OTP thật bằng core nhưng Owner chưa có công cụ đọc inbox.
M01.03 chưa endpoint; legacy register hiện có có thể dùng test core, không gọi legacy behavior là register CUSTOMER mới.

## 2. Phạm vi

Một backend-owned in-memory TestSmsInbox; adapters REGISTER và ADMIN_ACTIVATION; config explicit TEST_INBOX; listener riêng loopback; công cụ CMD/CLI đọc mã; runbook và technical tests.
RESET_PASSWORD là future DTO/port integration .16, không code reset ở đây.
Không SMS telecom/vendor, gateway/modem, fixed OTP, auto-verify, public OTP endpoint, thay TOTP, remote deployment/APP_ENV, schema business migration hoặc UI Auth mới.
Không app thứ tư, không thay ba launcher. Tool read-only, không gửi OTP/resend/register/verify/login/reset hộ.
Sau triển khai .22, PR .03 mới kiểm luồng inbox→proof→CUSTOMER end-to-end.

## 3. Config và startup boundary

TEST_INBOX chỉ APP_ENV=development|test trên target local được guard.
Khóa config đề xuất: OTP_PROVIDER=TEST_INBOX cho REGISTER; ADMIN_ACTIVATION_OTP_MODE=TEST_INBOX cho activation, giữ giá trị/behavior cũ khi không chọn TEST_INBOX.
Claude đối chiếu parser thật; nếu OTP_PROVIDER đã có ý nghĩa khác thì báo mapping/conflict trước sửa, không silently repurpose.
Một instance inbox dùng chung adapters và listener. Không listener chỉ vì APP_ENV dev/test; phải có TEST_INBOX explicit.
Staging/production từ chối mọi TEST_INBOX selection trước mở listener hoặc nhận request; không fallback.
Giữ FAKE/TEST_DISPLAY compatibility trong tests và mode explicit hiện hành. Không bật TEST_DISPLAY khi chọn inbox; public activation không trả displayedCode qua inbox.
Nếu thiếu private ACL/chmod hoặc guard local/bind loopback không đạt: fail startup; cleanup resources đã mở. Không report READY khi listener/state incomplete.
Public backend/API giữ local binding policy, không tự mở 0.0.0.0 để điện thoại test. Phone transport là task runtime/TLS riêng, không mở public inbox.

## 4. Inbox và send outcomes

Message internal exact:
message_id UUID ngẫu nhiên server; purpose REGISTER|RESET_PASSWORD|ADMIN_ACTIVATION;
phone_normalized; otp string 6 digits do core cung cấp; received_at ISO UTC server;
channel SIMULATED_SMS.
Không lưu challenge_id/expiry suy đoán khi port hiện hành không cung cấp. Core DB quyết định expiry/proof validity.
Retention10 phút, cap100; purge expired trước insert/read, vượt cap loại oldest theo insert order, tie thời gian không gây nondeterministic ordering. Backend stop/restart mất mọi message.
Không ghi OTP/phone/token inbox vào DB/audit/outbox/log/file. Tool terminal hiển thị mã là thao tác xem có chủ đích.
REGISTER resolve chỉ sau append thành công; reject/timeout giữ contract main. ADMIN outcome giữ ACCEPTED/REJECTED/UNKNOWN, không coercion; append xong lost response có thể còn message, challenge core vẫn authority.
Provider call ngoài business DB lock/transaction. Không tự retry send unknown. Failure injection chỉ automated isolated tests.
Inbox không reset attempts/cooldown và không tự consume OTP; xem mã không đổi challenge.
Mã vào inbox chỉ là SIMULATED_SMS; không chứng minh SMS đến điện thoại hoặc sở hữu SĐT thật.

## 5. Listener và discovery state

Listener 127.0.0.1, OS-assigned random port, tách public API port/proxy; không CORS/public route/redirect.
Token CSPRNG256bit rotate mỗi backend start, chỉ Authorization Bearer header.
File discovery ngoài Git, quyền current OS user, gồm endpoint loopback/port/token + backend PID/start-time/repo identity/protocol version.
Claude chọn path theo local state convention thật, document exact path; không đặt token trong argv/env echo/URL.
Unix file0600 và private parent; Windows ACL chỉ current OS user theo cơ chế platform đã kiểm. Không hứa hỗ trợ quyền file bằng chmod trên Windows.
Atomic publish state sau listener sẵn sàng; không follow symlink/reparse location ngoài ownership boundary; fail khi state file/path không private hoặc owner mismatch.
Cleanup chỉ xóa own instance state qua PID/start-time/instance identity match. Process cũ không xóa state backend mới. Không kill PID từ state.
Tool verify repo/current user/PID start-time và loopback endpoint trước gửi token; stale/malformed/unowned state không kết nối.
Backend restart: token đổi, inbox rỗng; tool đọc lại state owned để reconnect. Không lưu token cũ như fallback.
Listener reject browser Origin kể cả null; public API proxy không mount đường đọc mã. No-store/no-cache mọi response/error.
Quotas60 request/phút burst10/token; định nghĩa token bucket capacity10/refill1 mỗi giây. Invalid-auth requests không cấp token access và cần bounded transport abuse handling theo server convention; không log Authorization.
Không tạo listener khi mode off; startup/restart/shutdown tests phải kiểm.

## 6. Exact private tool API

| Method | Request | Success |
|---|---|---|
| GET /messages | Bearer private token; purpose optional enum, phone optional theo VN normalizer; limit1–20 default20; không extra keys/duplicate query | 200 {data:{items:[{message_id,purpose,phone_masked,received_at,channel}]}} newest-first; không otp/phone_normalized |
| GET /messages/:message_id | Bearer; UUID canonical; không query/body | 200 {data:{message_id,purpose,phone_normalized,otp,received_at,channel}} nếu chưa purge |

Masked phone: chỉ giữ ba số cuối, các ký tự trước là *; normalize từ core, không display raw phone trong list.
401 missing/wrong token;403 request có Origin;404 unknown/purged;400 invalid query/ID;405 other method;429 quota, Retry-After typed; infrastructure500/503 fixed no secrets.
Token auth trước trả metadata/errors resource; constant-time digest comparison khi feasible theo primitive hiện hành, không raw token logs.
Không DELETE/purge/send endpoints; không mutation listener.
No request body được chấp nhận ở GET; bound URL/header/body theo HTTP convention, không unlimited input.
Tool API không product API /v1; dùng cùng safe error conventions nhưng không mở rộng public API contract.

## 7. Tool Owner và bản chạy

tools/local/11ship-test-sms.cmd gọi scripts/test-sms-inbox.mjs, giữ cửa sổ mở để đọc.
Khung terminal:
- “SMS TEST — KHÔNG GỬI SMS THẬT”
- Nhập số test (chỉ memory) và chọn REGISTER hoặc ADMIN_ACTIVATION.
- Danh sách tối đa20 mã theo metadata newest-first; chọn bản tin để xem mã/purpose/time.
- Làm mới, chọn số/purpose lại, thoát. Không có chức năng gửi hoặc xác minh.
Không tự chọn một mã thành còn hiệu lực: nhãn “Thời hạn do màn OTP quyết định”; resend có thể invalid code cũ.
Không mã: “Chưa có OTP test phù hợp. Hãy yêu cầu mã từ màn đăng ký/kích hoạt.”
Backend chưa chạy: hướng dẫn mở launcher hiện có, không tự start/kill/reset DB.
Restart: “Backend đã khởi động lại; hộp test đã được làm trống. Yêu cầu lại OTP từ màn tương ứng khi được phép.”
Timeout/401 do restart: re-read owned state rồi retry GET bounded; không send/resend; state vẫn sai thì thông báo cần mở lại tool.
Không auto-copy clipboard, ghi transcript/historical code hoặc mở browser. Evidence dùng số/mã được che. Windows double-click phải được test thật bởi Claude/Owner, không chỉ Node unit.
Banner/copy Auth revision09 là yêu cầu cho UI nối sau, không sửa UI trong PR .22. Nội dung consent test .03 đã Owner duyệt tại PR#62; không dùng approval đó để mở UI mới .22.

## 8. Files và tests

Mapping dự kiến, Claude báo paths thật trước sửa:
apps/backend/src/test-sms/; auth/otp-provider-binding.ts;
admin-activation/activation-otp-providers.ts và delivery port type nếu cần;
config parser/type/composition; backend bootstrap lifecycle wiring;
tools/local/11ship-test-sms.cmd; scripts/test-sms-inbox.mjs;
tests/integration/; unit layer tương ứng; ops/runbooks/; docs/evidence/.
Launcher chỉ wiring/config test cần thiết, không đổi three-launcher behavior; nếu sửa launcher chạy launcher:test và Windows checks.
Không migration business, grant thêm runtime DB, Auth core behavior/reset code hoặc sửa dashboard.

| ID | Evidence cần |
|---|---|
| TS01 | REGISTER core→inbox→manual code verify→proof, legacy register API/PG17 thật; .03 chưa code ghi chưa chạy |
| TS02 | ADMIN_ACTIVATION delivery/verify với cookie/CSRF/TOTP core; reset future ghi chưa triển khai |
| TS03 | Wrong attempts/TTL/resend/proof once/double submit giữ main; xem inbox không kéo dài TTL |
| TS04 | Reject/timeout/unknown/append-lost-response/restart; deterministic concurrency barriers |
| TS05 | Staging/production deny, modeoff no listener, missing ACL/guard startup fail |
| TS06 | Missing/wrong token, Origin, network outside, extra queries/methods/quota/purge/cap; no OTP list/log |
| TS07 | Windows double-click/state ACL/restart/ownership/PID reuse/old cleanup/new state; runbook exact version |
| TS08 | Regression FAKE/TEST_DISPLAY/binding cũ; public API không route/private OTP leakage |
| TS09 | TTL/cap/order boundary, malformed or unowned discovery state, bounded GET retry |
| TS10 | Phone nhập OTP lấy trên PC sau local acceptance, theo runtime transport đã duyệt |

lint/typecheck/build/unit/integration PG17 và CI phù hợp exact final SHA. Test destructively chỉ TEST5433 với guard, không DEV5432/remote.
CI/read-only review không thay Windows/manual/local/phone. Tests thiếu environment ghi BLOCKED/CHƯA CHẠY, không claim PASS.
Ghi base/source/dependency/head SHA, commands/results, CI links, runbook, platform file-private evidence không secret.

## 9. Prompt giao Claude — một gói

Làm duy nhất M01.22 backend hộp SMS test + công cụ PC theo tài liệu này và revision09 §5 tại PR#48, giữ contract10/11 main. Đọc AGENTS.md/CLAUDE.md/workflow. Fetch main/#48, ghi full SHAs/diff và đối chiếu dependency M01.01/M00.08 với local runtime thật; nếu thiếu boundary thì báo finding cụ thể trước code.
Branch implementation riêng từ main, không code trên nhánh docs. Wire REGISTER/ADMIN_ACTIVATION provider ports, shared in-memory inbox, explicit TEST_INBOX dev/test, separate loopback private listener/state/token, double-click read-only tool. RESET future chưa triển khai. Giữ FAKE/TEST_DISPLAY/OTP core/CSRF/TOTP; không OTP public/log/telecom/remote deploy.
Kiểm TS01–TS09 và Windows, chuẩn bị TS10/runbook; Draft PR final SHA/evidence, không mock thành API/DB thật. Ghi Owner actual chưa chạy. Không mở .03/.04/.16/UI/native scope, không sửa PROGRESS/plan.yml, deploy/apply remote/auto-merge/LOCK.
ChatGPT review rồi merge gói nhỏ khi CI/review/dependency đạt theo ủy quyền hiện hành; Claude không tự merge.

## 10. Gate và trạng thái

| Bề mặt | Phạm vi | Code/CI/review | Owner local | Phone | Nghiệm thu |
|---|---|---|---|---|---|
| PC tool | Discovery/read inbox/double-click | Chưa triển khai | Chưa chạy | Không phải app phone; liên thông TS10 | Chưa |
| Web Admin | Activation adapter/regression | Chưa triển khai | Chưa chạy | Chưa chạy | Chưa |
| 11Food khách/quán | REGISTER delivery core; .03 nối sau | Chưa triển khai | Chưa chạy | Chưa chạy | Chưa |
| 11Ship xế | REGISTER delivery core; .03 nối sau | Chưa triển khai | Chưa chạy | Chưa chạy | Chưa |
| Liên thông | Hai adapters/shared inbox/real proof | Chưa triển khai | Chưa chạy | Chưa chạy | Chưa |

Không đóng M01 từ .22. N/A cho gói backend không miễn gate module. Không có product tests/build hoặc DB remote chạy bởi tài liệu này.
