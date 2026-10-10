# M01-D-ADMIN-1C — bằng chứng triển khai (10/10/2026)

Người thực hiện: Claude. Môi trường test chính thức: GitHub Actions CI (Node 24.21.0, npm 11.9.0, PostgreSQL 17, DB test có guard). **Không phải nghiệm thu**: ChatGPT chưa review code/test 1C, Owner chưa test local (cần UI kích hoạt — gói riêng), chưa deploy, M01 chưa đóng. `LOCK_PROTOCOL=NOT_FINAL` cho tới khi ChatGPT review xác nhận.

## 1. Mốc

| Mốc | SHA |
|---|---|
| Hợp đồng 1C đã duyệt (head #44, **base** của PR này) | `2e63da58ffb946ae0af5eced178a32bcc93a82d9` (= `802b334` đã duyệt + commit tài liệu ghi quyết định Owner OD-1…OD-16) |
| `main` lúc preflight | `e43083a1ba7c5e0d5d944ca2820fb530a4935c97` |
| Head code đã chạy CI đạt (trước commit tài liệu này) | `d602c061db64fa722b89da291c6c59588422fe09` |
| Final head (sau commit tài liệu này, chỉ thêm tài liệu) | ghi ở mô tả PR #45 cùng kết quả CI đúng SHA đó |

CI trên `d602c06`: **success** — lint, typecheck, build, deploy-config tests, migrations smoke; unit **1634/1634** (83 suite); integration CI mode **1169/1169** (70 suite); local mode 1164 đạt + 5 pending theo thiết kế. So với bằng chứng 1B (`d5cc580`: unit 1587, 76 suite; integration 1097, 65 suite): **+47 test unit (+7 suite)**, **+72 test integration (+5 suite)**.

Preflight: head #44 trùng mốc đã duyệt (`802b334`) + 1 commit tài liệu ghi quyết định Owner (đã làm trước khi code). Không có khác biệt cần đối chiếu.

## 2. Đã triển khai

| Phần | File |
|---|---|
| Migration A (bảng attempt, challenge OTP, `admin_profiles`, `admin_app_permissions`, trigger), B (4 kind limiter mới), C (guard nguồn gốc membership) — Up/Down thật, byte-equal DDL đã kiểm chứng | `database/migrations/1792281600000_*`, `1792368000000_*`, `1792454400000_*` |
| 3 mã lỗi (`ADMIN_ACTIVATION_LINK_INVALID` 404, `_SESSION_INVALID` 401, `_STEP_INVALID` 409 + `details`) | `common/app-errors.ts`, `http/error-envelope.ts` |
| Cấu hình `ADMIN_ACTIVATION_ENABLED`, `ADMIN_ACTIVATION_OTP_MODE` (FAKE/TEST_DISPLAY/SMS), timeout provider, ân hạn promote | `config/admin-activation-config.ts`, `config/app-config.ts`, `.env.example`, runbook |
| Subkey OTP kích hoạt (HKDF `admin-activation-otp-hmac.v1`), CSRF type `ACTIVATION` | `crypto/kdf.ts`, `crypto/key-version.ts`, `admin-auth/admin-crypto.ts` |
| Module kích hoạt: controller 8 route, service, repository (toàn bộ SQL), views, limiter, validation, cookie, OTP port + provider FAKE/TEST_DISPLAY | `apps/backend/src/admin-activation/` |
| Móc 1B `invalidateActivationFor` (gọi từ reissue, revoke, expire-on-create) | `admin-activation-invalidator.ts`, `admin-provisioning/admin-invitation-service.ts` |
| Đấu nối (chỉ khi `ADMIN_ACTIVATION_ENABLED=true`; provider bind tường minh, **không fallback**) | `admin-auth/admin-auth.module.ts`, `app.module.ts`, `main.ts` |
| Runbook: quyền bảng (4 bảng mới; `admin_memberships` thêm `INSERT`) và biến cấu hình | `ops/runbooks/render-supabase-staging.md` |

Routes (`/v1/admin-activation`, không cần đăng nhập admin): `POST start`, `POST restart`, `GET state`, `POST otp/request`, `POST otp/verify`, `POST password`, `POST totp/enrollment`, `POST complete`. **Không** làm: SMS thật, UI, reset mật khẩu, recovery. OTP thử chỉ bật bằng `ADMIN_ACTIVATION_OTP_MODE=FAKE|TEST_DISPLAY` ở `APP_ENV` development/test; `SMS` làm startup dừng (chưa có adapter), thiếu provider cũng dừng.

Kích hoạt nguyên tử: user + membership + profile + quyền + factor `ACTIVE`, lời mời → `ACCEPTED`, attempt → `COMPLETED` cùng một transaction ở `complete`; trước đó không có tài khoản nào; sau đó trả `COMPLETED/next=LOGIN`, không cấp phiên admin.

## 3. Đối chiếu hợp đồng ↔ code ↔ test

Viết tắt test (tất cả trong `tests/integration/` trừ khi ghi khác): **F** = `admin-activation.int.spec.ts` (luồng, transport, CSRF, OTP, K28); **C** = `admin-activation-concurrency.int.spec.ts`; **T** = `admin-activation-faults.int.spec.ts` (trace khóa, lỗi COMMIT, rò rỉ); **B** = `admin-activation-barriers.int.spec.ts`; **M** = `admin-activation-migration.int.spec.ts`; **U** = unit trong `apps/backend/src/admin-activation/*.spec.ts` và `config/admin-activation-config.spec.ts`, `crypto/*.spec.ts`.

| Mục hợp đồng | Code | Test / bằng chứng |
|---|---|---|
| §5 DDL, CHECK, trigger, Down; Up→Down→Up | migration A/B/C | M: hình thức file, byte-equal DDL, kind limiter nhận 4 loại và từ chối lạ (23514), Down B từ chối khi còn bucket (P0001), Down C,B,A→Up trong txn rollback; `docs/verification/m01-d-admin-1c-ddl/run.sh` (65 PASS, PG16 cục bộ); các suite migration cũ cập nhật danh sách/trigger/Down-Up |
| §6.1 transport: Origin chính xác, JSON ≤ 4 KiB, no-store, không ETag/304, không CORS | controller + `activationTransportMiddleware` | F "Origin", "POST must be JSON…", "every response carries no-store…" (kể cả lỗi/401, điều kiện `If-None-Match` không cho 304); U transport, boundary |
| §6.1 cookie `__Host-` HttpOnly Secure SameSite=Strict Path=/ không Domain; token chỉ ở body `start` | `admin-activation-cookies.ts` | F "cookie is __Host-…", "token travels only in the body"; U cookies |
| §6.1.1 CSRF + ma trận trạng thái → có CSRF không | `admin-activation-views.ts` | F "CSRF: every session POST…" (6 route × 4 sai), F T-CSRF-MATRIX (9 ô: 4 sống + ATTEMPTS_EXHAUSTED có; COMPLETED, SUPERSEDED, INVITATION_CLOSED, PHONE_CONFLICT không); U views |
| §6.2 `start`: token sai/đóng/hết hạn một 404; cookie tiếp tục/thay thế | `service.start` | F "start: a wrong…", "start: twice…"; C K5, K21, K24(d) |
| §6.2 `restart` từ ATTEMPTS_EXHAUSTED, OTP lại, không reset bucket | `service.restart` | F K28 (a)–(c) (bucket TOTP trước/sau giống hệt, 429 khi bucket còn khóa, thành công sau khi hết khóa), C K24, C K3 (restart từ INVITATION_CLOSED → 409) |
| §6.3 GET state, không lộ SĐT/tên/id/bí mật | `views`, `service.state` | F state ở mọi bước; T "no response, state or log…"; U views |
| §7 TTL/bộ đếm: OTP 5 sai → LOCKED, resend 60 s, TOTP 5 sai → ATTEMPTS_EXHAUSTED, ingress 30/60 s, link 10/15 phút khóa 15 phút | constants + service/limiter | F "OTP: request needs STARTED…", "ingress quota…", "wrong invitation tokens lock…", K28; C K8 (7 song song → đếm đúng 5, INVALIDATED một lần, bucket 5) |
| §8 bucket R0/L2, ingress quota trong txn riêng đã commit, replay vẫn +1 | controller `#post`, limiter | F quota; C K26 (`ACTIVATION_REQUEST_IP` +1 mỗi request, mọi bucket khác không đổi) |
| §9 thứ tự khóa R0<S0<L2<L3<L8<L9a<L9b<L10; L8 X cho start/restart/otp-request/complete, S cho verify/password/enrollment | service `#run` (lock_timeout trước), repository | T trace từng route qua service thật trên PostgreSQL thật: thứ tự không giảm, `lock_timeout` trước khóa đầu, writer không có `FOR SHARE` lời mời, reader không có X, repeat `complete` và `state` không có khóa/ghi; TL (1B) cập nhật thêm L9a cho reissue/revoke; U boundary |
| §10.1–10.7 từng endpoint, TX-P đọc thuần, kiểm lại dưới khóa, giờ DB sau khóa cuối, từ chối thuần = ROLLBACK | service | F/C/B như trên; C K25/K29 (cookie hết hạn × 7 route → 401, start bỏ qua cookie hết hạn, PHONE_CONFLICT trước/sau `expires_at`, không audit); B K15 (chờ khóa attempt qua `expires_at` → 401, không ghi, không gửi OTP), B K16 (chờ khóa lời mời qua `expires_at` → 404 chuẩn, không attempt) |
| §10.4/§10.5 password argon2id ngoài transaction, enrollment phát lại cùng bí mật | service | F "enrollment replays the SAME secret…", F steps in order |
| §10.6 `complete` nguyên tử | `service.complete` + repository | F "activates an invitation atomically…" (trước bước cuối 0 user/factor; sau: user ACTIVE `ADMIN_PROVISIONED`, membership ADMIN ACTIVE, profile, quyền, factor ACTIVE với id đã cấp sẵn, lời mời ACCEPTED, attempt COMPLETED, password_hash/ciphertext đã xoá, không có phiên admin, đăng nhập bằng mật khẩu + TOTP thành công); C K1 (2 complete song song → 1 user, cả hai 200 COMPLETED); K22; T "failing audit write rolls the completion back" |
| §11.2 replay/ma trận 6 trạng thái × 8 route | service | C K25/K26/K29, F steps in order, F K28; **một phần** — xem mục 6 |
| §12 móc 1B | `admin-activation-invalidator.ts` + gọi trong `admin-invitation-service` | C K4 (reissue: attempt + challenge → INVALIDATED, session cũ thấy `LINK_UNAVAILABLE`, token cũ 404), C K3 (revoke khi đã TOTP_ISSUED: complete → 409, không user), TL 1B reissue/revoke thêm `L9a` |
| §13 OTP: bảng kết quả provider, không gửi mù, PENDING_DELIVERY mồ côi | `activation-otp-providers.ts`, `service.#deliver` | F "OTP provider outcomes" (REJECTED → DELIVERY_FAILED + 503, gửi lại ngay được; UNKNOWN chấp nhận và mã đã “gửi” dùng được; THROW = UNKNOWN, không gọi lần hai); C K6 (2 request → 1 lần gửi); T K17 trong ân hạn không đếm/không promote, sau ân hạn promote rồi so mã; U providers |
| §14 commit-then-throw; unknown COMMIT | service `#run`, `thenThrow` | T K10 (verify/password/enrollment/complete: mất ack → `TRANSACTION_OUTCOME_UNKNOWN`, đúng 1 COMMIT, `GET state` phản ánh kết quả thật, gọi lại không tạo tài khoản thứ hai), T K9 (mất kết nối trước COMMIT → rollback hoàn toàn, mã TOTP chưa bị đốt, thử lại thành công); F/C TOTP sai commit rồi mới trả lỗi (đếm lưu) |
| §15 audit không chứa bí mật | `ACTIVATION_AUDIT_ACTIONS` | F "records audit rows…" (không token/mật khẩu/bí mật TOTP/SĐT/cookie), T leak scan (response + log) |
| §16 cấu hình | `admin-activation-config.ts` | U config (mặc định, miền giá trị, chế độ thử bị cấm ngoài development/test, SMS), U boundary (không fallback) |
| K2 `complete` ∥ `/auth/register` | unique `users.phone_normalized` | B K2: giữ INSERT user của bên kia — commit → `complete` 409 `ADMIN_PHONE_CONFLICT`, lời mời PHONE_CONFLICT, không membership; rollback → `complete` 200, đúng 1 user |
| K7, K13, K22 | | C K7 (LOCKED không bị ghi đè bởi VERIFIED), C K13 (resend ∥ verify), C K22 |
| K23 PHONE_CONFLICT | `#phoneConflict` | C K23 (otp/request với SĐT đã thuộc `users`: 409, lời mời PHONE_CONFLICT một lần, attempt INVALIDATED, không gửi OTP), T trace (không `FOR SHARE` lời mời ở route ghi) |
| K24, K27 (một phần) | | C K24 (quá 600 s → 409 `restart_required`, restart không token, OTP cũ vô dụng, hoàn tất được), F K27 (5 sai → LOCKED; verify thứ 6 giữ nguyên hàng/đếm/audit) |

## 4. Kết luận protocol khóa

- **Call graph (đọc code)**: toàn bộ SQL của 1C nằm trong `admin-activation-repository.ts` (khẳng định bằng U boundary); khóa chỉ đi qua `lockBuckets` (L2), `lockPhone` (L3, cùng miền với 1B), participant 1A `lock` / reader `lockShared` (L8 X/S), `lockAttempt(s)` (L9a), challenge (L9b). Hook 1B lấy L9a rồi L9b sau L3/L8 X của reissue/revoke.
- **Trace thực tế (CI)**: mỗi route có trace từng câu lệnh qua service thật; thứ tự không giảm; `lock_timeout` đặt trước khóa đầu; không có khóa ngoài bảng hạng.
- **Barrier (CI)**: K2, K15, K16 quyết định bằng khóa do test giữ + đồng hồ DB, không sleep; K1/K5/K6/K7/K8/K13/K21/K22 là chạy song song thật qua HTTP, khẳng định bất biến cho mọi thứ tự hợp lệ; không có `40P01`.
- **Trạng thái**: `LOCK_PROTOCOL=NOT_FINAL`. Chưa chạy race ngẫu nhiên N=100 (kiểm tra bổ sung, không phải chứng minh).

## 5. Điểm diễn giải / sai khác so với hợp đồng (cần ChatGPT xác nhận, không đổi nghiệp vụ)

1. **Dạng JSON**: phản hồi dùng `data` envelope và khoá `snake_case` như toàn bộ API quản trị hiện có (`csrf_token`, `restart_required`, `can_restart`, `attempts_left`…), không phải camelCase như một số chỗ ví dụ trong hợp đồng.
2. **Hằng số thay vì cấu hình** cho TTL/bộ đếm (đúng tinh thần OD-9: chỉ timeout provider, ân hạn promote và chế độ OTP là cấu hình); CHECK trong DB giới hạn trần.
3. **Factor không có cột ràng buộc mật khẩu**: `admin_totp_factors` hiện hữu không có cột này, 1C không đổi bảng 1A/login; mật khẩu gắn với user mới tạo cùng transaction.
4. Kiểm tra `Content-Type`/kích thước chạy **trước** quota ingress (không tốn truy vấn DB); JSON hỏng trả `400` chung của framework (không phải `ADMIN_INPUT_INVALID`).
5. `GET state` không có quota ingress (chỉ POST theo hợp đồng); đọc COMPLETED mà lời mời không ACCEPTED (bất khả thi theo trigger 1A) → 500 nội bộ, không audit.
6. `password` ở trạng thái khác `OTP_VERIFIED` trả 409 trước khi băm (đúng §10.4).
7. **Lần sai TOTP thứ 5** commit INVALIDATED + khoá bucket rồi trả `429 ADMIN_AUTH_RATE_LIMITED` (4 lần đầu `400 ADMIN_TOTP_INVALID`); bốn lần đầu và lần thứ 5 đều đã được đếm bền vững.
8. `restart` từ INVALIDATED không phải ATTEMPTS_EXHAUSTED trả 409 `STEP_INVALID` (state: `can_restart=false`), đúng K24.

## 6. Giới hạn kiểm chứng (nói rõ)

- **Môi trường**: không `npm install` được (chính sách tổ chức) nên không chạy được jest/Nest cục bộ; kiểm chứng cục bộ = PostgreSQL 16 cho SQL (`run.sh`: 65 PASS, Up/Down/Up) + typecheck bằng stub. **Nguồn sự thật là CI.** Log job không tải được, chỉ đọc được annotation (số tổng + lỗi đầu tiên), nên các lỗi trong quá trình làm được sửa theo từng vòng; lần chạy cuối xanh toàn bộ.
- **Chưa có test (ghi nhận, không tuyên bố đã đạt)**: K11 ngoài phạm vi K5 (không dựng được hai attempt khác nhau cùng lời mời); K18 (txn2 CAS ∥ verify promote); K20 hook ∥ otp-request/verify chạy song song (chỉ có trace thứ tự + K4/K3 tuần tự); K23(b)(c) PHONE_CONFLICT đồng thời / ∥ revoke (chỉ có (a) cho otp-request và trace); bảng K27 đầy đủ (chỉ có “5 sai → LOCKED → verify thứ 6”, “không có challenge”, “challenge mồ côi trong/ngoài ân hạn”; thiếu `PENDING` hết hạn, `DELIVERY_FAILED`, `INVALIDATED`, và ca challenge cũ PENDING + mới LOCKED); ma trận §11.2 đủ 6×8 ô (chỉ các ô nêu ở K25/K26/K29, steps-in-order, K28); TOTP COMPLETED hết hạn (không dựng được vì `created_at/expires_at` bất biến và COMPLETED cần lời mời ACCEPTED thật).
- **Chưa kiểm thử**: không SMS thật, không UI, không thiết bị thật, không staging; quyền bảng runbook chỉ được kiểm bằng test `remote-migration-fresh-db` (suy ra từ đọc code, **D4 phải kiểm bằng endpoint thật**).
- Không merge, không deploy, không đóng M01, không tuyên bố Owner nghiệm thu.

## 7. Checklist giao đoạn (theo `docs/templates/module-delivery-checklist.md`)

Task: M01-D-ADMIN-1C; base: head #44 `2e63da5`; nguồn nghiệp vụ: `docs/tasks/M01-D-ADMIN-1C-technical-contract.md` (Owner đã duyệt, OD-1…OD-16).

- [x] Owner duyệt nghiệp vụ/API/dữ liệu và ca lỗi (hợp đồng + OD-1…OD-16).
- [ ] ChatGPT gửi ảnh UI chi tiết; Owner duyệt màn hình kích hoạt — **chưa**, ngoài phạm vi gói này.
- [x] Claude code, test, build; CI trên head code đạt (mục 1). CI trên final head: ghi ở mô tả PR.
- [ ] ChatGPT review đúng SHA; sửa finding bắt buộc — **chưa**.
- [ ] Owner chạy local; xác nhận đạt — **chưa** (cần UI).
- [ ] Bản điện thoại/web test, thiết bị thật, liên thông, nghiệm thu/merge/đóng module — **chưa**, thuộc Owner.

| Ứng dụng | Phạm vi | Code/CI/review | Local | Thiết bị thật | Owner nghiệm thu |
|---|---|---|---|---|---|
| Web quản trị | API kích hoạt tài khoản (8 route), không UI | Code + CI đạt trên head ghi ở mục 1; **chưa review** | Chưa kiểm chứng | Chưa kiểm chứng | Chưa |
| Khách / Quán / Xế / App quản lý | N/A: không thay đổi (chỉ thêm unique-race với `/auth/register`, test B K2) | N/A | N/A | N/A | N/A |
