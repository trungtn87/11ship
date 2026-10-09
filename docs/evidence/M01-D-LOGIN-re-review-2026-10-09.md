# Re-review M01-D-LOGIN — 09/10/2026
Reviewed exact head: 5718971c60f2ffc53dc1beb8fc521eb0b793411a.
Kết luận: CHƯA PASS; còn2 finding bắt buộc và1 điểm hardening cần khóa.
Review thiết kế, không test code/CI/local. Báo cáo commit không thay reviewed tree.

## Kết quả F01–F06
F01: counter TOTP/challenge atomic và khóa cùng budget đã mô tả đủ để giải quyết race cũ ở mức thiết kế.
F02: password binding/key ID trong session + recheck đã giải quyết thiếu binding.
F03: có supersession/expiry/rerun, nhưng snapshot factor_version enrollment còn thiếu (R02).
F04: origin NOT NULL DEFAULT + CHECK và phạm vi guard additive đã giải quyết rủi ro REGISTER cũ.
F05: đoạn prose bỏ scopes nhưng GET/me table vẫn còn scopes (R01).
F06: CSRF HMAC ổn định, GET không rotate và historical key fail closed đã giải quyết multi-tab conflict cũ.
Không gọi các điểm sửa đạt implementation trước test tương ứng.

## R01 — P1: GET/me vẫn yêu cầu scopes
Nguồn docs/tasks/M01-D-LOGIN-backend-handoff.md, API table GET/me.
Table còn “user_id,admin_role,scopes,expires_at,csrf_token”, prose và các response verify đã bỏ scopes; schema không có scopes.
Trigger: implementer viết GET/me theo table; phải invent dữ liệu hoặc khác type giữa me/verify.
Fix: bỏ scopes khỏi GET/me table/type và cập nhật mọi contract/UI consumer; ADMIN không có quyền module mặc định, scope task sau. Test schema strict response không scopes và no implicit full access.

## R02 — P1: enrollment chưa định nghĩa cập nhật factor_version trong challenge
Nguồn handoff schema admin_auth_challenges và pending lifecycle.
Login tạo challenge khi chưa có factor nên factor_version nullable. Enrollment tạo factor ID/version nhưng chưa chỉ định atomic bind snapshot vào challenge; verify yêu cầu factor version matching.
Trigger: first enrollment rồi verify hoặc enrollment response mất và rerun.
Impact: triển khai có thể luôn fail mismatch, hoặc bỏ kiểm snapshot và làm yếu bảo vệ QR supersession; không đủ state transition contract.
Fix: POST enrollment khóa bucket/user/member/factor/challenge đúng thứ tự, tạo pending factor và set challenge.factor_version=factor.version trong cùng transaction; pending owner phải challenge_id match. Nếu cùng challenge rerun thì bắt buộc snapshot match, giữ secret/version. ACTIVE transition phải chốt có tăng version không; session mới dùng version sau transition, consumed challenge không tái sử dụng. Mọi mismatch fail closed.
Tests first login/enroll/verify, rerun, supersede old challenge, concurrent enrollment/verify; enrollment secret không dùng với challenge khác.

## R03 — P2: HMAC rate bucket key chưa có policy key rotation
Nguồn handoff admin_auth_limits bucket_key HMAC và keyring sử dụng.
Trigger: thay active crypto key khi user/IP đang locked.
Impact: nếu bucket HMAC theo active key, key rotation tạo bucket mới và reset lockout; nếu bỏ old key thì không tìm được bucket cũ. Counter atomic chưa xử lý identity thay đổi.
Fix: key riêng ổn định cho limiter và chính sách retention/migration; hoặc lookup historical buckets với giới hạn rõ, không chỉ active key. Không dùng key_id trong bucket để ngầm reset lock. Chốt trusted proxy/source IP trước public deploy.
Tests lockout qua key rotation, restart, nhiều instance.

## Gate
Chưa READY_FOR_CLAUDE code. Các nghiệp vụ Owner chốt không cần hỏi lại; chỉ sửa contract kỹ thuật R01–R03 rồi re-review.
M00 vẫn tạm dừng; UI trang chủ/tạo ADMIN và nghiệm thu app ở các task tiếp. Không merge/deploy/đóng M01.
