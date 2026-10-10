# M01-D-ADMIN-1C — Hợp đồng kỹ thuật kích hoạt ADMIN từ lời mời

> **Trạng thái:** **ĐÃ DUYỆT bởi Owner tại head `802b334a4c854c5517d50b651442a073103b22ea`; OD-1…OD-16 đã được Owner chốt theo đề xuất ghi trong §21** (ghi nhận ở §22, commit tài liệu riêng). Triển khai ở PR implementation stacked trên PR này. `LOCK_PROTOCOL = NOT_FINAL` tới khi ChatGPT review code/test. Chưa merge, chưa deploy, chưa đóng M01; **chưa có Owner nghiệm thu triển khai**.
> **Trung thực về nguồn:** "câu lệnh 1C" gốc không có trong repo hay hội thoại làm việc. Các điểm Claude suy ra mang nhãn **[ĐX]**; nay các [ĐX] liên quan OD-1…OD-16 là quyết định của Owner (§22). Điểm [ĐX] nào **không** thuộc OD nào vẫn cần ChatGPT xác nhận khi review code.
> **Kiểm chứng DDL:** chạy cục bộ trên PostgreSQL 16 bằng script trong `docs/verification/m01-d-admin-1c-ddl/`, kết quả ở §5.4. **Không phải CI.**

## 0. Nguồn và mốc

| Mục | Giá trị |
|---|---|
| Repo | `trungtn87/11ship` |
| Base của PR #44 | `feat/m01-d-admin-1b-provisioning` @ `4ab9c9cff8db730699d234c56bacf567506c5bbf` (PR #41) |
| Mốc review v1 | `45a261cbe903600ecabc13be185517341b8713bc` |
| Mốc review v2 | `2b36ddc172af1673cdf2be877646eade5a73e575` |
| Mốc review v3 | `90f852cbbd279b946094265634180c86925a6bc4` |
| Chuỗi PR | #34 login backend → #37 1A invitations → #38 hợp đồng 1B → #41 triển khai 1B (Draft) → #44 hợp đồng 1C (Draft) |
| Nguồn nghiệp vụ | PR #30, #33, #36 (preflight), #43 (reset). "Mật khẩu tạm" trong #30 **bị thay** bằng luồng lời mời → OTP → tự đặt mật khẩu → 2FA |
| Hợp đồng đối chiếu | `docs/tasks/M01-D-ADMIN-1B-technical-contract.md` (khóa L1–L10, §8.8) |

## 1. Bảng finding F1–F6 → mục sửa → test dự kiến

| # | Finding | Mục sửa | Test dự kiến |
|---|---|---|---|
| F1 | CHECK dữ liệu TOTP để lọt cột NULL (`octet_length(NULL)` là NULL ⇒ CHECK **đạt**) | §5.1 (`admin_activation_attempts_totp_all_or_none_ck` kiểm `IS NOT NULL` từng cột trước độ dài); §5.4 | DDL F1a–F1k (9 biến thể NULL/độ dài sai + 1 ca hợp lệ + secret ngoài TOTP_ISSUED), kiểm cả tên constraint; chạy trong `run.sh` |
| F2 | GET state / `complete` lặp sau COMPLETED khi lời mời đã ACCEPTED chưa xác định | §6.3 (bảng kết quả GET state theo trạng thái, chỉ dữ liệu không nhạy cảm), §6.4 (`complete` lặp), §11 | T-GET-1..6 (từng trạng thái, không lộ SĐT/tên/quyền/user id); T-CMP-REPLAY (không so lại TOTP, không đếm, không ghi) |
| F3 | Phục hồi PENDING_DELIVERY, provider timeout, unknown COMMIT, callback muộn; không gửi lại mù | §13 (máy trạng thái giao OTP, kết quả provider ACCEPTED/REJECTED/UNKNOWN, lazy promote, quy tắc không tự gửi lại), §11 | T-OTP-D1..D8 (provider timeout, chết giữa txn1 và gọi provider, txn2 unknown COMMIT, gửi muộn sau resend) |
| F4 | Giao dịch từng endpoint, thứ tự khóa đầy đủ, bucket trước phone lock, giờ DB sau khóa cuối, commit-then-throw, TOTP khi chưa có factor | §9 (bảng hạng khóa), §10 (từng endpoint), §8 (bộ đếm), §12 | K1–K22 (§17), trace khóa (`pg_locks`) cho mỗi route |
| F5 | Bảng replay đúng từng trạng thái; không so lại mã, không tăng counter sau bước đã xong | §11 (ma trận route × trạng thái × kết quả × phục hồi) | T-REPLAY-matrix (mọi ô của bảng) |
| F6 | Transport/cookie/CSRF/no-store; barrier resend×verify, enrollment×complete, expiry sau khóa | §6.1–6.2 (transport), §17 K13–K22 | T-HDR (mọi response có no-store), T-COOKIE, T-CSRF, K13 (resend×verify), K14 (enrollment×complete), K15–K16 (expiry sau khóa) |

### 1.1 Bảng finding G1–G4 → mục sửa → test dự kiến

| # | Finding | Mục sửa | Test dự kiến |
|---|---|---|---|
| G1 | `start`/`otp/request` có nhánh ghi PHONE_CONFLICT nhưng khóa lời mời **S** ⇒ nâng S→X | §9 (L8 **X từ đầu** cho mọi route có thể ghi lời mời: start, restart, otp/request, complete; S chỉ cho verify/password/enrollment, vốn không bao giờ ghi lời mời), §10.1, §10.1A, §10.2, §14 | K23 (PHONE_CONFLICT ở start/otp-request: trace `pg_locks`/câu lệnh không có `FOR SHARE` lời mời, hai request đồng thời không `40P01`) |
| G2 | Hết `password_deadline` thì `start` tiếp tục cookie hiện tại ⇒ kẹt tới hết hạn attempt | §6.2 (định nghĩa **resumable**; route `restart`), §6.3 (`restart_required`), §10.1, §10.1A, §11.2 | K24 (quá deadline → restart → OTP mới → hoàn tất) |
| G3 | start/GET/complete không đồng bộ ở COMPLETED và cookie hết hạn; repeat complete có thể tạo/cập nhật bucket | §6.1.1 (**một** quy tắc hiệu lực cookie), §6.3, §10.0 (TX-P đọc thuần, ranh giới transaction, kiểm lại dưới khóa, từ chối thuần = ROLLBACK), §10.1, §10.6, §11.2 | K25 (start token + cookie COMPLETED; cookie hết hạn ở mọi trạng thái × mọi route), K26 (repeat complete không đổi bucket/counter/audit/hàng) |
| G4 | verify dựa vào challenge sống thay vì challenge mới nhất; LOCKED/terminal chưa phân loại | §10.3 (chọn challenge **mới nhất**, bảng phân loại từng trạng thái), §6.3 (`otp.status`) | K27 (verify sau lần sai thứ 5 ⇒ `OTP_RATE_LIMITED`, không đổi counter; bảng challenge mới nhất × trạng thái) |

### 1.2 Bảng finding H1–H4 → mục sửa → test dự kiến

| # | Finding | Mục sửa | Test dự kiến |
|---|---|---|---|
| H1 | Quy tắc CSRF: `GET state` phải trả `csrf_token` cho attempt sống **và** `INVALIDATED(ATTEMPTS_EXHAUSTED)` (được phép `restart`); COMPLETED và INVALIDATED khác không cần | §6.1.1 mục 4 (bảng "trạng thái → có csrf không"), §6.2, §6.3, §6.4 | K28 (a)(e); T-CSRF-MATRIX (6 trạng thái + 4 lý do INVALIDATED) |
| H2 | Thiếu test: TOTP sai lần 5 → tải lại → lấy CSRF → restart → OTP lại; cookie hết hạn; lời mời đóng; bucket TOTP khóa không bị restart reset | §6.2 (restart không đụng limiter), §8, §17 | K28 (a)–(f) |
| H3 | TX-P: mọi nhánh trả lời sớm phải kiểm hiệu lực cookie bằng giờ DB trước khi trả trạng thái, kể cả `otp/request` | §10.0 (quy tắc TX-P bước 0), §10.1 bước 2, §10.1A bước 2, §10.2, §10.6, §11.2 | K29 (mọi nhánh trả lời sớm ở T ngay trước/ngay sau `expires_at`) |
| H4 | "Không ghi khi replay" phải nói rõ: không ghi bucket nghiệp vụ, counter, audit; quota ingress vẫn áp dụng | §10.0 (định nghĩa), §11.2 (quy ước), §8, §6.2 | K26 (sửa: bucket nghiệp vụ không đổi; `ACTIVATION_REQUEST_IP` **vẫn +1**) |

## 2. Quyết định đã có (không đổi trong tài liệu này)

1. Luồng: lời mời → OTP → tự đặt mật khẩu → thiết lập và xác nhận TOTP → kích hoạt ADMIN nguyên tử.
2. Tài khoản ADMIN là `account_origin = ADMIN_PROVISIONED`; không đi qua `/auth/register`.
3. SĐT lời mời bất biến (trigger 1A). SĐT trùng tài khoản khác ⇒ `PHONE_CONFLICT`.
4. TOTP: RFC 6238, SHA-1, 6 chữ số, 30 s, cửa sổ `{step hiện tại, step−1}` (`matchTotp`); bí mật AEAD niêm phong (AAD: userId, factorId, factorVersion); chỉ nhận step > `last_accepted_step` khi đã có factor.
5. Owner cho phép hiển thị "OTP thử" ở môi trường test không phải production; staging/production không chạy nếu thiếu provider OTP.
6. Claude không đổi nghiệp vụ hay UI đã duyệt; thiếu thiết kế ⇒ OD §21.

## 3. Phạm vi

