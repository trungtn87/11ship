# M01-D-ADMIN-1C — bằng chứng triển khai (10/10/2026)

Người thực hiện: Claude. Môi trường test chính thức: GitHub Actions CI (Node 24.21.0, npm 11.9.0, PostgreSQL 17, DB test có guard). **Không phải nghiệm thu**: ChatGPT chưa review code/test 1C, Owner chưa test local (cần UI kích hoạt — gói riêng), chưa deploy, M01 chưa đóng. `LOCK_PROTOCOL=NOT_FINAL` cho tới khi ChatGPT review xác nhận.

## 1. Mốc

| Mốc | SHA |
|---|---|
| Hợp đồng 1C đã duyệt (head #44, **base** của PR này) | `2e63da58ffb946ae0af5eced178a32bcc93a82d9` (= `802b334` đã duyệt + commit tài liệu ghi quyết định Owner OD-1…OD-16) |
| **Baseline test = code 1B cuối** | `4f9bfab79eb85de991a19d33382ea48802f5d339` (CI run 38016242293: unit **1587**/76 suite, integration CI mode **1109**/65 suite, 0 pending). Cây code của `2e63da5` **giống hệt** `4f9bfab` (`git diff --name-only 4f9bfab 2e63da5` chỉ có tệp dưới `docs/`), nên đây là baseline của 1C. `d5cc580` (1097) là mốc **cũ hơn** của 1B, không phải baseline |
| `main` lúc preflight vòng 1 | `e43083a1ba7c5e0d5d944ca2820fb530a4935c97` |
| Head code vòng triển khai (CI đạt) | `d602c061db64fa722b89da291c6c59588422fe09` |
| Head PR lúc mở vòng kiểm chứng này | `115ecf14425ef28ca1d9877892e088b2decd1b72` (preflight vòng 2: head và base không đổi so với mốc được giao) |
| Head code sau vòng kiểm chứng (CI đạt) | `74c5e53dcf205aef1f930bd6cb45db74419b5f4b` — CI run 38047772682: lint, typecheck, build, deploy-config, migrations smoke; unit 1634/1634 (83 suite); integration CI mode **1233/1233** (73 suite, 0 pending); local mode 1228 đạt + 5 pending theo thiết kế |
| Final head (thêm tài liệu) | ghi ở mô tả PR #45 cùng kết quả CI đúng SHA đó |

**Đếm test (đã sửa).** Vòng triển khai (`d602c06`): unit 1634/83 suite, integration 1169/70 suite ⇒ so với baseline `4f9bfab`: **+47 unit (+7 suite), +60 integration (+5 suite)**. Bản trước của tài liệu này ghi nhầm “+72” vì lấy mốc 1097 của `d5cc580`; con số đúng là **+60**. Sau vòng kiểm chứng (`74c5e53`): unit 1634/83 suite, integration 1233/73 suite ⇒ **+47 unit (+7 suite), +124 integration (+8 suite)** so với baseline `4f9bfab` (1109/65); so với `d602c06`: +64 integration (+3 suite: schedules, delivery, matrix), unit không đổi.

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

Viết tắt test (tất cả trong `tests/integration/` trừ khi ghi khác): **F** `admin-activation.int.spec.ts` (luồng, transport, CSRF, OTP, K28); **C** `admin-activation-concurrency.int.spec.ts` (chạy song song `Promise.all` — **bổ sung**, xem dưới); **S** `admin-activation-schedules.int.spec.ts` (lịch barrier, cả hai thứ tự); **D** `admin-activation-delivery.int.spec.ts` (K18, bảng K27); **X** `admin-activation-matrix.int.spec.ts` (ma trận §11.2, hết hạn cookie, Retry-After); **T** `admin-activation-faults.int.spec.ts` (trace khóa, lỗi COMMIT, rò rỉ); **B** `admin-activation-barriers.int.spec.ts` (K2, K15, K16); **M** `admin-activation-migration.int.spec.ts`; **U** unit trong `apps/backend/src/admin-activation/*.spec.ts`, `config/admin-activation-config.spec.ts`, `crypto/*.spec.ts`.

**Mức bằng chứng** (cột cuối): **B2** = barrier xác định, chạy cả hai thứ tự; **B1** = barrier xác định, một thứ tự (nêu lý do); **Σ** = tuần tự/xác định nhờ trạng thái hoặc giờ DB, không cần đua; **Tr** = trace câu lệnh/khóa qua service thật; **Sc** = bất biến schema/DB; **P** = `Promise.all` thật qua HTTP, **không** phải bằng chứng thứ tự khóa. Cơ chế barrier: `gatedSource` giữ request thứ nhất **ngay sau khi PostgreSQL cấp khóa cần giữ**; request thứ hai chỉ bắt đầu khi request thứ nhất đã đỗ ở đó và lịch chỉ tiếp tục khi `pg_stat_activity` cho thấy request thứ hai **đang chờ khóa** (`wait_event_type='Lock'`); test mới thả request thứ nhất. Khoảng giữa txn1 → provider → txn2 của `otp/request` dùng `FakeActivationOtpProvider.holdSends()`. Hết hạn đi qua **giờ DB** (`clock_timestamp()`), không sleep, không UPDATE cột bất biến.

### 3.1 Theo mục hợp đồng

| Mục hợp đồng | Code | Test | Mức |
|---|---|---|---|
| §5 DDL, CHECK, trigger, Down; Up→Down→Up | migration A/B/C | M (hình thức file, byte-equal DDL, kind limiter 4 loại + từ chối lạ 23514, Down B từ chối khi còn bucket, Down C,B,A→Up); `docs/verification/m01-d-admin-1c-ddl/run.sh` (65 PASS, PG16 cục bộ); S K11(c) (unique live/COMPLETED = 23505, attempt cuối không sống lại = 23001) | Sc |
| §6.1 transport: Origin, JSON ≤ 4 KiB, no-store, không ETag/304, không CORS; cookie `__Host-`; token chỉ ở body `start` | controller + `activationTransportMiddleware`, `admin-activation-cookies.ts` | F "Origin", "POST must be JSON…", "every response carries no-store…", "cookie is __Host-…", "token travels only in the body"; X malformed JSON; U transport, cookies, boundary | Σ |
| §6.1.1 hàng 0: cookie sai/hết hạn ⇒ 401 mọi trạng thái, trừ `start` | `service.#precheck`, TX-P | F (cookie lạ, hết hạn, sai loại); C K25/K29; **X** "cookie hết hạn": COMPLETED dựng từ INSERT attempt `PASSWORD_SET` với `expires_at` = +20 s, rồi **enrollment và complete thật**, đi qua hạn bằng giờ DB ⇒ 401 mọi route, `start` 404 (ACCEPTED), không ghi (vòng đời attempt 30 phút và TTL tối thiểu của lời mời 1 giờ khiến không thể dùng hạn thật; cột bất biến nên không UPDATE); thêm 5 trạng thái (STARTED…TOTP_ISSUED, INVALIDATED) dựng bằng INSERT `expires_at` +8 s, đi qua hạn bằng giờ DB | Σ |
| §6.1.1 CSRF theo trạng thái | `admin-activation-views.ts` | F "CSRF: every session POST…", T-CSRF-MATRIX (9 ô); U views | Σ |
| §6.2 `start`, `restart`, §6.3 GET state | `service.start/restart/state` | F, C K5/K21/K24/K28; S K5, K21; X ma trận | Σ/B2 |
| §7 TTL/ngưỡng | `admin-activation-constants.ts` | F quota, link, OTP, K28; C K8; bảng đối chiếu giá trị ở mục 5 (sai khác #2) | Σ |
| §8 limiter, commit-then-throw, ingress +1 mọi POST kể cả replay/401/409 | controller `#post`, limiter | C K26; X: 31 POST ⇒ 429 + `Retry-After` ∈ (0,60]; 10 token sai ⇒ 429 + `Retry-After`; lần TOTP sai thứ 5 ⇒ 429 + `Retry-After`, 4 lần đầu 400 | Σ |
| §9 thứ tự khóa R0<S0<L2<L3<L8<L9a<L9b<L10 | service `#run`, repository | T trace từng route (thứ tự không giảm, `lock_timeout` trước khóa đầu, writer = X lời mời, reader = S), S (mọi lịch dưới đây xác nhận thứ tự bằng chờ khóa thật) | Tr |
| §10.x endpoint, TX-P đọc thuần | service | F/C/B/S/X; S "GET state không chờ writer đang giữ khóa" (đọc thuần, `expectBlocked:false`) | Σ/B1 |
| §10.6 `complete` nguyên tử | `service.complete` | F "activates an invitation atomically…" (tài khoản, membership, profile, quyền, factor ACTIVE, lời mời ACCEPTED, attempt COMPLETED, dữ liệu nhạy cảm đã xoá, đăng nhập được); T audit lỗi ⇒ rollback | Σ |
| §11.2 ma trận 6 trạng thái × 8 route | service | **X**: mỗi trạng thái dựng bằng **thao tác thật** (STARTED, OTP_VERIFIED, PASSWORD_SET, TOTP_ISSUED, COMPLETED; INVALIDATED × 4 lý do: SUPERSEDED bằng `start` thứ hai, INVITATION_CLOSED bằng 1B revoke thật, PHONE_CONFLICT bằng SĐT đã thuộc `users`, ATTEMPTS_EXHAUSTED bằng 5 TOTP sai); 8 route (verify, password, enrollment, complete, otp/request, restart, start+cookie hợp lệ, GET state). Ô “xử lý” bỏ qua (đã có F/S/D); ô “—” khẳng định **đúng mã** và **không đổi** attempts/challenges (xmin), lời mời, users, audit, bucket nghiệp vụ (trừ ingress), số lần gọi provider; enrollment lặp ⇒ cùng bí mật; `complete` lặp trên COMPLETED ⇒ 200 kể cả khi bucket `ACTIVATION_TOTP` bị khóa (bucket không đổi); `start`+cookie sai ⇒ 201 (PENDING) hoặc 404 (ACCEPTED/đóng; đếm đúng 1 link-failure, xem sai khác #9) | Σ |
| §12 móc 1B | `admin-activation-invalidator.ts` + 1B | S K3/K4/K20 (dưới); C K3/K4 (tuần tự); TL 1B (thêm L9a) | B2 |
| §13 OTP/provider | `activation-otp-providers.ts`, `#deliver` | F provider outcomes (K19); T K17; D K18; U providers | Σ/B2 |
| §14 commit-then-throw, unknown COMMIT, PHONE_CONFLICT | service `#run`, `#phoneConflict` | T K9/K10; S K23(b)(c); C K23(a) | Σ/B2 |
| §15 audit không chứa bí mật | `ACTIVATION_AUDIT_ACTIONS` | F audit rows; T leak scan (response + log) | Σ |
| §16 cấu hình | `admin-activation-config.ts` | U config, boundary; **sai khác #2** | Σ |

### 3.2 Theo ID kiểm thử của hợp đồng (§17)

| ID | Lịch hợp đồng yêu cầu | Test chốt (bằng chứng chính) | Mức | Ghi chú trung thực |
|---|---|---|---|---|
| K1 | complete ∥ complete | S "K1" (hai complete cùng mã; một user, cả hai 200); C K1 (P, bổ sung) | B2* | *Hai request **giống hệt nhau**: “cả hai thứ tự” là cùng một lịch đổi nhãn; lịch ghi nhận bên thua đọc kết quả dưới khóa |
| K2 | complete ∥ `/auth/register` | B K2 (giữ INSERT user: commit ⇒ 409 PHONE_CONFLICT; rollback ⇒ 200, 1 user) | B2 | Hai nhánh của giao dịch bên kia = hai thứ tự quan sát được |
| K3 | complete ∥ revoke | S K3 (revoke trước / complete trước, `directServices` + barrier); C K3 (tuần tự) | B2 | |
| K4 | complete ∥ reissue | S K4 (như K3); C K4 (tuần tự) | B2 | |
| K5 | start ∥ start (không cookie) | S K5 (barrier L8 X); C K5 (P) | B2* | *Đối xứng như K1 |
| K6 | otp/request ∥ otp/request | S K6 (barrier; 1 lần gửi, bên kia `OTP_RATE_LIMITED`, provider chỉ 1 lần); C K6 (P) | B2* | *Đối xứng |
| K7 | verify sai lần 5 ∥ verify đúng | S K7 (sai trước / đúng trước; LOCKED không bị ghi đè); C K7 (P) | B2 | |
| K8 | TOTP sai ×N | C K8 (7 song song ⇒ đếm đúng 5, INVALIDATED 1 lần, bucket 5) | **P** | **Không phải bằng chứng thứ tự khóa**; kiểm bất biến đếm. Thứ tự hai-request của cùng loại được phủ bởi S K22 |
| K9 | kill giữa complete trước COMMIT | T K9 (mất kết nối trước COMMIT ⇒ rollback, mã chưa đốt, thử lại được) | Σ | Cắt kết nối bằng fault injection, không `pg_terminate_backend` ngẫu nhiên |
| K10 | COMMIT timeout từng route | T K10 (verify/password/enrollment/complete: `TRANSACTION_OUTCOME_UNKNOWN`, đúng 1 COMMIT, GET state phản ánh thật) | Σ | `otp/request`, `start`, `restart` chưa có ca K10 riêng (chỉ GET-state recovery theo hợp đồng §11.3) |
| K11 | complete ∥ complete **khác attempt** cùng lời mời | S K11(a) start ∥ complete của attempt sống (cả hai thứ tự); S K11(b) **attempt cũ đã qua bước đọc khi còn sống, bị thay bởi attempt mới (cũng tới TOTP_ISSUED), rồi hai complete đua nhau**: (1) cũ giữ khóa bucket TOTP trước, mới chờ sau nó; (2) cũ đỗ ngay sau câu đọc snapshot, mới giữ X trước, cũ chờ sau — cả hai: mới COMPLETED, cũ `STEP_INVALID`, đúng 1 user, không đếm TOTP; S K11(c) schema. *(Lần đầu cho cả hai cookie đi qua `complete` thẳng bị TX-P trả lời sớm cho attempt đã INVALIDATED nên không đua được; lịch trên đỗ attempt cũ trước khi nó bị thay.)* | B2 + Sc | Fixture “hai attempt **sống** cùng lúc” **bất khả thi theo schema**: unique index live (23505) và unique COMPLETED chặn tại INSERT — K11(c) chứng minh bằng 3 INSERT/UPDATE bị từ chối; lịch hợp lệ gần nhất (K11(a)(b)) đã chạy bằng barrier |
| K12 | trace khóa Auth↔1C | T (thứ tự không giảm), TL 1B | Tr | |
| K13 | resend ∥ verify | S K13 (verify trước; resend trước) + `holdSends` cho khoảng txn1→provider→txn2; C K13 (P) | B2 | Challenge cũ hợp lệ dựng bằng INSERT (`created_at` 120 s trước, cooldown 60 s) |
| K14 | enrollment ∥ complete | S K14 ×5: enrollment phát lại trước; complete trước; enrollment đầu tiên ∥ complete (complete **chờ** khóa lời mời, rồi chạy trên TOTP_ISSUED: mã sai đếm đúng 1); complete đến trước ở PASSWORD_SET (409, không đếm) rồi enrollment cấp bí mật; hai enrollment đầu tiên | B2 | |
| K15 | hết hạn attempt sau khóa | B K15 (chờ khóa attempt qua `expires_at` bằng giờ DB ⇒ 401, không ghi, không gửi OTP) | B1 | Một thứ tự: kết quả chỉ có một đáp án theo `T` đọc sau khóa |
| K16 | hết hạn lời mời sau khóa | B K16 | B1 | như trên |
| K17 | PENDING_DELIVERY mồ côi | T K17 (trong ân hạn 409 không đếm; ngoài ân hạn promote rồi so mã); D (bảng K27: cả hai ca) | Σ | |
| K18 | txn2 CAS ∥ verify promote | **D**: (1) verify promote **trong lúc** request giữ ở provider (`holdSends`), thả provider ⇒ txn2 CAS 0 hàng + audit anomaly + 202; (2) txn2 giữ khóa challenge (barrier `lockChallenge`), verify chờ L9b, thả ⇒ txn2 promote, verify thấy PENDING, đếm +1, **không** promote, không anomaly. Ân hạn 1 s qua cấu hình `promoteGraceMs=1000`, đi qua bằng giờ DB | B2 | |
| K19 | provider UNKNOWN/REJECTED/ACCEPTED | F "OTP provider outcomes" | Σ | |
| K20 | hook 1B ∥ otp-request / verify | S K20 ×4: reissue trước verify, verify trước reissue, reissue trước otp-request, otp-request trước reissue (hook chạy khi SMS đang chờ, outcome muộn không hồi sinh challenge) | B2 | |
| K21 | start tiếp tục ∥ start mới | S K21 (resume trước / start mới trước); C K21 (P) | B2 | |
| K22 | complete sai ∥ đúng | S K22 (sai trước / đúng trước); C K22 (P) | B2 | |
| K23 | PHONE_CONFLICT | (a) C K23 (tuần tự, otp-request/start); (b) S K23(b) (otp-request trước / start trước; một lần đóng, không 40P01); (c) S K23(c) (revoke trước / request trước) | B2 | `restart`/`complete` nhánh PHONE_CONFLICT: X (state PHONE_CONFLICT dựng bằng `complete`), F |
| K24 | quá deadline → restart | C K24, K24(d) | Σ | giờ DB |
| K25 | cookie COMPLETED, hết hạn mọi trạng thái, ma trận | C K25/K29; **X** (ma trận đủ ô + hết hạn) | Σ | |
| K26 | complete lặp trên COMPLETED | C K26; X (kể cả bucket TOTP bị khóa) | Σ | |
| K27 | verify × challenge mới nhất | F K27 (5 sai ⇒ LOCKED, verify thứ 6 không đổi hàng/đếm/audit); **D** bảng đầy đủ: không challenge, PENDING_DELIVERY trong ân hạn, ngoài ân hạn (mã đúng ⇒ VERIFIED; mã sai ⇒ promote + đếm 1), PENDING hết hạn, DELIVERY_FAILED, INVALIDATED, LOCKED, **PENDING cũ + LOCKED mới hơn** (chọn mới nhất). Ô chỉ-từ-chối so sánh `xmin` và số audit trước/sau | Σ | |
| K28 | phục hồi sau TOTP sai lần 5 | F K28 (a)–(c) | Σ | (d)(e)(f): F/X |
| K29 | TX-P bằng giờ DB | C K25/K29; X hết hạn qua INSERT + giờ DB | Σ | |

## 4. Kết luận protocol khóa

- **Call graph (đọc code)**: toàn bộ SQL của 1C nằm trong `admin-activation-repository.ts` (khẳng định bằng U boundary); khóa chỉ đi qua `lockBuckets` (L2), `lockPhone` (L3, cùng miền với 1B), participant 1A `lock` / reader `lockShared` (L8 X/S), `lockAttempt(s)` (L9a), challenge (L9b). Hook 1B lấy L9a rồi L9b sau L3/L8 X của reissue/revoke.
- **Trace thực tế (CI)**: mỗi route có trace từng câu lệnh qua service thật; thứ tự không giảm; `lock_timeout` đặt trước khóa đầu.
- **Lịch đồng thời**: các cặp K1, K3, K4, K5, K6, K7, K11, K13, K14, K18, K20, K21, K22, K23(b)(c) được quyết định bằng **barrier xác định** và chạy cả hai thứ tự (bảng 3.2, cột Mức). K2, K15, K16 dùng khóa do test giữ + giờ DB. `Promise.all` (C) còn lại chỉ là kiểm bổ sung; **K8 chỉ có bằng chứng loại P** (bất biến đếm), không dùng làm bằng chứng thứ tự khóa. Không có `40P01` trong bất kỳ lịch nào.
- **Chưa chứng minh**: hai request giống hệt nhau (K1, K5, K6) chỉ có một lịch (đối xứng, xem ghi chú); các lịch có ba request trở lên, và các lịch với **ba** điểm dừng (ví dụ hook ∥ otp-request ∥ verify) chưa dựng; chưa chạy race ngẫu nhiên N=100 (sẽ chỉ là kiểm bổ sung). Vì vậy giữ **`LOCK_PROTOCOL=NOT_FINAL`** cho tới khi ChatGPT review xác nhận bảng 3.2.

## 5. Đối chiếu 8 sai khác (+1 mới phát hiện) với hợp đồng (cần ChatGPT/Owner quyết; không tự diễn giải)

Cột “Kết luận” phân biệt **sai khác thật** (cần quyết định) với **khớp hợp đồng** (ghi lại để review, không cần đổi).

| # | Nội dung | Hợp đồng nói | Code làm | Kết luận / đề xuất |
|---|---|---|---|---|
| 1 | Dạng JSON | §6.3, §10: khoá camelCase (`csrfToken`, `expiresAt`, `restartRequired`, `canRestart`, `passwordDeadline`, `resendAt`…) và ví dụ phản hồi trần (`{state:"…"}`) | Phong bì `{data:{…}}` và khoá `snake_case` (`csrf_token`, `expires_at`, `restart_required`, `can_restart`…) như toàn bộ API quản trị 1A/1B | **Sai khác thật.** Đề xuất **chấp nhận** snake_case + `data` (một dạng chung cho UI/ứng dụng khác; đổi sau khi có UI tốn hơn). Cần ChatGPT sửa câu chữ §6.3/§10 và các ví dụ để UI bám đúng khoá. Chưa đổi code |
| 2 | TTL/ngưỡng | §7: bảng “Giá trị đề xuất”, OD-7 duyệt “như bảng”; §16 (OD-9): cấu hình gồm **“các TTL/ngưỡng §7”**, mặc định như §7, ép trần theo CHECK DB | **Hằng số** trong `admin-activation-constants.ts`; chỉ `OTP_MODE`, timeout provider, ân hạn promote là cấu hình. *(Bản trước viết “đúng tinh thần OD-9” — không đúng với chữ của §16; sửa lại ở đây.)* | **Sai khác thật so với §16.** **Giá trị bằng đúng §7** (kiểm từng dòng ở bảng dưới). Hai lựa chọn để quyết: **(A)** giữ hằng số (cùng cách 1A/1B; không biến môi trường nào nới được cổng) và sửa §16/OD-9 bỏ cụm “các TTL/ngưỡng §7”; **(B)** làm cấu hình thật với mặc định = §7 và trần/sàn nêu cụ thể (ví dụ `ADMIN_ACTIVATION_ATTEMPT_TTL_SECONDS` 60…3600; `…_OTP_TTL_SECONDS` 60…600; `…_PASSWORD_DEADLINE_SECONDS`; `…_REQUEST_LIMIT`/`…_WINDOW_SECONDS`; v.v.; riêng giới hạn sai OTP/TOTP **cố định 5** vì CHECK DB `attempt_count`/`totp_attempt_count` ≤ 5 nên chỉ có thể hạ, không nâng). (B) thêm bề mặt cấu hình + bộ test miền giá trị; cần Owner duyệt tên biến và biên. Chưa đổi code |
| 3 | Ràng buộc mật khẩu của factor | §10.6 bước 5: factor ACTIVE có “ràng buộc mật khẩu theo (`user_id`, `password_hash`)” | `admin_totp_factors` của 1A **không có cột này**; 1C không đổi bảng 1A/login. User, hash mật khẩu và factor được tạo **cùng một transaction** từ cùng attempt | **Sai khác thật.** Lựa chọn: **(A)** chấp nhận (ràng buộc là ngầm: cùng transaction, cùng `user_id`), sửa câu §10.6; **(B)** thêm migration cột ràng buộc + sửa login 1A — ngoài phạm vi 1C, cần task riêng. Đề xuất (A). Chưa đổi code |
| 4 | JSON hỏng | §6.1 “sai ⇒ 400 `ADMIN_INPUT_INVALID`”; §9 R0: `transport → Origin → quota → parse` | Sai Content-Type / quá 4 KiB / khoá thừa / sai kiểu ⇒ `400 ADMIN_INPUT_INVALID` (đúng, test F). **JSON cú pháp hỏng** bị bộ parse của framework từ chối **trước** controller ⇒ `400 BAD_REQUEST` chung, **không** tiêu quota ingress | **Sai khác nhỏ.** Test X ghi lại hành vi (400 `BAD_REQUEST`, bucket không đổi). Lựa chọn: chấp nhận (không tốn DB, không rò rỉ) hoặc đổi sang `ADMIN_INPUT_INVALID` + tiêu quota (cần chặn lỗi parse trong middleware). Chưa đổi code |
| 5 | GET state không quota | §8: “**Mọi request**, kể cả replay, 401 và 409 (sau kiểm `Origin`)” ⇒ `ACTIVATION_REQUEST_IP`; nhưng §9 R0 “**mọi POST**”, §6.3/§10.7 “GET state là **đọc thuần**: không khóa, không ghi, không đếm”, §11.3 dùng GET state làm đường phục hồi | `GET state` **không** có quota ingress (đọc thuần, một SELECT); mọi POST có (+1 kể cả 401/409/replay) | **Mâu thuẫn nội bộ của hợp đồng** (§8 vs §9/§10.7). Test X ghi lại hiện trạng (40 GET liên tiếp đều 401, không bucket nào đổi) và test K26 (POST). Lựa chọn: **(A)** giữ, sửa §8 thành “mọi POST” (đúng §9/§10.7, GET vẫn pure read, đường phục hồi không bị 429); **(B)** thêm quota cho GET: GET trở thành có ghi (UPSERT bucket ở transaction R0 riêng) và có thể trả 429 trên đường phục hồi — trái §10.7, cần sửa §6.3/§10.7. Cookie 256 bit nên GET không giúp đoán; rủi ro chỉ là tải. Đề xuất (A) |
| 6 | `password` sai bước ⇒ 409 trước khi băm | §10.4: “cổng chạy trước hashing; cổng hỏng không tốn hash” | Đúng như vậy | **Khớp hợp đồng.** Không cần quyết |
| 7 | Lần sai TOTP thứ 5 ⇒ 429 | §8: “TOTP sai lần 5 … commit rồi ném (**429 nếu bucket cũng khóa**)”; §7: bucket 5 sai/15 phút khóa 15 phút; §6.1: 429 kèm `Retry-After` | Lần 1–4: `400 ADMIN_TOTP_INVALID`; lần 5: attempt INVALIDATED + bucket khóa ⇒ `429 ADMIN_AUTH_RATE_LIMITED` + `Retry-After` > 0; cả 5 lần đều được đếm bền | **Khớp hợp đồng** (bucket cùng ngưỡng 5 nên luôn khóa ở lần 5). Test X ép đúng 4×400 rồi 429 + `Retry-After` |
| 8 | `restart` từ INVALIDATED không phải ATTEMPTS_EXHAUSTED ⇒ 409 | §11.2 hàng restart; K24 | Đúng như vậy (`can_restart=false`) | **Khớp hợp đồng**; test X (SUPERSEDED, INVITATION_CLOSED, PHONE_CONFLICT) |
| 9 | **Mới**: `start` ra 404 ở ô INVITATION_CLOSED / PHONE_CONFLICT (có cookie hợp lệ), và token của lời mời ACCEPTED/đóng | §11.2 ghi “—” (không bucket nghiệp vụ); nhưng §10.1 bước 6 và §8: lời mời không PENDING/hết hạn ⇒ `recordFailure(LINK_IP)` rồi 404 | Code theo §10.1/§8: **mỗi 404 của `start` đếm đúng 1 `ACTIVATION_LINK_IP`** (404 đồng nhất không phân biệt token sai với liên kết đã đóng; OD-10); không đổi gì khác | **Mâu thuẫn nội bộ của hợp đồng** (§11.2 “—” vs §10.1/§8) do test ma trận X phát hiện. Lựa chọn: **(A)** giữ code, sửa chú thích §11.2 (ô start-404 đếm LINK_IP); **(B)** không đếm khi token khớp một lời mời đã đóng — nhưng khi đó 404 không còn đồng nhất về bộ đếm (lộ “token này từng tồn tại” qua việc không bị khóa), trái OD-10. Đề xuất (A). Test X khẳng định +1 chính xác và không gì khác đổi |

Ngoài chín mục: đọc COMPLETED mà lời mời không ACCEPTED (bất khả thi theo trigger 1A) ⇒ lỗi nội bộ 500, không audit — không có câu trong hợp đồng; đề xuất giữ.

**Đối chiếu giá trị mục #2 với §7** (code = hằng số; test = nơi hành vi được kiểm):

| §7 | Giá trị | Hằng số | Kiểm bởi |
|---|---|---|---|
| Vòng đời attempt | 30 phút (≤ hạn lời mời) | `ATTEMPT_TTL_MS` | C K25 (giờ DB), DDL ≤ 1 giờ |
| OTP hiệu lực | 300 s | `OTP_TTL_MS` | D (PENDING hết hạn), F |
| Cooldown gửi lại | 60 s | `OTP_RESEND_COOLDOWN_MS` | F, S K13 |
| Sai OTP / challenge | 5 | `OTP_WRONG_LIMIT` | F K27, S K7 |
| Gửi OTP | 5 / giờ / lời mời | `OTP_SEND_LIMIT`, `…WINDOW` | F |
| Đặt mật khẩu sau OTP | ≤ 600 s | `PASSWORD_DEADLINE_MS` | C K24 |
| Sai TOTP / attempt | 5 | `TOTP_WRONG_LIMIT` | F K28, C K8, X |
| Ingress | 30 / 60 s / IP | `ACTIVATION_REQUEST_LIMIT` | X (31 POST ⇒ 429) |
| Sai token ở `start` | 10 / 15 phút, khóa 15 phút | `LINK_FAILURE_*` | F, X |
| Sai TOTP bucket | 5 / 15 phút, khóa 15 phút | `TOTP_FAILURE_*` | F K28, X |
| Timeout provider | 8 s (cấu hình) | `providerTimeoutMs` | U config, T |
| Ân hạn promote | 10 s (cấu hình) | `promoteGraceMs` | T K17, D K18 (1 s) |

## 6. Giới hạn kiểm chứng (nói rõ)

- **Môi trường**: không `npm install` được (chính sách tổ chức) nên không chạy được jest/Nest cục bộ; kiểm chứng cục bộ = PostgreSQL 16 cho SQL (`run.sh`: 65 PASS, Up/Down/Up) + typecheck bằng stub. **Nguồn sự thật là CI.** Log job không tải được, chỉ đọc được annotation (số tổng + lỗi đầu tiên), nên lỗi được sửa theo từng vòng; lần chạy cuối xanh toàn bộ.
- **Bằng chứng loại P, không phải thứ tự khóa**: K8 (7 TOTP sai song song) và các bản `Promise.all` của K1/K5/K6/K7/K13/K21/K22 trong C.
- **Đối xứng**: K1, K5, K6 chỉ có một lịch (hai request cùng loại là hoán đổi được).
- **Chưa dựng**: fixture “hai attempt sống cùng lúc” (bất khả thi theo schema — thay bằng K11(a)(b)(c)); K10 cho `otp/request`/`start`/`restart` (chỉ phục hồi bằng GET state theo §11.3); lịch ba request; race ngẫu nhiên N=100; hết hạn `invitation` giữa chừng cho mọi route (chỉ K16 cho `start`).
- **Chưa kiểm thử**: không SMS thật, không UI, không thiết bị thật, không staging; quyền bảng runbook chỉ được kiểm bằng `remote-migration-fresh-db` (**D4 phải kiểm bằng endpoint thật**).
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
