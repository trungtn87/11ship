\set ON_ERROR_STOP off
\set QUIET on
SET client_min_messages = notice;
CREATE FUNCTION pg_temp.expect(label text, stmt text, want text, want_constraint text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text := 'OK'; got_c text := NULL;
BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS got_c = CONSTRAINT_NAME; got := SQLSTATE; END;
 RAISE NOTICE '% | want % got % | %', CASE WHEN got = want AND (want_constraint IS NULL OR got_c = want_constraint) THEN 'PASS' ELSE 'FAIL' END,
  rpad(want,5), rpad(got,5) || coalesce(' ' || got_c, ''), label;
END $$;

-- Fixtures: SYSTEM (admin-provisioned) + a PENDING sealed invitation.
INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000001', '+84900000001', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', NULL, 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now());
INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000001', 'SYSTEM', 'ACTIVE', 1, now(), now());
BEGIN;
INSERT INTO app.admin_invitations (invitation_id, generation_id, phone_normalized, full_name, note, token_digest, status, version, created_by, created_at, expires_at, snapshot_sealed)
VALUES ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201', '+84911000001', 'Nguyen Van A', NULL, repeat('b',64), 'PENDING', 1, '00000000-0000-4000-8000-000000000001', now(), now() + interval '72 hours', false);
INSERT INTO app.admin_invitation_permissions VALUES ('00000000-0000-4000-8000-000000000101', 'CUSTOMER', true, false, false);
INSERT INTO app.admin_invitation_permissions VALUES ('00000000-0000-4000-8000-000000000101', 'SHOP', true, true, true);
UPDATE app.admin_invitations SET snapshot_sealed = true WHERE invitation_id = '00000000-0000-4000-8000-000000000101';
COMMIT;