**Trong:** 8 route công khai `/v1/admin-activation/*`; 3 migration (A, B bắt buộc; C tùy chọn OD-4); service, limiter, audit, lỗi, cấu hình; kế hoạch test.
**Ngoài:** gửi SMS thật (M01-C), UI, đăng nhập ADMIN (#34), step-up 1B, đổi quyền sau kích hoạt, đổi/quên mật khẩu, khôi phục TOTP, reset (PR #43).

## 4. Cơ sở code đã đọc (không sửa)

`AdminIdentityParticipant.insertProvisioned`; `AdminInvitationParticipant.transition` (CAS theo version); `AdminTotpService`, `admin-crypto`, `auth/totp` (`matchTotp`); `AdminLimiter` (`reserveRequest` = quota trong transaction riêng đã commit; `lockBuckets`/`recordFailure` = bộ đếm lỗi); `VerificationService` (mẫu OTP: txn1 → gửi ngoài txn → txn2); `TransactionManager` (`TRANSACTION_OUTCOME_UNKNOWN` khi COMMIT timeout); `freshClockMs`; `businessLockTimeoutMs`; `CSRF_HEADER = x-csrf-token`; `IdempotencyExecutor` (**không** dùng cho 1C, §11.1).

## 5. Dữ liệu — DDL đã chạy thử

Nguồn chuẩn của DDL là các file trong `docs/verification/m01-d-admin-1c-ddl/sql/`; khối dưới đây phải **trùng từng byte** (`run.sh` kiểm).

### 5.1 Migration A — attempt, OTP challenge, profile, permissions (**bắt buộc**)

Ghi chú thiết kế: `token_digest` của attempt là digest của **bí mật cookie phiên kích hoạt**, không phải token lời mời. `user_id`/`factor_id` cấp sẵn (không FK) vì là AAD của bí mật TOTP (factor và user được tạo cùng transaction từ attempt; không có cột ràng buộc mật khẩu ở factor). F1: ràng buộc `admin_activation_attempts_totp_all_or_none_ck` kiểm `IS NOT NULL` cho **từng** cột trước khi so độ dài, vì `octet_length(NULL)` là NULL và CHECK đánh giá NULL được coi là đạt.

```sql
CREATE TABLE app.admin_activation_attempts (
 attempt_id uuid PRIMARY KEY,
 invitation_id uuid NOT NULL,
 generation_id uuid NOT NULL,
 -- Pre-allocated identities of the account that exists only after COMPLETED (no foreign key on purpose). They are
 -- the AEAD associated data of the TOTP secret and the input of the password binding, so they must be fixed first.
 user_id uuid NOT NULL UNIQUE,
 factor_id uuid NOT NULL UNIQUE,
 -- Digest of the activation-session COOKIE secret (never of the invitation token, which lives in admin_invitations).
 token_digest char(64) NOT NULL UNIQUE CHECK (token_digest ~ '^[0-9a-f]{64}$'),
 csrf_nonce bytea NOT NULL CHECK (octet_length(csrf_nonce) = 32),
 csrf_key_id varchar(64) NOT NULL CHECK (csrf_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 status varchar(16) NOT NULL CHECK (status IN ('STARTED','OTP_VERIFIED','PASSWORD_SET','TOTP_ISSUED','COMPLETED','INVALIDATED')),
 invalidated_reason varchar(24) CHECK (invalidated_reason IN ('SUPERSEDED','INVITATION_CLOSED','PHONE_CONFLICT','ATTEMPTS_EXHAUSTED')),
 otp_verified_at timestamptz,
 password_hash text CHECK (password_hash ~ '^\$argon2id\$'),
 password_set_at timestamptz,
 totp_key_id varchar(64) CHECK (totp_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 totp_ciphertext bytea,
 totp_iv bytea,
 totp_tag bytea,
 totp_issued_at timestamptz,
 totp_attempt_count smallint NOT NULL DEFAULT 0 CHECK (totp_attempt_count BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 completed_at timestamptz,
 invalidated_at timestamptz,
 CONSTRAINT admin_activation_attempts_invitation_fk FOREIGN KEY (invitation_id, generation_id)
  REFERENCES app.admin_invitations (invitation_id, generation_id),
 CHECK (expires_at > created_at AND (expires_at - created_at) <= interval '1 hour'),
 -- F1: the sealed secret is all-or-nothing. Every column is tested with IS NULL / IS NOT NULL first, because
 -- octet_length(NULL) is NULL and a CHECK that evaluates to NULL PASSES: a bare length comparison would admit a NULL column.
 CONSTRAINT admin_activation_attempts_totp_all_or_none_ck CHECK (
     (totp_key_id IS NULL AND totp_ciphertext IS NULL AND totp_iv IS NULL AND totp_tag IS NULL AND totp_issued_at IS NULL)
  OR (totp_key_id IS NOT NULL AND totp_ciphertext IS NOT NULL AND totp_iv IS NOT NULL AND totp_tag IS NOT NULL
      AND totp_issued_at IS NOT NULL
      AND octet_length(totp_ciphertext) BETWEEN 1 AND 256 AND octet_length(totp_iv) = 12 AND octet_length(totp_tag) = 16)),
 CHECK (password_hash IS NULL OR password_set_at IS NOT NULL),
 -- password_hash and the TOTP secret exist only while the attempt is live; otp_verified_at / password_set_at stay as facts.
 CHECK ((status = 'STARTED'      AND otp_verified_at IS NULL     AND password_set_at IS NULL     AND password_hash IS NULL
         AND totp_issued_at IS NULL
         AND completed_at IS NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
     OR (status = 'OTP_VERIFIED' AND otp_verified_at IS NOT NULL AND password_set_at IS NULL     AND password_hash IS NULL
         AND totp_issued_at IS NULL
         AND completed_at IS NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
     OR (status = 'PASSWORD_SET' AND otp_verified_at IS NOT NULL AND password_set_at IS NOT NULL AND password_hash IS NOT NULL
         AND totp_issued_at IS NULL
         AND completed_at IS NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
     OR (status = 'TOTP_ISSUED'  AND otp_verified_at IS NOT NULL AND password_set_at IS NOT NULL AND password_hash IS NOT NULL
         AND totp_issued_at IS NOT NULL
         AND completed_at IS NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
     OR (status = 'COMPLETED'    AND otp_verified_at IS NOT NULL AND password_set_at IS NOT NULL AND password_hash IS NULL
         AND totp_issued_at IS NULL
         AND completed_at IS NOT NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
     OR (status = 'INVALIDATED'  AND password_hash IS NULL       AND totp_issued_at IS NULL
         AND completed_at IS NULL AND invalidated_at IS NOT NULL AND invalidated_reason IS NOT NULL)),
 CHECK (totp_attempt_count < 5 OR (status = 'INVALIDATED' AND invalidated_reason = 'ATTEMPTS_EXHAUSTED')),
 CHECK (completed_at IS NULL OR completed_at >= created_at),
 CHECK (invalidated_at IS NULL OR invalidated_at >= created_at)
);
-- At most one live attempt per invitation (a new start replaces the old one) and at most one COMPLETED.
CREATE UNIQUE INDEX admin_activation_attempts_live_uq
 ON app.admin_activation_attempts (invitation_id) WHERE status NOT IN ('COMPLETED','INVALIDATED');
CREATE UNIQUE INDEX admin_activation_attempts_completed_uq
 ON app.admin_activation_attempts (invitation_id) WHERE status = 'COMPLETED';

CREATE FUNCTION app.admin_activation_attempt_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'admin activation attempt deletion forbidden' USING ERRCODE = '23001';
 END IF;
 IF ROW(NEW.attempt_id,NEW.invitation_id,NEW.generation_id,NEW.user_id,NEW.factor_id,NEW.token_digest,NEW.csrf_nonce,NEW.csrf_key_id,NEW.created_at,NEW.expires_at)
  IS DISTINCT FROM
    ROW(OLD.attempt_id,OLD.invitation_id,OLD.generation_id,OLD.user_id,OLD.factor_id,OLD.token_digest,OLD.csrf_nonce,OLD.csrf_key_id,OLD.created_at,OLD.expires_at) THEN
  RAISE EXCEPTION 'admin activation attempt identity immutable' USING ERRCODE = '23001';
 END IF;
 IF OLD.status IN ('COMPLETED','INVALIDATED') THEN
  RAISE EXCEPTION 'admin activation attempt is terminal' USING ERRCODE = '23001';
 END IF;
 IF NEW.status = 'INVALIDATED' THEN
  IF NEW.invalidated_reason = 'ATTEMPTS_EXHAUSTED' THEN
   IF OLD.status = 'TOTP_ISSUED' AND NEW.totp_attempt_count = OLD.totp_attempt_count + 1 AND NEW.totp_attempt_count = 5 THEN RETURN NEW; END IF;
  ELSIF NEW.totp_attempt_count = OLD.totp_attempt_count THEN
   RETURN NEW;
  END IF;
 ELSIF OLD.status = 'STARTED' AND NEW.status = 'OTP_VERIFIED' AND NEW.totp_attempt_count = OLD.totp_attempt_count THEN
  RETURN NEW;
 ELSIF OLD.status = 'OTP_VERIFIED' AND NEW.status = 'PASSWORD_SET' AND NEW.totp_attempt_count = OLD.totp_attempt_count
   AND NEW.otp_verified_at IS NOT DISTINCT FROM OLD.otp_verified_at THEN
  RETURN NEW;
 ELSIF OLD.status = 'PASSWORD_SET' AND NEW.status = 'TOTP_ISSUED' AND NEW.totp_attempt_count = OLD.totp_attempt_count
   AND ROW(NEW.otp_verified_at,NEW.password_hash,NEW.password_set_at) IS NOT DISTINCT FROM ROW(OLD.otp_verified_at,OLD.password_hash,OLD.password_set_at) THEN
  RETURN NEW;
 ELSIF OLD.status = 'TOTP_ISSUED' AND NEW.status = 'TOTP_ISSUED' AND NEW.totp_attempt_count = OLD.totp_attempt_count + 1 AND NEW.totp_attempt_count < 5
   AND ROW(NEW.otp_verified_at,NEW.password_hash,NEW.password_set_at,NEW.totp_key_id,NEW.totp_ciphertext,NEW.totp_iv,NEW.totp_tag,NEW.totp_issued_at)
       IS NOT DISTINCT FROM
       ROW(OLD.otp_verified_at,OLD.password_hash,OLD.password_set_at,OLD.totp_key_id,OLD.totp_ciphertext,OLD.totp_iv,OLD.totp_tag,OLD.totp_issued_at) THEN
  RETURN NEW;
 ELSIF OLD.status = 'TOTP_ISSUED' AND NEW.status = 'COMPLETED' AND NEW.totp_attempt_count = OLD.totp_attempt_count
   AND NEW.otp_verified_at IS NOT DISTINCT FROM OLD.otp_verified_at AND NEW.password_set_at IS NOT DISTINCT FROM OLD.password_set_at THEN
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'invalid admin activation attempt transition' USING ERRCODE = '23001';
END $$;
CREATE TRIGGER admin_activation_attempt_transition_guard BEFORE UPDATE OR DELETE ON app.admin_activation_attempts
 FOR EACH ROW EXECUTE FUNCTION app.admin_activation_attempt_transition_guard();

CREATE TABLE app.admin_activation_otp_challenges (
 challenge_id uuid PRIMARY KEY,
 attempt_id uuid NOT NULL REFERENCES app.admin_activation_attempts (attempt_id),
 phone_normalized varchar(16) NOT NULL CHECK (phone_normalized ~ '^\+84[0-9]{9}$'),
 otp_digest char(64) NOT NULL CHECK (otp_digest ~ '^[0-9a-f]{64}$'),
 digest_key_id varchar(64) NOT NULL CHECK (digest_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 status varchar(16) NOT NULL CHECK (status IN ('PENDING_DELIVERY','PENDING','VERIFIED','LOCKED','INVALIDATED','DELIVERY_FAILED')),
 attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 resend_not_before timestamptz NOT NULL,
 verified_at timestamptz,
 ended_at timestamptz,
 CHECK (expires_at > created_at AND resend_not_before > created_at AND (expires_at - created_at) <= interval '10 minutes'),
 CHECK ((status IN ('PENDING_DELIVERY','PENDING') AND verified_at IS NULL AND ended_at IS NULL)
     OR (status = 'VERIFIED' AND verified_at IS NOT NULL AND ended_at IS NULL)
     OR (status IN ('LOCKED','INVALIDATED','DELIVERY_FAILED') AND verified_at IS NULL AND ended_at IS NOT NULL)),
 CHECK (attempt_count < 5 OR status = 'LOCKED'),
 CHECK (status <> 'LOCKED' OR attempt_count = 5),
 CHECK (verified_at IS NULL OR (verified_at >= created_at AND verified_at < expires_at)),
 CHECK (ended_at IS NULL OR ended_at >= created_at)
);
-- Exactly one challenge of an attempt can be live (delivered or being delivered).
CREATE UNIQUE INDEX admin_activation_otp_challenges_live_uq
 ON app.admin_activation_otp_challenges (attempt_id) WHERE status IN ('PENDING_DELIVERY','PENDING');
CREATE INDEX admin_activation_otp_challenges_attempt_idx
 ON app.admin_activation_otp_challenges (attempt_id, created_at DESC);

CREATE FUNCTION app.admin_activation_otp_challenge_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'admin activation otp challenge deletion forbidden' USING ERRCODE = '23001';
 END IF;
 IF ROW(NEW.challenge_id,NEW.attempt_id,NEW.phone_normalized,NEW.otp_digest,NEW.digest_key_id,NEW.created_at,NEW.expires_at,NEW.resend_not_before)
  IS DISTINCT FROM
    ROW(OLD.challenge_id,OLD.attempt_id,OLD.phone_normalized,OLD.otp_digest,OLD.digest_key_id,OLD.created_at,OLD.expires_at,OLD.resend_not_before) THEN
  RAISE EXCEPTION 'admin activation otp challenge identity immutable' USING ERRCODE = '23001';
 END IF;
 IF OLD.status IN ('VERIFIED','LOCKED','INVALIDATED','DELIVERY_FAILED') THEN
  RAISE EXCEPTION 'admin activation otp challenge is terminal' USING ERRCODE = '23001';
 END IF;
 IF OLD.status = 'PENDING_DELIVERY' AND NEW.status IN ('PENDING','DELIVERY_FAILED','INVALIDATED') AND NEW.attempt_count = OLD.attempt_count THEN
  RETURN NEW;
 END IF;
 IF OLD.status = 'PENDING' THEN
  IF NEW.status = 'PENDING' AND NEW.attempt_count = OLD.attempt_count + 1 AND NEW.attempt_count < 5 THEN RETURN NEW; END IF;
  IF NEW.status = 'LOCKED' AND NEW.attempt_count = OLD.attempt_count + 1 AND NEW.attempt_count = 5 THEN RETURN NEW; END IF;
  IF NEW.status IN ('VERIFIED','INVALIDATED') AND NEW.attempt_count = OLD.attempt_count THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'invalid admin activation otp challenge transition' USING ERRCODE = '23001';
END $$;
CREATE TRIGGER admin_activation_otp_challenge_transition_guard BEFORE UPDATE OR DELETE ON app.admin_activation_otp_challenges
 FOR EACH ROW EXECUTE FUNCTION app.admin_activation_otp_challenge_transition_guard();

-- The administrator that exists after COMPLETED. SYSTEM (operator bootstrap) has no profile row.
CREATE TABLE app.admin_profiles (
 user_id uuid PRIMARY KEY REFERENCES app.admin_memberships (user_id),
 invitation_id uuid NOT NULL UNIQUE REFERENCES app.admin_invitations (invitation_id),
 full_name varchar(120) NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 120),
 note varchar(1000),
 phone_verified_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL
);
CREATE TABLE app.admin_app_permissions (
 user_id uuid NOT NULL REFERENCES app.admin_memberships (user_id),
 app varchar(16) NOT NULL CHECK (app IN ('CUSTOMER','SHOP','DRIVER')),
 can_view boolean NOT NULL,
 can_review_profile boolean NOT NULL,
 can_lock boolean NOT NULL,
 PRIMARY KEY (user_id, app),
 CHECK (NOT can_review_profile OR can_view),
 CHECK (NOT can_lock OR can_view),
 CHECK (app <> 'CUSTOMER' OR NOT can_review_profile)
);
-- A profile is only valid together with at least one VIEW permission, checked at COMMIT (the permissions are inserted after it).
CREATE FUNCTION app.admin_profile_requires_view() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM app.admin_app_permissions WHERE user_id = NEW.user_id AND can_view) THEN
  RAISE EXCEPTION 'admin profile requires a VIEW permission' USING ERRCODE = '23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER admin_profile_requires_view AFTER INSERT ON app.admin_profiles
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.admin_profile_requires_view();
```

Down A:

```sql
DROP TRIGGER admin_profile_requires_view ON app.admin_profiles;
DROP FUNCTION app.admin_profile_requires_view();
DROP TABLE app.admin_app_permissions;
DROP TABLE app.admin_profiles;
DROP TRIGGER admin_activation_otp_challenge_transition_guard ON app.admin_activation_otp_challenges;
DROP FUNCTION app.admin_activation_otp_challenge_transition_guard();
DROP TABLE app.admin_activation_otp_challenges;
DROP TRIGGER admin_activation_attempt_transition_guard ON app.admin_activation_attempts;
DROP FUNCTION app.admin_activation_attempt_transition_guard();
DROP TABLE app.admin_activation_attempts;
```

### 5.2 Migration B — mở rộng kind của limiter (**bắt buộc**, OD-6)

```sql
ALTER TABLE app.admin_auth_limits DROP CONSTRAINT admin_auth_limits_kind_ck;
ALTER TABLE app.admin_auth_limits ADD CONSTRAINT admin_auth_limits_kind_ck CHECK (
 kind IN ('LOGIN_PHONE','LOGIN_IP','LOGIN_REQUEST_IP','TOTP_USER','TOTP_REQUEST_IP',
          'ACTIVATION_REQUEST_IP','ACTIVATION_LINK_IP','ACTIVATION_OTP_SEND','ACTIVATION_TOTP')
);
```

Down B (từ chối chạy nếu còn bucket `ACTIVATION_*`):

```sql
DO $$
BEGIN
 IF (SELECT count(*) FROM app.admin_auth_limits WHERE kind LIKE 'ACTIVATION\_%') > 0 THEN
  RAISE EXCEPTION 'cannot roll back admin_auth_limits kinds: activation buckets exist';
 END IF;
END
$$;
ALTER TABLE app.admin_auth_limits DROP CONSTRAINT admin_auth_limits_kind_ck;
ALTER TABLE app.admin_auth_limits ADD CONSTRAINT admin_auth_limits_kind_ck CHECK (
 kind IN ('LOGIN_PHONE','LOGIN_IP','LOGIN_REQUEST_IP','TOTP_USER','TOTP_REQUEST_IP')
);
```

### 5.3 Migration C — chốt nguồn gốc membership (**tùy chọn**, OD-4)

```sql
-- An administration membership may only belong to an operator/administration-provisioned account, never to an
-- account that registered through the apps (account_origin = 'PHONE_VERIFIED').
CREATE FUNCTION app.admin_membership_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM app.users WHERE user_id = NEW.user_id AND account_origin = 'ADMIN_PROVISIONED') THEN
  RAISE EXCEPTION 'admin membership requires an admin-provisioned account' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_membership_origin_guard BEFORE INSERT ON app.admin_memberships
 FOR EACH ROW EXECUTE FUNCTION app.admin_membership_origin_guard();
```

Down C:

```sql
DROP TRIGGER admin_membership_origin_guard ON app.admin_memberships;
DROP FUNCTION app.admin_membership_origin_guard();
```

Bật C làm 4 file test/fixture hiện chèn membership trực tiếp phải đổi sang tạo user ADMIN_PROVISIONED.

### 5.4 Kết quả kiểm DDL thực tế (cục bộ, **không phải CI**)

Chạy `PGHOST=… PGPORT=… PGUSER=… bash docs/verification/m01-d-admin-1c-ddl/run.sh` (PostgreSQL 16.x, cụm tạm, role superuser) trên mốc `tree của commit chứa script (xem head PR)`:

| Hạng mục | Kết quả thực tế |
|---|---|
| Kiểm DDL embed = file chạy | khớp từng byte (`run.sh` bước 0) |
| Migration của repo (11 file, phần Up) + 1C A, B, C | áp dụng không lỗi trên database trống |
| Kịch bản DDL | **65 PASS, 0 FAIL** (attempt A1–A21, F1a–F1k, challenge C0–C15, limiter L1–L3, origin guard M1–M3, profile/permissions P1–P6) |
| Down B khi còn bucket `ACTIVATION_*` | từ chối đúng |
| Up → Down (C, B, A) → Up | Down gỡ sạch 4 bảng 1C; Up lại đạt; 65 PASS, 0 FAIL |
| Môi trường | PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1), cụm tạm, máy phát triển. **Không phải CI.** Log đầy đủ: `docs/verification/m01-d-admin-1c-ddl/last-run.log` |

