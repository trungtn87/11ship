# M04-B2.2b — Admin đối soát nạp tiền và ghi ví TOPUP (18/10/2026)

**Trạng thái: READY_FOR_CLAUDE — implementation PR riêng, KHÔNG merge/deploy/migrate production.**
Repo: `trungtn87/11ship`. B2.2a = PR #131, merged to main (merge commit `9ffb98e9a0efc340b857d70d4637b97f65ee0dc4`). Phải checkout **main mới nhất**, không dùng base cũ của #131. Hiện không có PR B2.2b.

## 0. Nguồn sự thật / chống làm lại
Đọc trước (chỉ phần liên quan): `docs/tasks/M04-B2-2-admin-topup-settlement-20261018.md` mục **B2.2b**, `docs/current/ADR-004-driver-wallet-consistency.md` (§3–6, §9–10), `docs/current/M04-B2-2a-finance-access-bank-setup-20261018.md`, `docs/current/M04-B1-topup-source-core-20261017.md`, `docs/current/M04-B2-1-shipper-topup-request-20261018.md`. Đọc code thật của wallet / topup request / bank registry / admin actor / FinanceAccessParticipant / idempotency / migration hiện có và `ops/selfhosted/02-runtime-grants.sql`. Không sửa migration đã merge và không làm lại B2.2a.

## 1. Phạm vi khóa
**Backend + PostgreSQL + tests + documentation only**. Chưa Web Admin UI (B3), chưa APK, chưa SMS/Discord, chưa gateway ngân hàng / auto đối soát, không chỉnh M03 approval, M07, M04-C, M04 adjustment.

1. API Admin xem danh sách yêu cầu nạp có phân trang và lọc trạng thái `PENDING | CONFIRMED | REJECTED | CANCELLED`, xem chi tiết có kiểm `wallet.read` theo tài khoản đang đăng nhập (SYSTEM quyền ngầm, ADMIN mặc định từ chối). Chặn IDOR, không trả thừa chứng từ hoặc PII; danh sách không phải API lộ số tài khoản hệ thống cho ADMIN.
2. API Admin **từ chối** PENDING→REJECTED, `reason_code` allowlist, `expected_version`, `Idempotency-Key`, CSRF, Origin, audit/outbox; cần `wallet.topup.record`. Không ghi ledger/ví. Không được hủy/xác nhận lại yêu cầu đã terminal.
3. API Admin **xác nhận tiền thực nhận sau khi người có quyền đã đối chiếu sao kê**: PENDING→CONFIRMED với `expected_version`, `actual_amount_vnd` (VND nguyên safe integer dương), `bank_id`, `system_owned_account_id`, `canonical_transaction_id`, `received_at`, `Idempotency-Key`; permission `wallet.topup.record`. Số thực nhận có thể khác `amount_requested_vnd`; ví cộng **số thực nhận**, giữ nguyên amount requested. Ví dụ 100.000 yêu cầu, 60.000 nhận: ledger +60.000.
4. Định danh bank transaction toàn hệ thống `(bank_id, system_owned_account_id, canonical_transaction_id)` chỉ dùng một lần. Lấy transaction ID **từ sao kê ngân hàng**, không từ memo/ảnh/tên file; không đổi case, không bỏ số 0 đầu. Không cho Shipper/client gửi lệnh credit. Duplicate không tiết lộ thông tin ví/người nhận khác.
5. Xác nhận **một transaction PostgreSQL duy nhất**, cùng `TransactionContext`: lock/idempotency + actor session/TOTP live + finance-right lock `FOR SHARE` + M03 driver root + wallet `FOR UPDATE` + nguồn bank/request + bank registry `IN` + `wallet_topups` typed source + TOPUP ledger signed delta, sequence + wallet.balance/version + request CONFIRMED + audit/outbox/idempotency. Tuân thủ lock order ADR-004; pre-read chỉ discovery, phải recheck owner/source/version/status dưới khóa. Không mở HTTP/network trong transaction, không tự retry unknown COMMIT bằng key mới.
6. **Migration atomic mới** sau migration mới nhất: mở `app.wallet_ledger_source_gate()` **CHỈ** `TOPUP` có source hợp lệ; giữ `COMMISSION / WITHDRAWAL / ADJUSTMENT` fail-closed và các FK/deferred invariant B1/A1. Đồng thời cấp DB grants tối thiểu cho B2.2b: INSERT bank transactions/topups/ledger, UPDATE wallet, UPDATE request (đã có quyền cho cancel), UPDATE system-owned bank accounts cho lệnh SYSTEM bật/tắt; không UPDATE/DELETE ledger/topups/bank registry, không DELETE bảng tiền. Đồng bộ `ops/selfhosted/02-runtime-grants.sql`, runbook/migration specs; kiểm quyền thật `ship11_app` PG17.
7. SYSTEM-only command **bật/tắt nhận tiền** trên tài khoản ngân hàng đã cấu hình B2.2a, có `expected_version`/idempotency/CSRF/session 2FA/audit/outbox, giữ immutable identity và không DELETE. Chỉ bật khi TOPUP posting path đã được triển khai và kiểm thử. Cần thiết kế xử lý **tiền đến trước khi tắt nhưng xác nhận sau khi tắt** mà không mở đường ghi tiền giả: B1 hiện bank registry INSERT cần `can_receive=true`. Nếu cần sửa policy trigger/gate, dùng migration mới + test xác minh thời điểm giao dịch, account identity và authorization; không sửa B1 cũ, không bỏ qua kiểm bằng cách mở ghi tùy ý. Nếu chưa thể chứng minh policy disable an toàn, **fail closed** và báo blocker, không tự nới constraint.