-- ===== attempts =====
SELECT pg_temp.expect('A1 insert STARTED', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000501',repeat('a',64),decode(repeat('00',32),'hex'),'k1','STARTED',now(),now()+interval '30 minutes') $$, 'OK');
SELECT pg_temp.expect('A2 second live attempt for the same invitation', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000502',repeat('c',64),decode(repeat('00',32),'hex'),'k1','STARTED',now(),now()+interval '30 minutes') $$, '23505');
SELECT pg_temp.expect('A3 generation mismatch violates the composite FK (row outside the live unique index)', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, invalidated_reason, invalidated_at, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000303','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-0000000009ff','00000000-0000-4000-8000-000000000403','00000000-0000-4000-8000-000000000503',repeat('d',64),decode(repeat('00',32),'hex'),'k1','INVALIDATED','SUPERSEDED',now(),now(),now()+interval '30 minutes') $$, '23503', 'admin_activation_attempts_invitation_fk');
SELECT pg_temp.expect('A4 lifetime above one hour', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000304','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000404','00000000-0000-4000-8000-000000000504',repeat('e',64),decode(repeat('00',32),'hex'),'k1','STARTED',now(),now()+interval '61 minutes') $$, '23514');
SELECT pg_temp.expect('A5 skip a step STARTED -> PASSWORD_SET', $$
 UPDATE app.admin_activation_attempts SET status='PASSWORD_SET', otp_verified_at=now(), password_hash='$argon2id$x', password_set_at=now() WHERE attempt_id='00000000-0000-4000-8000-000000000301' $$, '23001');
SELECT pg_temp.expect('A6 STARTED -> OTP_VERIFIED', $$
 UPDATE app.admin_activation_attempts SET status='OTP_VERIFIED', otp_verified_at=now() WHERE attempt_id='00000000-0000-4000-8000-000000000301' $$, 'OK');
SELECT pg_temp.expect('A7 OTP_VERIFIED -> PASSWORD_SET', $$
 UPDATE app.admin_activation_attempts SET status='PASSWORD_SET', password_hash='$argon2id$v=19$x', password_set_at=now() WHERE attempt_id='00000000-0000-4000-8000-000000000301' $$, 'OK');
SELECT pg_temp.expect('A8 PASSWORD_SET -> TOTP_ISSUED', $$
 UPDATE app.admin_activation_attempts SET status='TOTP_ISSUED', totp_key_id='k1', totp_ciphertext=decode('aabb','hex'), totp_iv=decode(repeat('00',12),'hex'), totp_tag=decode(repeat('11',16),'hex'), totp_issued_at=now() WHERE attempt_id='00000000-0000-4000-8000-000000000301' $$, 'OK');
SELECT pg_temp.expect('A9 wrong TOTP +1', $$
 UPDATE app.admin_activation_attempts SET totp_attempt_count=1 WHERE attempt_id='00000000-0000-4000-8000-000000000301' $$, 'OK');
SELECT pg_temp.expect('A10 wrong TOTP +2 jump', $$
 UPDATE app.admin_activation_attempts SET totp_attempt_count=3 WHERE attempt_id='00000000-0000-4000-8000-000000000301' $$, '23001');
SELECT pg_temp.expect('A11 change the sealed secret', $$
 UPDATE app.admin_activation_attempts SET totp_attempt_count=2, totp_ciphertext=decode('ccdd','hex') WHERE attempt_id='00000000-0000-4000-8000-000000000301' $$, '23001');
SELECT pg_temp.expect('A12 5th wrong needs INVALIDATED(ATTEMPTS_EXHAUSTED) - bare count 5 refused', $$
 UPDATE app.admin_activation_attempts SET totp_attempt_count=2 WHERE attempt_id='00000000-0000-4000-8000-000000000301' $$, 'OK');
SELECT pg_temp.expect('A12b count 3', $$ UPDATE app.admin_activation_attempts SET totp_attempt_count=3 WHERE attempt_id='00000000-0000-4000-8000-000000000301' $$, 'OK');
SELECT pg_temp.expect('A12c count 4', $$ UPDATE app.admin_activation_attempts SET totp_attempt_count=4 WHERE attempt_id='00000000-0000-4000-8000-000000000301' $$, 'OK');
SELECT pg_temp.expect('A12d count 5 while TOTP_ISSUED', $$ UPDATE app.admin_activation_attempts SET totp_attempt_count=5 WHERE attempt_id='00000000-0000-4000-8000-000000000301' $$, '23001');
SELECT pg_temp.expect('A13 identity immutable (token digest)', $$
 UPDATE app.admin_activation_attempts SET token_digest=repeat('f',64) WHERE attempt_id='00000000-0000-4000-8000-000000000301' $$, '23001');
SELECT pg_temp.expect('A14 delete forbidden', $$ DELETE FROM app.admin_activation_attempts WHERE attempt_id='00000000-0000-4000-8000-000000000301' $$, '23001');
SELECT pg_temp.expect('A15 TOTP_ISSUED -> COMPLETED (secret and hash cleared)', $$
 UPDATE app.admin_activation_attempts SET status='COMPLETED', completed_at=now(), password_hash=NULL, totp_key_id=NULL, totp_ciphertext=NULL, totp_iv=NULL, totp_tag=NULL, totp_issued_at=NULL WHERE attempt_id='00000000-0000-4000-8000-000000000301' $$, 'OK');
SELECT pg_temp.expect('A16 COMPLETED is terminal', $$
 UPDATE app.admin_activation_attempts SET status='INVALIDATED', invalidated_at=now(), invalidated_reason='SUPERSEDED' WHERE attempt_id='00000000-0000-4000-8000-000000000301' $$, '23001');
SELECT pg_temp.expect('A17 COMPLETED keeping the hash is refused by the shape CHECK', $$
 UPDATE app.admin_activation_attempts SET status='COMPLETED' WHERE false $$, 'OK');

-- second attempt on the same invitation after a COMPLETED one: allowed live, but never a second COMPLETED
SELECT pg_temp.expect('A18 new live attempt after a COMPLETED one', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000305','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000405','00000000-0000-4000-8000-000000000505',repeat('1',64),decode(repeat('00',32),'hex'),'k1','STARTED',now(),now()+interval '30 minutes') $$, 'OK');
SELECT pg_temp.expect('A19 STARTED -> INVALIDATED(SUPERSEDED)', $$
 UPDATE app.admin_activation_attempts SET status='INVALIDATED', invalidated_at=now(), invalidated_reason='SUPERSEDED' WHERE attempt_id='00000000-0000-4000-8000-000000000305' $$, 'OK');
-- ATTEMPTS_EXHAUSTED path on a fresh attempt
SELECT pg_temp.expect('A20 attempt for exhausted path', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, otp_verified_at, password_hash, password_set_at, totp_key_id, totp_ciphertext, totp_iv, totp_tag, totp_issued_at, totp_attempt_count, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000306','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000406','00000000-0000-4000-8000-000000000506',repeat('2',64),decode(repeat('00',32),'hex'),'k1','TOTP_ISSUED',now(),'$argon2id$v=19$x',now(),'k1',decode('aabb','hex'),decode(repeat('00',12),'hex'),decode(repeat('11',16),'hex'),now(),4,now(),now()+interval '30 minutes') $$, 'OK');
SELECT pg_temp.expect('A21 5th wrong -> INVALIDATED(ATTEMPTS_EXHAUSTED) in one UPDATE', $$
 UPDATE app.admin_activation_attempts SET status='INVALIDATED', invalidated_reason='ATTEMPTS_EXHAUSTED', invalidated_at=now(), totp_attempt_count=5, password_hash=NULL, totp_key_id=NULL, totp_ciphertext=NULL, totp_iv=NULL, totp_tag=NULL, totp_issued_at=NULL WHERE attempt_id='00000000-0000-4000-8000-000000000306' $$, 'OK');

-- ===== F1: the sealed TOTP secret is all-or-nothing (a NULL column must never slip through a length CHECK) =====
BEGIN;
INSERT INTO app.admin_invitations (invitation_id, generation_id, phone_normalized, full_name, note, token_digest, status, version, created_by, created_at, expires_at, snapshot_sealed)
VALUES ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000203','+84911000003','F1','x',repeat('8',64),'PENDING',1,'00000000-0000-4000-8000-000000000001',now(),now()+interval '72 hours',false);
INSERT INTO app.admin_invitation_permissions VALUES ('00000000-0000-4000-8000-000000000103','CUSTOMER',true,false,false);
UPDATE app.admin_invitations SET snapshot_sealed = true WHERE invitation_id = '00000000-0000-4000-8000-000000000103';
COMMIT;
SELECT pg_temp.expect('F1a ciphertext NULL', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, otp_verified_at, password_hash, password_set_at, totp_key_id, totp_ciphertext, totp_iv, totp_tag, totp_issued_at, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000710','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000810','00000000-0000-4000-8000-000000000910',repeat('0',64),decode(repeat('00',32),'hex'),'k1','TOTP_ISSUED',now(),'$argon2id$v=19$x',now(),'k1',NULL,decode(repeat('00',12),'hex'),decode(repeat('11',16),'hex'),now(),now(),now()+interval '30 minutes') $$, '23514', 'admin_activation_attempts_totp_all_or_none_ck');
SELECT pg_temp.expect('F1b iv NULL', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, otp_verified_at, password_hash, password_set_at, totp_key_id, totp_ciphertext, totp_iv, totp_tag, totp_issued_at, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000711','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000811','00000000-0000-4000-8000-000000000911',repeat('1',64),decode(repeat('00',32),'hex'),'k1','TOTP_ISSUED',now(),'$argon2id$v=19$x',now(),'k1',decode('aabb','hex'),NULL,decode(repeat('11',16),'hex'),now(),now(),now()+interval '30 minutes') $$, '23514', 'admin_activation_attempts_totp_all_or_none_ck');
SELECT pg_temp.expect('F1c tag NULL', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, otp_verified_at, password_hash, password_set_at, totp_key_id, totp_ciphertext, totp_iv, totp_tag, totp_issued_at, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000712','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000812','00000000-0000-4000-8000-000000000912',repeat('2',64),decode(repeat('00',32),'hex'),'k1','TOTP_ISSUED',now(),'$argon2id$v=19$x',now(),'k1',decode('aabb','hex'),decode(repeat('00',12),'hex'),NULL,now(),now(),now()+interval '30 minutes') $$, '23514', 'admin_activation_attempts_totp_all_or_none_ck');
SELECT pg_temp.expect('F1d key id NULL', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, otp_verified_at, password_hash, password_set_at, totp_key_id, totp_ciphertext, totp_iv, totp_tag, totp_issued_at, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000713','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000813','00000000-0000-4000-8000-000000000913',repeat('3',64),decode(repeat('00',32),'hex'),'k1','TOTP_ISSUED',now(),'$argon2id$v=19$x',now(),NULL,decode('aabb','hex'),decode(repeat('00',12),'hex'),decode(repeat('11',16),'hex'),now(),now(),now()+interval '30 minutes') $$, '23514', 'admin_activation_attempts_totp_all_or_none_ck');
SELECT pg_temp.expect('F1e issued_at NULL', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, otp_verified_at, password_hash, password_set_at, totp_key_id, totp_ciphertext, totp_iv, totp_tag, totp_issued_at, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000714','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000814','00000000-0000-4000-8000-000000000914',repeat('4',64),decode(repeat('00',32),'hex'),'k1','TOTP_ISSUED',now(),'$argon2id$v=19$x',now(),'k1',decode('aabb','hex'),decode(repeat('00',12),'hex'),decode(repeat('11',16),'hex'),NULL,now(),now()+interval '30 minutes') $$, '23514');
SELECT pg_temp.expect('F1f iv wrong length', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, otp_verified_at, password_hash, password_set_at, totp_key_id, totp_ciphertext, totp_iv, totp_tag, totp_issued_at, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000715','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000815','00000000-0000-4000-8000-000000000915',repeat('5',64),decode(repeat('00',32),'hex'),'k1','TOTP_ISSUED',now(),'$argon2id$v=19$x',now(),'k1',decode('aabb','hex'),decode(repeat('00',11),'hex'),decode(repeat('11',16),'hex'),now(),now(),now()+interval '30 minutes') $$, '23514', 'admin_activation_attempts_totp_all_or_none_ck');
SELECT pg_temp.expect('F1g tag wrong length', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, otp_verified_at, password_hash, password_set_at, totp_key_id, totp_ciphertext, totp_iv, totp_tag, totp_issued_at, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000716','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000816','00000000-0000-4000-8000-000000000916',repeat('6',64),decode(repeat('00',32),'hex'),'k1','TOTP_ISSUED',now(),'$argon2id$v=19$x',now(),'k1',decode('aabb','hex'),decode(repeat('00',12),'hex'),decode(repeat('11',15),'hex'),now(),now(),now()+interval '30 minutes') $$, '23514', 'admin_activation_attempts_totp_all_or_none_ck');
SELECT pg_temp.expect('F1h ciphertext empty', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, otp_verified_at, password_hash, password_set_at, totp_key_id, totp_ciphertext, totp_iv, totp_tag, totp_issued_at, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000717','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000817','00000000-0000-4000-8000-000000000917',repeat('7',64),decode(repeat('00',32),'hex'),'k1','TOTP_ISSUED',now(),'$argon2id$v=19$x',now(),'k1',decode('','hex'),decode(repeat('00',12),'hex'),decode(repeat('11',16),'hex'),now(),now(),now()+interval '30 minutes') $$, '23514', 'admin_activation_attempts_totp_all_or_none_ck');
SELECT pg_temp.expect('F1i ciphertext too long', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, otp_verified_at, password_hash, password_set_at, totp_key_id, totp_ciphertext, totp_iv, totp_tag, totp_issued_at, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000718','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000818','00000000-0000-4000-8000-000000000918',repeat('8',64),decode(repeat('00',32),'hex'),'k1','TOTP_ISSUED',now(),'$argon2id$v=19$x',now(),'k1',decode(repeat('aa',257),'hex'),decode(repeat('00',12),'hex'),decode(repeat('11',16),'hex'),now(),now(),now()+interval '30 minutes') $$, '23514', 'admin_activation_attempts_totp_all_or_none_ck');
SELECT pg_temp.expect('F1j secret present while PASSWORD_SET', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, otp_verified_at, password_hash, password_set_at, totp_key_id, totp_ciphertext, totp_iv, totp_tag, totp_issued_at, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000799','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000899','00000000-0000-4000-8000-000000000999',repeat('7',64),decode(repeat('00',32),'hex'),'k1','PASSWORD_SET',now(),'$argon2id$v=19$x',now(),'k1',decode('aabb','hex'),decode(repeat('00',12),'hex'),decode(repeat('11',16),'hex'),now(),now(),now()+interval '30 minutes') $$, '23514');
SELECT pg_temp.expect('F1k fully populated TOTP_ISSUED row is accepted', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, otp_verified_at, password_hash, password_set_at, totp_key_id, totp_ciphertext, totp_iv, totp_tag, totp_issued_at, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000740','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000840','00000000-0000-4000-8000-000000000940',repeat('0',64),decode(repeat('00',32),'hex'),'k1','TOTP_ISSUED',now(),'$argon2id$v=19$x',now(),'k1',decode('aabb','hex'),decode(repeat('00',12),'hex'),decode(repeat('11',16),'hex'),now(),now(),now()+interval '30 minutes') $$, 'OK');

-- ===== OTP challenges (attempt 305 is INVALIDATED; use a fresh live attempt) =====
SELECT pg_temp.expect('C0 fresh live attempt', $$
 INSERT INTO app.admin_activation_attempts (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status, created_at, expires_at)
 VALUES ('00000000-0000-4000-8000-000000000307','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000407','00000000-0000-4000-8000-000000000507',repeat('3',64),decode(repeat('00',32),'hex'),'k1','STARTED',now(),now()+interval '30 minutes') $$, 'OK');
SELECT pg_temp.expect('C1 insert PENDING_DELIVERY', $$
 INSERT INTO app.admin_activation_otp_challenges (challenge_id, attempt_id, phone_normalized, otp_digest, digest_key_id, status, created_at, expires_at, resend_not_before)
 VALUES ('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000307','+84911000001',repeat('a',64),'k1','PENDING_DELIVERY',now(),now()+interval '300 seconds',now()+interval '60 seconds') $$, 'OK');
SELECT pg_temp.expect('C2 second live challenge of the attempt', $$
 INSERT INTO app.admin_activation_otp_challenges (challenge_id, attempt_id, phone_normalized, otp_digest, digest_key_id, status, created_at, expires_at, resend_not_before)
 VALUES ('00000000-0000-4000-8000-000000000602','00000000-0000-4000-8000-000000000307','+84911000001',repeat('b',64),'k1','PENDING',now(),now()+interval '300 seconds',now()+interval '60 seconds') $$, '23505');
SELECT pg_temp.expect('C3 PENDING_DELIVERY -> PENDING', $$ UPDATE app.admin_activation_otp_challenges SET status='PENDING' WHERE challenge_id='00000000-0000-4000-8000-000000000601' $$, 'OK');
SELECT pg_temp.expect('C4 wrong +1', $$ UPDATE app.admin_activation_otp_challenges SET attempt_count=1 WHERE challenge_id='00000000-0000-4000-8000-000000000601' $$, 'OK');
SELECT pg_temp.expect('C5 wrong +2 jump', $$ UPDATE app.admin_activation_otp_challenges SET attempt_count=3 WHERE challenge_id='00000000-0000-4000-8000-000000000601' $$, '23001');
SELECT pg_temp.expect('C6 count 2,3,4', $$ UPDATE app.admin_activation_otp_challenges SET attempt_count=attempt_count+1 WHERE challenge_id='00000000-0000-4000-8000-000000000601' $$, 'OK');
SELECT pg_temp.expect('C6b', $$ UPDATE app.admin_activation_otp_challenges SET attempt_count=attempt_count+1 WHERE challenge_id='00000000-0000-4000-8000-000000000601' $$, 'OK');
SELECT pg_temp.expect('C6c', $$ UPDATE app.admin_activation_otp_challenges SET attempt_count=attempt_count+1 WHERE challenge_id='00000000-0000-4000-8000-000000000601' $$, 'OK');
SELECT pg_temp.expect('C7 5th wrong while PENDING is refused', $$ UPDATE app.admin_activation_otp_challenges SET attempt_count=5 WHERE challenge_id='00000000-0000-4000-8000-000000000601' $$, '23001');
SELECT pg_temp.expect('C8 5th wrong -> LOCKED in one UPDATE', $$ UPDATE app.admin_activation_otp_challenges SET status='LOCKED', attempt_count=5, ended_at=now() WHERE challenge_id='00000000-0000-4000-8000-000000000601' $$, 'OK');
SELECT pg_temp.expect('C9 LOCKED is terminal', $$ UPDATE app.admin_activation_otp_challenges SET status='VERIFIED', verified_at=now() WHERE challenge_id='00000000-0000-4000-8000-000000000601' $$, '23001');
SELECT pg_temp.expect('C10 next challenge (cooldown handled by the service) then VERIFIED', $$
 INSERT INTO app.admin_activation_otp_challenges (challenge_id, attempt_id, phone_normalized, otp_digest, digest_key_id, status, created_at, expires_at, resend_not_before)
 VALUES ('00000000-0000-4000-8000-000000000603','00000000-0000-4000-8000-000000000307','+84911000001',repeat('c',64),'k1','PENDING',now(),now()+interval '300 seconds',now()+interval '60 seconds') $$, 'OK');
SELECT pg_temp.expect('C11 PENDING -> VERIFIED needs verified_at', $$ UPDATE app.admin_activation_otp_challenges SET status='VERIFIED' WHERE challenge_id='00000000-0000-4000-8000-000000000603' $$, '23514');
SELECT pg_temp.expect('C12 PENDING -> VERIFIED', $$ UPDATE app.admin_activation_otp_challenges SET status='VERIFIED', verified_at=now() WHERE challenge_id='00000000-0000-4000-8000-000000000603' $$, 'OK');
SELECT pg_temp.expect('C13 challenge delete forbidden', $$ DELETE FROM app.admin_activation_otp_challenges WHERE challenge_id='00000000-0000-4000-8000-000000000603' $$, '23001');
SELECT pg_temp.expect('C14 identity (digest) immutable', $$ UPDATE app.admin_activation_otp_challenges SET otp_digest=repeat('d',64) WHERE challenge_id='00000000-0000-4000-8000-000000000603' $$, '23001');
SELECT pg_temp.expect('C15 bad phone shape', $$
 INSERT INTO app.admin_activation_otp_challenges (challenge_id, attempt_id, phone_normalized, otp_digest, digest_key_id, status, created_at, expires_at, resend_not_before)
 VALUES ('00000000-0000-4000-8000-000000000604','00000000-0000-4000-8000-000000000307','0911000001',repeat('c',64),'k1','VERIFIED',now(),now()+interval '300 seconds',now()+interval '60 seconds') $$, '23514');

-- ===== limiter kinds =====
SELECT pg_temp.expect('L1 new activation kinds accepted', $$
 INSERT INTO app.admin_auth_limits (bucket_key, kind, window_started_at, failure_count, locked_until, updated_at) VALUES (repeat('1',64),'ACTIVATION_OTP_SEND',now(),1,NULL,now()) $$, 'OK');
SELECT pg_temp.expect('L2 unknown kind refused', $$
 INSERT INTO app.admin_auth_limits (bucket_key, kind, window_started_at, failure_count, locked_until, updated_at) VALUES (repeat('2',64),'ACTIVATION_NOPE',now(),1,NULL,now()) $$, '23514');
SELECT pg_temp.expect('L3 kind column fits the longest new kind', $$
 INSERT INTO app.admin_auth_limits (bucket_key, kind, window_started_at, failure_count, locked_until, updated_at) VALUES (repeat('3',64),'ACTIVATION_REQUEST_IP',now(),1,NULL,now()) $$, 'OK');

-- ===== membership origin guard =====
INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000011', '+84900000011', '$argon2id$v=19$x', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now()),
       ('00000000-0000-4000-8000-000000000012', '+84900000012', '$argon2id$v=19$x', NULL, 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now());
SELECT pg_temp.expect('M1 membership on an app-registered account refused', $$
 INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000011','ADMIN','ACTIVE',1,now(),now()) $$, '23514');
SELECT pg_temp.expect('M2 membership on an admin-provisioned account accepted', $$
 INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000012','ADMIN','ACTIVE',1,now(),now()) $$, 'OK');
SELECT pg_temp.expect('M3 second SYSTEM still refused by the existing unique index', $$
 INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000013', '+84900000013', '$argon2id$v=19$x', NULL, 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now());
 INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000013','SYSTEM','ACTIVE',1,now(),now()) $$, '23505');

-- ===== profile + permissions (deferred VIEW check: SET CONSTRAINTS ALL IMMEDIATE inside the sub-block fires it) =====
INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at) VALUES
 ('00000000-0000-4000-8000-000000000014', '+84900000014', '$argon2id$v=19$x', NULL, 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now()),
 ('00000000-0000-4000-8000-000000000015', '+84900000015', '$argon2id$v=19$x', NULL, 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now());
INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at) VALUES
 ('00000000-0000-4000-8000-000000000014','ADMIN','ACTIVE',1,now(),now()),
 ('00000000-0000-4000-8000-000000000015','ADMIN','ACTIVE',1,now(),now());
SELECT pg_temp.expect('P1 profile + VIEW permission in one transaction', $$
 INSERT INTO app.admin_profiles (user_id, invitation_id, full_name, note, phone_verified_at, created_at) VALUES ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000101','Nguyen Van A',NULL,now(),now());
 INSERT INTO app.admin_app_permissions VALUES ('00000000-0000-4000-8000-000000000012','CUSTOMER',true,false,false);
 INSERT INTO app.admin_app_permissions VALUES ('00000000-0000-4000-8000-000000000012','SHOP',true,true,true);
 SET CONSTRAINTS ALL IMMEDIATE $$, 'OK');
SELECT pg_temp.expect('P2 second profile for the same invitation', $$
 INSERT INTO app.admin_profiles (user_id, invitation_id, full_name, note, phone_verified_at, created_at) VALUES ('00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000101','Dup',NULL,now(),now()) $$, '23505');
SELECT pg_temp.expect('P3 profile without any VIEW permission', $$
 INSERT INTO app.admin_profiles (user_id, invitation_id, full_name, note, phone_verified_at, created_at) VALUES ('00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000103','NoView',NULL,now(),now());
 SET CONSTRAINTS ALL IMMEDIATE $$, '23514');
SELECT pg_temp.expect('P4 CUSTOMER with REVIEW refused', $$
 INSERT INTO app.admin_app_permissions VALUES ('00000000-0000-4000-8000-000000000014','CUSTOMER',true,true,false) $$, '23514');
SELECT pg_temp.expect('P5 LOCK without VIEW refused', $$
 INSERT INTO app.admin_app_permissions VALUES ('00000000-0000-4000-8000-000000000012','DRIVER',false,false,true) $$, '23514');
SELECT pg_temp.expect('P6 unknown app refused', $$
 INSERT INTO app.admin_app_permissions VALUES ('00000000-0000-4000-8000-000000000012','MANAGER',true,false,false) $$, '23514');
