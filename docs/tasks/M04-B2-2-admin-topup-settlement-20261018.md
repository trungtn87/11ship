# M04-B2.2 — Admin xác nhận tiền thực nhận, ghi ví một lần
Ngày giao: 18/10/2026. Trạng thái: **READY — triển khai B2.2a trước, KHÔNG mở cổng tiền cho đến B2.2b**.
11Ship repository: trungtn87/11ship.

## Hiện trạng đã hoàn thành
- M04-A1 PR #126 lõi ví + ledger; A2.1 PR #127 hold core; B1 PR #129 bank/source ledger integrity; B2.1 PR #130 (merge commit `a6b50322792cf03b622d45018297da41797e335b`) Shipper tạo/xem/hủy yêu cầu nạp.
- B2.1 có `POST /v1/driver/wallet/topup-requests` và GET receiving-accounts, nhưng chưa có tài khoản nhận production và chưa có API Admin xác nhận. `app.wallet_ledger_source_gate()` từ A1 vẫn từ chối mọi ledger INSERT. `ship11_app` chỉ SELECT bank/topups, chưa UPDATE ví hay INSERT ledger.
- Tiếp tục từ **main mới nhất**. Không sửa migrations đã merge.
- Nguồn hợp đồng: `docs/current/ADR-004-driver-wallet-consistency.md` v0.2 (§3–6 và §9–10), `docs/tasks/M04-B-topup-implementation-20261017.md`, `docs/current/M04-B1-topup-source-core-20261017.md`, `docs/current/M04-B2-1-shipper-topup-request-20261018.md`, `docs/ui/m04/README.md`.

## Nguyên tắc Owner LOCKED
1. Shipper **chỉ yêu cầu** nạp; **chỉ Admin có quyền riêng** mới xác nhận tiền thực nhận. Ảnh chuyển khoản / "Tôi đã chuyển tiền" **không tự** credit.
2. Chỉ ghi tiền thực sự đã đối soát trên sao kê; số thực nhận có thể khác số yêu cầu. Không auto-bank, không tạo giao dịch/QR/tài khoản mẫu trên môi trường production.
3. Mỗi định danh giao dịch ngân hàng chuẩn `(bank_id, system_owned_account_id, canonical_transaction_id)` chỉ được dùng **một lần trên toàn hệ thống** (không nằm theo ví/driver/admin). ID phải từ sao kê, không lấy memo/ảnh/tên file. Không chuẩn hóa mất leading zero/case.
4. `wallet_topups` + `wallet_bank_transactions` + TOPUP ledger + `driver_wallets.balance_vnd` + request CONFIRMED + audit/outbox/idempotency đều **cùng transaction**. Commit thiếu bất kỳ phần nào rollback toàn bộ. Zero wallet không tạo tiền.
5. VND nguyên bigint, số dư AVAILABLE = balance - held; TOPUP +x vào balance, không thay held; append-only ledger; sequence bảo toàn. Không ghi nếu driver CLOSED. Không tự ACTIVE hoặc approval M03. Không mở COMMISSION / WITHDRAWAL / ADJUSTMENT gate.
6. SYSTEM cao nhất; ADMIN quyền tài chính được SYSTEM cấp **từng chức năng**, không mặc định mọi ADMIN hoặc suy ra từ `can_review_profile`, `can_view` hay sidebar. Không cho customer/shop/shipper vào Admin Web.
7. Không merge, không deploy VPS, không migration production trong các gói Claude thực hiện.

## Chia nhỏ để triển khai an toàn
### B2.2a — Quyền tài chính + cấu hình tài khoản nhận của hệ thống (**GIAO CODE NGAY**, PR riêng)
- Bổ sung ACL tài chính từ DB, **default deny** cho ADMIN; SYSTEM implicit permission:
  - tối thiểu `wallet.read`, `wallet.topup.record`. Dùng schema key có thể mở rộng sau cho `wallet.withdrawal.process`, `wallet.withdrawal.confirm`, `wallet.withdrawal.reconcile`, `wallet.adjustment.post`, `driver.bank.read` mà không cấp bất kỳ quyền nào tự động.
  - bảng grant/binding bằng user_id tham chiếu `app.admin_memberships`, UNIQUE(user_id, permission_key), timestamp + version/actor; GRANT/REVOKE có audit/outbox và idempotency; thao tác SYSTEM-only, phải kiểm live admin session+TOTP+CSRF và quyền SYSTEM **dưới user/session lock**. Không grant tài chính cho SYSTEM như dòng ACL hoặc hạ cấp quyền qua API.
  - mỗi command Admin đọc/ghi sau này tái xác thực permissions **dưới khóa**. SYSTEM cấp/revoke không race để Admin vừa mất quyền vẫn post tiền. Tuân thủ lock order ADR-004.
  - Không đụng/viết lại `app.admin_app_permissions` hay snapshot invitation M01; tránh can-view tự kéo theo tài chính; không mở quyền tài chính trong profile M03 cũ. Nếu cần API xem quyền hiện tại cho Admin, trả scope phần tài chính đã được cấp, không PII.
