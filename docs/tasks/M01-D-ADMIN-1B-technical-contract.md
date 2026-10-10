# M01-D-ADMIN-1B — hợp đồng kỹ thuật: tạo / cấp lại / thu hồi lời mời ADMIN (v2, sau review ChatGPT + quyết định Owner)

Quy trình: [11ship-delivery-workflow](../process/11ship-delivery-workflow.md). Mẫu: [module-delivery-checklist](../templates/module-delivery-checklist.md).
Người soạn: Claude (theo yêu cầu ChatGPT/Owner). **Đây là tài liệu thiết kế kỹ thuật, không phải code, không phải bằng chứng test, không phải nghiệm thu.** Chưa có dòng code sản phẩm 1B nào. Claude chỉ code sau khi ChatGPT review đạt head mới của tài liệu này.
Trạng thái: `DESIGN v2 — chờ ChatGPT review head mới`. Các quyết định ở mục 1 là quyết định của Owner do ChatGPT chuyển; mọi điều khác trong tài liệu vẫn là đề xuất thiết kế.

## 0. Nguồn và mốc

| Nguồn | SHA đã đọc |
|---|---|
| #38 (tài liệu này) — head đã review, trước bản v2 | `76884c9f08e382e2f6c2257a9b4f98d4da99ead7` |
| #37 — gói 1A, head **trước** khi nhận bản sửa B-1 (ChatGPT đã duyệt kỹ thuật tại SHA này) | `fa11ee5c0a26f34c22e1ad97caa94857f363b134` |
| #37 — head **sau** khi merge bản sửa B-1 và sửa test (merge commit, không force-push); **base mới của #38** | `c93c05148768b25d162e50c7d70d73d522de586e` (trung gian: `81732370e1dd90e213be0ffee5ec075b1f4a2535`) |
| #34 — M01-D-LOGIN backend, head **trước** bản sửa B-1 | `4d20660eb3b0656b626a084df6e55d4385ee405a` |
| #34 — bản sửa B-1 (commit `fix(admin-auth): bootstrap SYSTEM locks user before membership (B-1)`) | `38bb8c7c196f9824b52827d703b9fa91c2ddbe05` |
| #34 — head **sau** commit sửa test tham chiếu (CI trên `38bb8c7` chỉ hỏng ca tham chiếu vì đọc sai trường `sqlState`) | `08910ed92608d102da29d45ae1a8e5afd14dbcd1` |
| #35 — UI đăng nhập (không dùng cho 1B) | `7b116c3d4551bf0028fa544278449598acf5991c` |
| #36 — kiểm kê/đề xuất ADMIN | `101daa8a53788b788c835fa53b3668733f1b359b` |

Head/base của #38 được kiểm lại trước khi sửa: khớp mốc đã review (`3fd5d22` / `fa11ee5`). Sau đó Owner cho phép sửa B-1 trong phạm vi riêng: bản sửa nằm ở **commit riêng trên nhánh #34**, được đưa lên #37 và #38 bằng **merge commit** (không rebase, không force-push). #38 vẫn là PR xếp chồng trên #37, nay với base mới ở bảng trên; không tự merge phụ thuộc. Nguồn nghiệp vụ: Activation Contract v1 + Technical Design 1A + 6 bộ UI Owner đã duyệt (UI-06: màn "Lời mời đã tạo", "ADMIN chờ kích hoạt", popup xác nhận gồm **lý do bắt buộc + mã 2FA mới của SYSTEM**).

Nguyên tắc không đổi: **web quản trị chỉ dành cho ADMIN/SYSTEM; Khách, Quán và Xế chỉ dùng app riêng.** 1B **không** có UI, OTP, kích hoạt tài khoản, trang kích hoạt công khai, user/membership ADMIN, khôi phục 2FA, hay quản lý tài khoản Khách/Quán/Xế.

## 1. Quyết định của Owner đã ghi nhận (Q1–Q11) và nơi áp dụng

Nguồn: review của ChatGPT, Owner duyệt toàn bộ đề xuất Q1–Q11 và hai tham số replay 15 phút / dedupe 24 giờ.

| # | Quyết định (nguyên văn ý) | Áp dụng ở |
|---|---|---|
| Q1 | Cấp lại nhận `permissions` **tùy chọn**. Không gửi → sao chép quyền cũ. Gửi → dùng snapshot quyền mới. Giữ nguyên họ tên, ghi chú, SĐT. Permissions đã chuẩn hóa nằm trong operation fingerprint và idempotency logical request, ở **cả** payload create-operation **và** route reissue. | 6.1 (parser), 6.2, 6.3, 6.8, 8.4.2, 9.1, 15 |
| Q2 | Chỉ cấp lại lời mời `PENDING`, kể cả `PENDING` đã quá hạn. | 6.8, 8.4.2 |
| Q3 | Kiểm SĐT sớm (create-operation) và kiểm lại khi mutation; kích hoạt 1C là chốt cuối. Không nâng quyền hay ghi đè tài khoản app đã tồn tại. | 6.2, 8.3.1, 8.4 |
| Q4 | Operation hết hạn **120 giây kể từ lúc tạo**, không gia hạn khi verify. | 5, 7.1 |
| Q5 | Dùng chung bucket sai TOTP (`TOTP_USER`) với đăng nhập. | 10 |
| Q6 | Dùng quota POST đã có. Thứ tự thống nhất: **transport → quota → parser → tiền kiểm cookie/CSRF → coordinator.** | 6.0, 8.1 (R0), 10 |
| Q7 | Lưu `reason` trong audit, không kèm token/link. UI sau này nhắc người dùng không nhập bí mật. **Không khẳng định reason tự do luôn không có dữ liệu cá nhân.** | 11 |
| Q8 | `actorType = SYSTEM` cho thao tác lời mời; giữ audit login hiện có (`USER`). | 11 |
| Q9 | Có endpoint danh sách lời mời trong backend 1B. | 6.9 |
| Q10 | TTL lời mời mặc định 72 giờ, hợp lệ 1–168; origin link theo allowlist. Thiếu TTL → dùng mặc định; giá trị sai → từ chối khởi động. | 13 |
| Q11 | Subkey riêng `adminOperation`; **không đổi dẫn xuất khóa cũ.** | 7.2, 13 |
| — | Replay 900 giây; dedupe 86400 giây. | 9 |

Quyết định bổ sung của Owner (duyệt kết luận review tại head `3fd5d22`, 10/10/2026):
- **Thu hồi chỉ áp dụng cho `PENDING`, kể cả `PENDING` đã quá hạn nhưng chưa terminal**; lời mời đã terminal trả `ADMIN_INVITATION_NOT_PENDING` (mục 8.4.3).
- **Khi `ADMIN_AUTH_ENABLED=true`, `ADMIN_ACTIVATION_ORIGIN` là bắt buộc và phải thuộc allowlist; thiếu hoặc sai ⇒ từ chối khởi động, không tự chọn origin** (mục 13).
- **Chấp nhận `409 ADMIN_INVITATION_NOT_REPLAYABLE`**, trả **trước** khi giải mã link (mục 9.3, 12).
- **Transaction 1B không qua executor đặt `lock_timeout` bằng `set_config('lock_timeout', …, true)` ngay trước khóa đầu tiên, giá trị lấy từ `businessLockTimeoutMs` đã validate; không sửa `TransactionManager` toàn cục** (mục 8.5).
- **Mọi GET lời mời (chi tiết và danh sách) kiểm factor ACTIVE đúng `factor_id/factor_version` của phiên dưới khóa**, thứ tự user → membership → factor → session → mục tiêu nếu cần (mục 6.0, 8.3.3).
- **B-1 được Owner cho phép sửa trong phạm vi riêng** (bootstrap SYSTEM và test liên quan), xem mục 8.6–8.7.

## 2. Sáu finding của ChatGPT → nơi đã sửa

| Finding | Nội dung | Mục |
|---|---|---|
| F1 | Tuần tự hóa create-operation: UPDATE user → membership ngay từ đầu, không nâng khóa giữa transaction, không dựa vào unique violation làm luồng điều khiển | 8.1, 8.2, 8.3.1, 15 (S1–S3) |
| F2 | Giờ DB sau khóa cuối; thứ tự kiểm tra từng route; replay create/reissue kiểm lời mời còn PENDING và chưa quá `expires_at` trước khi giải mã link | 8.3, 8.4, 9.3 |
| F3 | Test phù hợp một SYSTEM / một operation sống | 15 (S3–S5, S12) |
| F4 | Đổi quyền bằng cấp lại nhất quán (parser, API, fingerprint, coordinator, test) | 6.1, 6.3, 6.8, 8.4.2, 9.1, 15 |
| F5 | GET và trạng thái operation: Origin, `usable`/`expired` theo giờ DB và binding hiện tại, GET chỉ đọc | 6.0, 6.5, 8.3.3, 15 (nhóm ST) |
| F6 | Bộ đếm chỉ tăng khi thật sự so sánh TOTP và sai; commit-then-throw; phân biệt invalidation đã commit với từ chối do điều kiện; khóa hiện hữu vs ghi mới; khóa ngầm FK/unique/trigger; lịch chạy có barrier | 7.4, 8.1–8.2, 8.3.2, 8.6, 8.7, 10, 14, 15 |

## 3. Phạm vi 1B

Trong phạm vi (backend, không UI):
1. Migration mới: bảng `admin_sensitive_operations` (mục 5).
2. Step-up 2FA của SYSTEM: tạo operation, xác minh bằng TOTP mới, đọc trạng thái.
3. Tạo lời mời, cấp lại, thu hồi, đọc một lời mời, liệt kê lời mời.
4. Coordinator (một transaction mỗi route) gọi participant 1A; idempotency, audit, limiter, protocol khóa, mã lỗi, cấu hình.
5. Test đồng thời/replay (mục 15).

Ngoài phạm vi (1C hoặc về sau): mọi route `/admin-activation/*`, OTP và kênh operator, `admin_activation_attempts`, `admin_activation_otp_challenges`, `admin_profiles`, `admin_app_permissions`, tạo user/membership/factor/session ADMIN, khôi phục 2FA, UI, quản lý tài khoản các app. Điểm mở rộng cho 1C: mục 8.8.

## 4. Cơ sở đã đọc trong code (#34 + #37)

