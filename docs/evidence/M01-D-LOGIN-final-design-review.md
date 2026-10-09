# Kiểm tra cuối thiết kế M01-D-LOGIN
Ngày09/10/2026. Reviewed head 8132c144f0bf0d7d4748f0fd5796953eda4fae2d.
Phạm vi: contract backend và sửa F01–F06/R01–R03, đối chiếu draft và prompt preflight. Không code/CI/runtime/security certification.
Kết luận: không phát hiện thêm finding bắt buộc trong phạm vi review này. Các finding trước được giải quyết ở mức tài liệu; đủ chuyển Claude preflight implementation backend, không tự duyệt UI integration/production.

| Finding | Kết quả |
|---|---|
| F01 | TOTP bucket/challenge decision/counter atomic; failure commit trước trả error |
| F02 | Session/challenge password binding historical key, recheck dưới khóa |
| F03/R02 | Pending owner/supersession/expiry, factor ID+version snapshot và activate giữ generation |
| F04 | Origin default/backfill/CHECK, registration giữ insert cũ và app guard additive |
| F05/R01 | GET/me và verify thống nhất không scopes, ADMIN không implicit full access |
| F06 | CSRF stable credential HMAC, GET không rotate, key unavailable fail closed |
| R03 | Limiter key riêng + singleton config, crypto rotation không reset bucket |

Kiểm API schema đồng nhất, không bearer response web, cookie HttpOnly/Secure/Strict; TTL5m/8h không sliding; 2FA chưa hoàn tất không cấp admin session; login thành công mới revoke session cũ.
Các tham số Owner đã chốt không cần hỏi lại.

## Điều kiện implementation
Claude fetch main và so SHA, reconcile account_origin nếu #27/main đổi; không coi reviewed design SHA là backend base.
Claude preflight dependency/library TOTP và compatibility keyring; tạo file list/tests trước code. Mọi mismatch mới báo finding, không tự đổi nghiệp vụ.
Lock order mọi path login/enrollment/supersession phải nhất quán bucket trước user; nếu path cần nhiều buckets thì lock bucket_key theo thứ tự cố định trước user, không lấy bucket sau user.
Migration SQL phải làm đầy đủ column types/NOT NULL/CHECK/digest lengths/indexes như convention repo; chứng minh invariant bằng integration, không chỉ assertion UI.
Cookie parser phải từ chối ambiguous duplicate credential cookies; state ưu tiên session hợp lệ nếu cả session/preauth tồn tại, không downgrade phiên; invalid preauth không làm mất session. Đây là ca implementation cần kiểm, không thay nghiệp vụ.
TOTP malformed/unknown challenge chịu ingress protection, rate limiting không dựa spoofed forwarded IP. Không public deploy khi proxy trust chưa khóa.
Frontend selection, UI states còn task riêng; không tự code UI hoặc merge #24/#29/#31. M00 vẫn tạm dừng.

## Những gì chưa đạt
Chưa code/migrate/test, chưa CI, chưa browser reload hoặc Authenticator thật, chưa local/phone Owner acceptance. Recovery chưa làm, không production rollout.
Prompt hiện vẫn chỉ preflight: cần implementation handoff có base/file scope sau preflight đạt; không diễn giải review này thành đã gửi Claude hoặc đã merge PR#30.
Review apply reviewed tree trên; commit báo cáo chỉ thêm evidence. M01 chưa đóng.