- SYSTEM cấu hình tài khoản nhận **thật** trong `app.system_owned_bank_accounts` theo constraints B1 (bank_id, account_number, account_holder); expose SYSTEM-only API đọc + tạo bản ghi ban đầu inactive `can_receive=false`, + read list/detail. Không tạo dummy số TK. Identity immutable; muốn đổi ngân hàng/tên/số phải tạo tài khoản khác, không UPDATE identity; không DELETE. Lưu actor/audit/outbox, idempotency, version; bank code và số tài khoản validate đúng B1; nếu trùng báo conflict không leak thông tin khác.
- **B2.2a KHÔNG cho phép bật can_receive=true trên production/API**: tạm chưa có chức năng SET active. B2.2b sau khi credit path được kết nối và test mới mở riêng hành động ACTIVE/DISABLE. Nếu không có tài khoản active, B2.1 vẫn từ chối tạo yêu cầu. Fixture test có thể tạo tài khoản active bằng migrator trong DB test, không lộ lên production.
- Không tạo Admin confirm/reject endpoint trong B2.2a; không nới nguồn ledger hay quyền ghi ví/topups/bank-record. `ship11_app` chỉ cần INSERT vào system bank accounts cho SYSTEM config, SELECT ACL và thao tác grant/revoke ACL cần thiết; không UPDATE wallet, không INSERT ledger. Nếu UPDATE hệ thống tài khoản không cần ở B2.2a thì không grant UPDATE.
- Thêm migration additive cho ACL (và bảng audit metadata nếu thật sự cần), DOWN chặn lịch sử grant/account (bao gồm revoked), lock chống race, không CASCADE, giữ M01/M03/M04 tiền. Cập nhật `ops/selfhosted/02-runtime-grants.sql`, runbook và test quyền thật PG17.
- Test integration: ADMIN không có grant bị từ chối; SYSTEM có quyền; cấp/revoke từng quyền với idempotency+version, stale session/TOTP/CSRF/role bị chặn, không được sửa quyền bản thân để bypass; account only inactive, không delete/đổi identity, không có số giả; admin view M03 không đồng nghĩa tiền; no money mutation; DB down rollback và quyền role; CI Node24 PG17.
- Chỉ backend/DB; Web Admin UI B3 sẽ nối sau. PR riêng `feat/m04-b2-2a-finance-access-bank-setup`, review rồi Owner duyệt/merge mới mở B2.2b.