Phạm vi và giới hạn của kết quả này: chỉ kiểm DDL (CHECK, unique, FK, trigger chuyển trạng thái, Down/Up) trên database trống dựng từ chính migration của repo; **không** kiểm service, khóa đồng thời, giao dịch nhiều phiên, hay hành vi HTTP. Chạy trên máy phát triển, không có runner CI, không phải bằng chứng CI trên SHA nào. Lần kiểm này đã sửa hai kỳ vọng sai trong script v1 (A3 cũ khẳng định FK nhưng bị unique index chặn trước ⇒ nay chèn hàng ngoài index sống để thực sự thử FK; P4 cũ kỳ vọng sai mã) và chuyển các kịch bản giao dịch tường minh P1–P3 thành ca tự kiểm bằng `SET CONSTRAINTS ALL IMMEDIATE`.

## 6. API (prefix `/v1`, chỉ mount khi `ADMIN_ACTIVATION_ENABLED=true`)

### 6.1 Transport (F6)

| Hạng mục | Quy tắc |
|---|---|
| Content-Type / JSON | Mọi POST: `application/json`, thân ≤ 4 KiB. **Cú pháp JSON hỏng** ⇒ 400 chung `BAD_REQUEST` do framework trả, **trước** quota ingress (không đếm `ACTIVATION_REQUEST_IP`, không đụng DB; quyết định ChatGPT 10/10/2026). **Hình dạng/kiểu/khóa thừa sai** (JSON hợp lệ) ⇒ 400 `ADMIN_INPUT_INVALID` **sau** quota. Thân lỗi không phản chiếu input |
| Phản hồi | **Mọi** response của `/v1/admin-activation/*` (2xx, 4xx, 5xx, 429): `Cache-Control: no-store`, `Pragma: no-cache`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`. Không `ETag`/`Last-Modified`; không bao giờ trả 304 |
| CORS | Không bật. Không `Access-Control-Allow-*`. Mọi POST yêu cầu `Origin` = origin trang admin đã cấu hình (khác hoặc thiếu ⇒ 403 `ADMIN_CSRF_INVALID`, trước khi chạm DB) |
| Token lời mời | Chỉ ở thân `POST /start` (`{token}`). Liên kết gửi người dùng dạng `https://<admin-origin>/activate#t=<token>`: **fragment** không gửi lên server; SPA đọc rồi `history.replaceState` xóa ngay. Cấm query string. Thân request của route `/start` bị loại khỏi mọi log/APM/error report; token không bao giờ ghi log ở dạng gốc |
| Cookie phiên kích hoạt | `__Host-11admin-act=<base64url 32 byte ngẫu nhiên>`; `HttpOnly; Secure; SameSite=Strict; Path=/`; không `Domain`. `Max-Age` = thời gian còn lại của attempt (≤ 1800 s). Server chỉ lưu digest (`token_digest`), tra bằng unique index, so sánh hằng thời gian. Phát hành ở `start`/`restart`; **xóa** (`Max-Age=0`) khi 401 `ADMIN_ACTIVATION_SESSION_INVALID`. Khác với `__Host-11admin-pre`/`__Host-11admin`: không dùng chung và không chấp nhận thay thế |
| CSRF | Loại mới `ACTIVATION` trong `key-version.ts` (dẫn xuất cũ không đổi). Token = HMAC(khóa theo `csrf_key_id`, [ACTIVATION, attempt_id, `csrf_nonce`]). Gửi qua header `x-csrf-token` trên mọi POST trừ `start`. `start` (chưa có cookie) được bảo vệ bằng "sở hữu token lời mời" + kiểm `Origin`. Token CSRF trả trong thân `start`/`restart`/`GET state` khi cookie hợp lệ và attempt chưa ở trạng thái cuối (§6.1.1; đọc được chỉ same-origin) |
| Kiểm tiền xử lý (R0) | Tra attempt bằng digest cookie và tính lại CSRF chỉ dùng cột **bất biến** (`attempt_id`, `csrf_nonce`, `csrf_key_id`, `invitation_id`); mọi quyết định trạng thái được đọc lại **sau** khóa (§10) |
| Lỗi chuẩn | Cookie thiếu/không khớp/hết hạn ⇒ 401 `ADMIN_ACTIVATION_SESSION_INVALID`; CSRF/Origin sai ⇒ 403 `ADMIN_CSRF_INVALID`; input sai ⇒ 400 `ADMIN_INPUT_INVALID`. Quota/khóa ⇒ 429 `ADMIN_AUTH_RATE_LIMITED` kèm `Retry-After` |

### 6.1.1 Quy tắc hiệu lực cookie — **một** quy tắc cho mọi route (G3)

Cookie ánh xạ tới attempt `A` bằng digest. Tại `T` (đồng hồ DB):

1. Không có cookie, không khớp digest, hoặc `T ≥ A.expires_at` — **ở mọi trạng thái, kể cả COMPLETED và INVALIDATED** — ⇒ cookie **không hợp lệ**.
2. Cookie không hợp lệ: `GET state`, `restart`, `otp/*`, `password`, `totp/enrollment`, `complete` ⇒ 401 `ADMIN_ACTIVATION_SESSION_INVALID` (xóa cookie). `start` **không bao giờ** trả 401 vì cookie: nó bỏ qua cookie không hợp lệ và xử lý như "không có cookie" (chỉ dựa vào token).
3. Cookie hợp lệ ⇒ route xử lý theo trạng thái của `A` (§11.2). Trạng thái cuối (COMPLETED/INVALIDATED) **vẫn** là cookie hợp lệ tới `A.expires_at`.
4. CSRF chỉ do route POST yêu cầu và chỉ tính từ cột bất biến (nên kiểm được ở mọi trạng thái). `csrf_token` được trả trong `start`/`restart`/`GET state` theo **một** bảng, khi cookie hợp lệ (mục 1):

   | Trạng thái attempt | Trả `csrf_token`? | Lý do |
   |---|---|---|
   | STARTED, OTP_VERIFIED, PASSWORD_SET, TOTP_ISSUED (sống) | **Có** | còn POST bước tiếp / `restart` |
   | INVALIDATED(`ATTEMPTS_EXHAUSTED`) | **Có** | được phép `POST /restart`; tải lại trang phải lấy lại được token |
   | COMPLETED | Không | không còn hành động cần CSRF |
   | INVALIDATED(`SUPERSEDED` \| `INVITATION_CLOSED` \| `PHONE_CONFLICT`) | Không | không được `restart` |

   Client không có token ⇒ POST nhận 403 `ADMIN_CSRF_INVALID`. (`complete` lặp trên COMPLETED vẫn nhận token đã giữ từ trước; không có thì 403 — chấp nhận, vì `GET state` là đường phục hồi.) Việc `GET state` trả `csrf_token` cho ATTEMPTS_EXHAUSTED không cấp thêm quyền: `restart` vẫn phải qua cookie hợp lệ, lời mời `PENDING` và mọi cổng §6.2.

### 6.2 Danh sách route

**Dạng JSON trên dây (quyết định ChatGPT 10/10/2026, thay cho camelCase/phản hồi trần của bản duyệt trước; khớp 1A/1B).** Mọi thân thành công là `{ "data": { … } }`; khóa **snake_case**. Mọi ví dụ `{state:…}` trong tài liệu này là **nội dung của `data`**. Thân 409 `ADMIN_ACTIVATION_STEP_INVALID` mang trạng thái an toàn trong `error.details` (không phải `data`). Tên khóa: `state`, `expires_at`, `csrf_token`, `otp{status,resend_at,attempts_left}`, `password_deadline`, `restart_required`, `totp_attempts_left`, `reason`, `can_restart`, `next`, `delivery`, `displayed_code`, `otpauth_uri`, `secret`. Giá trị enum (`STARTED`, `REPLACED`…) và mã lỗi giữ nguyên.


