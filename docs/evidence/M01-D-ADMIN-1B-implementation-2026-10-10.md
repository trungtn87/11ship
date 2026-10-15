# M01-D-ADMIN-1B — bằng chứng triển khai (10/10/2026)

> **Cập nhật vòng sửa finding phân quyền (mục 7).** Review code tại `ad9b092` nêu một finding: reissue/revoke đọc SĐT lời mời trước khi kiểm quyền SYSTEM nên ADMIN nhận 404 (id không tồn tại) nhưng 403 (id tồn tại). Đã sửa ở commit riêng `4f9bfab`; các mục 1–6 dưới đây giữ nguyên là bằng chứng của `d5cc580`/`ad9b092`, riêng điểm diễn giải 5 ở mục 5 được thay thế bởi mục 7.

Người thực hiện: Claude. Môi trường test chính thức: GitHub Actions CI (Node 24, PostgreSQL 17, DB test có guard). **Không phải nghiệm thu**: chưa có review của ChatGPT cho code 1B, chưa có test local của Owner (cần UI SYSTEM — gói riêng), chưa deploy, M01 chưa đóng.

## 1. Mốc

| Mốc | SHA |
|---|---|
| Hợp đồng v2.1 đã duyệt (#38, base của PR này) | `ba0884bf53cf985c12f9ce69be868755349d19c2` |
| #37 (1A + B-1) | `c93c05148768b25d162e50c7d70d73d522de586e` |
| #34 (login + B-1) | `08910ed92608d102da29d45ae1a8e5afd14dbcd1` |
| Head code của PR implementation đã chạy CI (trước commit tài liệu này) | `d5cc580df579d4d331787c7fb9c470967be5dad4` |

CI trên `d5cc580`: **success** — lint, typecheck, build, deploy-config tests, migrations smoke; unit **1587/1587** (76 suite); integration CI mode **1097/1097** (65 suite); local mode 1092 đạt + 5 pending theo thiết kế (hai ca chỉ chạy ở CI mode). So với base #38 (`ba0884b`: unit 1504, integration 986, 60 suite): +3 suite unit, +5 suite integration, +83 test unit, +111 test integration. Kết quả CI trên final head (sau commit này, chỉ thêm tài liệu) ghi ở mô tả PR.

Preflight (10/10/2026): ba head khớp mốc đã duyệt; `main` = `01b44ed`; #34 lệch `main` 55 commit, **tất cả chỉ `docs/PROGRESS.md`**, GitHub báo `mergeable=true` — ghi nhận là gate tích hợp, không tự hòa giải, không đụng #27.

## 2. Đã triển khai

| Phần | File |
|---|---|
| Migration `admin_sensitive_operations` (DDL, trigger, Down thật) | `database/migrations/1792195200000_create-admin-sensitive-operations.sql` |
| 9 mã lỗi mới | `apps/backend/src/common/app-errors.ts` |
| Cấu hình `ADMIN_INVITATION_TTL_HOURS`, `ADMIN_ACTIVATION_ORIGIN` | `apps/backend/src/config/admin-auth-config.ts`, `.env.example`, runbook |
| Subkey `adminOperation` (Q11) + fingerprint | `crypto/kdf.ts`, `crypto/key-version.ts`, `admin-auth/admin-crypto.ts` |
| Module 1B | `apps/backend/src/admin-provisioning/` — controller, `admin-operation-service`, `admin-invitation-service`, `admin-system-actor`, `admin-operation-repository`, `admin-invitation-reader`, `admin-provisioning-validation`, `admin-provisioning-views`, `admin-provisioning-locks`, constants |
| Đấu nối (chỉ khi `ADMIN_AUTH_ENABLED=true`) | `admin-auth/admin-auth.module.ts` (+ `IdempotencyModule`, middleware no-store) |
| Fixture test | `tests/integration/support/provisioning-fixtures.ts`; `admin-fixtures.ts` (basePath, cấu hình mới, `businessLockTimeoutMs` 10 s cho test barrier); `auth-fixtures.ts` (`purgePhone` dọn 3 bảng 1A/1B bằng `TRUNCATE` khi còn tham chiếu user) |

Routes (`/v1/admin`, chỉ SYSTEM): `POST /operations`, `POST /operations/:id/verify`, `GET /operations/:id`, `POST /invitations`, `GET /invitations`, `GET /invitations/:id`, `POST /invitations/:id/reissue`, `POST /invitations/:id/revoke`. Không UI, không OTP, không kích hoạt 1C, không recovery, không tạo user/membership ADMIN, không quản lý tài khoản Khách/Quán/Shipper.

## 3. Đối chiếu hợp đồng ↔ test/bằng chứng

Tên file test viết tắt: **H** = `tests/integration/admin-provisioning.int.spec.ts`; **SU** = `admin-provisioning-step-up.int.spec.ts`; **RP** = `admin-provisioning-replay.int.spec.ts`; **TL** = `admin-provisioning-locks.int.spec.ts`; **MG** = `admin-provisioning-migration.int.spec.ts`; **U** = unit trong `apps/backend/src/admin-provisioning/*.spec.ts`.

| Mục hợp đồng | Triển khai | Test / bằng chứng |
|---|---|---|
| §5 DDL, CHECK, trigger, unique sống, Down | migration | MG: hình thức file, inventory, FK NO ACTION (3), CHECK 23514, unique 23505, trigger 23001 cho từng chuyển sai, CHECK hết hạn, thứ tự Down, up→down→up rollback; spec cũ (auth/driver/shop/hours/migration/1A) cập nhật Down/Up và trigger count |
| §6.0 thứ tự POST (Q6) | controller `#postIngress` | H "POST transport…", H LM quota |
| §6.0 GET Origin tùy chọn (F5) | `#assertGetOrigin` | H "GET: no Origin header is fine…" |
| §6.0 chỉ SYSTEM; app Khách/Quán/Shipper không vào được | `AdminSystemActor` | H AZ: ADMIN-role → 403 trên cả 8 route; không cookie / bearer / cookie lạ → 401; DISABLED, đổi mật khẩu, membership version, factor version → 401 cho GET và POST |
| §6.1 parser strict, chuẩn hóa | validation | U validation (canonical, reissue null/array, giới hạn code point, quyền, cursor); H "strict parser" (20 ca, không ghi gì) |
| §6.2/§8.3.1 create-operation, F1 | `createOperation` | H ST; TL trace; TL S1, S2 (không có 23505) |
| §6.3 fingerprint, Q1/F4 | `canonicalPayload`, `operationFingerprint` | U purposes (null ≠ mảng giống hệt; khác action/khóa); H CR "body differs…"; H RI "copy và explicit là hai xác nhận khác nhau" |
| §6.4/§7.4 verify, bộ đếm, commit-then-throw (F6) | `verify` | SU: sai → commit bucket + attempt + audit DENIED; lần 5 → `ATTEMPTS_EXHAUSTED` + 429; bucket khóa → 429 không đếm; mã vừa dùng đăng nhập bị so và đếm; unknown/replaced/verified/consumed → 403 không đếm; H body sai → 400 không đếm |
| §6.5 GET operation (F5) | `read`, `operationView` | U views; H ST (PENDING/VERIFIED, VERIFIED quá hạn → usable=false không ghi, đăng nhập lại → không dùng được, status giữ PENDING); TL S8 hai thứ tự |
| §6.6 create | `create` | H CR (snapshot, digest = SHA-256 của token trong link, TTL 72 h, CONSUMED, 1 audit, 1 record, token/SĐT/tên không có trong audit/log); PENDING_EXISTS sớm và dưới khóa; PENDING quá hạn → EXPIRED + audit; PHONE_CONFLICT sớm và dưới khóa (Q3); thiếu Idempotency-Key |
| §6.7/§6.9 GET chi tiết, danh sách | `get`, `list` | H reads (che SĐT, `expired` theo giờ DB, không token/link, 404; phân trang cursor, lọc status, query sai → 400) |
| §6.8 reissue (Q1, Q2, F4) | `reissue` | H RI (copy snapshot/tên/ghi chú/SĐT; snapshot mới khi có permissions; snapshot cũ bất biến; SUPERSEDED → PENDING cùng transaction; reissue PENDING quá hạn; version cũ/terminal/404 ở create-op) |
| §6.9 revoke (Owner: chỉ PENDING) | `revoke` | H RI (200 REVOKED v+1; revoke PENDING quá hạn; terminal → NOT_PENDING) |
| §7.2 Q11 subkey, khóa lịch sử | kdf, `AdminCrypto` | U kdf (vector cũ giữ nguyên + vector mới); RP "operation fingerprinted with a key that is no longer in the keyring" → 503 |
| §7.3 tiêu thụ CAS, 120 s | `consume`, `markVerified` | SU "consumes exactly once"; SU hết hạn trong lúc chờ khóa (verify và create); H ST 120 s |
| §8.1 thứ tự khóa L1…L9, một chế độ/hàng | toàn module | TL trace từng route (create-op, verify, reissue-target, create, replay, reissue, revoke, 3 GET): chuỗi khóa thực tế đúng thứ tự và đúng danh sách; GET không có `FOR UPDATE`/ghi |
| §8.2 khóa ngầm FK/unique/trigger | L8 trước L9, L3 trước PENDING | TL S1/S2 (unique sống không bao giờ là luồng điều khiển), S4/S5 (L3 tuần tự hóa cùng SĐT), MG FK |
| §8.5 giờ DB sau khóa cuối; `lock_timeout` (Owner) | `freshClockMs`, `setBusinessLockTimeout` | SU hết hạn sau khóa (operation, phiên); TL trace (`set_config(lock_timeout)` trước khóa đầu); U boundary; TL "lock wait longer than lock_timeout" → 55P03, không ghi gì |
| §8.6 B-1 | bootstrap (#34) | **Test B-1 đã có** (#34 `08910ed`): `admin-bootstrap-lock-order.int.spec.ts`. **Test 1B mới**: TL S9 bootstrap × create-operation hai thứ tự → không deadlock, `UNCHANGED` |
| §9 idempotency/replay (F2), 900/86400 s | executor + `#authorizeReplay` | RP: cùng key → cùng link, không tạo thêm; khác body → KEY_REUSED; hết cửa sổ → REPLAY_EXPIRED; phiên mới của cùng SYSTEM được replay, phiên cũ thu hồi → 401; membership vô hiệu → 401 với ciphertext hỏng (không 503); lời mời bị thu hồi / PENDING quá hạn → NOT_REPLAYABLE với ciphertext hỏng hoặc guard đổi (chứng minh trước giải mã); reissue/revoke replay; hai request cùng key; TL S11 |
| §9.4/§14 unknown COMMIT, khôi phục | executor, TransactionManager | RP unknown COMMIT → `TRANSACTION_OUTCOME_UNKNOWN`, server không retry (1 COMMIT), cùng key sau đó → replay đúng 1 lời mời; RP audit lỗi → rollback toàn bộ, operation còn VERIFIED, key chưa tiêu thụ; RP create-op lặp lại an toàn (REPLACED); RP thiếu khóa lịch sử idempotency → 503 `IDEMPOTENCY_KEY_UNAVAILABLE` |
| §10 limiter (Q5, Q6) | quota POST, bucket `TOTP_USER` | H LM (31 → 429 + Retry-After; một operation sống); SU (bucket chung khóa cả TOTP đăng nhập) |
| §11 audit (Q7, Q8) | `actorType = SYSTEM` | H CR/RI (audit created/reissued/revoked, `reason` trong audit, không trong response/log); SU audit DENIED; H expired audit |
| §12 mã lỗi | registry | `all-exceptions.filter.spec.ts`, `error-registry-http.int.spec.ts` (47 mã, 15 `ADMIN_*`) |
| §13 cấu hình (Q10, Owner) | config | `admin-auth-config.spec.ts` (mặc định 72, 1–168, sai → tên biến; origin bắt buộc, thuộc allowlist, không tự chọn) |
| S12 (hai create cùng SĐT) | tầng participant 1A | `admin-invitations.int.spec.ts` (giữ nguyên, chỉ thêm bảng vào `TRUNCATE`) |

## 4. Kết luận protocol khóa

- **Call graph (đọc code)**: mọi khóa của module mới nằm ở `admin-system-actor` (L4–L7 qua `lockAndCheck`, factor, session), `admin-invitation-reader.lockShared` (L8 S), participant 1A `lock`/`lockPendingByPhone` (L8 X), `admin-operation-repository` (L9), `lockPhone` (L3), `lockBuckets` (L2) và executor (L1). Không có đường đi nào lấy khóa hạng thấp sau hạng cao; GET chỉ `FOR SHARE`. B-1 đã sửa, không còn đường đi đảo thứ tự đã biết ở #34/#37/#41.
- **Trace thực tế (CI)**: chuỗi khóa của từng route khớp đúng bảng §8.1 và không giảm; transaction không qua executor đặt `lock_timeout` trước khóa đầu.
- **Lịch barrier (CI)**: S1–S11 đạt theo cả hai thứ tự ở nơi thứ tự quan trọng; không có `40P01`; unique "một operation sống" không bao giờ bị chạm; S12 ở tầng 1A.
- **Trạng thái**: các điều kiện kỹ thuật (1) và (3) của §8.7 đã có bằng chứng CI. `LOCK_PROTOCOL` vẫn ghi **NOT_FINAL** cho tới khi ChatGPT review xác nhận (điều kiện 2); điều kiện (4) thuộc 1C (phải phân tích call graph kích hoạt trước khi mở route 1C).
- **Chưa làm**: race ngẫu nhiên N=100 (hợp đồng §15 coi là kiểm tra bổ sung, không phải chứng minh).

## 5. Điểm diễn giải hợp đồng (cần ChatGPT xác nhận, không đổi nghiệp vụ)

1. `GET /admin/operations/:id` với id không tồn tại hoặc của actor khác trả `403 ADMIN_STEP_UP_REQUIRED` (hợp đồng không nêu mã; chọn mã step-up duy nhất để không lộ sự tồn tại).
2. Logical request của idempotency có dạng `{ operation_id, payload: <canonical payload §6.3> }` cho cả ba route — cùng nội dung với §9.1 (kể cả `permissions` của reissue), chỉ khác cách lồng.
3. Phần đọc lời mời nằm trong `admin-provisioning/admin-invitation-reader.ts` thay vì thêm hàm vào repository 1A (§16 dự kiến): file 1A giữ nguyên.
4. `Content-Type` không phải JSON → `400` chung (như #34), không phải `ADMIN_INPUT_INVALID`.
5. ~~Reissue/revoke với id không tồn tại trả 404 ở bước tiền kiểm~~ — **đã sửa** (finding review `ad9b092`, mục 7): kiểm quyền SYSTEM dưới khóa chạy trước khi tra mục tiêu.

Bốn diễn giải 1–4 **đã được chấp nhận** và được ghi vào hợp đồng tại mục 6.10 (hợp đồng v2.2).

## 6. Giới hạn

- Môi trường của Claude không cài được dependency (registry npm bị chặn) nên không chạy được jest/eslint cục bộ. Bằng chứng cục bộ: typecheck bằng TypeScript 6 với stub cho `@nestjs/*`, `pg`, `@jest/globals` (chỉ lỗi do stub); SQL của migration, repository và reader chạy thử trên PostgreSQL 16 cục bộ (DB nháp). **Bằng chứng chính thức là CI.**
- Không chạy gì trên DB Owner/staging; migration chỉ chạy trên DB test của CI và DB nháp cục bộ.
- Theo từng ứng dụng: Web quản trị — backend API đã code + CI, **chưa có UI**, chưa test local/thiết bị; Khách/Quán/Shipper — N/A (chỉ dùng app; test âm tính xác nhận không vào được) — quyết định N/A thuộc Owner; App quản lý — N/A trong 1B; Liên thông — kích hoạt là 1C, chưa kiểm chứng.

## 7. Sửa finding phân quyền của reissue/revoke (review `ad9b092`)

**Finding.** `reissue()`/`revoke()` gọi tra SĐT mục tiêu (đọc không khóa) trước mọi kiểm quyền dưới khóa. Phiên ADMIN-role nhận `404 ADMIN_INVITATION_NOT_FOUND` với id không tồn tại nhưng `403 ADMIN_FORBIDDEN` với id tồn tại: lộ sự tồn tại. Cùng lỗ hổng với phiên đã hết hạn/thu hồi/lệch factor hoặc membership.

**Sửa (commit riêng `4f9bfab`, đã push không force-push).** Thêm một transaction authorization chỉ đọc chạy **trước** việc tra mục tiêu: `lock_timeout` (`set_config(..., true)`) → L4 `users` S → L5 `memberships` S → L6 factor S → L7 phiên S → giờ DB → `assertLive` (ADMIN ⇒ 403, hết hạn/thu hồi/lệch ⇒ 401) → chỉ khi đạt mới đọc thường SĐT bất biến (không có ⇒ 404 cho SYSTEM hợp lệ). Transaction này commit trước coordinator nên không giữ khóa nào khi coordinator lấy L1/L3; coordinator và hook replay giữ nguyên kiểm actor/session/factor/membership của chúng dưới khóa và thứ tự đã duyệt. Hợp đồng cập nhật ở mục 6.0, 6.8, 6.9, 8.1, 8.3.4, 8.4, 8.5, 8.6, 15 (nhóm AZ-R) và mục 6.10 mới.

### Bảng finding → code → regression test

| Yêu cầu | Code | Regression test |
|---|---|---|
| ADMIN + id tồn tại **và** không tồn tại ⇒ 403 `ADMIN_FORBIDDEN` (cả hai route) | `admin-invitation-service.ts`: `#authorizeAndTargetPhone` thay `#targetPhone` ở `reissue` và `revoke` | `admin-provisioning.int.spec.ts` › "reissue/revoke authorize the session BEFORE looking the target up" › "an ADMIN-role session gets 403 ADMIN_FORBIDDEN for an existing AND an unknown id" (`it.each` reissue, revoke; body không chứa `NOT_FOUND`) |
| SYSTEM hợp lệ + id không tồn tại ⇒ vẫn 404 | cùng hàm: đọc `peekPhone` chỉ sau `assertLive` | "a valid SYSTEM session still gets 404 for an unknown id" (reissue, revoke) |
| Phiên thu hồi / hết hạn; version factor lệch; version membership lệch; membership `DISABLED` ⇒ 401 `ADMIN_SESSION_INVALID`, id tồn tại và không tồn tại | `actor.lock(..., { user: 'read', factor: 'read' })` + `freshClockMs` + `assertLive` | "refused with 401 when …" — 8 ca (4 điều kiện × reissue/revoke), mỗi ca cho cả hai loại id |
| Không đổi lời mời, operation, bộ đếm TOTP, audit nghiệp vụ, record idempotency khi bị từ chối | transaction authorization chỉ đọc, không audit | `snapshot()` (lời mời, `admin_sensitive_operations` gồm `status/attempt_count`, số audit `admin_invitation.%`, số record `admin_user`, bucket TOTP) so bằng nhau trước/sau ở mọi ca trên |
| Kiểm actor/session/factor/membership trong coordinator và replay còn nguyên; thứ tự khóa đã duyệt giữ nguyên | coordinator (`executor.execute`) và `#authorizeReplay` **không đổi** | `admin-provisioning-locks.int.spec.ts` › `expectAuthorizedThenMutation`: 2 transaction; authorization = `L4,L5,L6,L7` chỉ `FOR SHARE`, không advisory, `lock_timeout` trước khóa đầu; coordinator không giảm và đúng danh sách khóa cũ; authorization kết thúc trước coordinator; test replay/RP, S1–S11 và các trace khác giữ nguyên và xanh |
| Barrier / `lock_timeout` | `setBusinessLockTimeout` trước khóa đầu của transaction authorization | trace ở trên; test `55P03` hiện có không đổi |

**Mốc.** Head được review: `ad9b092959e60adab5a9f5ef6919082feb2fe7ba`; base (hợp đồng #38): `ba0884bf53cf985c12f9ce69be868755349d19c2` (không đổi). Head lúc nhận việc là `4f9bfab79eb85de991a19d33382ea48802f5d339` (đã chứa bản sửa, 3 file: service, 2 spec); đối chiếu diff `ad9b092..4f9bfab` trước khi làm tiếp: chỉ đúng phạm vi finding, không file nào khác.

**CI trên `4f9bfab`** (code, trước commit tài liệu của vòng này): **success** — https://github.com/trungtn87/11ship/actions/runs/38016242293 — lint, typecheck, build, deploy-config, migrations smoke; unit **1587/1587** (76 suite); integration CI mode **1109/1109** (65 suite, 0 pending); local mode 1104 đạt + 5 pending theo thiết kế. So với `d5cc580` (1097 integration): +12 test, đúng bằng 2 + 2 + 8 ca regression ở trên. CI trên final head (sau commit tài liệu) ghi ở mô tả PR.

**Giữ nguyên.** PR Draft; `LOCK_PROTOCOL = NOT_FINAL` (điều kiện 2 và 4 của mục 8.7 hợp đồng chưa đạt); chưa triển khai 1C; không merge, không deploy, không nghiệm thu, không đóng M01; PR #40/G01 đã merge và không bị sửa lại.

**Giới hạn của vòng này.** Môi trường của Claude không chạy được jest/eslint cục bộ (registry npm bị chặn): bằng chứng chính thức là CI đúng SHA; không chạm DB Owner/staging.