### B2.2b — Admin xử lý yêu cầu + nguồn TOPUP/ledger thực (**CHƯA CODE, sau B2.2a merge**)
- Quyền `wallet.topup.record` cho confirm/reject; riêng `wallet.read` cho list/detail theo scope. SYSTEM implicit; ADMIN chỉ khi quyền hiện hành được SYSTEM cấp, plus target money scope theo nguyên tắc ADR. Yêu cầu admin session live/2FA/CSRF. Không lấy actor/scope từ body.
- Read list/status PENDING/CONFIRMED/REJECTED/CANCELLED và detail (masked fields); POST reject PENDING→REJECTED có reason_code allowlist, resolver/time/version/audit/outbox; POST confirm PENDING→CONFIRMED theo `expected_version`, body gồm `actual_amount_vnd`, nhận đúng chứng từ `bank_id + system_owned_account_id + canonical_transaction_id`, `received_at`, `Idempotency-Key`. Phải kiểm đã nhận thực tế từ sao kê, kiểm source/scope/owner và trạng thái dưới khóa; tiền nhận lệch số request được ghi actual, giữ requested. Request đã CANCELLED/REJECTED/CONFIRMED không được xác nhận lại; tiền chuyển muộn cần đối soát riêng. Nếu cần giao dịch ghi nhận trực tiếp không gắn request, tách command có permission/log riêng, không tự tạo thành công từ client.
- Atomic money posting: khóa idempotency→Admin actor/session/finance rights→target user/driver root→wallet FOR UPDATE→bank account/receipt (lock order tuân ADR)→request PENDING row/version→bank registry IN + topup typed-FK→ledger TOPUP +actual signed delta/sequence_no/balance_after→UPDATE wallet B/version→request CONFIRMED/resolver/time→audit+outbox+idempotency; không giữ transaction qua network. Recheck Admin quyền ngay trong transaction theo đúng lock protocol.
- Migration sau B1 mở `app.wallet_ledger_source_gate()` **chỉ TOPUP có typed FK đúng nguồn wallet/amount**; mọi loại khác fail closed. Bảo vệ cross-table invariant COMMIT của B1 không bị sửa/giảm. Thêm privileges tối thiểu: INSERT bank registry/topups/ledger, UPDATE wallet cho service backend; không DELETE hoặc UPDATE append-only. Cập nhật ma trận quyền và PG17 tests.
- Bật can_receive=true chỉ sau khi MONEY path active, thông qua SYSTEM command versioned+audited; disable cần policy đối soát giao dịch đến muộn: không khóa khả năng ghi nhận tiền đã thực nhận sai lệch trong khi account đã disable (B1 bank gate hiện `can_receive=true` tại INSERT). Nếu cần đổi B1 gate, dùng migration additive riêng và chứng minh an toàn **không chỉnh migration B1 cũ**; không được bỏ kiểm tài khoản nhận là của hệ thống.
- Test PG17 bắt buộc: đúng một credit cho cùng canonical bank key với cùng/khác Idempotency-Key, race hai Admin/khác ví với cùng bank transaction chỉ một thắng, request cancel vs confirm, nguồn sai/wallet sai/amount sai rollback, ledger sequence và balance/held giữ đúng, idempotency replay reauthorize sau revoke/khóa session, no fake received proof, no direct client credit, handling 60k thực nhận trên request 100k, không auto ACTIVE, admin thiếu permission bị từ chối, forbidden withdrawal/commission/adjustment kinds. Test COMMIT unknown semantics theo primitive hiện tại, don't auto retry bank transfer; test crash rollback.
- Không tích hợp màn hình app/Admin trong B2.2b; B3 là UI+APK sau khi backend thành công.

## Ranh giới và các điểm cần chú ý
- M03 `approve` hiện chỉ lifecycle chứ chưa atomic funding policy như ADR-004. **Không tự sửa M03 approval trong B2.2a hoặc B2.2b**; ghi dependency tích hợp M03 activation riêng trước khi tuyên bố Shipper đủ điều kiện nhận đơn.
- B2.1 client không tự tạo proof upload; screenshot optional chỉ nối khi có private storage + ACL; không lưu public URL, base64 hay statement evidence trong audit/outbox.
- Không hardcode mức topup tối thiểu 100k cho **actual received**. Ngưỡng ở lúc Shipper CREATE request, từ M03 system parameter.
- B2.2a không làm thay đổi hành vi B2.1 production khi chưa có tài khoản nhận bật active; giữ fail closed.
- Nếu bất đồng giữa thiết kế và schema đã merge (ví dụ bank gate, permission scope), lập patch trong phạm vi PR tương ứng, kiểm với ADR; không nới nguồn tiền chỉ để test qua.
- Mọi lỗi COMMIT unknown không retry lệnh ghi tiền bằng key mới; business dedup bank identity vĩnh viễn.

## Bàn giao Claude B2.2a
1. Checkout latest main, branch `feat/m04-b2-2a-finance-access-bank-setup`.
2. Code đúng **B2.2a**, tạo PR, CI Node24 / PG17 + self-hosted PG17 rights. Không B2.2b/B3, không tiền thật, không APK.
3. Báo base/head SHA, PR, migration/grants/routes/auth matrix, tests, CI URL, dependency để mở B2.2b.
4. **Không tự merge, không deploy VPS hay migrate production**.
