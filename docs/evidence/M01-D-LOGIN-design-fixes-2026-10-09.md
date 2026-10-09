# Sửa review thiết kế đăng nhập — 09/10/2026
Review gốc head f4960b041e25315d9fc77694cd7b79db8b319497. Sửa tài liệu theo yêu cầu Owner; chưa code/test/merge.
| Finding | Sửa contract |
|---|---|
| F01 | TOTP bucket → user/factor/challenge, attempt+budget+decision atomic; commit counters trước trả lỗi; password quota shared và recheck trước cấp preauth |
| F02 | Password binding+historical key ID cả challenge/session; authorization recheck dưới khóa; writer revoke atomic |
| F03 | Login mới supersede preauth/pending cũ dưới khóa; một owner challenge; rerun ổn định; active factor không overwrite |
| F04 | Origin NOT NULL DEFAULT PHONE_VERIFIED + pairing CHECK; explicit admin bootstrap; scope cho phép guard/repository additive, hồi quy REGISTER |
| F05 | Bỏ scopes khỏi login API gói này; ADMIN chỉ account/auth shell, quyền module task sau; không implicit full access |
| F06 | CSRF HMAC stable theo credential nonce/key, GET không rotate/ghi DB; key lịch sử fail closed; hai tab/F5 giữ ổn định |

Draft bỏ bảng bearer/API/schema cũ, trỏ một contract kỹ thuật; sửa literal newline checklist.
Kiểm lại bằng đọc contract và mapping acceptance; không gọi là CI hoặc test code đã đạt.
Phần create ADMIN/scope UI tiếp sau; chưa tự thiết kế full permissions để lấp finding. Credential origin admin không giả phone verified.
Cần re-review kỹ thuật head cuối và đối chiếu main trước Claude implementation. M00 vẫn tạm dừng, local/phone acceptance chưa thực hiện.
