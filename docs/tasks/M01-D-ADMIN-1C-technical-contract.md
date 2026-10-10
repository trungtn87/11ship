# M01-D-ADMIN-1C — Hợp đồng kỹ thuật kích hoạt ADMIN từ lời mời

> **Trạng thái:** DRAFT, chỉ tài liệu. Không có code sản phẩm. `LOCK_PROTOCOL = NOT_FINAL`. Chưa merge, chưa deploy, chưa đóng M01, chưa có Owner acceptance.
> **Trung thực về nguồn:** "câu lệnh 1C" gốc không có trong repo hay hội thoại làm việc. Mọi điểm do Claude suy ra từ 1A/1B/#34 và các PR #30/#33/#36/#43 được gắn nhãn **[ĐX]** (đề xuất) và gom ở §19 (OD). Không có điểm [ĐX] nào là quyết định đã duyệt.
> **Kiểm chứng DDL:** DDL §5 chạy thử cục bộ trên PostgreSQL 16 (Up, Down, Up) cùng 80+ kịch bản trong script thử. Không phải CI. Script thử chưa nằm trong repo; sẽ thành test migration ở PR triển khai.

## 0. Nguồn và mốc

| Mục | Giá trị |
|---|---|
| Repo | `trungtn87/11ship` |
| Base của PR này | nhánh `feat/m01-d-admin-1b-provisioning` (PR #41) |
| Mốc 1B được duyệt | `4ab9c9cff8db730699d234c56bacf567506c5bbf` |
| Chuỗi PR | #34 login backend → #37 1A invitations → #38 hợp đồng 1B → #41 triển khai 1B (Draft) |
| Nguồn nghiệp vụ | PR #30 (thiết kế nghiệp vụ), #33, #36 (preflight), #43 (reset). Bản "mật khẩu tạm" trong #30 **bị thay** bằng luồng lời mời → OTP → tự đặt mật khẩu → 2FA |
| Hợp đồng đối chiếu | `docs/tasks/M01-D-ADMIN-1B-technical-contract.md` (khóa L1–L10, §8.8) |

## 1. Quyết định đã có (không đổi trong tài liệu này)

1. Luồng: lời mời → OTP → tự đặt mật khẩu → thiết lập và xác nhận TOTP → kích hoạt ADMIN nguyên tử.
2. Tài khoản ADMIN là `account_origin = ADMIN_PROVISIONED`; không dùng chung đăng ký app (`/auth/register`).
3. SĐT lời mời bất biến (trigger 1A). SĐT trùng tài khoản khác ⇒ `PHONE_CONFLICT`.
4. TOTP: RFC 6238, SHA-1, 6 chữ số, 30 s; bí mật được AEAD niêm phong (AAD gồm userId, factorId, factorVersion); chỉ nhận step lớn hơn `last_accepted_step`.
5. Owner cho phép hiển thị "OTP thử" ở môi trường test không phải production; production/staging không chạy nếu thiếu provider OTP.
6. Claude không đổi nghiệp vụ hay UI đã duyệt; thiếu thiết kế ⇒ OD ở §19.

## 2. Phạm vi

**Trong:** 7 route công khai `/v1/admin-activation/*`; 3 migration (A bắt buộc, B bắt buộc, C tùy chọn OD-4); service, limiter, audit, lỗi, cấu hình; kế hoạch test.
**Ngoài:** gửi SMS thật (M01-C), UI, đăng nhập ADMIN (đã có #34), step-up 1B, cấp/thu hồi phân quyền sau kích hoạt, đổi/quên mật khẩu ADMIN, khôi phục TOTP, reset (PR #43).

## 3. Cơ sở code đã đọc (không sửa)

`AdminIdentityParticipant.insertProvisioned` (tạo user ADMIN_PROVISIONED); `AdminInvitationParticipant.transition` (CAS theo version); `AdminTotpService` + `admin-crypto` (seal/unseal, `matchTotp`); `AdminLimiter` (`reserveRequest` là quota commit riêng; `lockBuckets`/`recordFailure` là bộ đếm lỗi); `VerificationService` (mẫu OTP: txn1 → gửi ngoài txn → txn2); `TransactionManager` (ném `TRANSACTION_OUTCOME_UNKNOWN` khi COMMIT timeout); `key-version.ts` (CSRF type, subkey); `IdempotencyExecutor` (không dùng, xem §11).

## 4. Luồng và máy trạng thái

```
STARTED --otp/verify--> OTP_VERIFIED --password--> PASSWORD_SET --totp/enrollment--> TOTP_ISSUED --complete--> COMPLETED
   \________ mọi trạng thái sống ________/ -> INVALIDATED{SUPERSEDED | INVITATION_CLOSED | PHONE_CONFLICT | ATTEMPTS_EXHAUSTED}
```

- Mỗi lời mời có tối đa **một** attempt sống (unique index) và tối đa một attempt COMPLETED.
- `start` với token hợp lệ tạo attempt mới và đưa attempt sống cũ sang `INVALIDATED(SUPERSEDED)` trong cùng giao dịch.
- `user_id` và `factor_id` được cấp sẵn trong attempt vì chúng nằm trong AAD của TOTP và ràng buộc mật khẩu.
- Chỉ `complete` mới tạo user/membership/profile/permissions/factor. Mọi bước trước chỉ ghi vào attempt/challenge, nên bỏ dở không để lại tài khoản.
- Trigger DB chặn nhảy bước, sửa danh tính, sửa bí mật đã niêm phong, đi ngược từ trạng thái cuối, DELETE.

## 5. Dữ liệu — DDL đã chạy thử

### 5.1 Migration A — attempt, OTP challenge, profile, permissions (**bắt buộc**)

```sql
CREATE TABLE app.admin_activation_attempts (
 attempt_id uuid PRIMARY KEY,
 invitation_id uuid NOT NULL,
 generation_id uuid NOT NULL,
 -- Pre-allocated identities of the account that exists only after COMPLETED (no foreign key on purpose). They are
 -- the AEAD associated data of the TOTP secret and the input of the password binding, so they must be fixed first.
 user_id uuid NOT NULL UNIQUE,
 factor_id uuid NOT NULL UNIQUE,
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
 CHECK ((totp_key_id IS NULL AND totp_ciphertext IS NULL AND totp_iv IS NULL AND totp_tag IS NULL AND totp_issued_at IS NULL)
     OR (totp_key_id IS NOT NULL AND octet_length(totp_ciphertext) BETWEEN 1 AND 256 AND octet_length(totp_iv) = 12
         AND octet_length(totp_tag) = 16 AND totp_issued_at IS NOT NULL)),
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

### 5.2 Migration B — mở rộng kind của limiter (**bắt buộc**)

```sql
ALTER TABLE app.admin_auth_limits DROP CONSTRAINT admin_auth_limits_kind_ck;
ALTER TABLE app.admin_auth_limits ADD CONSTRAINT admin_auth_limits_kind_ck CHECK (
 kind IN ('LOGIN_PHONE','LOGIN_IP','LOGIN_REQUEST_IP','TOTP_USER','TOTP_REQUEST_IP',
          'ACTIVATION_REQUEST_IP','ACTIVATION_LINK_IP','ACTIVATION_OTP_SEND','ACTIVATION_TOTP')
);
```

Down B (từ chối chạy nếu còn bucket `ACTIVATION_*`, tránh mất dữ liệu khóa):

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

### 5.3 Migration C — chốt nguồn gốc membership (**tùy chọn, OD-4**)

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

Lưu ý: bật C làm 4 file test/fixture hiện chèn membership trực tiếp phải đổi sang tạo user ADMIN_PROVISIONED.

### 5.4 Kết quả chạy thử cục bộ

Script thử dùng harness `expect(nhãn, câu lệnh, sqlstate mong đợi)`. Hai kịch bản lệch do **kỳ vọng sai trong script**, không do DDL: (A3) lệch generation bị từ chối bằng 23505 của unique index trước khi tới FK (23503); (P4) CUSTOMER+REVIEW bị CHECK từ chối bằng 23514 như dự định. Hai kịch bản này phải sửa kỳ vọng khi đưa vào test migration chính thức.

## 6. API (prefix `/v1`, chỉ mount khi `ADMIN_ACTIVATION_ENABLED=true`)

Chung: token lời mời nằm trong **body/fragment, không nằm trong query string hay log**; chỉ `start` nhận token. Các bước sau dùng cookie `__Host-11admin-act` (HttpOnly, Secure, SameSite=Strict, Path=/) + header CSRF kiểu `ACTIVATION`. Mọi lỗi liên quan token/trạng thái lời mời trả **cùng một** 404 `ADMIN_ACTIVATION_LINK_INVALID` (không phân biệt hết hạn, thu hồi, không tồn tại) — xem OD-10.

| # | Route | Điều kiện attempt | Hiệu ứng | Thành công |
|---|---|---|---|---|
| 1 | `POST /admin-activation/start` `{token}` | token khớp, lời mời PENDING, đúng generation | tạo attempt STARTED; SUPERSEDE attempt cũ; đặt cookie + CSRF | 201 `{state, expiresAt}` |
| 2 | `GET /admin-activation/state` | cookie hợp lệ | không ghi | 200 `{state, maskedPhone, otp:{resendAt,attemptsLeft}, expiresAt}` |
| 3 | `POST /admin-activation/otp/request` | STARTED | tạo challenge PENDING_DELIVERY → gửi ngoài txn → PENDING | 202 `{resendAt, displayedCode?}` |
| 4 | `POST /admin-activation/otp/verify` `{code}` | STARTED, challenge PENDING | đúng ⇒ VERIFIED + attempt OTP_VERIFIED; sai ⇒ +1 (commit rồi ném) | 200 `{state}` |
| 5 | `POST /admin-activation/password` `{password}` | OTP_VERIFIED, trong 600 s kể từ xác minh | băm mật khẩu (cùng thuật toán #34); attempt PASSWORD_SET | 200 `{state}` |
| 6 | `POST /admin-activation/totp/enrollment` | PASSWORD_SET (hoặc TOTP_ISSUED ⇒ trả lại cùng bí mật) | tạo bí mật, niêm phong theo (userId, factorId, v1); attempt TOTP_ISSUED | 200 `{otpauthUri, secretBase32, state}` — chỉ trả khi vừa phát hành/retry cùng trạng thái |
| 7 | `POST /admin-activation/complete` `{totp}` | TOTP_ISSUED | xác nhận TOTP + kích hoạt nguyên tử (§9) | 200 `{state:"COMPLETED"}` |

Lỗi theo mã: cookie/CSRF sai ⇒ 401 `ADMIN_ACTIVATION_SESSION_INVALID` / 403 `ADMIN_CSRF_INVALID`; sai bước ⇒ 409 `ADMIN_ACTIVATION_STEP_INVALID`; input sai ⇒ 400 `ADMIN_INPUT_INVALID`; vượt hạn mức ⇒ 429 `ADMIN_AUTH_RATE_LIMITED`; OTP sai/hết hạn/khóa ⇒ mã `OTP_*` hiện có; TOTP sai ⇒ `ADMIN_TOTP_INVALID`; SĐT trùng ⇒ 409 `ADMIN_PHONE_CONFLICT`; COMMIT không rõ ⇒ `TRANSACTION_OUTCOME_UNKNOWN`. Mật khẩu: cùng chính sách độ mạnh của #34 (không đặt số mới).

## 7. TTL và giới hạn số **[ĐX — OD-7]**

| Hạng mục | Giá trị đề xuất |
|---|---|
| Vòng đời attempt | 30 phút (DDL chặn > 1 giờ) |
| OTP hiệu lực | 300 s |
| Cooldown gửi lại | 60 s |
| Sai OTP tối đa / challenge | 5 ⇒ LOCKED |
| Gửi OTP tối đa | 5 / giờ / lời mời |
| Đặt mật khẩu sau khi xác minh OTP | ≤ 600 s |
| Sai TOTP tối đa / attempt | 5 ⇒ INVALIDATED(ATTEMPTS_EXHAUSTED) |
| Quota ingress | 30 / 60 s / IP (`ACTIVATION_REQUEST_IP`) |
| Sai token `start` | 10 / 15 phút / IP, khóa 15 phút (`ACTIVATION_LINK_IP`) |
| Gửi OTP | `ACTIVATION_OTP_SEND`, định danh = invitation_id |
| Sai TOTP | 5 / 15 phút, khóa 15 phút (`ACTIVATION_TOTP`, định danh = invitation_id) |

Bucket không bao giờ dùng SĐT làm định danh (tránh lộ/ghi SĐT, tránh khóa theo SĐT bị người ngoài lạm dụng).

## 8. Limiter và bộ đếm — sự kiện × bộ đếm × cách commit

| Sự kiện | Bộ đếm | Commit |
|---|---|---|
| Mọi request công khai | `ACTIVATION_REQUEST_IP` quota | giao dịch riêng, commit trước nghiệp vụ (như `reserveRequest`) |
| Token sai ở `start` | `ACTIVATION_LINK_IP` +1 | commit rồi ném 404 |
| Gửi OTP | `ACTIVATION_OTP_SEND` +1, cooldown theo challenge | cùng txn1 |
| OTP sai | `attempt_count` challenge +1 | commit rồi ném (như Auth) |
| OTP sai lần 5 | challenge LOCKED | một UPDATE, commit rồi ném |
| TOTP sai | `totp_attempt_count` +1 và `ACTIVATION_TOTP` +1 | commit rồi ném `ADMIN_TOTP_INVALID` |
| TOTP sai lần 5 | attempt INVALIDATED(ATTEMPTS_EXHAUSTED) | một UPDATE, commit rồi ném |
| Thành công | không tăng; không reset bucket khóa đang hiệu lực | — |

Vì bộ đếm lỗi phải commit rồi mới ném, `IdempotencyExecutor` (rollback khi ném) **không** dùng cho route 4 và 7.

## 9. `complete` — kích hoạt nguyên tử

Một giao dịch, không dùng executor, thứ tự khóa §10:

1. Đọc SĐT lời mời (không khóa) để lấy khóa L3; khóa L3 (advisory theo SĐT).
2. Khóa lời mời (L8) rồi attempt (L9a). Kiểm tra: attempt TOTP_ISSUED, chưa hết hạn, lời mời vẫn PENDING và đúng generation, SĐT không đổi.
3. Giải niêm phong bí mật (AAD userId, factorId, v1); `matchTotp` với `last_accepted_step`.
4. **Sai:** tăng bộ đếm (hoặc INVALIDATED nếu lần 5), COMMIT, rồi ném `ADMIN_TOTP_INVALID`.
5. **Đúng:**
   - `INSERT users ... ON CONFLICT DO NOTHING` qua `insertProvisioned` (`phone_verified_at` NULL, nguồn ADMIN_PROVISIONED). Nếu không chèn được ⇒ PHONE_CONFLICT (§12).
   - `admin_memberships` (ADMIN, ACTIVE, version 1).
   - `admin_profiles` (kèm `phone_verified_at` — OD-3).
   - `admin_app_permissions` sao chép từ snapshot lời mời.
   - `admin_factors` ACTIVE: bí mật niêm phong sao chép nguyên, `last_accepted_step` = step vừa khớp, mật khẩu ràng buộc theo (userId, passwordHash).
   - Lời mời → ACCEPTED (`accepted_user_id`, CAS version).
   - Attempt → COMPLETED (xóa `password_hash`, bí mật TOTP).
   - Audit cùng giao dịch.
6. COMMIT. Không tạo session đăng nhập (OD-2).

Mọi thất bại trước COMMIT ⇒ rollback toàn bộ, không có user nửa vời.

## 10. Thứ tự khóa và đối chiếu 1B

Thứ tự 1C (mở rộng L1–L10 của 1B, không đảo thứ tự cũ):

`L2 limiter bucket < L3 phone advisory (11ship.admin-provisioning.phone.v1) < L8 invitation < L9 operations (không dùng) < L9a attempt < L9b OTP challenge (UUID tăng dần) < L10 hàng mới`

- Route `start`, `otp/request`, `complete` lấy L3 **vô điều kiện** (đọc SĐT trước, không khóa). Đúng với yêu cầu 1B §8.8: route 1C ghi PENDING/ACCEPTED theo SĐT phải lấy L3 trước.
- Móc 1B `invalidateActivationFor(context, invitationId)`: reissue/revoke/đổi trạng thái lời mời của 1B gọi móc này trong giao dịch của chính nó (đã giữ L3, L8) để chuyển attempt sống sang INVALIDATED(INVITATION_CLOSED/SUPERSEDED). Móc lấy L9a sau L8, đúng thứ tự.
- **Khóa ẩn:** unique SĐT trên `users` giữa `complete` và `/auth/register`. Không tạo chu trình vì Auth không lấy khóa admin nào và Auth Core không đổi; ai chèn sau sẽ chờ/va unique, không giữ khóa nào mà bên kia cần.
- Challenge: nếu một route khóa nhiều challenge phải khóa theo UUID tăng dần (thực tế mỗi attempt chỉ có 1 challenge sống).
- `LOCK_PROTOCOL = NOT_FINAL`: 1C cần phân tích call graph riêng khi triển khai, giữ `lock_timeout` ngắn như 1B.

## 11. Idempotency, replay, mất response, COMMIT không rõ

Idempotency **suy ra từ trạng thái** (không executor, không bảng khóa idempotency mới) — OD-5.

| Route | Gọi lại sau thành công | Mất response | COMMIT không rõ |
|---|---|---|---|
| start | tạo attempt mới, SUPERSEDE cũ (chấp nhận được, token dùng lại được tới khi ACCEPTED) | `start` lại | `start` lại; attempt mồ côi hết hạn |
| otp/request | trong cooldown ⇒ `OTP_RESEND_TOO_SOON`, không gửi lại | `GET state` xem `resendAt` | `GET state` |
| otp/verify | attempt đã qua bước ⇒ 200 `{state}` hiện tại nếu mã đúng bước; khác ⇒ 409 step | `GET state` | `GET state`: nếu OTP_VERIFIED thì đã xong |
| password | đã PASSWORD_SET ⇒ 409 step (không ghi đè) | `GET state` | `GET state` |
| totp/enrollment | TOTP_ISSUED ⇒ trả lại **cùng** bí mật (giải niêm phong), không phát hành mới | gọi lại | gọi lại |
| complete | attempt COMPLETED ⇒ 200 `{COMPLETED}` | `GET state` ⇒ COMPLETED | `TRANSACTION_OUTCOME_UNKNOWN` ⇒ client `GET state`; nếu cookie còn hiệu lực trả COMPLETED, nếu không thì đăng nhập |

Quy tắc chung: không bao giờ thử lại tự động một giao dịch đã COMMIT không rõ; luôn đọc lại trạng thái. TOTP đã dùng không thể phát lại (replay guard) — điều này cũng bảo vệ trường hợp client gửi lại cùng mã sau lost-response.

## 12. PHONE_CONFLICT

Phát hiện khi: `start`, `otp/request` (kiểm tra sớm, rẻ) và `complete` (quyết định, dưới L3).

- Điều kiện: SĐT lời mời đã thuộc `users` khác (đăng ký app hoặc ADMIN khác).
- Hiệu ứng, trong **một** giao dịch: lời mời PENDING → PHONE_CONFLICT (CAS), attempt sống → INVALIDATED(PHONE_CONFLICT), audit; COMMIT; rồi ném 409 `ADMIN_PHONE_CONFLICT` (commit-then-throw).
- Không tạo user/membership/profile/factor một phần. Người dùng bị từ chối thấy lỗi nghiệp vụ, không lộ danh tính tài khoản trùng.
- Race với `/auth/register` cùng SĐT: unique SĐT quyết định người thắng. Nếu `/auth/register` thắng sau khi 1C đã kiểm tra, `ON CONFLICT DO NOTHING` bắt được ở bước `complete`. Nếu `complete` thắng, `/auth/register` nhận lỗi trùng SĐT sẵn có của Auth. Auth Core không đổi.
- Khôi phục: SYSTEM tạo lời mời mới sau khi xử lý nghiệp vụ (ngoài phạm vi 1C).

## 13. OTP

Bảng riêng `admin_activation_otp_challenges` (không dùng bảng Auth), purpose `ADMIN_ACTIVATION`, subkey Keyring `adminActivationOtp`. Digest = HMAC theo [miền, challengeId, SĐT, purpose, otp]. Cổng giao `{displayedCode?}`:

- `FAKE`: tự kiểm thử, không hiển thị.
- `TEST_DISPLAY`: chỉ môi trường không phải production; trả mã về client; **không bao giờ ghi log**.
- `SMS`: sau M01-C; staging/production không khởi động nếu thiếu provider.

Gửi theo mẫu Auth: txn1 (khóa, cooldown, PENDING_DELIVERY) → commit → gọi provider ngoài txn → txn2 đánh dấu PENDING hoặc DELIVERY_FAILED.

## 14. Audit

Cùng giao dịch với mutation; audit lỗi ⇒ rollback. Actor `ANONYMOUS` trước kích hoạt, `USER` sau kích hoạt (sự kiện `complete`). Ghi mọi chuyển trạng thái attempt, gửi/xác minh/khóa OTP, sai TOTP, PHONE_CONFLICT, kích hoạt. **Cấm** ghi OTP, mật khẩu, hash, bí mật TOTP, token, SĐT, mã `displayedCode`.

## 15. Mã lỗi mới và cấu hình

Mới: `ADMIN_ACTIVATION_LINK_INVALID` (404), `ADMIN_ACTIVATION_SESSION_INVALID` (401), `ADMIN_ACTIVATION_STEP_INVALID` (409). Dùng lại: `OTP_*`, `ADMIN_TOTP_INVALID`, `ADMIN_AUTH_RATE_LIMITED`, `ADMIN_PHONE_CONFLICT`, `ADMIN_CSRF_INVALID`, `ADMIN_INPUT_INVALID`, `TRANSACTION_OUTCOME_UNKNOWN`. Thông điệp cố định, không phản chiếu input.

Cấu hình **[ĐX — OD-9]**: `ADMIN_ACTIVATION_ENABLED` (mặc định false; yêu cầu `ADMIN_AUTH_ENABLED`), `ADMIN_ACTIVATION_OTP_MODE` (`FAKE|TEST_DISPLAY|SMS`), các TTL/ngưỡng ở §7 (mặc định như bảng, ép trần theo CHECK DB). CSRF type `ACTIVATION` thêm vào `key-version.ts`, không đổi dẫn xuất cũ.

## 16. Kế hoạch test (barrier là trọng tâm)

Đối chiếu 1B S1–S12 (không làm hỏng) và đăng ký app. Mỗi lịch dùng barrier hai-phiên, có kiểm tra `pg_stat_activity`/`lock_timeout`.

| ID | Lịch | Kỳ vọng |
|---|---|---|
| K1 | `complete` ∥ `complete` (cùng attempt, cùng TOTP) | đúng 1 user; bên kia 200 COMPLETED qua trạng thái |
| K2 | `complete` ∥ `/auth/register` cùng SĐT | đúng 1 thắng; thua nhận PHONE_CONFLICT/lỗi trùng; không user nửa vời |
| K3 | `complete` ∥ 1B `revoke` lời mời | thứ tự L3<L8<L9a; kết quả tuần tự hóa, không deadlock; không tài khoản từ lời mời thu hồi |
| K4 | `complete` ∥ 1B `reissue` | attempt cũ INVALIDATED; `complete` cũ nhận LINK_INVALID |
| K5 | `start` ∥ `start` | 1 attempt sống, 1 SUPERSEDED |
| K6 | `otp/request` ∥ `otp/request` | 1 gửi, 1 cooldown |
| K7 | `otp/verify` sai ∥ `otp/verify` đúng ở lần 5 | tuần tự hóa theo challenge; LOCKED không bị ghi đè |
| K8 | `complete` TOTP sai ×5 song song | đúng tới 5 lần tính; attempt INVALIDATED một lần |
| K9 | kill giữa `complete` (trước COMMIT) | rollback hoàn toàn |
| K10 | COMMIT timeout giả lập | `TRANSACTION_OUTCOME_UNKNOWN`; `GET state` phản ánh kết quả thật |
| K11 | `complete` ∥ `complete` khác attempt cùng lời mời | unique live/completed ngăn trùng |
| K12 | tải: phone advisory không chu trình với Auth (đồ thị khóa trace) | không deadlock |

Ngoài ra: test migration (Up/Down/Up, mọi kịch bản §5.4 sau khi sửa kỳ vọng), không-log (quét log không chứa OTP/mật khẩu/token/SĐT/hash/bí mật), 404 đồng nhất, cookie/CSRF, hết hạn theo đồng hồ DB, vector TOTP RFC 6238, replay step.

## 17. File dự kiến (PR triển khai, đổi khi review)

3 migration (A, B, C?), `apps/backend/src/admin-activation/*` (controller, service, repository, otp port, constants, locks), cập nhật `crypto/key-version.ts`, `common/app-errors.ts`, `config`, móc `invalidateActivationFor` trong module 1B, test + evidence doc.

## 18. Gate và ma trận từng ứng dụng

- Gate: 1C chỉ bắt đầu code sau khi ChatGPT duyệt hợp đồng này và chốt OD §19; PR 1C stack lên #41 hoặc sau khi #41 merge theo Owner.
- Không đổi hành vi đăng ký app (Customer/Shipper/Merchant…): các app tiếp tục dùng `/auth/register`; ADMIN không đăng ký qua app, và (nếu bật C) membership chỉ thuộc user ADMIN_PROVISIONED.
- Phân quyền theo app: `admin_app_permissions` chép nguyên snapshot lời mời, quy tắc VIEW/REVIEW/LOCK như 1A (DB chặn).

## 19. Quyết định còn mở (OD) cho ChatGPT/Owner

| OD | Câu hỏi | Đề xuất |
|---|---|---|
| OD-1 | Chế độ OTP và phạm vi hiển thị "OTP thử" | FAKE/TEST_DISPLAY non-production; SMS chờ M01-C |
| OD-2 | Sau `complete`: tự đăng nhập hay chuyển về trang đăng nhập | Về đăng nhập (replay guard buộc chờ ≤ 30 s mới có TOTP step kế tiếp, nên tự đăng nhập không khả thi nếu không đổi guard) |
| OD-3 | `phone_verified_at`: trên `users` hay trên profile | Profile (CHECK hiện tại ép NULL ở users cho ADMIN_PROVISIONED) |
| OD-4 | Có bật trigger C (origin guard) không | Có; đổi 4 file test/fixture |
| OD-5 | Executor hay idempotency suy ra từ trạng thái | Từ trạng thái (executor không hợp với commit-then-throw) |
| OD-6 | Mở rộng CHECK kind hay bảng limiter riêng | Mở rộng CHECK (migration B) |
| OD-7 | Các con số TTL/ngưỡng §7 | Như bảng |
| OD-8 | UI-05 §13: hết hạn và bị thu hồi có trạng thái hiển thị riêng không (ảnh UI không có trong repo) | Gộp một thông điệp (chống dò) |
| OD-9 | Tên cờ/cấu hình §15 | Như §15 |
| OD-10 | 404 đồng nhất cho mọi lỗi token | Có |
| OD-11 | `/admin-auth/me` có trả phân quyền không | Ngoài 1C |
| OD-12 | Trang kích hoạt có hiện tóm tắt quyền không | Không (tránh lộ trước xác thực đủ) |

## 20. Giới hạn

Tài liệu này chưa có code, chưa chạy CI, chưa phải quyết định đã duyệt. DDL chỉ được thử cục bộ. Câu lệnh 1C gốc không có trong tay; mọi chỗ lệch với câu lệnh đó cần ChatGPT chỉ ra để chỉnh.