## 2. Bảo mật và vận hành
- Dùng B2.2a `FinanceAccessParticipant.require(context, actor, 'wallet.topup.record', nowMs)` cho POST confirm/reject, `wallet.read` cho read; **recheck actor/session/TOTP/live membership** dưới khóa, không chỉ check cookie. Thu hồi quyền phải chặn command bắt đầu sau revoke; command qua khóa trước revoke được serialize đúng. Không suy ra tiền từ `admin_app_permissions`/quyền M03.
- Không nhận actor, driver_id, wallet_id, role, can_receive, delta tiền hay ledger fields do client tự cung cấp khi xác nhận; suy ra từ server và request đã lock. Audit/outbox KHÔNG chứa số tài khoản ngân hàng, tên chủ tài khoản, mã giao dịch thực tế, token, ảnh, memo.
- `wallet.balance_vnd` + actual; `held_vnd` không đổi; `available=balance-held`, wallet.version tăng chuẩn; tạo zero wallet nếu được phép đúng root trước khi ghi ledger, nhưng **không có topup source thì không thể credit**. Driver CLOSED bị chặn; không tự chuyển ACTIVE, không thay initial-activation state của M03.
- Sau trạng thái CANCELLED/REJECTED/CONFIRMED, không confirm lại. Giao dịch đến muộn cần quy trình đối soát riêng, không tạo command generic credit hoặc lén nối request mới.
- Chưa tạo số tài khoản ngân hàng giả, dữ liệu ngân hàng mock, hoặc giao dịch TOPUP thực trên production; fixture test mới được phép dùng dữ liệu giả.
- Không dùng screenshot hoặc statement upload làm chứng cứ tự động. Hành động ADMIN xác nhận là quyết định đối soát thủ công, với trường chứng từ, ID ngân hàng duy nhất, thời điểm và audit rõ ràng.

## 3. PG17 acceptance gate (tối thiểu)
- Happy-path 1 credit, nguồn đúng, ledger exactly once, balance/held/sequence/version, request terminal và audit/outbox đồng commit.
- Duplicate bank key với **cùng và khác Idempotency-Key**, 2 admin/2 ví tranh cùng bank ID: đúng một lần credit, không lộ target; rollback phía thua; không tạo ghost bank row.
- Confirm vs Shipper cancel; confirm vs reject; stale expected_version; replay key sau revoke/session disabled; ADMIN thiếu quyền read vs record, SYSTEM implicit; role customer/shipper bị chặn.
- Request 100k nhưng actual 60k; actual 0/âm/float/overflow sai; source bank account mismatch, disabled/late bank case, driver CLOSED; COMMIT UNKNOWN không auto retry.
- Test DB triggers/FK/deferred COMMIT: orphan source, wrong wallet, wrong amount, duplicate ledger or sequence, insert forbidden ledger kinds, ledger UPDATE/DELETE/TRUNCATE, source tampering → fail-closed.
- Crash injected tại từng bước write phải rollback tất cả; chỉ valid credit được giữ; kiểm B2.1 không tạo tiền khi gửi request, B2.2a grant/account unchanged ngoài activation có version.
- Down migration: dữ liệu TOPUP/bank/ledger đã có thì từ chối destructive rollback; database rỗng có thể down/up không ảnh hưởng A1/A2.1/B1/M03/M06/finance grants. Race khi down, quyền runtime thật qua selfhost PG17 TLS.
- Chạy lint/typecheck/build/unit/integration CI local+CI mode, Node24/PostgreSQL17, self-hosted role test; không sửa test cũ để che lỗi, không thay đổi launcher trừ khi chứng minh gây lỗi.

## 4. Bàn giao Claude
1. Checkout `main` mới nhất; kiểm migration order và PR open, tạo nhánh `feat/m04-b2-2b-admin-topup-posting`.
2. Implement phạm vi ở trên; nếu khối lượng quá lớn hãy chia **PR triển khai hẹp an toàn** (backend reads/reject trước, money atomic sau), nhưng **không bật can_receive=true hay mở ledger một phần** trước khi tất cả phần tiền hoàn chỉnh, migration/grants được test.
3. Mở PR, gửi SHA base/head, route/permission matrix, migration timestamp + DB grants, trường hợp bảo vệ duplicate/race, CI link và kết quả.
4. **KHÔNG tự merge main, KHÔNG deploy VPS, KHÔNG chạy migration production**, không tự tuyên bố M03 eligible khi chưa nối activation.