1. **`IdempotencyExecutor` là coordinator sở hữu transaction**: advisory lock theo tuple → `SELECT … FOR UPDATE` record → đồng hồ DB → (a) replay: so fingerprint (`KEY_REUSED`), cửa sổ replay (`REPLAY_EXPIRED`), kiểm cấu trúc, **hook `sensitive` khóa dòng quyết định quyền** rồi đọc đồng hồ lần nữa và mới giải mã; (b) chạy callback đúng một lần. Callback trả non-2xx hoặc ném lỗi → **rollback toàn bộ**. Record hết dedupe còn sót bị xóa trong transaction rồi coi như yêu cầu mới. Hệ quả: bước **verify TOTP** (cần commit bộ đếm khi sai) **không** chạy trong executor; nó theo mẫu `AdminTotpService.#verify`: transaction trả `{kind:'wrong'|'limited'|'ok'}`, commit, rồi ném lỗi **sau** commit.
2. **Thứ tự khóa đã có** (#34): bucket limiter (tăng dần `bucket_key`) → user → membership → factor → challenge/session. Writer `FOR UPDATE`, reader `FOR SHARE`. `AdminCredentialChecks.lockAndCheck` = user rồi membership (kiểm ACTIVE, binding mật khẩu, version membership). Hết hạn quyết định bằng `freshClockMs(context)` **sau khóa cuối**. Phiên cũ bị `revokeAllForUser` mỗi lần đăng nhập mới.
3. **Quota ingress** `reserveTotpRequest(ip)` chạy `withTransaction` **riêng và commit trước coordinator**; slot không hoàn lại khi lỗi sau đó. Controller #34: `#assertPostTransport` (Origin phải thuộc allowlist + Content-Type JSON) → quota → `parseTotpBody` → service (đọc cookie, tiền kiểm CSRF). `GET /admin-auth/me` hiện **không** kiểm Origin.
4. **TOTP**: `matchTotp(secret, code, now, lastAcceptedStep)` chỉ nhận step lớn hơn `last_accepted_step`. Sai/ngoài cửa sổ/dùng lại đều cùng một kết quả `undefined`. #34 ghi `recordWrongAttempt` + `recordFailure(bucket)` trong transaction commit rồi ném `ADMIN_TOTP_INVALID`/429. Trạng thái bucket bị khóa → `limited` (không tăng thêm).
5. **Limiter**: `lockBuckets` = `INSERT … ON CONFLICT DO NOTHING` (tạo dòng thiếu) rồi `SELECT … ORDER BY bucket_key FOR UPDATE`; `reserveRequest` = upsert `ON CONFLICT DO UPDATE` trong transaction riêng. Giá trị đã duyệt ở #34: `TOTP_REQUEST_LIMIT=30/60 s/IP`, `TOTP_FAILURE_LIMIT=5`, cửa sổ và khóa 15 phút.
6. **Audit** (`AuditWriter`): participant chỉ nhận `TransactionContext`; `actorType` khớp `^[A-Z][A-Z0-9_]{0,31}$` (`SYSTEM` hợp lệ, đã được dùng cho `system_bootstrapped`); lỗi audit ⇒ rollback toàn bộ. `audit_logs` và `idempotency_records` **không có FK**.
7. **1A (#37)**: identity lời mời bất biến bằng trigger (SĐT không đổi giữa tiền kiểm và khóa); reissue phải chuyển bản cũ sang terminal **trước** khi INSERT bản mới (FK `successor_id` deferred); `admin_invitation_permission_insert_guard` khóa dòng lời mời **vừa tạo** (`FOR UPDATE`); `admin_invitation_requires_view` chạy lúc COMMIT.
8. **Chỉ module admin chạm bảng `admin_*`**: `admin-auth/*` và `admin-invitations/*` (đã grep toàn `apps/backend/src`). Auth core, onboarding, shop, driver, outbox chỉ khóa các hàng `app.*` khác.

## 5. Dữ liệu 1B — `admin_sensitive_operations`

Một migration mới `<ts>_create-admin-sensitive-operations.sql` (timestamp chọn khi code, sau `1792108800000`), không `IF [NOT] EXISTS`/`CASCADE`, không seed, có Down thật. Mọi mốc thời gian lấy từ đồng hồ DB (cùng cách `CLOCK_CTE` của 1A). Operation sống tối đa 120 giây (Q4).

```sql
CREATE TABLE app.admin_sensitive_operations (
 operation_id uuid PRIMARY KEY,
 actor_user_id uuid NOT NULL REFERENCES app.admin_memberships(user_id),
 actor_session_id uuid NOT NULL REFERENCES app.admin_sessions(session_id),
 factor_id uuid NOT NULL,
 factor_version bigint NOT NULL CHECK (factor_version >= 1),
 membership_version bigint NOT NULL CHECK (membership_version >= 1),
 action varchar(24) NOT NULL CHECK (action IN ('CREATE_INVITATION','REISSUE_INVITATION','REVOKE_INVITATION')),
 target_id uuid REFERENCES app.admin_invitations(invitation_id),
 expected_version bigint CHECK (expected_version >= 1),
 payload_fingerprint char(64) NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
 fingerprint_key_id varchar(64) NOT NULL CHECK (fingerprint_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 status varchar(16) NOT NULL CHECK (status IN ('PENDING','VERIFIED','CONSUMED','INVALIDATED')),
 attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 verified_at timestamptz,
 consumed_at timestamptz,
 invalidated_at timestamptz,
 invalidated_reason varchar(24) CHECK (invalidated_reason IN ('REPLACED','ATTEMPTS_EXHAUSTED')),
 CHECK (expires_at > created_at AND (expires_at - created_at) <= interval '120 seconds'),
 CHECK ((action = 'CREATE_INVITATION' AND target_id IS NULL AND expected_version IS NULL)
     OR (action <> 'CREATE_INVITATION' AND target_id IS NOT NULL AND expected_version IS NOT NULL)),
 CHECK ((status = 'PENDING'     AND verified_at IS NULL     AND consumed_at IS NULL     AND invalidated_at IS NULL     AND invalidated_reason IS NULL)
     OR (status = 'VERIFIED'    AND verified_at IS NOT NULL AND consumed_at IS NULL     AND invalidated_at IS NULL     AND invalidated_reason IS NULL)
     OR (status = 'CONSUMED'    AND verified_at IS NOT NULL AND consumed_at IS NOT NULL AND invalidated_at IS NULL     AND invalidated_reason IS NULL)
     OR (status = 'INVALIDATED' AND consumed_at IS NULL     AND invalidated_at IS NOT NULL AND invalidated_reason IS NOT NULL)),
 CHECK (verified_at IS NULL OR (verified_at >= created_at AND verified_at < expires_at)),
 CHECK (consumed_at IS NULL OR (consumed_at >= verified_at AND consumed_at < expires_at)),
 CHECK (invalidated_at IS NULL OR invalidated_at >= created_at),
 CHECK (attempt_count < 5 OR (status = 'INVALIDATED' AND invalidated_reason = 'ATTEMPTS_EXHAUSTED'))
);
-- Tối đa MỘT operation đang sống cho mỗi SYSTEM. Đây là CHỐT AN TOÀN: luồng bình thường không bao giờ chạm vào nó,
-- vì create-operation tuần tự hóa theo khóa user/membership rồi vô hiệu bản cũ trước khi INSERT (mục 8.3.1).
CREATE UNIQUE INDEX admin_sensitive_operations_live_uq
 ON app.admin_sensitive_operations(actor_user_id) WHERE status IN ('PENDING','VERIFIED');

CREATE FUNCTION app.admin_sensitive_operation_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'admin sensitive operation deletion forbidden' USING ERRCODE = '23001';
 END IF;
 -- Định danh bất biến.
 IF ROW(NEW.operation_id,NEW.actor_user_id,NEW.actor_session_id,NEW.factor_id,NEW.factor_version,NEW.membership_version,
        NEW.action,NEW.target_id,NEW.expected_version,NEW.payload_fingerprint,NEW.fingerprint_key_id,NEW.created_at,NEW.expires_at)
  IS DISTINCT FROM
    ROW(OLD.operation_id,OLD.actor_user_id,OLD.actor_session_id,OLD.factor_id,OLD.factor_version,OLD.membership_version,
        OLD.action,OLD.target_id,OLD.expected_version,OLD.payload_fingerprint,OLD.fingerprint_key_id,OLD.created_at,OLD.expires_at) THEN
  RAISE EXCEPTION 'admin sensitive operation identity immutable' USING ERRCODE = '23001';
 END IF;
 -- Terminal không đổi nữa.
 IF OLD.status IN ('CONSUMED','INVALIDATED') THEN
  RAISE EXCEPTION 'admin sensitive operation is terminal' USING ERRCODE = '23001';
 END IF;
 -- Mốc đã đặt thì không đổi.
 IF OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
  RAISE EXCEPTION 'admin sensitive operation verified_at immutable' USING ERRCODE = '23001';
 END IF;
 -- PENDING -> PENDING: đúng MỘT lần sai thêm, không gì khác (lần sai thứ 5 phải đi cùng INVALIDATED bên dưới).
 IF OLD.status = 'PENDING' AND NEW.status = 'PENDING' THEN
  IF NEW.attempt_count = OLD.attempt_count + 1 AND NEW.attempt_count < 5 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'invalid admin sensitive operation transition' USING ERRCODE = '23001';
 END IF;
 IF OLD.status = 'PENDING' AND NEW.status = 'VERIFIED' AND NEW.attempt_count = OLD.attempt_count THEN RETURN NEW; END IF;
 IF OLD.status = 'VERIFIED' AND NEW.status = 'CONSUMED' AND NEW.attempt_count = OLD.attempt_count THEN RETURN NEW; END IF;
 IF NEW.status = 'INVALIDATED' THEN
  IF NEW.invalidated_reason = 'REPLACED' AND NEW.attempt_count = OLD.attempt_count THEN RETURN NEW; END IF;
  IF NEW.invalidated_reason = 'ATTEMPTS_EXHAUSTED' AND OLD.status = 'PENDING'
     AND NEW.attempt_count = OLD.attempt_count + 1 AND NEW.attempt_count = 5 THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'invalid admin sensitive operation transition' USING ERRCODE = '23001';
END $$;
CREATE TRIGGER admin_sensitive_operation_transition_guard BEFORE UPDATE OR DELETE ON app.admin_sensitive_operations
 FOR EACH ROW EXECUTE FUNCTION app.admin_sensitive_operation_transition_guard();
```

Quy tắc dữ liệu rút ra:
- Trạng thái lưu: `PENDING → VERIFIED → CONSUMED`; `PENDING|VERIFIED → INVALIDATED` với đúng hai lý do `REPLACED` (create-operation mới thay) và `ATTEMPTS_EXHAUSTED` (lần sai thứ 5). Không có trạng thái `EXPIRED` và không có job: **hết hạn không được ghi**, nó được tính bằng giờ DB mỗi lần đọc (mục 7.3). Điều kiện hiện tại lệch (phiên/factor/membership/mục tiêu) cũng **không** ghi `INVALIDATED`; chúng chỉ làm yêu cầu bị từ chối (mục 7.4).
- `attempt_count` chỉ tăng +1 khi `PENDING` và chỉ do một lần so sánh TOTP thật sự sai; lần thứ 5 đổi trạng thái sang `INVALIDATED` trong **cùng câu UPDATE**.
- Lệnh tiêu thụ và xác minh là compare-and-set có điều kiện thời gian (mục 7.3 và 8.3.2), không dựa vào CHECK để bắt hết hạn; CHECK `verified_at/consumed_at < expires_at` chỉ là lớp chặn cuối.
- Mã lỗi: `23001` cho xóa/định danh/terminal/chuyển sai (cùng quy ước trigger 1A); `23514` cho CHECK; `23505` cho unique; `23503` cho FK. Tôi sẽ đối chiếu lại hàm 1A trước khi code; test migration khẳng định từng mã.

**Down Migration** (thứ tự ngược, không `IF EXISTS`/`CASCADE`): `DROP TRIGGER … ON app.admin_sensitive_operations;` → `DROP FUNCTION app.admin_sensitive_operation_transition_guard();` → `DROP INDEX app.admin_sensitive_operations_live_uq;` → `DROP TABLE app.admin_sensitive_operations;`. Chỉ cho DB test dùng một lần; không chạy trên DB Owner/staging.

**Kiểm chứng đã làm (không phải CI):** DDL, trigger và Down ở trên được chạy trên PostgreSQL 16 cục bộ sau khi áp toàn bộ migration hiện có (gồm 1A). Mười kịch bản SQL cho kết quả đúng như thiết kế: insert hợp lệ; `expires_at` > 120 s bị CHECK chặn; operation sống thứ hai của cùng actor bị unique chặn; chỉ tăng `attempt_count` +1; lần sai thứ 5 không kèm `INVALIDATED` bị chặn, kèm `ATTEMPTS_EXHAUSTED` thì qua; terminal và DELETE bị chặn; `consumed_at` ≥ `expires_at` bị CHECK chặn; đổi fingerprint bị chặn; `REPLACED` qua; reissue không có `target_id` bị CHECK chặn; Down (rollback) đúng thứ tự. Đây là kiểm cú pháp/hành vi SQL của bản thảo, **không thay thế** migration thật, test tích hợp và CI.

Runbook grants thêm: `admin_sensitive_operations: SELECT, INSERT, UPDATE` (khớp bởi `remote-migration-fresh-db`). **Không** sửa `admin_auth_limits` (Q5/Q6), không sửa CHECK `kind`.

## 6. API (prefix `/v1`, controller `admin`, chỉ mount khi `ADMIN_AUTH_ENABLED=true`)

### 6.0 Quy ước chung và thứ tự kiểm (Q6)

**Mọi POST 1B**, theo đúng thứ tự: (1) **transport**: `Origin` phải bằng đúng một origin cấu hình (thiếu hoặc sai → `ADMIN_CSRF_INVALID`), `Content-Type: application/json`; (2) **quota** `reserveTotpRequest(ip)` (transaction riêng, commit); (3) **parser** strict của body; (4) **tiền kiểm không khóa**: đọc cookie `__Host-11admin` → `findByDigest` → so CSRF (`x-csrf-token`) với nonce lưu; (5) **coordinator** (executor hoặc `withTransaction`) với toàn bộ kiểm quyền lặp lại dưới khóa. Tiền kiểm chỉ để từ chối sớm; không bao giờ là quyết định cuối.

**Mọi GET 1B** (F5): không quota mới, không CSRF. **`Origin` là tùy chọn**: GET cùng-origin không bắt buộc có header `Origin`; nếu header **có mặt** mà không thuộc allowlist → `ADMIN_CSRF_INVALID`. Cookie phiên vẫn bắt buộc; phiên/quyền hiện tại vẫn được kiểm **dưới khóa** (`FOR SHARE`) như POST. GET không ghi gì và không bao giờ đổi trạng thái. **Mọi GET lời mời (chi tiết, danh sách) và GET operation kiểm factor `ACTIVE` đúng `factor_id/factor_version` của phiên, dưới khóa**: user → membership → factor → session → mục tiêu nếu cần (mục 8.3.3). Factor không ACTIVE hoặc lệch với phiên ⇒ `ADMIN_SESSION_INVALID`.

Chung: JSON strict (khóa lạ → `ADMIN_INPUT_INVALID`; cấm client gửi `role`, `account_origin`, `user_id`, `status`, `generation_id`, `expires_at`, `token`, `created_by`); response `{ "data": … }`; thời gian ISO-8601 UTC; `Cache-Control: no-store`. Chỉ phiên **SYSTEM** (membership ACTIVE, `admin_role='SYSTEM'`): phiên ADMIN → `ADMIN_FORBIDDEN`; không có cookie/phiên sai → `ADMIN_SESSION_INVALID`. Token của app Khách/Quán/Xế không phải cookie quản trị nên không qua được.

### 6.1 Chuẩn hóa đầu vào (một parser dùng chung cho create-operation và route nghiệp vụ, để fingerprint khớp)
- `full_name`: trim, 1–120 code point; `note`: 0–1000 ký tự, rỗng → `null`; `reason`: trim, 1–500 ký tự.
- `phone`: `normalizeVietnamPhone` phía server; kết quả phải khớp `^\+84[0-9]{9}$`.
- `permissions` (tạo; và cấp lại **nếu có gửi**): mảng 1–3, `app ∈ {CUSTOMER,SHOP,DRIVER}` không trùng, ba boolean `can_view/can_review_profile/can_lock` bắt buộc; ít nhất một `can_view`; review/lock ⇒ view; CUSTOMER không review. Sắp theo `app` trước khi tính fingerprint.
- **Cấp lại — quy tắc `permissions` (Q1/F4):** **vắng khóa** ⇒ chuẩn hóa thành `permissions: null` nghĩa là "sao chép snapshot của bản cũ"; **khóa có mặt** phải là mảng hợp lệ như trên (một `permissions: null` hay `[]` do client gửi tường minh → `ADMIN_INPUT_INVALID`, không có nghĩa "sao chép"). Cấp lại **cấm** `full_name`, `phone`, `note` (khóa lạ → `ADMIN_INPUT_INVALID`): họ tên, ghi chú, SĐT luôn lấy từ bản cũ. Thu hồi **cấm** `permissions`.
- `expected_version`: số nguyên an toàn ≥ 1. `Idempotency-Key`: UUID chuẩn (`parseIdempotencyKey`); client không tự sinh lại khi retry.
- SĐT trả về luôn dạng che `phone_masked` (như UI-06: `09•• ••• 101`); SĐT đầy đủ không có trong response, log hay audit.

### 6.2 `POST /admin/operations` — tạo yêu cầu xác nhận 2FA
- Không dùng `Idempotency-Key`. Body: `{ "action": "CREATE_INVITATION", "payload": { "full_name", "phone", "note", "permissions" } }`; hoặc `{ "action": "REISSUE_INVITATION", "payload": { "invitation_id", "expected_version", "reason", "permissions"? } }`; hoặc `{ "action": "REVOKE_INVITATION", "payload": { "invitation_id", "expected_version", "reason" } }`. Parser mục 6.1 áp dụng y hệt (kể cả `permissions` của reissue, F4).
- Server chuẩn hóa, tính `payload_fingerprint` (mục 7.2), **vô hiệu operation sống cũ của SYSTEM** (`REPLACED`) và tạo operation `PENDING` (`expires_at = created_at + 120 s`). Kiểm sớm dưới khóa: cú pháp, mục tiêu tồn tại / `PENDING` / đúng `expected_version`, SĐT chưa thuộc `users` (Q3). Đây **không** thay cho kiểm cuối ở route nghiệp vụ.
- `201`: `{ "data": { "operation_id", "action", "status": "PENDING", "expires_at" } }`. Không trả fingerprint.
- Lỗi: 400 `ADMIN_INPUT_INVALID`; 401/403 chung; 404 `ADMIN_INVITATION_NOT_FOUND`; 409 `ADMIN_VERSION_CONFLICT`, `ADMIN_INVITATION_NOT_PENDING`, `ADMIN_INVITATION_PENDING_EXISTS`, `ADMIN_PHONE_CONFLICT`; 429 `ADMIN_AUTH_RATE_LIMITED`; 503.

### 6.3 Fingerprint canonical của từng action
`canonicalPayload`: CREATE = `{full_name, phone, note|null, permissions[sorted]}`; REISSUE = `{invitation_id, expected_version, reason, permissions: null | [sorted]}` (**`permissions` luôn có mặt trong canonical**, `null` = sao chép); REVOKE = `{invitation_id, expected_version, reason}`. Hai request cấp lại chỉ khác ở "có gửi permissions hay không" cho **fingerprint khác nhau**, kể cả khi mảng gửi giống hệt quyền cũ. Route nghiệp vụ **tính lại** từ body của chính nó và so sánh hằng thời gian.

### 6.4 `POST /admin/operations/:operation_id/verify` — xác minh bằng TOTP mới
- Không dùng `Idempotency-Key` (mã TOTP dùng một lần). Body `{ "code": "123456" }` (`parseTotpBody`, đúng 6 chữ số).
- `200`: `{ "data": { "operation_id", "status": "VERIFIED", "expires_at" } }`.
- `400 ADMIN_TOTP_INVALID` / `429 ADMIN_AUTH_RATE_LIMITED` + `Retry-After`: chỉ khi **TOTP thật sự đã được so sánh và sai** hoặc bucket đang khóa; thứ tự commit/ném và quy tắc đếm ở mục 7.4.
- Operation không tồn tại / của người khác / không còn `PENDING` / hết hạn / lệch phiên-factor-membership / mục tiêu đã đổi / `attempt_count ≥ 5` → `403 ADMIN_STEP_UP_REQUIRED` (một mã, không nói lý do), **không** đếm gì.
- Mất response hoặc `TRANSACTION_OUTCOME_UNKNOWN`: **không gửi lại mã**; gọi 6.5 (mục 14).

### 6.5 `GET /admin/operations/:operation_id`
`{ "data": { "operation_id", "action", "status", "expires_at", "expired", "verifiable", "usable", "attempts_remaining", "verified_at", "consumed_at", "invalidated_reason" } }` — chỉ của chính SYSTEM đó; không fingerprint/secret. Ngữ nghĩa (F5):
- `status`: **trạng thái đã lưu**, nguyên văn từ DB.
- `expired` = `T ≥ expires_at`, với `T` là giờ DB đọc sau khóa cuối.
- `binding_ok` (nội bộ, không trả): operation thuộc SYSTEM này; `actor_session_id` = phiên của request và phiên chưa thu hồi/chưa hết hạn tại `T`; factor ACTIVE đúng `factor_id/factor_version`; `membership_version` = hiện tại; với reissue/revoke: mục tiêu còn `PENDING` đúng `expected_version`.
- `verifiable` = `status='PENDING' ∧ ¬expired ∧ binding_ok ∧ attempt_count<5`.
- `usable` = `status='VERIFIED' ∧ ¬expired ∧ binding_ok`. **Một operation `VERIFIED` nhưng hết hạn hoặc lệch binding trả `usable=false`** (trong khi `status` vẫn là `VERIFIED`).
- `attempts_remaining` = `5 − attempt_count` khi `PENDING`, ngược lại `null`.
- GET **chỉ đọc**: không ghi, không đổi `status` dù đã hết hạn/lệch (không có "đánh dấu EXPIRED/INVALIDATED khi đọc").

### 6.6 `POST /admin/invitations` — tạo lời mời
- Header `Idempotency-Key`. Body `{ "operation_id", "full_name", "phone", "note", "permissions" }`.
- `201`: `{ "data": { "invitation": { "invitation_id", "status": "PENDING", "version": 1, "full_name", "phone_masked", "note", "permissions": [{ "app", "can_view", "can_review_profile", "can_lock" }], "created_at", "expires_at" }, "activation_link": "<ADMIN_ACTIVATION_ORIGIN>/activate#t=<token>" } }`.
- `activation_link` chỉ xuất hiện trong response này và trong replay ≤ 15 phút. Token = 32 byte CSPRNG (`base64url`), DB chỉ giữ SHA-256 (`digestToken`).
- Lỗi: 400 `ADMIN_INPUT_INVALID`; 400/409 `IDEMPOTENCY_*`; 403 `ADMIN_STEP_UP_REQUIRED`; 409 `ADMIN_INVITATION_PENDING_EXISTS`, `ADMIN_PHONE_CONFLICT`, `ADMIN_INVITATION_NOT_REPLAYABLE` (chỉ replay); 429; 503 `TRANSACTION_OUTCOME_UNKNOWN`.

### 6.7 `GET /admin/invitations/:invitation_id`
`{ "data": { "invitation": { …như trên…, "status", "version", "terminal_at", "successor_id", "expired": boolean }, "activation": { "state": "NONE" } } }`. `expired` = `status='PENDING' ∧ T ≥ expires_at` (đọc, không ghi). Không bao giờ có token, digest, link. `activation.state` luôn `NONE` ở 1B. 404 `ADMIN_INVITATION_NOT_FOUND`.

### 6.8 `POST /admin/invitations/:invitation_id/reissue`
- Header `Idempotency-Key`. Body `{ "operation_id", "expected_version", "reason", "permissions"? }`.
- Theo Q1: bản mới có `full_name`, `note`, SĐT của bản cũ; quyền = `permissions` nếu có gửi, ngược lại sao chép snapshot quyền của bản cũ. **Snapshot của bản cũ không đổi** (bất biến bằng trigger 1A); bản mới có snapshot riêng và `expires_at` mới (`T + TTL`), không thừa kế hạn cũ.
- `201`: `{ "data": { "invitation": { …bản mới… }, "superseded_invitation_id": "<cũ>", "activation_link": "…" } }`.
- Lỗi: như 6.6, thêm 404 `ADMIN_INVITATION_NOT_FOUND`, 409 `ADMIN_VERSION_CONFLICT`, 409 `ADMIN_INVITATION_NOT_PENDING`.

### 6.9 `POST /admin/invitations/:invitation_id/revoke`, `GET /admin/invitations`
- Revoke: header `Idempotency-Key`; body `{ "operation_id", "expected_version", "reason" }`. `200`: `{ "data": { "invitation": { …, "status": "REVOKED", "version": <n+1>, "terminal_at" } } }`. Lỗi như 6.8.
- Danh sách (Q9): query `status` (tuỳ chọn, một trong 6 giá trị), `limit` (1–50, mặc định 20), `cursor` (opaque base64url của `(created_at_ms, invitation_id)`, sai định dạng → `ADMIN_INPUT_INVALID`). Sắp `created_at DESC, invitation_id DESC` (đúng `admin_invitations_list_idx`). `{ "data": { "items": [ …tóm tắt như 6.7, không permissions chi tiết… ], "next_cursor": string|null } }`. Một câu SELECT duy nhất (một snapshot) sau khóa actor; **không khóa hàng lời mời**.

## 7. Step-up 2FA

### 7.1 Máy trạng thái và vòng đời
Mục 5 mô tả trạng thái **lưu**. Tuổi thọ: `expires_at = created_at + 120 s`, không gia hạn khi verify (Q4). Một SYSTEM có tối đa một operation `PENDING|VERIFIED`; tạo mới thay thế bản cũ trong cùng transaction (`REPLACED`). Operation chỉ đổi trạng thái lưu qua bốn chuyển tiếp ở trigger.

### 7.2 Fingerprint và khóa
`payload_fingerprint = HMAC-SHA-256(subkey_adminOperation[key_version], canonicalJson(["admin-operation.v1", action, canonicalPayload]))` (Q11: **subkey riêng `adminOperation`** trong `Keyring`; không đổi dẫn xuất khóa cũ; cập nhật `admin-purposes.spec` để khẳng định các subkey cũ giữ nguyên giá trị). `fingerprint_key_id` lưu cùng; khi kiểm dùng đúng khóa lịch sử đó, thiếu khóa ⇒ fail-closed `503` (không rơi về khóa hiện tại). Client không tự tính hay gửi fingerprint.

### 7.3 Điều kiện tiêu thụ và điều kiện "dùng được"
Một operation **dùng được** tại thời điểm `T` (giờ DB sau khóa cuối) khi: thuộc `actor_user_id` hiện tại; `actor_session_id` = phiên của request và phiên chưa thu hồi/chưa hết hạn tại `T`; factor ACTIVE đúng `factor_id/factor_version`; `membership_version` hiện tại khớp; `action` đúng route; `target_id/expected_version` đúng URL/body; fingerprint khớp; `status` lưu là `VERIFIED` (route nghiệp vụ) hoặc `PENDING` (verify); `T < expires_at`. Tiêu thụ là CAS trong transaction của mutation: `UPDATE … SET status='CONSUMED', consumed_at=clock.t WHERE operation_id=$1 AND status='VERIFIED' AND clock.t < expires_at` — không có hàng nào ⇒ `ADMIN_STEP_UP_REQUIRED` và rollback toàn bộ. Mutation thất bại ⇒ rollback ⇒ operation vẫn `VERIFIED` (dùng lại được đến hết 120 s cho **đúng** payload đó).

### 7.4 Quy tắc đếm và commit của verify (F6)
Chuỗi quyết định trong transaction verify (mục 8.3.2) tuân theo bảng:

| Sự kiện | `TOTP_USER` +1 | `attempt_count` +1 | Có commit ghi gì? | Kết quả |
|---|---|---|---|---|
| Body sai định dạng (parser) | không | không | không có transaction | 400 `ADMIN_INPUT_INVALID` |
| Vượt quota IP | không | không | quota không hoàn lại | 429 |
| Bucket `TOTP_USER` đang khóa | **không** | không | commit rỗng (chỉ dọn khóa hết hạn) | 429 + `Retry-After`, **trước khi mở secret** |
| Operation/phiên/factor/membership/mục tiêu không hợp lệ hoặc hết hạn | không | không | **rollback**, không ghi gì | 403 `ADMIN_STEP_UP_REQUIRED` |
| TOTP **đã so sánh** và sai (kể cả step cũ/ngoài cửa sổ) | **có** | **có** | **commit**: bucket + operation + audit DENIED | 400 `ADMIN_TOTP_INVALID`, hoặc 429 nếu bucket vừa bị khóa |
| Lần sai thứ 5 của operation | có | có (=5) | commit: operation `INVALIDATED(ATTEMPTS_EXHAUSTED)` trong cùng UPDATE + audit | 400/429 |
| TOTP đúng | không | không | commit: `advanceStep`, operation `VERIFIED`, audit SUCCESS | 200 |

Phân biệt rõ: **`INVALIDATED` chỉ được nói là đã lưu trong hai trường hợp đã commit** — `REPLACED` (create-operation thành công) và `ATTEMPTS_EXHAUSTED` (verify sai lần 5, commit-then-throw). Mọi trường hợp khác (hết hạn, lệch binding, mục tiêu đổi) **chỉ là từ chối do điều kiện hiện tại**, không có ghi nào; transaction rollback nên không thể và không được tuyên bố đã lưu `INVALIDATED`. Lỗi trên đường tiêu thụ ở route nghiệp vụ cũng rollback và để operation nguyên trạng.

## 8. Giao dịch, protocol khóa và đồng hồ

### 8.1 Thứ tự khóa toàn cục

Mọi transaction 1B phải là chuỗi con **không giảm** của bảng này. Quy tắc nền (F1/F6): (i) mỗi hàng chỉ bị khóa **một chế độ trong một transaction**, không bao giờ nâng `SHARE → UPDATE`; (ii) mọi writer của SYSTEM actor lấy `UPDATE` ở user và membership **ngay từ đầu**; (iii) không bao giờ ghi hàng con (FK) khi hàng cha chưa bị chính transaction đó khóa.

| Hạng | Đối tượng | Chế độ | Ai lấy |
|---|---|---|---|
| R0 | transport → quota IP → parser → tiền kiểm cookie/CSRF | **ngoài** coordinator; quota là transaction ngắn riêng đã commit; không giữ khóa nào | mọi POST |
| L1 | advisory key + record idempotency `FOR UPDATE` (executor) | exclusive | create / reissue / revoke |
| L2 | bucket `TOTP_USER`: `INSERT … ON CONFLICT DO NOTHING` (hàng **mới**), rồi `SELECT … FOR UPDATE` (hàng **hiện hữu**) | exclusive | chỉ verify |
| L3 | advisory SĐT: miền `11ship.admin-provisioning.phone.v1`, `deriveLockKey(domain,[limiterKey.bucketKey('PROVISIONING_PHONE', phone)])` | exclusive | create / reissue / revoke |
| L4 | `users` của actor | **X** cho writer (create-op, verify, create, reissue, revoke); **S** cho reader (GET, replay hook) | mọi route |
| L5 | `admin_memberships` của actor | như L4 | mọi route |
| L6 | `admin_totp_factors` của actor | **X** chỉ verify (`advanceStep`); S ở nơi còn lại | create-op, verify, create, reissue, revoke, **mọi GET** (operation, một lời mời, danh sách), replay hook |
| L7 | `admin_sessions` của phiên request | S | mọi route |
| L8 | `admin_invitations` mục tiêu / PENDING theo SĐT | **X** cho create (PENDING-by-phone), reissue, revoke; **S** cho create-op, verify, GET một lời mời, replay hook | tuỳ route |
| L9 | `admin_sensitive_operations` theo id / hàng sống của actor | **X** cho create-op, verify, create, reissue, revoke; S cho GET | tuỳ route |
| L10 | hàng **mới** của chính transaction: `admin_invitations`, `admin_invitation_permissions`, `admin_sensitive_operations`, `audit_logs`, `idempotency_records` | không ai khác thấy được | ghi cuối |

Khớp #34 (bucket → user → membership → factor → session) và Technical Design 1A. Ghi chú: L1/L3 không bao giờ cùng L2 trong một route. Không route nào lấy khóa hạng thấp hơn sau khi đã giữ khóa hạng cao hơn. `GET /admin/invitations` (danh sách) lấy L4 S → L5 S → L6 S → L7 S rồi một câu SELECT không khóa hàng lời mời.

### 8.2 Khóa ngầm (FK, unique, trigger) và cách xử lý

| Nguồn khóa ngầm | Khóa phát sinh | Cách đảm bảo không đảo thứ tự |
|---|---|---|
| INSERT `admin_sensitive_operations`: FK `actor_user_id`, `actor_session_id`, `target_id` | `FOR KEY SHARE` trên membership / session / lời mời mục tiêu | Cả ba hàng đã bị chính transaction khóa (L5, L7, L8) **trước** khi INSERT; khóa của chính mình không chờ. Create-op **khóa mục tiêu (L8) trước** khi đụng hàng operation (L9). Không bao giờ khóa operation rồi mới khóa lời mời (sẽ tạo chu trình với writer của lời mời). |
| INSERT `admin_invitations`: FK `created_by` | `KEY SHARE` membership | Đã giữ L5. |
| UPDATE lời mời cũ đặt `successor_id` (FK deferred) và INSERT bản mới | kiểm FK lúc COMMIT: `KEY SHARE` lên **hàng bản mới do chính transaction tạo** | Hàng chưa commit, không ai khác khóa được. |
| INSERT `admin_invitation_permissions` + trigger `admin_invitation_permission_insert_guard` | `FOR UPDATE` lên hàng lời mời **do chính transaction vừa tạo** | Như trên. |
| Trigger deferred `admin_invitation_requires_view` | chỉ SELECT lên hàng của chính transaction | Không khóa chờ. |
| Unique một PENDING mỗi SĐT (`admin_invitations_pending_phone_uq`) | INSERT PENDING phải chờ nếu transaction khác có PENDING chưa commit cùng SĐT | **L3 đứng trước** mọi INSERT/UPDATE PENDING của 1B, nên hai route 1B không bao giờ chạm nhau ở đây. Còn lại chỉ là chốt an toàn (`23505` ⇒ lỗi nội bộ, không phải luồng điều khiển). Quy tắc cho 1C: bắt buộc lấy L3. |
| Unique `token_digest`, `generation_id` | chờ transaction trùng khóa | Giá trị ngẫu nhiên 256-bit / UUID; va chạm = lỗi nội bộ. |
| Unique `admin_sensitive_operations_live_uq` | INSERT op mới chờ op sống chưa commit của cùng actor | **F1**: L4/L5 `UPDATE` ngay từ đầu tuần tự hóa mọi create-op / verify / mutation của actor; op sống cũ được vô hiệu **trước** khi INSERT. Chốt an toàn, test khẳng định không bao giờ gặp `23505` trong lịch chạy bình thường. |
| UPDATE `admin_sensitive_operations` | không FK nào đổi (cột định danh bất biến) ⇒ không kiểm FK | — |
| INSERT `audit_logs`, `idempotency_records` | không FK; `idempotency_records` có UNIQUE tuple | Cùng tuple ⇒ cùng khóa advisory L1 nên đã tuần tự hóa. |
| Limiter (`lockBuckets`) | INSERT-if-missing có thể chờ transaction đang tạo cùng `bucket_key`; sau đó `FOR UPDATE` | Cùng bucket một người dùng luôn là L2 (đứng trước L4), và `reserveRequest` nằm ở transaction riêng đã commit (R0). |

### 8.3 Các transaction của từng endpoint (thứ tự kiểm cho từng route)

Ký hiệu: **`T`** = `freshClockMs(context)` đọc **một lần sau khóa cuối** của transaction (F2). Mọi quyết định hết hạn dùng `T`; không `now()` trong predicate; participant 1A không quyết định hết hạn. Mọi lỗi trong transaction làm rollback toàn bộ (trừ verify sai đã nêu).

#### 8.3.1 `POST /admin/operations` (create-operation) — F1
1. L4 `users` X → L5 `memberships` X (`lockAndCheck(write)`: ACTIVE, binding mật khẩu, membership ACTIVE) → L6 factor S → L7 phiên S.
2. (reissue/revoke) L8 lời mời mục tiêu S.
3. L9: `SELECT … WHERE actor_user_id=$1 AND status IN ('PENDING','VERIFIED') FOR UPDATE` (0 hoặc 1 hàng).
4. `T`. Kiểm theo thứ tự: (a) actor là SYSTEM và phiên còn hiệu lực tại `T`, factor ACTIVE, version khớp phiên; (b) (reissue/revoke) mục tiêu còn `PENDING` và `version = expected_version` (quá hạn `expires_at` mà chưa terminal **vẫn được**, Q2); (c) (create/reissue) SĐT chưa thuộc `users` (đọc thường, không khóa, Q3).
5. Ghi: hàng sống (nếu có) → `INVALIDATED(REPLACED)` bằng CAS; INSERT operation `PENDING`; audit; commit.

Hai request create-operation đồng thời **không bao giờ cùng ở bước 5**: request thứ hai chờ ở L4. Khi nó chạy, nó **thấy** kết quả đã commit của request thứ nhất (READ COMMITTED, câu SELECT ở bước 3 chạy sau khi có khóa).
- *Chưa có operation sống*: A INSERT op₁; B chờ ở L4; sau A commit, B thấy op₁ (PENDING), vô hiệu `REPLACED` rồi INSERT op₂. Kết cục: op₁ `INVALIDATED`, op₂ `PENDING`; không có `23505`.
- *Đã có op₀ sống*: A vô hiệu op₀, INSERT op₁; B vô hiệu op₁, INSERT op₂. Kết cục như trên, op₀ và op₁ `INVALIDATED(REPLACED)`.
- *Đua với tiêu thụ*: nếu route nghiệp vụ (L4 X) giành khóa trước, nó tiêu thụ op cũ rồi commit; create-op chạy sau thấy op `CONSUMED` (không sống), chỉ INSERT mới. Nếu create-op giành trước, nó vô hiệu op cũ rồi commit; route nghiệp vụ chạy sau đọc op `INVALIDATED` ⇒ `ADMIN_STEP_UP_REQUIRED`, rollback, **không** mutation.

#### 8.3.2 `POST /admin/operations/:id/verify` (không qua executor)
1. L2 bucket `TOTP_USER` (`lockBuckets`). Đang khóa ⇒ trả `limited` ngay (không mở secret, không đếm), commit, ném 429 sau commit.
2. L4 X → L5 X (`lockAndCheck(write)`) → L6 factor **X** → L7 phiên S → (nếu có mục tiêu) L8 S → L9 operation theo `operation_id` **và** `actor_user_id` X.
3. `T`. Cổng kiểm theo thứ tự (không đếm gì nếu thất bại, mục 7.4): operation tồn tại; `status='PENDING'`; `T < expires_at`; `attempt_count < 5`; `actor_session_id` = phiên của request và phiên còn hiệu lực tại `T`; factor ACTIVE đúng `factor_id/version`; `membership_version` khớp; mục tiêu còn `PENDING` đúng `expected_version`. Bất kỳ điều nào sai ⇒ `ADMIN_STEP_UP_REQUIRED`, rollback.
4. Chỉ **sau** cổng: mở secret, `matchTotp(secret, code, T/1000, last_accepted_step)`.
5. Sai ⇒ `recordFailure(bucket)`; `attempt_count + 1` (lần 5 ⇒ `INVALIDATED(ATTEMPTS_EXHAUSTED)` cùng UPDATE); audit DENIED; **commit**; sau commit mới ném 400/429. Đúng ⇒ `advanceStep`; operation `VERIFIED` (`verified_at` từ đồng hồ DB, CAS có `clock.t < expires_at`; không hàng ⇒ `STEP_UP_REQUIRED`/rollback); audit SUCCESS; commit.

#### 8.3.3 `GET /admin/operations/:id`, `GET /admin/invitations/:id`, `GET /admin/invitations`
Một transaction chỉ đọc, **cùng chuỗi cho cả ba GET**: L4 S → L5 S (`lockAndCheck(read)`) → **L6 S (factor)** → L7 S → (mục tiêu: L8 S) → (operation: L9 S) → `T` → kiểm: user/membership ACTIVE, **factor `ACTIVE` và `factor_id/factor_version` bằng giá trị lưu trong phiên**, phiên chưa thu hồi/chưa hết hạn tại `T` (sai ⇒ `ADMIN_SESSION_INVALID`) → tính `expired/verifiable/usable` (chỉ GET operation) → trả. Không UPDATE, không INSERT, không audit. Reader chờ writer đang giữ khóa (nên không bao giờ thấy trạng thái nửa chừng).

### 8.4 Route nghiệp vụ (qua executor) — thứ tự kiểm

Tiền kiểm không khóa (R0): với reissue/revoke đọc SĐT của mục tiêu (**bất biến** nhờ trigger 1A) để lấy khóa L3; mục tiêu không tồn tại ⇒ 404 trước khi mở transaction.

Executor: L1 (advisory rồi record `FOR UPDATE`), đồng hồ DB, rồi **hoặc replay hoặc callback**.

#### 8.4.1 `POST /admin/invitations` (create) — callback
1. L3 advisory SĐT (từ body đã chuẩn hóa).
2. L4 X → L5 X (`lockAndCheck(write)`) → L6 S → L7 S.
3. L8: `lockPendingByPhone` X (0 hoặc 1 hàng).
4. L9: operation theo `operation_id` + `actor_user_id` X.
5. `T` (**sau khóa cuối L9**).
6. Kiểm theo thứ tự cố định: (a) authz: SYSTEM, phiên còn hiệu lực tại `T`; (b) **step-up** (mục 7.3, gồm fingerprint tính lại từ body) ⇒ `ADMIN_STEP_UP_REQUIRED`; (c) nếu có PENDING cùng SĐT: `T < expires_at` ⇒ `ADMIN_INVITATION_PENDING_EXISTS`; ngược lại (quá hạn) sẽ chuyển `EXPIRED`; (d) SĐT thuộc `users` ⇒ `ADMIN_PHONE_CONFLICT` (kiểm lại lần hai, Q3).
7. Ghi: [PENDING quá hạn ⇒ `transition(…,'EXPIRED')` + audit `expired`] → `participant.create` (insert + quyền + seal) → CAS tiêu thụ operation → audit `created` → trả 201 + `replayGuard` → executor mã hóa và ghi record → commit.

Ưu tiên lỗi: authz > step-up > xung đột nghiệp vụ. Hai request khác key cùng operation và cùng payload: request thứ hai chờ ở L4, rồi đọc operation `CONSUMED` ở bước 6(b) ⇒ `ADMIN_STEP_UP_REQUIRED` (chứ không phải `PENDING_EXISTS`).

#### 8.4.2 `POST /admin/invitations/:id/reissue` — callback (F4)
1. L3 (SĐT mục tiêu) → L4 X → L5 X → L6 S → L7 S.
2. L8: lời mời mục tiêu `lock` X (theo id).
3. L9: operation X. 4. `T`.
5. Kiểm theo thứ tự: (a) authz; (b) step-up — fingerprint tính lại từ `{invitation_id, expected_version, reason, permissions}` (với `permissions` vắng ⇒ `null`); (c) mục tiêu tồn tại (404), `PENDING` (ngược lại `ADMIN_INVITATION_NOT_PENDING`; **quá hạn chưa terminal vẫn được**), `version = expected_version` (ngược lại `ADMIN_VERSION_CONFLICT`); (d) SĐT thuộc `users` ⇒ `ADMIN_PHONE_CONFLICT`; (e) giải quyết quyền: `permissions` vắng ⇒ đọc snapshot bản cũ (đã seal, bất biến) bằng một SELECT chỉ đọc; có gửi ⇒ dùng bản gửi (đã validate ở parser, và participant validate lần nữa).
6. Ghi **theo đúng thứ tự deferred FK**: `transition(old → SUPERSEDED, successorId = idMới)` **trước**, rồi `participant.create(new)` (SĐT, họ tên, ghi chú từ bản cũ; quyền ở 5e; `expires_at = DB clock + TTL`), rồi CAS tiêu thụ operation, audit `reissued`, `replayGuard` → record → commit. Lỗi ở bất kỳ bước ghi nào ⇒ rollback ⇒ bản cũ còn `PENDING` nguyên vẹn, operation còn `VERIFIED`.

#### 8.4.3 `POST /admin/invitations/:id/revoke` — callback
L3 → L4 X → L5 X → L6 S → L7 S → L8 mục tiêu X → L9 X → `T` → (a) authz, (b) step-up, (c) tồn tại / `PENDING` / version → `transition(old → REVOKED)` → CAS tiêu thụ → audit `revoked` → record → commit.

### 8.5 Đồng hồ DB, hết hạn và `lock_timeout`
Mọi quyết định hết hạn (phiên, operation, `expired` của lời mời, cửa sổ replay) dùng giờ DB đọc **sau khóa cuối**; mọi CAS ghi mốc thời gian lấy `clock.t` trong chính câu UPDATE và kèm điều kiện `clock.t < expires_at` ở nơi mốc đó không được vượt hạn. Replay có hai lần đọc (executor: trước hook và ngay trước khi giải mã) và hook có lần đọc riêng sau khóa của nó.

**`lock_timeout` (Owner đã quyết).** Route qua executor dùng ngân sách của executor (đặt sau advisory lock). Mọi transaction 1B **không** qua executor (create-operation, verify, ba GET) tự đặt `SELECT set_config('lock_timeout', '<businessLockTimeoutMs>ms', true)` — `is_local = true`, chết cùng transaction — **ngay trước khóa đầu tiên** của transaction (verify: trước `lockBuckets`; create-op/GET: trước L4). Giá trị lấy từ cấu hình `businessLockTimeoutMs` đã được validate khi khởi động; không thêm biến môi trường; **không sửa `TransactionManager` toàn cục**. Hết thời gian chờ (`55P03`) đi qua xử lý lỗi kỹ thuật hiện có (503 chung), không retry phía server; test khẳng định timeout không bị nhầm với deadlock `40P01`.

### 8.6 Rà soát call graph (kết luận thiết kế, không phải bằng chứng runtime)

Đã đọc `FOR UPDATE|SHARE|pg_advisory*` trên toàn `apps/backend/src`:

| Đường đi | Thứ tự khóa (theo code) | Ghi chú với 1B |
|---|---|---|
| Đăng nhập, TOTP enroll/verify (#34) | bucket (tăng dần key) → user → membership → factor → challenge → (session: `revokeAllForUser`, `insert`) | Nhất quán với L2 < L4 < L5 < L6 < L7. |
| `state`/`me` (#34) | user S → membership S (`lockAndCheck(read)`) → factor S → session S | Chuỗi con hợp lệ. |
| `logout` (#34) | user X (`lockById`) → session (`revoke`, UPDATE) | Chuỗi con hợp lệ (không lấy membership). |
| Quota IP | transaction riêng, commit trước | Không giữ khóa vào coordinator. |
| Executor idempotency | advisory + record → callback | L1 đứng đầu. Cleanup dùng `SKIP LOCKED` (không chờ). |
| Participant 1A | `lock`, `lockPendingByPhone`, trigger insert-guard | Chỉ khóa hàng lời mời (L8) hoặc hàng của chính mình. |
| Outbox dispatcher | `FOR UPDATE SKIP LOCKED` | Không chờ, không liên quan bảng admin. |
| Auth core, onboarding, shop, driver | `users` X → `sessions` → các bảng `app.*` khác | **Không** chạm bảng `admin_*` (đã grep) và 1B chỉ khóa `users` của SYSTEM; không có cạnh đảo. |
| CLI limit-config | advisory `limit-config` | Không giữ hàng 1B. |
| **CLI bootstrap SYSTEM** (#34, `admin-bootstrap-service.ts`) | **Trước sửa:** advisory `bootstrap` → (đọc cấu hình limiter, không khóa) → `lockSystem` (**membership X**) → `lockById` (**user X**) ⇒ đảo. **Sau sửa (`38bb8c7`):** advisory `bootstrap` → (đọc cấu hình) → đọc id SYSTEM **không khóa** → user X → membership X → kiểm lại role | Đã nhất quán với L4 < L5. Đường tạo mới (chưa có SYSTEM) chỉ INSERT hàng mới. |

**Finding B-1 — ĐÃ SỬA ở commit riêng `38bb8c7` (trên nhánh #34), chờ CI trên head cuối và review.** Trước sửa, khi đã có SYSTEM, bootstrap khóa **membership trước, user sau**, ngược thứ tự user → membership của đăng nhập và mọi route 1B; chạy đồng thời với một writer của SYSTEM tạo chu trình (`40P01`). Cách sửa (Owner cho phép, phạm vi: bootstrap và test; sau đó một commit chỉ sửa test tham chiếu, `08910ed`): giữ advisory `bootstrap` và đọc cấu hình limiter như cũ → đọc id SYSTEM **không khóa** → khóa user → khóa membership → kiểm lại membership vẫn là SYSTEM và đúng tài khoản; cùng SĐT ⇒ `UNCHANGED` (không đổi mật khẩu), SĐT khác ⇒ `SYSTEM_ACCOUNT_DIFFERENT`, chưa có SYSTEM ⇒ đường tạo mới giữ nguyên; `lockSystem` bị xóa để không ai dùng lại thứ tự đảo. Không đụng route `/admin-auth` hay migration.

*Bằng chứng cũ → mới.* (1) **Mức SQL, chạy cục bộ** trên PostgreSQL 16 (`deadlock_timeout=1s`), hai phiên xen kẽ có kiểm soát: thứ tự cũ (membership theo `admin_role='SYSTEM'` rồi user) đối với writer user → membership ⇒ `ERROR: deadlock detected`; thứ tự mới ⇒ cả hai phiên lấy đủ khóa, không lỗi. (2) **Test tích hợp có barrier** `tests/integration/admin-bootstrap-lock-order.int.spec.ts`: ca tham chiếu dựng lại thứ tự cũ và khẳng định `40P01`; ba lịch chạy thật của service mới (writer giữ user; bootstrap giữ user; bootstrap giữ cả hai) và một ca SĐT khác đều không deadlock và giữ nguyên nghiệp vụ. Ngân sách timeout của test (statement 20 s, query 25 s, transaction 30 s) lớn hơn xa `deadlock_timeout`, và test khẳng định `deadlock_timeout ≤ 5 s`, nên lock/statement timeout không che được deadlock. (3) Máy của Claude không chạy được jest (registry bị chặn): **bằng chứng test chính thức là CI** trên head cuối, ghi ở PR.

### 8.7 Trạng thái của protocol khóa

- **Kết luận thiết kế (rà lại sau khi sửa B-1):** thứ tự L1…L10 nhất quán cho mọi route 1B, mọi đường đi đăng nhập/phiên, bootstrap (sau sửa), executor, participant 1A, và đã rà khóa ngầm (mục 8.2). Rà lại bằng grep toàn `apps/backend/src`: không còn truy vấn khóa membership trước user (`lockSystem` đã xóa). **Không còn đường đi đảo thứ tự nào đã biết.**
- **Bằng chứng runtime:** chỉ có (a) hai phiên SQL xen kẽ cho B-1 (cục bộ) và (b) spec barrier của B-1 chờ CI. **Chưa có code 1B**, chưa có trace khóa và chưa có test S1–S12 của 1B. Phần còn lại là suy luận từ đọc code.
- **Trạng thái:** `LOCK_PROTOCOL = NOT_FINAL`. Điều kiện để gọi `LOCK_PROTOCOL_FINAL`: (1) ChatGPT review bản sửa B-1 và CI xanh trên head cuối của nó (đã xử lý B-1 theo quyết định của Owner); (2) bảng L1…L10 và mục 8.2 được ChatGPT chấp thuận; (3) bộ test có barrier S1–S12 của 1B (mục 15) và test trace thứ tự khóa đều đạt trên CI ở head cuối; (4) 1C có phân tích call graph riêng cho các đường đi kích hoạt trước khi mở route nào của nó.

### 8.8 Điểm mở rộng cho 1C
Hàm `invalidateActivationFor(context, invitationId)` đặt sau khóa lời mời trong reissue/revoke (không làm gì ở 1B). 1C thêm vô hiệu attempt/OTP challenge bằng khóa theo UUID tăng dần **sau L8**, không đổi thứ tự trên; mọi đường 1C ghi PENDING/ACCEPTED theo SĐT phải lấy L3 trước.

## 9. Idempotency và replay

### 9.1 Khóa và logical request
`scopeType='admin_user'`, `scopeId=actor_user_id` (từ principal đã xác thực), `operationId ∈ {'admin.invitation.create.v1','admin.invitation.reissue.v1','admin.invitation.revoke.v1'}`. TTL: `replaySeconds = 900` (15 phút, link) và `dedupeSeconds = 86400` (24 giờ) — **Owner đã duyệt**. `logicalRequest`: create = `{operation_id, canonicalPayload}`; reissue = `{operation_id, invitation_id, expected_version, reason, permissions: null|[sorted]}`; revoke = `{operation_id, invitation_id, expected_version, reason}`. `permissions` nằm trong logical request của reissue (Q1/F4): cùng key với `permissions` khác hoặc khi vắng/có ⇒ `IDEMPOTENCY_KEY_REUSED`. Link không nằm trong logical request. Hệ quả: operation mới cần Idempotency-Key mới.

### 9.2 Replay guard
`replayGuard = {actor_user_id, invitation_id, kind: 'create'|'reissue'|'revoke'}` (không secret). `invitation_id` là bản **mới** với create/reissue.

### 9.3 Hook authorize và thứ tự kiểm khi replay — F2
Sau khi executor đã khớp fingerprint (`KEY_REUSED`), còn trong cửa sổ replay (`REPLAY_EXPIRED`) và kiểm cấu trúc, hook chạy **cùng context, chỉ đọc, khóa trước khi đọc**, **trước mọi giải mã**:
1. L4 S → L5 S (`lockAndCheck(read)`) → L6 S → L7 S: phiên của request hiện tại còn hiệu lực; `actor_user_id` của guard = actor hiện tại; SYSTEM ACTIVE.
2. (create/reissue) L8: khóa lời mời `guard.invitation_id` S.
3. `T_h = freshClockMs` **sau các khóa trên**.
4. Kiểm: phiên chưa thu hồi/chưa hết hạn tại `T_h`; (create/reissue) lời mời tồn tại, **`status='PENDING'` và `T_h < expires_at`** — nếu không ⇒ `ADMIN_INVITATION_NOT_REPLAYABLE` (409), link **không** bị giải mã. (revoke) chỉ cần các kiểm actor/phiên, không có link để lộ.
5. Hook trả `true`; executor đọc đồng hồ lần nữa (cửa sổ replay, bằng ⇒ hết hạn) rồi mới giải mã.

Replay **không** tiêu thụ operation và không cần TOTP mới. Sau 15 phút: `IDEMPOTENCY_REPLAY_EXPIRED` (409), link cũ không lấy lại; SYSTEM cấp lại. Sau 24 giờ record bị xóa và key coi như mới; vì operation chỉ sống 120 s nên một yêu cầu "mới" như vậy sẽ bị `ADMIN_STEP_UP_REQUIRED`.

### 9.4 Lỗi và unknown COMMIT
Lỗi/rollback không tiêu thụ key; thử lại cùng key được thực thi lại nếu operation còn `VERIFIED` và `T < expires_at`. `TRANSACTION_OUTCOME_UNKNOWN` (503): client thử lại **cùng key và cùng operation_id**; không retry phía server. Replay payload chứa link chỉ lưu mã hóa (AAD gắn tuple + fingerprint).

## 10. Limiter (không thêm số liệu mới)

| Điểm | Cơ chế | Giá trị (đã duyệt ở #34) |
|---|---|---|
| Ingress mọi POST 1B (Q6) | `reserveTotpRequest(ip)`, transaction riêng, không hoàn lại | 30 / 60 s / IP |
| GET 1B | không quota mới; dựa vào phiên và khóa chia sẻ | — |
| Sai TOTP step-up (Q5) | bucket `TOTP_USER` **dùng chung với đăng nhập**; chỉ tăng khi TOTP đã so sánh và sai (mục 7.4); commit trước khi ném | 5 sai / 15 phút → khóa 15 phút; 429 + `Retry-After` |
| Sai TOTP trên một operation | `attempt_count` | 5 → `INVALIDATED(ATTEMPTS_EXHAUSTED)` |
| Mutation route nghiệp vụ | không bucket riêng (tối đa 1 operation sống × 120 s × quota IP) | — |

Hệ quả của Q5 (ghi nhận để test): sai ở step-up cũng làm giảm ngân sách đăng nhập TOTP và ngược lại. Không đổi CHECK `kind` của `admin_auth_limits`.

## 11. Audit (cùng transaction với mutation; thất bại ⇒ rollback toàn bộ)

| Action (versioned) | Khi nào | Outcome | Metadata |
|---|---|---|---|
| `admin_invitation.operation_created.v1` | 6.2 | SUCCESS | `operation_id`, `action`, `target_id?`, `replaced_operation_id?` |
| `admin_invitation.operation_verified.v1` | 6.4 đúng | SUCCESS | `operation_id` |
| `admin_invitation.operation_verify_denied.v1` | 6.4 TOTP đã so sánh và sai (commit cùng bộ đếm) | DENIED, `reasonCode=TOTP_INVALID` hoặc `ATTEMPTS_EXHAUSTED` | `operation_id`, `attempt_count` |
| `admin_invitation.created.v1` | 6.6 | SUCCESS | `invitation_id`, `generation_id`, `version`, `operation_id`, quyền `[app:V/R/L]` |
| `admin_invitation.reissued.v1` | 6.8 | SUCCESS | `invitation_id` (mới), `superseded_invitation_id`, `operation_id`, `reason`, `permissions_source` (`COPIED`\|`PROVIDED`), quyền `[app:V/R/L]` |
| `admin_invitation.revoked.v1` | 6.9 | SUCCESS | `invitation_id`, `version`, `operation_id`, `reason` |
| `admin_invitation.expired.v1` | create gặp PENDING quá hạn | SUCCESS | `invitation_id`, `version` |

Không audit khi bucket đang khóa (giống #34: nhánh `limited` không ghi); quota IP đã chặn lưu lượng. `actorType = 'SYSTEM'` (Q8) cho các thao tác trên; `actorId` = user id SYSTEM từ principal đã kiểm; audit login hiện có (`USER`) giữ nguyên. `requestId` do server tạo; `resourceType='admin_invitation'`, `resourceId`, `resourceVersion`. **Không ghi** mật khẩu, token, link, digest, SĐT, họ tên, ghi chú, cookie, header, mã TOTP.

**`reason` (Q7):** lưu trong `metadata.reason` của audit revoke/reissue, **không bao giờ cùng token/link**. `reason` là văn bản tự do do SYSTEM nhập, nên **có thể chứa dữ liệu cá nhân hoặc nhạy cảm do người nhập tự gõ**; tài liệu này **không** khẳng định nó không có dữ liệu cá nhân. Biện pháp: UI sau này phải nhắc không nhập mật khẩu/token/mã/SĐT đầy đủ; `reason` không vào log ứng dụng, không vào thông báo lỗi, không lặp lại trong response; áp dụng cùng chính sách lưu giữ/quyền đọc audit. Test quét log/response khẳng định điều đó.

## 12. Mã lỗi (đăng ký trong `APP_ERROR_DEFINITIONS`, thông điệp cố định, không phản chiếu input)

| HTTP | Mã | Ghi chú |
|---|---|---|
| 400 | `ADMIN_INPUT_INVALID` | **mới**; cú pháp/chuẩn hóa/khóa lạ/cursor/`permissions` tường minh không hợp lệ |
| 400 | `ADMIN_TOTP_INVALID` | đã có (#34) |
| 400/409 | `IDEMPOTENCY_KEY_REQUIRED`, `INVALID_IDEMPOTENCY_KEY`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_BUSY`, `IDEMPOTENCY_REPLAY_EXPIRED`, `IDEMPOTENCY_KEY_UNAVAILABLE` | đã có |
| 401 | `ADMIN_SESSION_INVALID` | đã có |
| 403 | `ADMIN_FORBIDDEN` | **mới**; phiên hợp lệ nhưng không phải SYSTEM |
| 403 | `ADMIN_CSRF_INVALID` | đã có (POST thiếu/sai Origin hoặc CSRF; GET có Origin sai) |
| 403 | `ADMIN_STEP_UP_REQUIRED` | **mới**; operation thiếu/hết hạn/không khớp/đã dùng/bị thay |
| 404 | `ADMIN_INVITATION_NOT_FOUND` | **mới**, chỉ cho SYSTEM đã xác thực |
| 409 | `ADMIN_VERSION_CONFLICT` | **mới** |
| 409 | `ADMIN_INVITATION_NOT_PENDING` | **mới**; thu hồi/cấp lại một lời mời đã terminal |
| 409 | `ADMIN_INVITATION_NOT_REPLAYABLE` | **mới (Owner chấp nhận)**; replay create/reissue khi lời mời không còn PENDING hoặc đã quá `expires_at`; trả **trước** giải mã link |
| 409 | `ADMIN_INVITATION_PENDING_EXISTS` | **mới**; SĐT đã có lời mời PENDING còn hạn |
| 409 | `ADMIN_PHONE_CONFLICT` | **mới** |
| 429 | `ADMIN_AUTH_RATE_LIMITED` | đã có; kèm `Retry-After` |
| 503 | `TRANSACTION_OUTCOME_UNKNOWN`; thiếu khóa lịch sử | đã có / lỗi kỹ thuật chung |

`40P01`/`55P03` (nếu xảy ra) đi qua xử lý lỗi kỹ thuật hiện có của `TransactionManager`/executor, không có mã nghiệp vụ riêng; server không retry. Cập nhật các test registry/HTTP hiện có và kiểm tương thích trước code.

## 13. Cấu hình

- `ADMIN_INVITATION_TTL_HOURS`: **mặc định 72**, số nguyên 1–168. **Thiếu ⇒ dùng mặc định**; giá trị có mặt nhưng sai (không phải số nguyên, ngoài khoảng) ⇒ **từ chối khởi động**, chỉ nêu tên biến.
- `ADMIN_ACTIVATION_ORIGIN`: **bắt buộc khi `ADMIN_AUTH_ENABLED=true`** (Owner đã quyết); phải **thuộc allowlist** `ADMIN_AUTH_ALLOWED_ORIGINS` (HTTPS ở staging/production); link = `<origin>/activate#t=<token>`. **Thiếu hoặc sai (ngoài allowlist) ⇒ từ chối khởi động, chỉ nêu tên biến; không bao giờ tự chọn origin** (kể cả khi allowlist chỉ có một origin).
- Chỉ đọc khi `ADMIN_AUTH_ENABLED=true`. TTL được chụp vào `expires_at` lúc tạo (participant 1A nhận `ttlSeconds`); đổi cấu hình **không** kéo dài lời mời cũ. Replay 900 s / dedupe 86400 s là hằng số trong code (không env).
- `lock_timeout` của transaction 1B không qua executor: xem mục 8.5 (dùng `businessLockTimeoutMs` đã validate, không thêm biến mới).
- Keyring: thêm mục đích `adminOperation` (Q11). Cập nhật `.env.example`, README/runbook, test cấu hình.

## 14. Khôi phục khi mất response (F6)

| Tình huống | Hành vi đúng |
|---|---|
| Mất response của **create-operation** | An toàn gọi lại `POST /admin/operations`: nó vô hiệu bản cũ (`REPLACED`) và tạo bản mới; không tiêu hao TOTP, không ghi mutation. Client không biết `operation_id` của bản mất nên không dùng lại. |
| Mất response / unknown COMMIT của **verify** (`VERIFIED` ⇒ từ chối trước khi so mã, không đếm; không tự retry; GET quyết định) | **Không bao giờ gửi lại mã tự động** (server không retry; client không auto-retry). Nếu lần trước đã commit thành công thì operation đã `VERIFIED`; một lần gửi lại sẽ bị **từ chối trước khi so mã** (`ADMIN_STEP_UP_REQUIRED`, không mở secret, **không tăng counter**). Nếu operation vẫn `PENDING`, một mã gửi lại có thể bị so sánh và tính **một lần sai** — vì vậy **không tự retry TOTP**. Cách đúng: dùng `GET /admin/operations/:id` để xác định kết quả: — `usable=true` ⇒ đi tiếp; `verifiable=true` ⇒ **người dùng nhập một mã mới** (`attempts_remaining` cho biết còn mấy lần); cả hai `false` ⇒ tạo operation mới. |
| Mất response của create/reissue/revoke | Gọi lại với **cùng `Idempotency-Key` và cùng `operation_id`** trong 15 phút: nhận đúng kết quả cũ (kèm link với create/reissue) hoặc, nếu transaction đã rollback, thực thi lại nếu operation còn `usable`. Quá 15 phút không lấy lại link: dùng `GET /admin/invitations` (SĐT che) để xem trạng thái, rồi **cấp lại**. |
| Phiên bị thu hồi giữa chừng | Operation gắn phiên cũ trở thành không dùng được (binding); đăng nhập lại, tạo operation mới. Replay link vẫn khả dụng trong 15 phút với phiên mới của cùng SYSTEM (hook mục 9.3). |

## 15. Kế hoạch test (đồng thời và replay là trọng tâm)

Unit: parser/chuẩn hóa (kể cả `permissions` vắng/null/mảng của reissue); fingerprint ổn định, nhạy thứ tự quyền, khác action, **khác khi permissions vắng vs gửi giống hệt**; máy trạng thái operation; `usable/expired/verifiable`; mapping lỗi; config. Integration trên PostgreSQL thật qua pipeline Nest thật. **Không** dùng `sleep` để chứng minh thứ tự: dùng barrier và `waitForBlockedBackends` (poll `pg_locks`/`pg_stat_activity` cho đến khi đúng số backend đang chờ).

**Harness có barrier (nhóm TL).** Một wrapper test-only quanh `TransactionContext` ghi lại mọi câu có `FOR UPDATE/FOR SHARE/FOR KEY SHARE/pg_advisory_xact_lock` kèm hạng (bảng 8.1) và cho phép **tạm dừng ngay sau khi lấy hạng X**. Test (a) khẳng định mỗi route phát ra chuỗi hạng không giảm; (b) dựng lịch chạy xác định bên dưới. Không dựng SYSTEM thứ hai và không bỏ unique index để tạo tình huống.

**Lịch chạy xác định (barrier) cho các cặp đường đi trọng yếu** — mỗi dòng: A giữ ở hạng nêu, B bắt đầu, xác nhận B đang chờ, thả A, kiểm kết quả; rồi **chạy lại với thứ tự đảo**:

| ID | Cặp | A dừng tại | Kết quả bắt buộc |
|---|---|---|---|
| S1 | create-op × create-op, chưa có op sống | sau L4 | op₁ `INVALIDATED(REPLACED)`, op₂ `PENDING`, đúng một hàng sống, **0 lần `23505`** |
| S2 | create-op × create-op, đã có op₀ sống | sau L9 | op₀, op₁ `REPLACED`, op₂ sống, 0 `23505` |
| S3 | create-op mới × tiêu thụ op cũ (create) | sau L4 (mỗi thứ tự) | create-op trước ⇒ mutation `ADMIN_STEP_UP_REQUIRED`, **không** lời mời; mutation trước ⇒ op `CONSUMED`, op mới `PENDING`, lời mời đã tạo |
| S4 | cùng operation, hai `Idempotency-Key` khác, cùng payload (create) | sau L4 | **đúng một** 201; request kia `ADMIN_STEP_UP_REQUIRED`; đúng một lời mời, một audit `created` |
| S5 | như S4 cho reissue và revoke | sau L4 | đúng một thành công, hàng cũ chuyển đúng một lần |
| S6 | verify × verify, cùng operation | sau L2 | một `VERIFIED`; request kia `STEP_UP_REQUIRED`, **không** cộng bộ đếm, không mở secret |
| S7 | verify × create-op | sau L4 | hai thứ tự: verify trước ⇒ op `VERIFIED` rồi bị `REPLACED`; create-op trước ⇒ verify `STEP_UP_REQUIRED` không đếm |
| S8 | GET operation × verify | sau L4 (hai thứ tự) | **Verify trước:** GET chờ, rồi thấy `VERIFIED` (`usable=true`). **GET trước:** GET có thể thấy `PENDING` (`verifiable=true`), verify chạy sau và thành công. Không yêu cầu cả hai lịch đều thấy `VERIFIED`; chỉ yêu cầu không bao giờ thấy trạng thái trung gian/nửa chừng |
| S9 | **BOOT (bootstrap) × writer / create-op** | BOOT sau khóa user (và sau khóa membership) | Đã có ở spec B-1 (`admin-bootstrap-lock-order.int.spec.ts`: ca tham chiếu thứ tự cũ ⇒ `40P01`; thứ tự mới ⇒ không deadlock, `UNCHANGED`). Khi có create-op thật ở 1B, thêm lịch BOOT × create-op với cùng kỹ thuật |
| S10 | login (revoke phiên) × business route | sau L4 | route chờ rồi thấy phiên đã thu hồi ⇒ 401; không mutation |
| S11 | replay hook × reissue/revoke cùng lời mời | sau L8 | replay không bao giờ giải mã link của lời mời đã SUPERSEDED/REVOKED/quá hạn |
| S12 | create (cùng SĐT) × create (cùng SĐT), khác key, **khác operation** | — | được dựng **ở tầng participant 1A** (giữ test đua unique SĐT có sẵn), không dựng hai operation sống ở tầng route |

Ngoài ra chạy race ngẫu nhiên có seed (N=100) trộn create-op/verify/mutation/login/logout làm **kiểm tra bổ sung**, khẳng định 0 lần `40P01` và bất biến cuối. **Không** dùng nó làm chứng minh không deadlock; chứng minh là bảng thứ tự + trace + lịch barrier ở trên.

Nhóm test chức năng:
- **AZ:** ADMIN-role ⇒ `ADMIN_FORBIDDEN` mọi route; không cookie / token app Khách-Quán-Xế / cookie sai ⇒ `ADMIN_SESSION_INVALID`; POST Origin sai/thiếu hoặc CSRF thiếu ⇒ 403; **GET không có Origin ⇒ thành công; GET có Origin sai ⇒ 403**; user/membership `DISABLED`, đổi mật khẩu (binding lệch), phiên thu hồi hoặc hết hạn *trong lúc chờ khóa* ⇒ 401; **mọi GET (chi tiết, danh sách, operation) với factor không ACTIVE hoặc lệch `factor_id/version` của phiên ⇒ 401**; trace khóa của từng GET phát ra user → membership → factor → session.
- **SU:** sai mã tăng bộ đếm bucket và `attempt_count` và **được commit** (đọc lại sau lỗi); lần 5 ⇒ `INVALIDATED(ATTEMPTS_EXHAUSTED)`; **các trường hợp không đếm** (body sai, bucket khóa, operation sai/hết hạn/lệch binding) giữ nguyên cả hai bộ đếm; bucket khóa ⇒ 429 + `Retry-After` trước khi mở secret (spy `openTotpSecret` = 0 lần); mã vừa dùng đăng nhập bị từ chối (và được đếm vì đã so sánh); mã step trước/sau cửa sổ; operation hết hạn trong lúc chờ khóa; sai target/body/version/action; dùng lại sau `CONSUMED`; đăng nhập lại / đổi factor / tăng version membership ⇒ operation không dùng được nhưng `status` lưu **không đổi** (kiểm chứng "chỉ từ chối, không ghi"); tạo operation thứ hai ⇒ cái cũ `REPLACED`.
- **ST (trạng thái, F5):** `VERIFIED` quá 120 s ⇒ GET `usable=false, expired=true, status='VERIFIED'` và **không** có UPDATE nào do GET; lệch binding ⇒ `usable=false`; `PENDING` ⇒ `verifiable=true`, `attempts_remaining` đúng.
- **CR (create):** thành công (lời mời + snapshot + digest, link không có trong DB/audit/log, một audit, một record idempotency); PENDING còn hạn ⇒ `PENDING_EXISTS`; PENDING quá hạn ⇒ `EXPIRED` + audit rồi tạo mới; SĐT đã là user ⇒ `ADMIN_PHONE_CONFLICT`; ưu tiên lỗi authz > step-up > nghiệp vụ; audit lỗi ⇒ rollback toàn bộ.
- **RI (reissue/revoke, F4):** reissue vắng `permissions` ⇒ bản mới có đúng quyền bản cũ, họ tên/ghi chú/SĐT giữ nguyên; reissue có `permissions` ⇒ bản mới có quyền mới và **snapshot bản cũ không đổi** (đọc lại); `permissions` tường minh `null`/`[]`/không hợp lệ ⇒ 400; thêm `full_name`/`phone`/`note` vào reissue ⇒ 400; fingerprint/logical request khác nhau khi vắng vs gửi (op tạo với vắng, route gửi ⇒ `STEP_UP_REQUIRED`; cùng key khác `permissions` ⇒ `KEY_REUSED`); `SUPERSEDED` cũ + `PENDING` mới trong một transaction (đúng thứ tự deferred FK); `expected_version` cũ ⇒ `VERSION_CONFLICT`; mục tiêu terminal ⇒ `NOT_PENDING`; reissue/revoke lời mời `PENDING` quá hạn thành công; rollback giữ nguyên bản cũ khi bất kỳ bước sau transition lỗi.
- **RP (replay, F2):** mất response ⇒ cùng key trả đúng link cũ, không sinh generation thứ hai; khác body ⇒ `KEY_REUSED`; sau 15 phút ⇒ `REPLAY_EXPIRED` và không giải mã; replay sau khi phiên thu hồi / membership vô hiệu ⇒ từ chối **trước** giải mã (ciphertext cố ý hỏng vẫn nhận lỗi quyền, không phải lỗi crypto); **replay create/reissue khi lời mời đã thu hồi / bị thay thế / đã quá `expires_at` (còn trong 15 phút) ⇒ `ADMIN_INVITATION_NOT_REPLAYABLE`, spy `decryptReplay` = 0 lần**; hai request cùng key ⇒ một thực thi; thiếu khóa lịch sử ⇒ fail-closed 503; **unknown COMMIT** (tiêm lỗi ack COMMIT) ⇒ 503, thử lại cùng key ⇒ đúng một lời mời.
- **AU:** mỗi mutation đúng một audit cùng transaction; verify sai có audit DENIED khi bộ đếm commit; không audit nhánh bucket khóa; `actorType=SYSTEM`; quét log/audit/response không chứa token/link/digest/SĐT (trừ link ở response tạo/replay); `reason` có trong audit nhưng không có trong log/response.
- **LM:** request thứ 31/phút/IP ⇒ 429 + `Retry-After`; bucket `TOTP_USER` dùng chung với đăng nhập (ghi nhận Q5).
- **MG:** up/down/up chỉ trên DB test có guard; CHECK hình dạng theo action/status/mốc thời gian; trigger chuyển trạng thái và mã lỗi `23001/23514`; unique "một operation sống/SYSTEM"; FK NO ACTION; runbook grants khớp.
- **CF:** TTL thiếu ⇒ 72; 1–168 hợp lệ; ngoài khoảng/không phải số ⇒ dừng khởi động chỉ nêu tên biến; origin link ngoài allowlist ⇒ dừng.
- **Hồi quy:** toàn bộ suite #34/#37 giữ xanh; không route 1B nào đổi hành vi `/admin-auth/*`; subkey cũ giữ nguyên giá trị (Q11).

CI phải đạt trên final head; lint, typecheck, build bắt buộc. Môi trường làm việc của Claude không cài được jest (registry bị chặn) ⇒ bằng chứng test chính thức là CI, như ở #34/#37.

## 16. File dự kiến (đổi khi review)

Mới: migration `*_create-admin-sensitive-operations.sql`; `apps/backend/src/admin-provisioning/` (controller, `admin-operation-service`, `admin-invitation-service`, participant actor SYSTEM dùng `lockAndCheck`, repository operation, validation/chuẩn hóa, `activation-link` builder, hằng số); các spec và `tests/integration/admin-provisioning-*.int.spec.ts` (+ harness barrier/trace).
Sửa: `common/app-errors.ts` (mã mới) và test registry; `crypto/key-version.ts` + `keyring.ts` (`adminOperation`) + `admin-purposes.spec.ts`; `config/admin-auth-config.ts` (+spec, `.env.example`); `app.module.ts` (mount có điều kiện); `admin-invitations/admin-invitation-repository.ts` (thêm **một** hàm đọc quyền của lời mời, chỉ đọc, cho reissue sao chép); `ops/runbooks/render-supabase-staging.md` (grants + biến mới); các test migration/trigger liệt kê migration mới; dọn dữ liệu test cho bảng mới. B-1 đã sửa riêng ở `38bb8c7` (`admin-bootstrap-service.ts`, `admin-membership-repository.ts`, một spec mới); 1B không sửa lại các file đó.
Không sửa: migration đã apply, `/admin-auth/*`, bất kỳ route app Khách/Quán/Xế.

## 17. Gate và ma trận từng ứng dụng

| Giai đoạn | Người | Trạng thái |
|---|---|---|
| Hợp đồng 1B (tài liệu này, v2) | Claude soạn → ChatGPT review head mới | **Chờ review** |
| Sửa B-1 (bootstrap SYSTEM) trong phạm vi riêng | Owner đã cho phép; Claude sửa; ChatGPT review | **Đã sửa** ở `38bb8c7`; chờ CI trên head cuối và review của ChatGPT |
| Code + test 1B | Claude | Chưa bắt đầu; chỉ sau khi review đạt |
| Review diff đúng SHA | ChatGPT | Chưa |
| Test local, Authenticator thật | Owner | Chưa (cần UI SYSTEM — gói riêng) |

| Ứng dụng | Phạm vi 1B | Ghi chú |
|---|---|---|
| Web quản trị (ADMIN/SYSTEM) | Backend API cho SYSTEM; **không UI** (UI-06 đã duyệt, code UI là gói khác) | Chưa kiểm chứng |
| Khách / Quán / Xế | N/A: chỉ dùng app; không route 1B nào mở cho họ; test âm tính xác nhận | Quyết định N/A thuộc Owner |
| App quản lý | N/A trong 1B | Quyết định Owner |
| Liên thông | Chưa xác định; kích hoạt là 1C | Chưa kiểm chứng |

## 18. Giới hạn và những gì còn thiếu

- Chưa có code, migration chạy thật, test hay CI nào cho 1B; mọi mục trên là **thiết kế** dựa trên đọc code #34/#37. Không có bằng chứng runtime về thứ tự khóa.
- `LOCK_PROTOCOL = NOT_FINAL` (mục 8.7): B-1 đã sửa nhưng chưa có CI/review, và chưa có code hay test barrier của 1B.
- Đã được Owner chốt (không còn là điểm mở): thu hồi chỉ `PENDING`; `ADMIN_ACTIVATION_ORIGIN` bắt buộc/allowlist/không tự chọn; `ADMIN_INVITATION_NOT_REPLAYABLE`; `lock_timeout` bằng `set_config(…, true)` với `businessLockTimeoutMs`; GET kiểm factor.
- Còn thiếu: review B-1 và hợp đồng của ChatGPT; CI xanh trên final head (ghi ở PR); test barrier S1–S12 cho code 1B (chưa có code).
- Chưa kiểm lịch sử migration DB Owner/staging (không có quyền operator read-only); migration 1B chỉ chạy trên DB test, không deploy.
- Kích hoạt (1C) sẽ cần phân tích call graph khóa riêng; tài liệu này chỉ đặt ràng buộc (mục 8.8).
- Chưa có Owner nghiệm thu, chưa đóng M01, chưa deploy.