| # | Route | Mục đích |
|---|---|---|
| 1 | `POST /admin-activation/start` `{token}` | Mở / tiếp tục / (với cookie COMPLETED) báo hoàn tất; phát cookie + CSRF |
| 2 | `GET /admin-activation/state` | Đọc trạng thái an toàn (§6.3) |
| 3 | `POST /admin-activation/otp/request` | Gửi OTP tới SĐT của lời mời (không nhận SĐT từ client) |
| 4 | `POST /admin-activation/otp/verify` `{code}` | Xác minh OTP |
| 5 | `POST /admin-activation/password` `{password}` | Tự đặt mật khẩu (chính sách độ mạnh như #34; không số mới) |
| 6 | `POST /admin-activation/totp/enrollment` | Phát hành bí mật TOTP (otpauth + base32) |
| 7 | `POST /admin-activation/complete` `{code}` | Xác nhận TOTP và kích hoạt nguyên tử |
| 8 | `POST /admin-activation/restart` (không thân; **không cần token**) | Bắt đầu lại khi cookie còn hợp lệ nhưng attempt không còn tiến được (G2) |

**Resumable (dùng cho `start`).** Attempt `A` là *resumable* khi, tại `T` và dưới khóa: `A` sống (STARTED/OTP_VERIFIED/PASSWORD_SET/TOTP_ISSUED), `T < A.expires_at`, và **không quá hạn bước**: nếu `A = OTP_VERIFIED` thì `T ≤ otp_verified_at + 600 s` (`password_deadline`). Không còn điều kiện hạn bước nào khác (PASSWORD_SET/TOTP_ISSUED chỉ bị chặn bởi hạn attempt).

**Quy tắc `start`** (token luôn bắt buộc; chi tiết giao dịch §10.1) **[ĐX — OD-14]**:

| Cookie (theo §6.1.1) | Token → lời mời | Kết quả |
|---|---|---|
| hợp lệ, cùng lời mời, `A` **resumable** | bất kỳ trạng thái lời mời | (lời mời phải `PENDING`; xem dưới) 200 tiếp tục: trả trạng thái hiện tại + csrf, **không** đổi gì |
| hợp lệ, cùng lời mời, `A` sống nhưng **không resumable** (quá `password_deadline`) | lời mời `PENDING` | tạo attempt mới (201), `A → INVALIDATED(SUPERSEDED)`, cookie mới ⇒ **không kẹt** |
| hợp lệ, cùng lời mời, `A = COMPLETED` | lời mời `ACCEPTED` (cùng `accepted_user_id`) | 200 `{state:"COMPLETED", next:"LOGIN"}`; **không ghi, không bucket nghiệp vụ, không audit nghiệp vụ** (quota ingress vẫn áp dụng) |
| hợp lệ, cùng lời mời, `A = INVALIDATED(SUPERSEDED \| ATTEMPTS_EXHAUSTED)` | `PENDING` | tạo attempt mới (201) |
| hợp lệ, cùng lời mời, `A = INVALIDATED(INVITATION_CLOSED \| PHONE_CONFLICT)` | không `PENDING` | 404 `LINK_INVALID` đồng nhất (đếm `LINK_IP`) |
| không hợp lệ hoặc khác lời mời | `PENDING`, chưa hết hạn | tạo attempt mới (201); attempt sống cũ của lời mời (nếu có) → SUPERSEDED |
| không hợp lệ hoặc khác lời mời | không khớp / không `PENDING` / hết hạn | 404 `LINK_INVALID` đồng nhất (đếm `LINK_IP`) |

Điều kiện "lời mời `PENDING`" của dòng đầu: tiếp tục chỉ khi lời mời còn `PENDING`, chưa hết hạn tại `T` và SĐT chưa thuộc `users`; ngược lại áp dụng nhánh tương ứng (404 / PHONE_CONFLICT §14).

**`restart`** [ĐX — OD-16]: dùng khi token đã bị xóa khỏi URL (fragment) nên không thể gọi lại `start`. Yêu cầu cookie hợp lệ + CSRF; `A` thuộc một trong: sống (mọi bước, kể cả quá `password_deadline`) hoặc `INVALIDATED(ATTEMPTS_EXHAUSTED)`; lời mời `PENDING`, chưa hết hạn, SĐT chưa thuộc `users`. Hiệu ứng: `A` (nếu sống) → `INVALIDATED(SUPERSEDED)`, attempt sống khác của lời mời (nếu có) → SUPERSEDED, tạo attempt mới `STARTED` với `user_id`/`factor_id`/cookie/CSRF mới; **bắt buộc OTP lại** (challenge mới, theo trần gửi OTP). **`restart` không bao giờ đọc, ghi hay reset limiter** (`ACTIVATION_LINK_IP`, `ACTIVATION_OTP_SEND`, `ACTIVATION_TOTP`): bucket `ACTIVATION_TOTP` đang khóa vẫn khóa `complete` của attempt mới tới hết thời gian khóa (người dùng phải đợi, dù đã OTP lại), và trần gửi OTP vẫn tính theo lời mời, không theo attempt. `A` ở COMPLETED, `INVALIDATED(SUPERSEDED | INVITATION_CLOSED | PHONE_CONFLICT)` ⇒ 409 `STEP_INVALID` kèm `state` (người dùng quay về đăng nhập hoặc liên hệ SYSTEM).

### 6.3 `GET /admin-activation/state` — chỉ dữ liệu không nhạy cảm (F2, G3)

Chỉ nhận cookie (không cần CSRF). Áp §6.1.1 trước: cookie không hợp lệ ⇒ 401 cho **mọi** trạng thái. Thân luôn gồm `state`, `expires_at` và `csrf_token` **chỉ** theo bảng §6.1.1 mục 4 (attempt sống hoặc `INVALIDATED(ATTEMPTS_EXHAUSTED)`). **Không bao giờ** trả: SĐT (kể cả che một phần — OD-12), họ tên, ghi chú, `user_id`, `factor_id`, quyền, mật khẩu/hash, bí mật TOTP, nội dung OTP, token lời mời.

| Trạng thái attempt (cookie hợp lệ tại `T`) | Phản hồi |
|---|---|
| STARTED | 200 `{state:"STARTED", otp:{status, resend_at?, attempts_left?}}`; `otp.status` suy từ challenge **mới nhất** (§10.3): `NONE` (không có / `INVALIDATED`), `SUBMITTED` (`PENDING_DELIVERY`/`PENDING` chưa hết hạn), `EXPIRED` (`PENDING` có `T ≥ expires_at`), `LOCKED`, `FAILED` (`DELIVERY_FAILED`) |
| OTP_VERIFIED | 200 `{state:"OTP_VERIFIED", password_deadline, restart_required}`; `restart_required = true` khi `T > password_deadline` (client gọi `restart`) |
| PASSWORD_SET | 200 `{state:"PASSWORD_SET"}` |
| TOTP_ISSUED | 200 `{state:"TOTP_ISSUED", totp_attempts_left}` — **không** trả lại bí mật (chỉ `totp/enrollment`) |
| COMPLETED (lời mời `ACCEPTED`, `accepted_user_id` = `user_id` của attempt) | 200 `{state:"COMPLETED", next:"LOGIN"}` — không thêm trường nào, không csrf |
| COMPLETED nhưng lời mời **không** `ACCEPTED` hoặc `accepted_user_id` khác | Không thể xảy ra (cùng transaction, trigger 1A). Nếu gặp: 500 + audit cảnh báo; **không** trả COMPLETED |
| INVALIDATED | 200 `{state:"INVALIDATED", reason:"REPLACED"\|"LINK_UNAVAILABLE"\|"PHONE_CONFLICT"\|"ATTEMPTS_EXHAUSTED", can_restart, csrf_token?}` (SUPERSEDED→REPLACED; INVITATION_CLOSED→LINK_UNAVAILABLE — OD-8). `csrf_token` **chỉ** khi `reason=ATTEMPTS_EXHAUSTED`; `can_restart=true` chỉ khi đó **và** lời mời còn `PENDING`, chưa hết hạn tại `T` (gợi ý, `restart` vẫn kiểm lại dưới khóa) |

`GET state` là **đọc thuần**: một câu SELECT kèm `clock_timestamp()` (ảnh chụp nhất quán), không khóa, không ghi, không audit, không đếm, không thăng cấp challenge, **không quota DB** (quyết định ChatGPT 10/10/2026; giới hạn tốc độ GET nếu cần thuộc hạ tầng, ngoài 1C). Cookie hết hạn sau COMPLETED ⇒ 401 và UI hướng dẫn "nếu đã kích hoạt, hãy đăng nhập" (OD-13). Đây là đường phục hồi chung cho mất response/unknown COMMIT (§11).

### 6.4 Đặc tả từng route

| Route | Thành công | Lỗi nghiệp vụ chính |
|---|---|---|
| start | 201 `{state, csrf_token, expires_at}` + Set-Cookie (mới); 200 (tiếp tục) hoặc 200 `{COMPLETED}` theo bảng §6.2 | không khớp / lời mời không PENDING / sai generation / `T ≥ invitation.expires_at` ⇒ **cùng** 404 `ADMIN_ACTIVATION_LINK_INVALID`; SĐT đã thuộc `users` ⇒ đóng lời mời PHONE_CONFLICT rồi 409 `ADMIN_PHONE_CONFLICT` (§14) |
| restart | 201 `{state:"STARTED", csrf_token, expires_at}` + Set-Cookie mới (cookie/CSRF cũ vô hiệu vì attempt cũ ở trạng thái cuối) | cookie ⇒ 401; trạng thái không cho phép ⇒ 409 S; lời mời đóng ⇒ 404 `LINK_INVALID`; SĐT trùng ⇒ 409 `ADMIN_PHONE_CONFLICT` |
| otp/request | 202 `{resend_at, delivery:"SUBMITTED", displayed_code?}` (`displayed_code` chỉ ở `TEST_DISPLAY`) | còn cooldown / vượt trần gửi ⇒ 429 `OTP_RATE_LIMITED`; provider từ chối ⇒ 503 `SERVICE_UNAVAILABLE`; sai bước ⇒ 409; SĐT trùng ⇒ 409 `ADMIN_PHONE_CONFLICT` |
| otp/verify | 200 `{state:"OTP_VERIFIED"}` | sai ⇒ 400 `OTP_INVALID` (commit-then-throw); hết hạn ⇒ `OTP_EXPIRED`; challenge mới nhất `LOCKED` ⇒ `OTP_RATE_LIMITED` (không ghi); chưa có OTP / `DELIVERY_FAILED` ⇒ 409; sai bước ⇒ 409 |
| password | 200 `{state:"PASSWORD_SET"}` | quá `password_deadline` ⇒ 409 `STEP_INVALID` kèm `restart_required:true`; vi phạm chính sách ⇒ 400 `ADMIN_INPUT_INVALID` |
| totp/enrollment | 200 `{state:"TOTP_ISSUED", otpauth_uri, secret}` | sai bước ⇒ 409 |
| complete | 200 `{state:"COMPLETED"}` | TOTP sai ⇒ 400 `ADMIN_TOTP_INVALID` (commit-then-throw); PHONE_CONFLICT ⇒ 409; bị khóa ⇒ 429; sai bước ⇒ 409 |

Mọi 409 `ADMIN_ACTIVATION_STEP_INVALID` kèm thân `{state:<trạng thái hiện tại an toàn như §6.3>}` để client không cần gọi thêm.

## 7. TTL và giới hạn số **[ĐX — OD-7]**

| Hạng mục | Giá trị đề xuất | Nơi ép |
|---|---|---|
| Vòng đời attempt | 30 phút | DDL chặn > 1 giờ; dịch vụ dùng `T` |
| OTP hiệu lực | 300 s | DDL chặn > 10 phút |
| Cooldown gửi lại | 60 s | `resend_not_before` |
| Sai OTP / challenge | 5 ⇒ LOCKED (cố định theo schema) | `attempt_count` (DDL) |
| Gửi OTP | 5 / giờ / lời mời | bucket `ACTIVATION_OTP_SEND` |
| Đặt mật khẩu sau khi xác minh OTP | ≤ 600 s | dịch vụ |
| Sai TOTP / attempt | 5 ⇒ INVALIDATED(ATTEMPTS_EXHAUSTED) | `totp_attempt_count` (DDL) |
| Quota ingress | 30 / 60 s / IP | `ACTIVATION_REQUEST_IP` (`reserveRequest`) |
| Sai token ở `start` | 10 / 15 phút / IP, khóa 15 phút | `ACTIVATION_LINK_IP` |
| Sai TOTP | 5 / 15 phút, khóa 15 phút | `ACTIVATION_TOTP` (định danh = `invitation_id`) |
| Hết hạn gọi provider OTP | 8 s | cấu hình, OD-15 |
| Ân hạn promote PENDING_DELIVERY | 10 s | cấu hình, OD-15 |

Bucket không bao giờ dùng SĐT làm định danh.

## 8. Limiter và bộ đếm — sự kiện × bộ đếm × cách commit

Quy tắc chung: **đồng hồ quyết định luôn là `T`** (§10.0). Bộ đếm lỗi dùng mô hình *commit-then-throw*: ghi bộ đếm, COMMIT, rồi mới ném lỗi; quota ingress là transaction riêng đã commit trước nghiệp vụ.

| Sự kiện | Bộ đếm | Commit |
|---|---|---|
| Mọi **POST**, kể cả replay, 401 và 409 (sau kiểm `Origin`, trừ JSON cú pháp hỏng bị từ chối trước quota) | `ACTIVATION_REQUEST_IP` quota | transaction riêng (R0), commit trước nghiệp vụ |
| `GET state` | **không** (đọc thuần, không quota DB; giới hạn tốc độ ở hạ tầng nằm ngoài phạm vi 1C) | — |
| Mọi 404 `LINK_INVALID` của `start` (token không khớp **và** các nhánh 404 dưới khóa) | `ACTIVATION_LINK_IP` +1 **đúng một lần** mỗi request | commit rồi ném 404. `restart` 404 **không** đếm |
| Bucket `LINK_IP` đang khóa | không đếm thêm, không tra token | commit (rỗng) rồi ném 429 (hàng bucket đã tồn tại, không đổi) |
| Gửi OTP (mỗi lần tạo challenge) | `ACTIVATION_OTP_SEND` +1 | trong txn1 |
| OTP sai | `attempt_count` +1 | commit rồi ném `OTP_INVALID` |
| OTP sai lần 5 | challenge LOCKED (cùng UPDATE) | commit rồi ném `OTP_RATE_LIMITED` |
| TOTP sai (`complete`) | `totp_attempt_count` +1 **và** `ACTIVATION_TOTP` +1 | commit rồi ném `ADMIN_TOTP_INVALID` |
| TOTP sai lần 5 | attempt INVALIDATED(ATTEMPTS_EXHAUSTED), xóa bí mật | commit rồi ném (429 nếu bucket cũng khóa) |
| `complete`: SĐT trùng | lời mời PHONE_CONFLICT + attempt INVALIDATED | commit rồi ném 409 |
| Thất bại **trước** khi mở bí mật (sai bước, hết hạn, lời mời đóng) | **không đếm gì**, không ghi gì | **ROLLBACK** (huỷ cả hàng bucket mới tạo bởi `lockBuckets`) rồi ném |
| Replay trên trạng thái cuối (`complete` lặp, `start` + cookie COMPLETED) | **không** tạo/cập nhật bucket nghiệp vụ, không audit nghiệp vụ; `ACTIVATION_REQUEST_IP` vẫn +1 ở R0 | trả từ TX-P (đọc thuần) hoặc ROLLBACK nếu phát hiện dưới khóa (§10.0) |
| `restart` thành công | không đổi bucket đếm lỗi; challenge mới sẽ tính `OTP_SEND` khi `otp/request` | cùng transaction với attempt mới |
| Thành công | không tăng; không reset bucket đang khóa | — |
| `lock_timeout` / lỗi hạ tầng trước COMMIT | không đếm | rollback hoàn toàn, 503 `SERVICE_UNAVAILABLE` |

Vì bộ đếm lỗi phải commit rồi mới ném, `IdempotencyExecutor` (rollback khi ném) không dùng cho route 4 và 7.

## 9. Hạng khóa (mở rộng L1–L10 của 1B, không đảo thứ tự cũ)

| Hạng | Đối tượng | Chế độ | Route |
|---|---|---|---|
| R0 | transport (cú pháp JSON hỏng ⇒ 400 `BAD_REQUEST` chung, **trước** quota) → `Origin` → quota IP (txn riêng đã commit) → kiểm hình dạng (`ADMIN_INPUT_INVALID`) → tiền kiểm cookie/CSRF (cột bất biến) → (password) băm argon2id ngoài transaction | không giữ khóa | mọi POST (`GET state` không qua R0, §6.3) |
| S0 | `SELECT set_config('lock_timeout', '<businessLockTimeoutMs>ms', true)` — **trước khóa đầu tiên** | — | mọi transaction nghiệp vụ |
| L2 | bucket limiter (restart, verify, password, enrollment: không dùng): `INSERT … ON CONFLICT DO NOTHING` rồi `SELECT … FOR UPDATE`; thứ tự `(kind, bucket_key)` tăng dần nếu có nhiều | X | start (LINK_IP), otp/request (OTP_SEND), complete (TOTP) |
| L3 | advisory SĐT, miền `11ship.admin-provisioning.phone.v1` (**cùng khóa với 1B**) | X | start, restart, otp/request, complete |
| L8 | `admin_invitations` | **X từ đầu** cho start, restart, otp/request, complete (mỗi route này có nhánh có thể ghi lời mời: PHONE_CONFLICT hoặc ACCEPTED); **S** chỉ cho verify, password, enrollment (không bao giờ ghi lời mời) | tất cả trừ GET |
| L9 | `admin_sensitive_operations` | 1C **không dùng** | — |
| L9a | `admin_activation_attempts` | X, mọi hàng của route (cookie attempt và attempt sống của lời mời, nếu khác nhau: thứ tự `attempt_id` tăng dần) | mọi POST; start/restart tạo thêm hàng mới ở L10 |
| L9b | `admin_activation_otp_challenges` của attempt: challenge **mới nhất** (`created_at DESC, challenge_id DESC LIMIT 1`) cho otp/request và otp/verify; challenge sống (nếu có) cho start/restart/hook khi vô hiệu | X | otp/request, otp/verify, start, restart (khi supersede) |
| L10 | hàng mới của chính transaction | — | ghi cuối |

Thứ tự đầy đủ: **R0 < S0 < L2 < L3 < L8 < L9a < L9b < L10**. Không route nào dùng L1, L4–L7, L9 (1C không có actor đã đăng nhập). Mỗi hàng bị khóa **một chế độ** trong một transaction (không bao giờ nâng S→X); route nào *có nhánh* ghi vào hàng đó lấy X từ đầu, kể cả khi nhánh ghi hiếm (G1). Hệ quả: mọi người giữ hàng attempt của lời mời `I` đều đã giữ L8(`I`) trước; vì start/restart/otp-request/complete/hook giữ **X** nên chúng loại trừ lẫn nhau và loại trừ verify/password/enrollment, nên khóa nhiều hàng attempt trong cùng một transaction không thể tạo chu trình.

**Gợi ý khóa không khóa.** Khóa L2/L3 cần `invitation_id` và SĐT trước khi khóa L8. Chúng được lấy bằng đọc thường các cột **bất biến** (`attempt.invitation_id`; `invitation.phone_normalized` bất biến theo trigger 1A; `start`: lời mời tra bằng `token_digest`, cũng bất biến). Gợi ý chỉ chọn *khóa nào*, không bao giờ quyết định nghiệp vụ: mọi điều kiện được đọc lại sau khi giữ khóa.

**Nhánh PHONE_CONFLICT (G1).** Chỉ start, restart, otp/request, complete kiểm SĐT và có thể ghi `PENDING → PHONE_CONFLICT`; cả bốn lấy L8 **X** ngay sau L3, trước mọi đọc lời mời cần quyết định. verify/password/enrollment không kiểm SĐT, không ghi lời mời nên giữ S. Không có đường nào đọc lời mời bằng `FOR SHARE` rồi `UPDATE`.

**Móc 1B `invalidateActivationFor(context, invitationId)`** (1B §8.8): chạy trong transaction của reissue/revoke khi đã giữ L3 và L8 X (và L9 nếu có); lấy L9a X rồi L9b X (nếu challenge sống) ⇒ `INVALIDATED(INVITATION_CLOSED)` / challenge `INVALIDATED`, audit cùng transaction. Thứ tự L8 < L9 < L9a < L9b nhất quán với bảng trên.

### 9.1 Khóa ẩn (FK, unique, trigger)

| Nguồn | Khóa phát sinh | Vì sao không đảo thứ tự |
|---|---|---|
| INSERT attempt: FK `(invitation_id, generation_id)` | `KEY SHARE` lời mời | đã giữ L8 X |
| INSERT challenge: FK `attempt_id` | `KEY SHARE` attempt | đã giữ L9a X |
| `complete`: INSERT `users` | unique `phone_normalized` / PK | L3 chặn mọi writer 1B/1C cùng SĐT. **Ngoại lệ:** `/auth/register` không lấy L3 ⇒ chờ nhau qua unique index (xem dưới) |
| INSERT `admin_memberships`, `admin_profiles`, `admin_app_permissions`, `admin_totp_factors` | `KEY SHARE` hàng cha **do chính transaction vừa tạo** (users/membership); profile còn `KEY SHARE` lời mời (đã giữ X) | hàng chưa commit, không ai khác khóa được |
| UPDATE lời mời → ACCEPTED (`accepted_user_id` FK) | `KEY SHARE` user mới của chính transaction | INSERT user đứng **trước** UPDATE lời mời |
| UPDATE attempt → COMPLETED | không FK nào đổi (danh tính bất biến) | — |
| Trigger deferred `admin_profile_requires_view` | SELECT permissions của chính transaction lúc COMMIT | không chờ |
| Unique live attempt/challenge | INSERT mới chờ hàng sống chưa commit | vô hiệu hàng sống (đã giữ X) **trước** khi INSERT; `23505` ⇒ lỗi nội bộ (chốt an toàn) |
| Limiter (`lockBuckets`) | chờ transaction đang tạo cùng `bucket_key` | bucket luôn là L2, trước L3 |
| `audit_logs` | không FK | ghi cuối |

**Khóa ẩn `users`: `complete` ∥ `/auth/register`.** Hai bên chỉ giao nhau ở unique SĐT trên `users`. `/auth/register` không giữ khóa admin nào và Auth Core không đổi; `complete` không giữ khóa nào mà register cần ngoài các hàng của chính nó. Không có chu trình: bên chèn sau chờ bên chèn trước commit/rollback rồi nhận `ON CONFLICT DO NOTHING` (1C) hoặc lỗi trùng sẵn có (register); `lock_timeout` giới hạn thời gian chờ.

## 10. Giao dịch từng endpoint (F4)

### 10.0 Quy tắc chung

- **`T`** = `freshClockMs(context)`, đọc **đúng một lần ngay sau khóa cuối** của transaction (không `now()`/`Date.now()` trong predicate). Mọi kiểm tra hết hạn, cooldown, TTL dùng `T`; mọi cột thời gian ghi ra dùng `T`. Nếu request phải chờ khóa lâu thì `T` đọc **sau** khi chờ xong ⇒ "expiry sau khóa" (K15–K16).
- Hết hạn là **suy ra từ `T`**, không có sweeper: attempt/lời mời quá hạn không bị ghi trạng thái, chỉ bị từ chối (ngoại lệ: `start` đưa attempt sống-quá-hạn sang SUPERSEDED để giải phóng unique index).
- Thất bại trước COMMIT ⇒ rollback toàn bộ. Chỉ các nhánh nêu ở §8 là commit-then-throw.
- Nhánh "kiểm trước, đếm sau": cổng (gate) gồm trạng thái, hạn, lời mời, bucket, `attempt_count`. **Chưa qua cổng thì không mở bí mật, không so OTP/TOTP, không đếm.**
- Mọi audit ghi cùng transaction (§15).
- **"Không ghi khi replay" nghĩa là gì (H4).** Replay/early-answer **không**: ghi hay khóa hàng `admin_auth_limits` của bucket nghiệp vụ (`ACTIVATION_LINK_IP`, `ACTIVATION_OTP_SEND`, `ACTIVATION_TOTP`), tăng counter (`attempt_count`, `totp_attempt_count`), ghi audit nghiệp vụ, hay đổi hàng attempt/challenge/lời mời/user/factor. **Quota ingress `ACTIVATION_REQUEST_IP` (R0, transaction riêng đã commit) vẫn áp dụng và vẫn đếm cho mọi POST** — kể cả replay, 401 do cookie hết hạn và 409 (`GET state` không có quota DB); đó là thiết kế, không phải ghi nghiệp vụ.
- **Từ chối thuần ⇒ ROLLBACK.** COMMIT chỉ khi có ghi phải giữ: bộ đếm lỗi (commit-then-throw), đóng PHONE_CONFLICT, chuyển trạng thái, ghi mới. Từ chối thuần (sai bước, hết hạn, lời mời đóng, replay trạng thái cuối phát hiện dưới khóa) rollback toàn bộ, kể cả hàng bucket vừa được `lockBuckets` tạo.
- **TX-P — transaction đọc phân loại trước (G3).** Với `start`, `complete` (và `otp/request` cho trạng thái "đã qua STARTED") có thể chạy trước coordinator một *transaction/câu lệnh chỉ đọc* TX-P: READ COMMITTED, **không khóa, không ghi, không audit, không bucket**, một câu SELECT kèm `clock_timestamp()`; kết thúc (commit/rollback chỉ đọc) **trước** khi coordinator bắt đầu — không giữ gì sang coordinator. **Bước 0 bắt buộc của mọi nhánh trả lời sớm (H3):** trước khi trả bất kỳ trạng thái nào, TX-P kiểm hiệu lực cookie theo §6.1.1 bằng `T` = `clock_timestamp()` của **chính câu SELECT** (`T < attempt.expires_at`, ở mọi trạng thái kể cả cuối). Không hợp lệ ⇒ 401 (riêng `start`: bỏ qua cookie, không trả lời sớm theo cookie). Không nhánh nào được trả `COMPLETED`/`409 S`/`PHONE_CONFLICT` dựa trên trạng thái attempt khi `T ≥ expires_at`. Áp cho: `start` (COMPLETED), `complete` (COMPLETED/INVALIDATED), `restart` (409 S), `otp/request` (đã qua STARTED / cuối). TX-P chỉ được **trả lời thay** coordinator cho những sự thật **bất biến/đơn điệu**: (i) attempt ở trạng thái cuối `COMPLETED`/`INVALIDATED` (trigger cấm rời trạng thái cuối); (ii) attempt đã vượt `STARTED` (trạng thái chỉ đi tới). Mọi kết luận khác (live, sắp hết hạn, lời mời PENDING…) bị **bỏ**, coordinator đọc lại hết dưới khóa. Nếu coordinator, dưới khóa, thấy trạng thái cuối mà TX-P chưa thấy (đua), nó **ROLLBACK** và trả đúng câu trả lời replay của §11.2 — không tin TX-P, không ghi bucket/audit.

### 10.1 `POST /start`

1. R0: (JSON hỏng đã bị 400 chung trước quota) Origin; `reserveRequest(ACTIVATION_REQUEST_IP)`; kiểm hình dạng; digest token; digest cookie nếu có.
2. TX-P (đọc thuần, bước 0 §10.0: cookie hợp lệ theo giờ DB): lời mời theo `token_digest` (gợi ý `invitation_id`, SĐT, trạng thái) và attempt theo cookie. Nếu cookie hợp lệ → attempt `COMPLETED` **và** `attempt.invitation_id` = lời mời của token ⇒ trả 200 `{COMPLETED, next:"LOGIN"}` ngay: **không** bucket, không audit, không ghi (sự thật bất biến). Nếu cookie → attempt cuối khác hoặc hết hạn: bỏ qua cookie, tiếp tục. Mọi thứ còn lại bỏ, coordinator đọc lại.
3. Coordinator: S0 → L2 `ACTIVATION_LINK_IP` X. Đang khóa ⇒ commit rỗng, 429.
4. Token **không khớp** (không có gợi ý) ⇒ `recordFailure(LINK_IP)`, commit, 404 (không có L3).
5. Có gợi ý: L3 SĐT → L8 lời mời **X** (G1) → L9a: attempt của cookie (nếu hợp lệ & cùng lời mời) và attempt sống của lời mời, `FOR UPDATE`, thứ tự `attempt_id` tăng dần → `T`.
6. Kiểm dưới khóa: nếu attempt của cookie nay `COMPLETED` (đua) ⇒ ROLLBACK, 200 COMPLETED như bước 2. Lời mời phải `PENDING`, `generation_id` khớp, `T < invitation.expires_at`; sai ⇒ `recordFailure(LINK_IP)`, commit, 404 `LINK_INVALID`. **Mỗi request `start` kết thúc 404 đếm `LINK_IP` đúng một lần** (bước 4 hoặc bước này, không bao giờ cả hai). SĐT đã thuộc `users` ⇒ §14 (ghi dưới X đã giữ, không nâng khóa).
7. Quyết định theo bảng §6.2: *resumable* ⇒ trả trạng thái (200); không ghi, không audit ⇒ ROLLBACK. Ngược lại: mọi attempt sống của lời mời → `INVALIDATED(SUPERSEDED)` (CAS, kèm challenge sống); INSERT attempt mới (`user_id`, `factor_id` ngẫu nhiên; `expires_at = T + 30 phút`, không vượt `invitation.expires_at` — OD-7); audit; commit; phát cookie.

### 10.1A `POST /restart` (G2)

1. R0: Origin; CSRF (cột bất biến); `reserveRequest(ACTIVATION_REQUEST_IP)`; tra attempt theo cookie.
2. TX-P (bước 0 §10.0): cookie không hợp lệ theo giờ DB (§6.1.1) ⇒ 401; chỉ khi hợp lệ: attempt `COMPLETED` hoặc `INVALIDATED` với lý do ≠ `ATTEMPTS_EXHAUSTED` ⇒ 409 S (sự thật bất biến), không khóa.
3. Coordinator: S0 → L3 SĐT → L8 lời mời **X** → L9a attempt của cookie và attempt sống của lời mời (`attempt_id` tăng dần) → `T`. (Không L2: không đếm lỗi nào.)
4. Kiểm dưới khóa: cookie còn hợp lệ tại `T`; trạng thái thuộc tập cho phép (§6.2); lời mời `PENDING`, `T < invitation.expires_at`; SĐT chưa thuộc `users` (có ⇒ §14).
5. Mọi attempt sống → `INVALIDATED(SUPERSEDED)` (kèm challenge sống → `INVALIDATED`); INSERT attempt mới; audit; commit; phát cookie mới (cookie cũ hết tác dụng vì attempt cũ cuối hoặc hết hạn).

Kết quả: sau `password_deadline`, UI (đọc `restart_required`) gọi `restart` mà không cần token ⇒ `STARTED`, OTP mới ⇒ hoàn tất được (K24).

### 10.2 `POST /otp/request`

TX-P (bước 0 §10.0 trước): cookie không hợp lệ theo giờ DB ⇒ 401; chỉ khi cookie hợp lệ và attempt đã vượt `STARTED` hoặc ở trạng thái cuối ⇒ 409 S ngay (sự thật đơn điệu), không bucket.
Txn1: S0 → L2 `ACTIVATION_OTP_SEND` → L3 SĐT → L8 lời mời **X** (G1: nhánh PHONE_CONFLICT có thể ghi lời mời) → L9a attempt X → L9b challenge **mới nhất** của attempt X → `T`.
Cổng: attempt `STARTED` và `T < expires_at`; lời mời `PENDING` và `T < invitation.expires_at`; cooldown (áp khi challenge mới nhất **không** ở `DELIVERY_FAILED`): `resend_not_before > T` ⇒ 429 `OTP_RATE_LIMITED` (không đếm thêm); bucket `OTP_SEND` khóa/vượt trần ⇒ 429; SĐT chưa thuộc `users` (nếu có ⇒ §14, ghi dưới X đã giữ). Sai bước dưới khóa ⇒ ROLLBACK (không để lại hàng bucket).
Ghi: challenge sống cũ (kể cả `PENDING_DELIVERY`) ⇒ `INVALIDATED`; INSERT challenge mới `PENDING_DELIVERY` (digest HMAC; `expires_at = T+300s`, `resend_not_before = T+60s`); `recordSend(OTP_SEND)`; audit; **commit (txn1)**.
Ngoài transaction: gọi provider với timeout cứng (§13).
Txn2 (S0 → L9b challenge mới X): CAS theo kết quả provider (§13). Không lấy L2/L3/L8/L9a (tập con của thứ tự).

### 10.3 `POST /otp/verify` (G4)

Txn: S0 → L8 lời mời **S** (route không bao giờ ghi lời mời) → L9a attempt X → L9b challenge **mới nhất** X → `T`.

Challenge được chọn bằng `SELECT … WHERE attempt_id = $1 ORDER BY created_at DESC, challenge_id DESC LIMIT 1 FOR UPDATE` — **mới nhất theo mọi trạng thái**, không lọc "sống". (Truy vấn chỉ-lấy-sống sẽ không phân biệt được "đã khóa", "gửi lỗi", "chưa gửi".)

Cổng 1 (theo thứ tự, hỏng ⇒ ROLLBACK, không đếm): attempt trạng thái đúng (§11.2) và `T < expires_at`; lời mời `PENDING` và `T < invitation.expires_at`.

Cổng 2 — phân loại challenge mới nhất (không đếm, không ghi trừ promote):

| Challenge mới nhất | Kết quả |
|---|---|
| không có | 409 `STEP_INVALID` `{state:STARTED, otp:NONE}` |
| `PENDING_DELIVERY`, `T < created_at + grace` | 409 `STEP_INVALID` (đang giao) |
| `PENDING_DELIVERY`, `T ≥ created_at + grace` | promote lên `PENDING` (audit `OTP_DELIVERY_PROMOTED`) rồi xử lý như `PENDING` |
| `PENDING`, `T ≥ expires_at` | 400 `OTP_EXPIRED` |
| `PENDING`, chưa hết hạn | **so digest** (dưới) |
| `LOCKED` (đã sai lần thứ 5) | 429 `OTP_RATE_LIMITED`; **không** so mã, **không** đổi `attempt_count`, không audit; người dùng phải `otp/request` (sau cooldown) |
| `DELIVERY_FAILED` | 409 `STEP_INVALID` `{otp:FAILED}` |
| `INVALIDATED` | 409 `STEP_INVALID` `{otp:NONE}` (challenge mới nhất đã bị thay/đóng) |
| `VERIFIED` khi attempt vẫn `STARTED` | không thể xảy ra (cùng transaction); nếu gặp: 500 + audit cảnh báo |

So digest (hằng thời gian):
- Sai ⇒ `attempt_count + 1` (lần 5 ⇒ `LOCKED` cùng UPDATE); audit; **commit**; ném `OTP_INVALID` (lần 5: `OTP_RATE_LIMITED`).
- Đúng ⇒ challenge `VERIFIED` (`verified_at = T`); attempt `OTP_VERIFIED` (`otp_verified_at = T`); audit; commit.

### 10.4 `POST /password`

R0: tiền kiểm đọc thường (cookie, trạng thái `OTP_VERIFIED`, chưa hết hạn) rồi kiểm chính sách mật khẩu và **băm argon2id ngoài transaction**; cổng thất bại thì không tốn băm.
Txn: S0 → L8 S → L9a X → `T`. Cổng: trạng thái `OTP_VERIFIED`; `T < expires_at`; `T ≤ otp_verified_at + 600 s` (quá hạn ⇒ ROLLBACK, 409 `STEP_INVALID` kèm `restart_required:true`); lời mời `PENDING` & chưa hết hạn tại `T`. Ghi: attempt `PASSWORD_SET` (`password_hash`, `password_set_at = T`); audit; commit. Mật khẩu/hash không vào audit/log.

### 10.5 `POST /totp/enrollment`

R0: sinh bí mật 20 byte ngẫu nhiên (rẻ) trước transaction.
Txn: S0 → L8 S → L9a X → `T`. Cổng: trạng thái `PASSWORD_SET` (hoặc `TOTP_ISSUED` ⇒ nhánh "phát lại" bên dưới); `T < expires_at`; lời mời `PENDING`.
- `PASSWORD_SET`: niêm phong bí mật với AAD (`user_id`, `factor_id`, version 1); attempt `TOTP_ISSUED` (`totp_*`, `totp_issued_at = T`); audit; commit; trả `otpauth_uri` + `secret`.
- `TOTP_ISSUED`: mở lại **cùng** bí mật và trả lại (không phát hành mới, không ghi, không đếm). Chỉ route này trả bí mật; chỉ trong lúc attempt `TOTP_ISSUED` còn hạn.

### 10.6 `POST /complete` — kích hoạt nguyên tử

R0: Origin; CSRF; shape mã 6 chữ số; `reserveRequest`.
TX-P (đọc thuần, bước 0 §10.0): cookie không hợp lệ theo giờ DB ⇒ 401; chỉ khi hợp lệ: attempt `COMPLETED` ⇒ 200 `{COMPLETED}`; `INVALIDATED(PHONE_CONFLICT)` ⇒ 409 `ADMIN_PHONE_CONFLICT`; `INVALIDATED` khác ⇒ 409 S. **Repeat complete kết thúc ở đây: không L2 (không tạo/cập nhật bucket), không audit, không ghi, không so TOTP.** Còn lại → coordinator.
Coordinator (txn đơn, **không** executor): S0 → L2 `ACTIVATION_TOTP` (theo `invitation_id` gợi ý) → L3 SĐT → L8 lời mời **X** → L9a attempt X → `T`.
**Cổng** (theo thứ tự; hỏng ở đây ⇒ ROLLBACK, **không đếm, không mở bí mật**; riêng bucket đang khóa ⇒ commit rỗng + 429):
1. Attempt `COMPLETED` (đua với complete khác) ⇒ **ROLLBACK** (huỷ hàng bucket nếu mới tạo), 200 `{COMPLETED}` — không so mã, không ghi, không audit.
2. Attempt `INVALIDATED` ⇒ ROLLBACK, §11.2.
3. Cookie còn hợp lệ (`T < expires_at`; sai ⇒ 401) và attempt `TOTP_ISSUED` (khác ⇒ 409 `STEP_INVALID`).
4. Lời mời `PENDING`, `generation_id` khớp, `T < invitation.expires_at` (sai ⇒ 404 `LINK_INVALID`).
5. Bucket `ACTIVATION_TOTP` không khóa tại `T` (khóa ⇒ 429, không đếm).
6. `totp_attempt_count < 5` (bảo đảm bởi DDL).
7. **Pre-check SĐT:** SĐT đã thuộc `users` (đọc dưới L3) ⇒ §14, không mở bí mật.

**TOTP trước khi có factor.** Chưa có hàng `admin_totp_factors` ⇒ không có L6, không có `last_accepted_step`. Bí mật lấy từ attempt (AAD `user_id`, `factor_id`, version 1), `matchTotp(secret, code, T/1000, null)` (cửa sổ `{step(T), step(T)−1}`). Đếm sai nằm ở **attempt + bucket `ACTIVATION_TOTP`**, không ở factor. Step khớp trở thành `last_accepted_step` của factor mới; vì factor chỉ tồn tại sau COMMIT nên một `complete` lỗi/rollback **không đốt** mã (client gửi lại cùng mã trong cửa sổ vẫn dùng được).

**Sai** ⇒ `totp_attempt_count + 1` (lần 5 ⇒ `INVALIDATED(ATTEMPTS_EXHAUSTED)`, xóa `password_hash` & bí mật cùng UPDATE), `recordFailure(ACTIVATION_TOTP)`, audit; **commit**; ném `ADMIN_TOTP_INVALID` (hoặc 429).
**Đúng** (cùng transaction, thứ tự ghi cố định):
1. `INSERT users … ON CONFLICT DO NOTHING RETURNING` qua `insertProvisioned` (`user_id` của attempt, `password_hash` của attempt, `phone_verified_at` NULL, `ADMIN_PROVISIONED`). 0 hàng ⇒ §14. **INSERT này có thể chờ** unique `users.phone_normalized` (register đang giữ). Vì vậy sau INSERT, `complete` **đọc lại giờ DB** (`doneMs`) và kiểm lại: `doneMs ≥ attempt.expires_at` ⇒ 401 `SESSION_INVALID`; `doneMs ≥ invitation.expires_at` ⇒ 404 `LINK_INVALID`; cả hai ⇒ ROLLBACK toàn bộ hàng vừa tạo (user, membership, profile, permission, factor chưa có). Các ghi sau đó dùng `doneMs`, không dùng `T` cũ. Test K30.
2. `admin_memberships` (ADMIN, ACTIVE, version 1).
3. `admin_profiles` (`phone_verified_at = attempt.otp_verified_at` — OD-3).
4. `admin_app_permissions` sao chép từ snapshot lời mời.
5. `admin_totp_factors` ACTIVE: `factor_id` của attempt, bí mật niêm phong **sao chép nguyên**, `last_accepted_step` = step khớp. Factor và user được tạo **cùng transaction, từ cùng một attempt**; mật khẩu nằm ở `users.password_hash`. **Không thêm cột ràng buộc mật khẩu** vào bảng factor (quyết định ChatGPT 10/10/2026).
6. Lời mời `PENDING → ACCEPTED` (`accepted_user_id`, CAS version, qua participant 1A).
7. Attempt `TOTP_ISSUED → COMPLETED` (`completed_at = T`; xóa `password_hash` và bí mật).
8. Audit (actor `USER` = user mới); commit.

Không tạo session đăng nhập (OD-2). Mọi thất bại trước COMMIT ⇒ không có user nửa vời.

### 10.7 `GET /state`

Đọc thuần (§6.3): không khóa, không ghi, không quota DB. Là đường phục hồi duy nhất cần thiết cho mọi route.

## 11. Idempotency, replay và phục hồi (F5)

### 11.1 Cơ chế — và vì sao "không dùng executor" chưa phải idempotency

Không có `Idempotency-Key`, không có `idempotency_records`. Bất biến duy nhất là **máy trạng thái của attempt + CAS**. Điều đó **chỉ** cho tính idempotent ở những route mà việc gọi lại có kết quả xác định theo trạng thái (verify/password/enrollment/complete); các route khác **không** idempotent và phục hồi bằng quy tắc riêng:

| Route | Idempotent? | Lý do / phục hồi |
|---|---|---|
| start | **Không** (mỗi lần gọi không-cookie tạo attempt mới) | Có quy tắc tiếp tục khi còn cookie hợp lệ (§6.2); mất cookie ⇒ attempt cũ bị thay, tiến trình mất — chấp nhận, bắt đầu lại |
| restart | **Không** (mỗi lần thành công tạo attempt mới) | Sau thành công attempt cũ ở trạng thái cuối nên gọi lại ⇒ 401/409 theo §11.2; phục hồi bằng `GET state` rồi tiếp tục với cookie mới nếu có, hoặc dùng lại liên kết (`start`) |
| otp/request | **Không** (mỗi lần có thể gửi SMS) | Chặn bằng cooldown + trần; không tự gửi lại (§13) |
| otp/verify | Có theo trạng thái | Lặp ⇒ 409 kèm `state` (không so lại mã) |
| password | Có theo trạng thái | Lặp ⇒ 409 kèm `state` (không so lại/ghi đè) |
| totp/enrollment | Có (phát lại cùng bí mật) | Chỉ khi `TOTP_ISSUED` |
| complete | Có (kết quả cuối cố định) | `COMPLETED` ⇒ 200 |

### 11.2 Ma trận route × trạng thái attempt (tại `T`, sau khóa)

Quy ước: "—" = không ghi counter, không audit nghiệp vụ, **không tạo/cập nhật bucket nghiệp vụ**, không đổi hàng nghiệp vụ; quota ingress `ACTIVATION_REQUEST_IP` **vẫn áp dụng** như mọi POST (§10.0, H4). **Ngoại lệ có chủ đích:** các ô `start` ⇒ 404 `LINK_INVALID` đếm `ACTIVATION_LINK_IP` +1 đúng một lần (§8); `GET state` không có quota DB. "S" = kèm `{state}` an toàn (§6.3). **Hàng 0 áp trước mọi cột (§6.1.1):** cookie không hợp lệ hoặc `T ≥ expires_at` ở *mọi* trạng thái (kể cả COMPLETED/INVALIDATED) ⇒ 401 `SESSION_INVALID`, ngoại trừ `start` (bỏ qua cookie).

| Route \ Trạng thái | STARTED | OTP_VERIFIED | PASSWORD_SET | TOTP_ISSUED | COMPLETED | INVALIDATED |
|---|---|---|---|---|---|---|
| 0. cookie hết hạn/sai | 401 | 401 | 401 | 401 | 401 | 401 |
| verify | xử lý (§10.3) | 409 S — | 409 S — | 409 S — | 409 S — | 409 S — |
| password | 409 S — | xử lý (§10.4); quá deadline ⇒ 409 S+`restart_required` — | 409 S — | 409 S — | 409 S — | 409 S — |
| enrollment | 409 S — | 409 S — | xử lý (§10.5) | **200 phát lại cùng bí mật** — | 409 S — | 409 S — |
| complete | 409 S — | 409 S — | 409 S — | xử lý (§10.6) | **200 `{COMPLETED}` — (TX-P)** | 409 `ADMIN_PHONE_CONFLICT` nếu lý do PHONE_CONFLICT (TX-P); ngược lại 409 S — |
| otp/request | xử lý (§10.2) | 409 S — | 409 S — | 409 S — | 409 S — | 409 S — |
| restart | xử lý (§10.1A) | xử lý (supersede) | xử lý (supersede) | xử lý (supersede) | 409 S — | `ATTEMPTS_EXHAUSTED`: xử lý; khác: 409 S — |
| start (token + cookie hợp lệ cùng lời mời) | 200 tiếp tục — | resumable: 200 tiếp tục —; **quá deadline: attempt mới (201)** | 200 tiếp tục — | 200 tiếp tục — | **200 `{COMPLETED}` — (TX-P)** | `SUPERSEDED`/`ATTEMPTS_EXHAUSTED`: attempt mới (201); `INVITATION_CLOSED`/`PHONE_CONFLICT`: 404 `LINK_INVALID` |
| start (cookie không hợp lệ/hết hạn/khác lời mời) | theo token: lời mời `PENDING` ⇒ attempt mới (201), ngược lại 404 `LINK_INVALID` (cookie bị bỏ qua) | cùng | cùng | cùng | cùng (`ACCEPTED` ⇒ 404 `LINK_INVALID`) | cùng |
| GET state | §6.3 | §6.3 (+`restart_required`) | §6.3 | §6.3 | §6.3 (`COMPLETED`, `next:LOGIN`) | §6.3 (+`can_restart`) |

Ghi chú: (a) "409 S —" của verify/password sau khi bước đã xong **không so lại mã/mật khẩu và không đếm** (kể cả `attempt_count` của challenge đã `VERIFIED`). (b) `complete` lặp trên `COMPLETED` chỉ kiểm hình dạng đầu vào (6 chữ số) rồi trả 200 từ TX-P; **không** mở bí mật (đã xóa), không so TOTP, không tăng `totp_attempt_count`, **không đụng `ACTIVATION_TOTP` (kể cả khi bucket đang khóa — vẫn 200)**, không audit. (c) `start` + cookie `COMPLETED` cần token **khớp đúng lời mời** của attempt; token khác ⇒ như cookie "khác lời mời". (d) `start`/`restart`/`otp/request` kiểm SĐT trùng ở mọi nhánh *ghi* (§14). (e) INVALIDATED mà lời mời không còn `PENDING` ⇒ `start` không bao giờ tạo attempt mới.

### 11.3 Phục hồi mất response / unknown COMMIT — cụ thể từng route

Nguyên tắc: **không bao giờ tự thử lại mù** một giao dịch có thể đã COMMIT; đọc lại trạng thái bằng `GET state` (cookie còn hiệu lực) hoặc gọi lại route theo bảng.

| Route | Mất response (đã commit) | `TRANSACTION_OUTCOME_UNKNOWN` | Ghi chú |
|---|---|---|---|
| start | Gọi lại `start` với cùng token: nếu cookie đã nhận được ⇒ tiếp tục (200); nếu mất cookie ⇒ attempt mới (201), attempt cũ SUPERSEDED | Như mất response | Tiến trình cũ mất; hàng mồ côi tự hết hạn |
| restart | `GET state` với cookie cũ ⇒ 401 (attempt cũ đã cuối/hết hạn) hoặc `INVALIDATED(REPLACED)`; cookie mới nếu đã nhận ⇒ `STARTED`. Mất cookie mới ⇒ dùng lại liên kết (`start`, token vẫn hợp lệ nếu lời mời còn `PENDING`) | Như mất response (không có ghi một phần: attempt cũ SUPERSEDED + mới INSERT cùng transaction) | Trạng thái mất, bắt đầu lại |
| otp/request | `GET state`: `otp.status="SUBMITTED"` + `resend_at` ⇒ chờ SMS, **không** bấm gửi lại trước `resend_at`. Nếu `TEST_DISPLAY` mà mất `displayed_code` ⇒ chờ `resend_at` rồi gửi lại | txn1 unknown: provider **chưa** được gọi (gọi sau commit nhưng lỗi trả về trước đó) ⇒ `GET state`: nếu chưa có challenge ⇒ gọi lại; có ⇒ chờ `resend_at`. txn2 unknown: SMS có thể đã gửi; challenge là `PENDING_DELIVERY` hoặc `PENDING`; lazy promote ở lần verify kế (§13) | Xem §13 |
| otp/verify | `GET state`: `OTP_VERIFIED` ⇒ sang bước sau; còn `STARTED` ⇒ nhập lại mã (mã vẫn đúng/sai theo challenge) | Như trên. Sai-OTP đã commit nên `attempt_count` có thể đã +1 dù client không thấy lỗi: `GET state.otp.attempts_left` cho biết | |
| password | `GET state`: `PASSWORD_SET` ⇒ sang enrollment (không gửi lại mật khẩu); còn `OTP_VERIFIED` ⇒ gửi lại | Như trên | Hash đã băm lại là rẻ; không so với hash cũ |
| enrollment | Gọi lại: `TOTP_ISSUED` ⇒ nhận lại **cùng** bí mật | Như mất response | Không có rủi ro lộ thêm: chỉ cookie hợp lệ |
| complete | `GET state`: `COMPLETED` ⇒ chuyển sang đăng nhập; gọi lại `complete` cũng cho 200 | Như mất response. Nếu `GET state` cho `TOTP_ISSUED` ⇒ chưa commit ⇒ có thể gửi lại cùng mã **nếu** còn trong cửa sổ (mã chưa bị đốt), hoặc mã mới | TOTP sai đã commit có thể đã +1: `totp_attempts_left` |
| mọi route: cookie đã hết hạn (**ở mọi trạng thái**, kể cả COMPLETED) | 401 ⇒ không thể đọc trạng thái: UI hướng dẫn "đã kích hoạt thì đăng nhập; chưa thì dùng lại liên kết" (OD-13) | | Đăng nhập (#34) luôn là nguồn sự thật cuối cùng |

`TRANSACTION_OUTCOME_UNKNOWN` được `TransactionManager` ném khi COMMIT timeout/ack muộn; 1C không bắt hay thử lại nó, chỉ chuyển cho client cùng chỉ dẫn `GET state`.

## 12. TOTP khi chưa có factor (tóm tắt)

Xem §10.6 "TOTP trước khi có factor". Tóm tắt luật: (1) cổng trước, bí mật sau; (2) bí mật nằm trong attempt; (3) đếm sai ở attempt + bucket, commit-then-throw; (4) khớp ⇒ step trở thành `last_accepted_step` của factor mới; (5) rollback ⇒ mã không bị đốt.

## 13. OTP — giao, phục hồi và quy tắc "không gửi lại mù" (F3)

Bảng riêng `admin_activation_otp_challenges` (không dùng bảng Auth), purpose `ADMIN_ACTIVATION`, subkey Keyring `adminActivationOtp`; digest = HMAC theo [miền, `challenge_id`, SĐT, purpose, otp]. Cổng provider (port) trả `{ outcome: 'ACCEPTED' | 'REJECTED' | 'UNKNOWN', displayed_code? }`; **mọi** ngoại lệ, timeout (`ADMIN_ACTIVATION_OTP_PROVIDER_TIMEOUT_MS`, 8 s, OD-15) hoặc kết quả không rõ ánh xạ thành `UNKNOWN`. Chế độ: `FAKE` (kiểm thử); `TEST_DISPLAY` (chỉ non-production, `displayed_code` trả về client, **không bao giờ ghi log**); `SMS` (sau M01-C; thiếu provider ⇒ staging/production không khởi động).

### 13.1 Máy trạng thái giao

```
PENDING_DELIVERY --ACCEPTED/UNKNOWN--> PENDING --verify đúng--> VERIFIED
        |                                |--sai--> PENDING (+1) --5--> LOCKED
        |--REJECTED--> DELIVERY_FAILED   |--resend--> INVALIDATED
        |--resend (sau cooldown)--> INVALIDATED
```

### 13.2 Kết quả provider → txn2

| Kết quả | Hành động txn2 | Phản hồi `otp/request` |
|---|---|---|
| `ACCEPTED` | CAS `PENDING_DELIVERY→PENDING` | 202 `delivery:"SUBMITTED"` |
| `UNKNOWN` (timeout/ngoại lệ) | CAS `PENDING_DELIVERY→PENDING` + audit `OTP_DELIVERY_UNKNOWN`. SMS **có thể** đã đến ⇒ giữ challenge dùng được; **không** gửi lại | 202 `delivery:"SUBMITTED"` (không khẳng định đã gửi); UI: "nếu chưa nhận được sau `resend_at`, hãy gửi lại" |
| `REJECTED` (từ chối rõ ràng) | CAS `PENDING_DELIVERY→DELIVERY_FAILED` (`ended_at = T`) ; vẫn tính vào trần gửi giờ | 503 `SERVICE_UNAVAILABLE`; cooldown **không** áp cho challenge `DELIVERY_FAILED` ngoài trần giờ |
| CAS 0 hàng | challenge đã đổi (ví dụ đã được promote hoặc bị thay): bỏ qua, không ghi đè, audit cảnh báo | theo trạng thái hiện tại |

### 13.3 Phục hồi các ca lỗi

| Ca | Hệ quả | Phục hồi (không gửi lại mù) |
|---|---|---|
| Chết/cắt kết nối **giữa txn1 và lúc gọi provider** | challenge `PENDING_DELIVERY`, SMS **chưa** gửi | Không tự gì. `GET state`: `otp.status="SUBMITTED"` + `resend_at`. Sau `resend_at` người dùng chủ động gửi lại ⇒ challenge cũ `INVALIDATED`. Lazy promote (dưới) chỉ làm mã cũ dùng được nếu nó thực sự được gửi |
| Provider timeout | `UNKNOWN` ⇒ như bảng §13.2 | Chờ `resend_at`; không retry nội bộ |
| txn2 lỗi/unknown COMMIT sau khi provider `ACCEPTED` | challenge vẫn `PENDING_DELIVERY` dù SMS đã đến | **Lazy promote**: `otp/verify` giữ L9b X; nếu thấy `PENDING_DELIVERY` và `T ≥ created_at + grace (10 s)` ⇒ thăng lên `PENDING` (audit `OTP_DELIVERY_PROMOTED`) rồi so mã bình thường. Trong ân hạn ⇒ 409 `STEP_INVALID` không đếm. txn2 đến sau thấy 0 hàng (CAS) ⇒ bỏ qua |
| Gửi lại khi challenge cũ chưa rõ | Mã cũ có thể đến muộn | `otp/request` mới (sau cooldown) làm challenge cũ `INVALIDATED` trong txn1: mã cũ đến muộn **không còn hiệu lực**; nhập mã cũ vào challenge mới là một lần sai (+1) — chấp nhận, ghi trong UI |
| "Callback đến muộn" (DLR/webhook, nếu provider tương lai có) | Không có trong 1C | **Ngoài phạm vi.** Cổng provider hiện là gọi-trả-lời; DLR webhook cần hợp đồng riêng (xác thực chữ ký, idempotent theo `challenge_id`, không bao giờ đổi `VERIFIED/LOCKED/INVALIDATED`). Trong 1C, "đến muộn" chỉ có nghĩa là SMS đến sau timeout (ca `UNKNOWN`), đã xử lý ở trên |
| Client retry `otp/request` trong cooldown (do mất response) | Có thể nhân đôi SMS | Bị chặn bởi cooldown (429 `OTP_RATE_LIMITED`); `GET state` cho biết `resend_at`. Không có đường gửi lại ngầm |

Quy tắc cấm: không có vòng retry gọi provider, không có job nền tự gửi lại, không có gửi lại do `GET`/`verify`. Mọi lần gửi đều do một `otp/request` tường minh đã qua cooldown và trần.

## 14. PHONE_CONFLICT

Phát hiện ở `start`, `otp/request` (kiểm sớm) và `complete` (quyết định, dưới L3, **trước** khi mở bí mật).

- Điều kiện: SĐT lời mời đã thuộc `users` khác. Nhánh này chạy trong start, restart, otp/request, complete — cả bốn đã giữ L3 và L8 **X** từ đầu (G1), nên ghi lời mời không phải nâng khóa.
- Hiệu ứng trong **một** transaction: lời mời PENDING → PHONE_CONFLICT (CAS), attempt sống → `INVALIDATED(PHONE_CONFLICT)` (và challenge sống → INVALIDATED), audit; **COMMIT**; rồi ném 409 `ADMIN_PHONE_CONFLICT` (commit-then-throw). Thân lỗi không nêu danh tính tài khoản trùng.
- Lặp lại: attempt đã INVALIDATED(PHONE_CONFLICT) ⇒ `complete` trả lại đúng 409 này (§11.2); `GET state` ⇒ `reason:"PHONE_CONFLICT"`.
- Race với `/auth/register` cùng SĐT: unique SĐT quyết định. Nếu register thắng sau pre-check, `INSERT … ON CONFLICT DO NOTHING` trả 0 hàng ⇒ cùng đường đóng + 409 (TOTP đúng không bị tính/ghi vì chưa có factor). Nếu `complete` thắng, register nhận lỗi trùng SĐT sẵn có. Auth Core không đổi.
- Không có bản ghi nửa vời: user/membership/profile/permissions/factor chỉ được ghi sau khi INSERT users thành công, cùng transaction.
- SYSTEM tạo lời mời mới sau khi xử lý nghiệp vụ (ngoài 1C).

## 15. Audit

Cùng transaction với mutation; lỗi audit ⇒ rollback. Actor `ANONYMOUS` trước kích hoạt, `USER` (user mới) cho sự kiện `complete`. Ghi: mọi chuyển trạng thái attempt, tạo/thay/khóa/xác minh/promote challenge, `OTP_DELIVERY_UNKNOWN`, TOTP sai, PHONE_CONFLICT, kích hoạt, SUPERSEDED/INVITATION_CLOSED (kể cả từ móc 1B). **Cấm** ghi OTP, mật khẩu, hash, bí mật TOTP, token (lời mời/cookie/CSRF), SĐT, `displayed_code`. Route chỉ-đọc và nhánh replay không ghi audit.

## 16. Mã lỗi mới và cấu hình

Mới: `ADMIN_ACTIVATION_LINK_INVALID` (404), `ADMIN_ACTIVATION_SESSION_INVALID` (401), `ADMIN_ACTIVATION_STEP_INVALID` (409). Dùng lại (đã có trong `app-errors.ts`): `OTP_INVALID`, `OTP_EXPIRED`, `OTP_RATE_LIMITED`, `ADMIN_TOTP_INVALID`, `ADMIN_AUTH_RATE_LIMITED`, `ADMIN_PHONE_CONFLICT`, `ADMIN_CSRF_INVALID`, `ADMIN_INPUT_INVALID`, `SERVICE_UNAVAILABLE`, `TRANSACTION_OUTCOME_UNKNOWN`. Thông điệp cố định, không phản chiếu input.

Cấu hình **[ĐX — OD-9]**: `ADMIN_ACTIVATION_ENABLED` (mặc định false; yêu cầu `ADMIN_AUTH_ENABLED`), `ADMIN_ACTIVATION_OTP_MODE` (`FAKE|TEST_DISPLAY|SMS`), `ADMIN_ACTIVATION_OTP_PROVIDER_TIMEOUT_MS`, `ADMIN_ACTIVATION_OTP_PROMOTE_GRACE_MS`, các TTL/ngưỡng §7, `ADMIN_ACTIVATION_ORIGIN`. Mặc định như §7, ép trần theo CHECK DB.

**Cấu hình TTL/ngưỡng §7 — đã triển khai (PR #45); tên biến và miền hợp lệ CHỜ ChatGPT/Owner xác nhận, KHÔNG phải giá trị Owner đã duyệt.** Mặc định = đúng §7. Mọi biến là số nguyên dương; ngoài miền hoặc không phải số nguyên ⇒ khởi động thất bại (không fallback).

| Biến (`ADMIN_ACTIVATION_…`) | Mặc định (§7) | Miền triển khai | Nguồn trần |
|---|---|---|---|
| `ATTEMPT_TTL_SECONDS` | 1800 | 1..3600 | CHECK DB (≤ 1 giờ) |
| `OTP_TTL_SECONDS` | 300 | 1..600 | CHECK DB (≤ 10 phút) |
| `OTP_RESEND_COOLDOWN_SECONDS` | 60 | 1..86400 | kỹ thuật (1 ngày), không phải số hợp đồng |
| `PASSWORD_DEADLINE_SECONDS` | 600 | 1..86400 | kỹ thuật |
| `OTP_SEND_LIMIT` / `OTP_SEND_WINDOW_SECONDS` | 5 / 3600 | 1..1000 / 1..86400 | kỹ thuật |
| `REQUEST_LIMIT` / `REQUEST_WINDOW_SECONDS` | 30 / 60 | 1..1000 / 1..86400 | kỹ thuật |
| `LINK_FAILURE_LIMIT` / `_WINDOW_SECONDS` / `_LOCK_SECONDS` | 10 / 900 / 900 | 1..1000 / 1..86400 / 1..86400 | kỹ thuật |
| `TOTP_FAILURE_WINDOW_SECONDS` / `_LOCK_SECONDS` | 900 / 900 | 1..86400 | kỹ thuật |

**Cố định theo schema, không cấu hình được:** sai OTP / challenge = 5, sai TOTP / attempt = 5, ngưỡng bucket `ACTIVATION_TOTP` = 5. Các trần "kỹ thuật" là lựa chọn triển khai để chặn giá trị vô nghĩa, cần ChatGPT/Owner xác nhận hoặc đổi. Test biên: mỗi biến được kiểm min, max, min−1, max+1, không nguyên, rỗng.

## 17. Kế hoạch test

Mỗi lịch barrier dùng nhiều phiên DB thật, ép thứ tự bằng advisory/`pg_stat_activity`, kèm kiểm `lock_timeout` và trace `pg_locks` đối chiếu §9. Đối chiếu 1B S1–S12 không hỏng.

| ID | Lịch | Kỳ vọng |
|---|---|---|
| K1 | `complete` ∥ `complete` (cùng attempt, cùng TOTP) | đúng 1 user; bên kia 200 `COMPLETED` qua trạng thái |
| K2 | `complete` ∥ `/auth/register` cùng SĐT | đúng 1 thắng; thua nhận PHONE_CONFLICT/lỗi trùng; không user nửa vời |
| K3 | `complete` ∥ 1B `revoke` | tuần tự hóa theo L3<L8<L9a; không deadlock; không tài khoản từ lời mời thu hồi |
| K4 | `complete` ∥ 1B `reissue` | attempt cũ INVALIDATED; `complete` cũ nhận LINK_INVALID |
| K5 | `start` ∥ `start` (không cookie) | 1 attempt sống, 1 SUPERSEDED |
| K6 | `otp/request` ∥ `otp/request` | 1 gửi, 1 `OTP_RATE_LIMITED` |
| K7 | `otp/verify` sai ∥ `otp/verify` đúng ở lần thứ 5 | tuần tự hóa theo challenge; LOCKED không bị ghi đè |
| K8 | `complete` TOTP sai ×N song song | đếm đúng tới 5; INVALIDATED một lần; bucket khớp |
| K9 | kill giữa `complete` trước COMMIT | rollback hoàn toàn; mã TOTP chưa bị đốt |
| K10 | COMMIT timeout giả lập ở từng route | `TRANSACTION_OUTCOME_UNKNOWN`; `GET state` phản ánh đúng kết quả thật |
| K11 | `complete` ∥ `complete` khác attempt cùng lời mời | unique live/completed ngăn trùng |
| K12 | trace khóa Auth↔1C | không chu trình |
| **K13** | **`otp/request` (resend) ∥ `otp/verify`** — verify giữ L9b trước / resend giữ trước | Verify trước: đúng ⇒ VERIFIED, resend sau thấy `STEP_INVALID`. Resend trước: challenge cũ INVALIDATED, verify (mã cũ) = sai +1 trên challenge mới hoặc `STEP_INVALID`; không bao giờ VERIFIED trên challenge đã INVALIDATED; không deadlock |
| **K14** | **`totp/enrollment` ∥ `complete`** (cùng attempt) | Cả hai lấy L9a X nên tuần tự hóa. `complete` trước (attempt đã `TOTP_ISSUED`, mã đúng) ⇒ `COMPLETED`; enrollment sau thấy `COMPLETED` ⇒ 409, không trả bí mật. Enrollment (phát lại) trước ⇒ complete sau vẫn dùng đúng bí mật đã trả. `complete` khi attempt còn `PASSWORD_SET` ∥ enrollment đầu tiên ⇒ `complete` hoặc 409 (nếu giành trước) hoặc chạy trên `TOTP_ISSUED` (nếu sau). Hai enrollment ∥ ⇒ cùng một bí mật; không bao giờ `complete` mở bí mật khác với bí mật đã trả |
| **K15** | **Expiry sau khóa:** request chờ L9a/L8 qua `expires_at` của attempt | `T` đọc sau khi chờ ⇒ 401, không ghi, không mở bí mật |
| **K16** | **Expiry sau khóa của lời mời:** chờ qua `invitation.expires_at` | 404 `LINK_INVALID`; không tạo user |
| K17 | PENDING_DELIVERY mồ côi (chết sau txn1) + verify trong/ngoài ân hạn | trong ân hạn 409 không đếm; ngoài ân hạn promote rồi so mã |
| K18 | txn2 (CAS) ∥ verify promote | đúng một bên đổi trạng thái; bên kia 0 hàng, không lỗi |
| K19 | provider `UNKNOWN`/`REJECTED`/`ACCEPTED` (stub) | đúng bảng §13.2; không gọi provider lần hai |
| K20 | hook 1B `invalidateActivationFor` ∥ `otp/request`/`verify` | thứ tự L8<L9a<L9b; không deadlock; challenge không VERIFIED sau khi INVALIDATED |
| K21 | `start` tiếp tục (cookie) ∥ `start` mới | tuần tự hóa; không hai attempt sống |
| K22 | `complete` TOTP sai ∥ `complete` TOTP đúng | tuần tự hóa theo L9a; đếm không mất cập nhật |
| **K23** | **PHONE_CONFLICT ở start / restart / otp-request / complete (G1):** (a) mỗi route với SĐT đã thuộc `users`; (b) hai request đồng thời cùng lời mời đi nhánh này; (c) ∥ 1B `revoke` | Trace `pg_locks` + log câu lệnh: lời mời chỉ bị khóa **một lần, chế độ X, ngay sau L3**; **không** có `FOR SHARE`/`FOR KEY SHARE` lời mời đứng trước `UPDATE` trong các route này; (b),(c) không có `40P01`; kết quả: lời mời `PHONE_CONFLICT` một lần, attempt INVALIDATED, 409 |
| **K24** | **Quá `password_deadline` → restart (G2):** đưa attempt tới `OTP_VERIFIED`, tua đồng hồ DB quá 600 s; (a) `password` ⇒ 409 `restart_required`; (b) `GET state.restart_required = true`; (c) `restart` (không token) ⇒ attempt mới `STARTED`, cũ SUPERSEDED; (d) `start` với token + cookie cũ ⇒ cũng attempt mới (không resume); (e) OTP mới → verify → password → enrollment → complete ⇒ `COMPLETED` | không kẹt; OTP cũ không dùng lại được; còn trong deadline thì `start` + cookie resume (200, không đổi gì); `restart` từ `ATTEMPTS_EXHAUSTED` hoạt động, từ `PHONE_CONFLICT`/`INVITATION_CLOSED` ⇒ 409 |
| **K25** | **(a)** `start` token đúng + cookie `COMPLETED` còn hạn ⇒ 200 `{COMPLETED}`; token của lời mời khác ⇒ như không cookie. **(b)** Cookie hết hạn (`T ≥ expires_at`) ở **mọi** trạng thái × **mọi** route ⇒ 401 (trừ `start` bỏ qua cookie). **(c)** `GET state`/`start`/`complete` nhất quán ở COMPLETED | Bảng 6 trạng thái × 8 route khớp §11.2 từng ô; không route nào trả COMPLETED cho cookie hết hạn; `start` + cookie COMPLETED không ghi |
| **K26** | **Repeat `complete`** trên `COMPLETED` (lặp ×N, ∥ `complete` đầu tiên, và khi bucket `ACTIVATION_TOTP` đang khóa) | Trước/sau: các hàng `admin_auth_limits` **trừ** kind `ACTIVATION_REQUEST_IP` (số hàng, mọi cột), `totp_attempt_count`, `audit_logs` (số hàng), `xmin` của attempt/lời mời/user/factor **không đổi**; riêng `ACTIVATION_REQUEST_IP` của IP đó **tăng đúng +1 mỗi request**; luôn 200; ca đua: người thua ROLLBACK và vẫn 200 |
| **K27** | **Verify sau lần sai thứ 5 và bảng challenge mới nhất (G4):** 5 lần sai ⇒ challenge `LOCKED`; lần verify thứ 6 (mã đúng hoặc sai) | `OTP_RATE_LIMITED`, `attempt_count` vẫn 5, không audit mới, `xmin` challenge không đổi; thêm từng ca: không có challenge, `PENDING_DELIVERY` trong/ngoài ân hạn, `PENDING` hết hạn, `DELIVERY_FAILED`, `INVALIDATED`, và ca có challenge cũ `PENDING` giả lập "sống" nhưng challenge mới nhất là `LOCKED` ⇒ chọn đúng mới nhất |
| **K28** | **Phục hồi sau TOTP sai lần 5 (H1, H2):** (a) 5 lần `complete` sai ⇒ attempt `INVALIDATED(ATTEMPTS_EXHAUSTED)`, bucket `ACTIVATION_TOTP` khóa; tải lại trang (mất state client) ⇒ `GET state` trả `INVALIDATED`, `can_restart:true`, **có `csrf_token`**; (b) `restart` với token đó ⇒ 201 attempt mới `STARTED`, cookie mới, **phải OTP lại** (không kế thừa `otp_verified_at`/mật khẩu); (c) đi hết OTP → mật khẩu → enrollment → `complete` ngay ⇒ 429 `ADMIN_AUTH_RATE_LIMITED` (bucket TOTP vẫn khóa; snapshot `admin_auth_limits` TOTP trước/sau `restart` **giống hệt**), hết thời gian khóa ⇒ `complete` đúng thành công; (d) cookie hết hạn ⇒ `GET state`/`restart` 401; (e) ma trận CSRF §6.1.1: `GET state` **không** trả `csrf_token` cho COMPLETED và INVALIDATED(`SUPERSEDED`/`INVITATION_CLOSED`/`PHONE_CONFLICT`), **có** cho 4 trạng thái sống và `ATTEMPTS_EXHAUSTED`; (f) lời mời đóng (`REVOKED`/`SUPERSEDED`/`EXPIRED`/`PHONE_CONFLICT`/`ACCEPTED`) ⇒ `restart` từ ATTEMPTS_EXHAUSTED thất bại (404 `LINK_INVALID`), `can_restart:false`, không tạo attempt, không đổi limiter | Đúng như cột trái; `restart` không tạo/đổi/reset hàng limiter nào; audit chỉ có chuyển trạng thái attempt và tạo attempt mới |
| **K29** | **TX-P kiểm cookie bằng giờ DB (H3):** fixture attempt có `created_at`/`expires_at` trong quá khứ (các cột này bất biến nên dựng bằng INSERT, không giả clock Node) và cặp ngay-trước / ngay-sau `expires_at` cho **từng** nhánh trả lời sớm: `start`+cookie COMPLETED, `complete` lặp trên COMPLETED, `complete` trên INVALIDATED(PHONE_CONFLICT), `restart` trên COMPLETED/INVALIDATED không restart được, `otp/request` trên attempt đã qua STARTED / cuối | Trước `expires_at`: câu trả lời replay đúng bảng §11.2; từ `expires_at`: 401 (`start`: bỏ qua cookie → theo token), **không** trả `COMPLETED`/409 S/PHONE_CONFLICT; mọi ca vẫn không ghi nghiệp vụ và quota ingress +1 |

Test khác: lịch xem xét khóa — mỗi route chạy dưới `log_statement` + `pg_locks` để chứng minh chuỗi hạng khóa của §9 và không có nâng khóa; DDL (script trong PR, mở rộng thành test migration ở PR triển khai), ma trận §11.2 (mọi ô), GET state theo trạng thái (không lộ trường nhạy cảm), header (no-store, nosniff, Referrer-Policy trên **mọi** mã trả về), cookie (thuộc tính, xóa khi 401), CSRF/Origin, `start` không log token, 404 đồng nhất, vector TOTP RFC 6238, không-log (quét log), giờ DB (không dùng clock của Node).

## 18. File dự kiến (PR triển khai, đổi khi review)

3 migration (A, B, C?), `apps/backend/src/admin-activation/*`, `crypto/key-version.ts`, `common/app-errors.ts`, `config`, móc `invalidateActivationFor` trong module 1B, test + evidence.

## 19. Gate và ma trận từng ứng dụng

- 1C chỉ bắt đầu code sau khi ChatGPT duyệt hợp đồng này và Owner chốt các OD §21 (OD-14, OD-16 ảnh hưởng trực tiếp tới số route và test).
- Không đổi hành vi đăng ký app (Customer/Shop/Driver): vẫn `/auth/register`.
- Phân quyền theo app: `admin_app_permissions` chép nguyên snapshot lời mời; quy tắc VIEW/REVIEW/LOCK do DB chặn.

## 20. Giới hạn

Tài liệu này không có code, chưa chạy CI, không phải quyết định đã duyệt. Kiểm DDL chỉ ở mức cục bộ (§5.4). Câu lệnh 1C gốc không có trong tay; chỗ nào lệch cần ChatGPT chỉ ra.

## 21. Quyết định mở (OD) — nội dung đề xuất; Owner đã chốt toàn bộ theo cột "Đề xuất" (§22)

| OD | Câu hỏi | Đề xuất |
|---|---|---|
| OD-1 | Chế độ OTP và phạm vi "OTP thử" | FAKE/TEST_DISPLAY non-production; SMS chờ M01-C |
| OD-2 | Sau `complete`: tự đăng nhập hay về trang đăng nhập | Về đăng nhập (replay guard buộc chờ ≤ 30 s để có step TOTP kế tiếp) |
| OD-3 | `phone_verified_at` ở `users` hay profile | Profile (CHECK ép NULL ở `users` cho ADMIN_PROVISIONED) |
| OD-4 | Có bật trigger C | Có; đổi 4 file test/fixture |
| OD-5 | Executor hay idempotency theo trạng thái | Theo trạng thái (§11.1), vì executor không hợp commit-then-throw |
| OD-6 | Mở CHECK kind hay bảng limiter riêng | Mở CHECK (migration B) |
| OD-7 | Các con số §7 (kể cả `expires_at` attempt ≤ `invitation.expires_at`) | Như bảng |
| OD-8 | Hết hạn vs thu hồi có trạng thái hiển thị riêng (UI-05 §13; ảnh không có trong repo) | Gộp một thông điệp |
| OD-9 | Tên cờ/cấu hình | Như §16 |
| OD-10 | 404 đồng nhất cho lỗi token | Có |
| OD-11 | `/admin-auth/me` có trả quyền | Ngoài 1C |
| OD-12 | Trang kích hoạt có hiện SĐT che một phần / tóm tắt quyền | Không |
| OD-13 | Sau khi cookie hết hạn, UI hướng dẫn "đã kích hoạt thì đăng nhập" | Có |
| OD-14 | `start` tiếp tục attempt sống khi còn cookie hợp lệ | Có |
| OD-15 | Timeout provider 8 s, ân hạn promote 10 s | Như §7 |
| OD-16 | Thêm route `restart` không cần token (token đã bị xóa khỏi URL) và cho phép restart từ `ATTEMPTS_EXHAUSTED` | Có; nếu Owner không muốn thêm route, phương án thay thế: SPA giữ token trong `sessionStorage` tới khi COMPLETED (rủi ro lưu token) — **cần Owner chọn** |

## 21A. Quyết định của ChatGPT, 2026-10-10 (sau review PR #45)

| Mục | Quyết định | Nơi áp dụng |
|---|---|---|
| Dạng JSON trên dây | snake_case, thân thành công bọc trong `data` | §6 |
| JSON cú pháp hỏng | 400 chung `BAD_REQUEST` **trước** quota ingress; hình dạng sai sau quota là `ADMIN_INPUT_INVALID` | §6.1, §9, §10.1 |
| `GET state` | đọc thuần, không quota DB | §6.3, §8, §10.7 |
| `start` 404 | đếm `LINK_IP` đúng một lần; `restart` 404 không đếm | §8, §10.1, §11.2 |
| Factor | tạo cùng transaction/user từ attempt; không thêm cột ràng buộc mật khẩu | §10.6 |
| Bổ sung triển khai (chưa duyệt) | `complete` đọc lại giờ DB sau chờ unique `users`; cấu hình §7 (tên/miền ở §16) | §10.6, §16 |

## 22. Quyết định của Owner (ghi nhận khi bắt đầu triển khai)

| Mục | Nội dung |
|---|---|
| Ngày / nguồn | 2026-10-10, thông báo của Owner trong phiên làm việc triển khai |
| Mốc được duyệt | Hợp đồng tại head `802b334a4c854c5517d50b651442a073103b22ea` (base `4ab9c9cff8db730699d234c56bacf567506c5bbf`) |
| OD đã chốt | **OD-1 … OD-16: chốt theo đúng cột "Đề xuất" ở §21**, không sửa đổi. Cụ thể: OTP FAKE/TEST_DISPLAY chỉ non-production, SMS chờ M01-C (OD-1); sau `complete` về trang đăng nhập, không tự cấp phiên (OD-2); `phone_verified_at` ở profile (OD-3); bật trigger origin guard C (OD-4); idempotency theo trạng thái, không dùng executor (OD-5); mở CHECK kind limiter (OD-6); các con số §7 (OD-7); gộp thông điệp hết hạn/thu hồi (OD-8); tên cấu hình §16 (OD-9); 404 đồng nhất (OD-10); `/admin-auth/me` ngoài 1C (OD-11); không hiện SĐT/quyền ở trang kích hoạt (OD-12); hướng dẫn đăng nhập khi cookie hết hạn (OD-13); `start` tiếp tục attempt resumable (OD-14); timeout provider 8 s / ân hạn 10 s (OD-15); thêm route `restart` không cần token (OD-16) |
| Phạm vi triển khai | Migration A/B/C, 8 route, cookie/CSRF, cấu hình, limiter, cổng OTP, audit, mã lỗi, móc `invalidateActivationFor` trong 1B. **Không**: SMS thật, UI, reset mật khẩu, recovery |
| Điều kiện giữ nguyên | `LOCK_PROTOCOL=NOT_FINAL` tới khi ChatGPT review code/test; OTP thử chỉ bật bằng cấu hình tường minh ở môi trường test, **không tự fallback** khi thiếu provider SMS; không merge/deploy/đóng M01; Owner nghiệm thu là quyết định riêng sau này |
