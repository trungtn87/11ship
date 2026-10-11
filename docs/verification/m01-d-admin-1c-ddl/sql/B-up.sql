ALTER TABLE app.admin_auth_limits DROP CONSTRAINT admin_auth_limits_kind_ck;
ALTER TABLE app.admin_auth_limits ADD CONSTRAINT admin_auth_limits_kind_ck CHECK (
 kind IN ('LOGIN_PHONE','LOGIN_IP','LOGIN_REQUEST_IP','TOTP_USER','TOTP_REQUEST_IP',
          'ACTIVATION_REQUEST_IP','ACTIVATION_LINK_IP','ACTIVATION_OTP_SEND','ACTIVATION_TOTP')
);
