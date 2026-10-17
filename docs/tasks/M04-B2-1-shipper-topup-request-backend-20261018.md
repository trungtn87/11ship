# 11Ship — M04-B2.1: Shipper tạo và quản lý yêu cầu nạp tiền (backend)
Ngày giao: 18/10/2026. **CODE HANDOFF — Claude triển khai riêng B2.1.**
Mục tiêu: Shipper dùng session hợp lệ để tạo, xem và hủy yêu cầu nạp; **không làm thay đổi số dư ví hoặc tạo tiền thực**. Đây là phần thứ nhất của M04-B2; B2.2 mở nghiệp vụ Admin xác nhận tiền thực nhận bằng PR riêng.

## Base, nguồn quyết định
- PR #129 (M04-B1 nguồn nạp tiền) đã merge vào `main` bằng commit `d6f483519bc8d03a08e6fe0d3ad4d54dd87204fa`. Khi bắt đầu code **fetch latest main**, không dựa vào SHA cố định vì có tác vụ khác cùng repo.
- Đọc `docs/tasks/M04-B-topup-implementation-20261017.md`, `docs/current/ADR-004-driver-wallet-consistency.md` v0.2, `docs/current/M04-B1-topup-source-core-20261017.md`, `docs/ui/m04/README.md`; kiến trúc tham khảo `apps/backend/src/shipper-self`, `apps/backend/src/client-auth/client-session-authority.ts`, `apps/backend/src/driver/shipper-wallet-parameters.ts`, `apps/backend/src/wallet`, `apps/backend/src/idempotency`.
- B1 có `app.wallet_topup_requests` với PENDING → CONFIRMED/REJECTED/CANCELLED, owner (wallet_id, driver_id), amount_requested_vnd, created_by_user_id, version, resolution fields; hiện runtime chỉ SELECT. A1/B1 ledger source gate vẫn đóng và không được mở trong B2.1.
- App 11Ship đã duyệt UI (giữ 5 tab), B2.1 chỉ backend. Không thay UI hay build APK.

## Phạm vi cần code ngay
1. Tạo `TopupRequest` owner service/repository + controller/module ở tầng trên Auth/M03/M04; bám conventions của `shipper-self`, tránh import M03 coordinator hay vòng module.
2. Định tuyến đề nghị theo convention hiện hành `/v1/driver/wallet/topup-requests`:
   - POST: body allowlist duy nhất `amount_vnd` (VND nguyên safe integer >0); yêu cầu `Idempotency-Key` UUID theo M00; response {request_id, amount_requested_vnd, state, version, created_at}.
   - GET list: của chính Shipper; phân trang giới hạn, order deterministic, optional status filter với allowlist; trả items+next_cursor/cursor an toàn, không đọc thông tin người khác.
   - GET `:request_id`: chỉ owner, trường hợp khác owner không tiết lộ tồn tại; không trả bank ref/PII.
   - POST `:request_id/cancel`: body allowlist `expected_version` (DB version), idempotency key; chỉ PENDING → CANCELLED, resolved_by_user_id là actor, resolved_at là DB time, version +1; không xóa.
   - GET receiving-accounts (hoặc gộp vào GET config theo existing conventions): liệt kê **chỉ** tài khoản hệ thống `can_receive=true` (bank_id, số tài khoản, tên chủ tài khoản) cho chính driver đã xác thực. Không hiển thị số tài khoản dummy, bank transaction reference, raw internal financial evidence hay tài khoản bank của Shipper.
   Tên route chi tiết có thể chuẩn hóa theo convention code hiện có nhưng giữ rõ contract/test.
3. Xác thực: `SessionAuthGuard` gồm native device proof, sau đó **ClientSessionAuthority.lock** trong transaction để kiểm tra user/session/app từ DB. Bắt buộc app `SHIP`, active role `DRIVER`, driver từ actor.userId (không nhận driver_id/wallet_id từ request); kiểm profile còn tồn tại, status không CLOSED. PENDING có thể yêu cầu nạp để được xét kích hoạt; không áp guard `DriverActiveGuard` cho tạo nạp. DISABLED/không có DRIVER context/FOOD app/cross-owner phải từ chối. Replay kiểm lại quyền hiện tại/ownership, không tạo request mới.
4. Tạo request:
   - Đọc mức `topup_min_vnd` **từ tham số M03 hiện có trong DB** tại thời điểm tạo; không hardcode 100.000 vào nghiệp vụ, cho phép SYSTEM đổi tham số sau này không sửa request cũ.
   - Nếu chưa có receiving account cấu hình `can_receive=true`, **không hướng dẫn chuyển tiền hoặc tạo request có thể khiến người dùng tin đã có địa chỉ nhận**: trả lỗi domain rõ và không ghi dữ liệu (GET vẫn có thể trả danh sách rỗng). B2.2 cấu hình tài khoản thật; test B2.1 dùng fixture bank account chỉ trong test DB.
   - Dùng driver root lock, `WalletService.ensureZeroWallet(context,driverId)` tạo ví 0 **trong cùng transaction** khi cần; INSERT `app.wallet_topup_requests` PENDING/version1, created_by chính user. Không ghi vào `wallet_topups`, `wallet_bank_transactions`, `wallet_ledger_entries`, không UPDATE `driver_wallets.balance_vnd/held_vnd`. GET không provision ví.
   - TransactionContext do coordinator/IdempotencyExecutor cấp; không mở nested transaction/COMMIT, không HTTP/bank calls. Actor + idempotency locks theo ADR-003/ADR-004, dùng fresh DB time khi so phiên.
   - Trong một transaction lưu request+audit tối thiểu+outbox event mang **ID, state, version**, không chứa bank account/phone/screenshot/note. Transaction thất bại rollback tất cả.
5. Cancel: lock actor/current session -> driver root -> request row FOR UPDATE; enforce owner, PENDING và expected_version, conditional update để tránh race với admin B2.2; audit/outbox trong cùng transaction. Không tự thay đổi tiền, vì request chưa được confirm; nếu request đã CONFIRMED/REJECTED/CANCELLED trả state/version conflict, không “undo” khoản topup đã post.
6. GET list/detail/view: quyền current role và owner theo DB; đọc không mutation; trang/tìm kiếm có limit phòng abuse. Trường hợp không provisioned chỉ trả list rỗng, không tự mở ví. Tiền bigint nội bộ, JSON number chỉ khi safe; không float.
7. Grants: B2.1 mở đúng `SELECT, INSERT, UPDATE` của `app.wallet_topup_requests` cho app runtime qua `ops/selfhosted/02-runtime-grants.sql`, runbook/grants tests. **Không grant INSERT/UPDATE** cho `wallet_topups`, `wallet_bank_transactions`, `system_owned_bank_accounts`; không UPDATE `driver_wallets`, không INSERT ledger, không mở `wallet_ledger_source_gate()`. Quyền B1 hiện SELECT-only ở nguồn khác vẫn giữ.
8. Không chỉnh migration B1 đã merge. Nếu phải thêm indexes/contract DB phục vụ B2.1, migration additive mới, không tháo safeguards của B1/A2.1. Không thêm ảnh chứng từ trôi nổi, URL public hoặc base64 chứng từ vào audit/DB; attachment thật chỉ khi có storage riêng bảo mật, tách task.

## Test bắt buộc — vừa đủ đúng
- Integration PostgreSQL 17: PENDING create hợp lệ dưới session SHIP/DRIVER + tài khoản nhận fixture đang active, request chỉ được tạo một lần với same idempotency key, không credit/ledger/bank record; GET không tạo ví.
- Mức nạp tối thiểu lấy DB (trước/sau đổi tham số), invalid 0/âm/fraction/unsafe/unknown fields.
- Tài khoản nhận chưa cấu hình, `can_receive=false`: không tạo request, không show tài khoản giả.
- Ownership/IDOR: user khác xem/hủy bị chặn; FOOD, CUSTOMER context, driver CLOSED và disabled account từ chối; role revoke/expired/invalid native device proof từ chối; PENDING driver được phép.
- Cancel PENDING thành CANCELLED đủ `resolved_at + resolved_by`, tăng version 1, không xóa lịch sử; cancel trùng key không lặp side effect, cancel sau terminal hoặc wrong version bị từ chối.
- Race 2 requests same key/2 cancels/current role revoke không tạo request thừa; business transaction rollback không để lại row/audit/outbox nửa chừng.
- Kiểm quyền runtime trên PG17 (đúng grants): request INSERT/UPDATE, bảng nguồn tiền/ledger/balance vẫn không writable.
- Không mở route Admin xác nhận, không ảnh hưởng M03, tests cũ vẫn xanh; lint/typecheck/build + CI Verify Node24/PG17 và selfhosted PG17. **Không chạy lại test Android UI** vì backend-only.

## Ngoài phạm vi
- B2.2: Admin `wallet.topup.record`/SYSTEM quản lý tài khoản nhận, input bank transaction identity/actual amount; mở ledger-gate cho TOPUP và credit+bank registry+ledger+wallet atomic; permissions tài chính tách riêng; reject Admin.
- B3: nối mobile 11Ship và Admin Web, QR/screenshot upload/private media nếu đã có dịch vụ phù hợp.
- Không tự ACTIVE Shipper/không cấp role; không thay M03/M07, A2.2 holds hay M04-C withdrawal; không ghi COD, không tự auto xác nhận từ screenshot.
- Tuyệt đối **không merge**, **không deploy VPS**, **không apply migration production**.

## Bàn giao Claude
Lấy latest main, tạo nhánh `feat/m04-b2-1-shipper-topup-request`, code **chỉ B2.1**, push PR; cung cấp base/head SHA, link PR, route/authorization, DB grants, PG17 tests, CI URL và các phụ thuộc B2.2. Sau review PR/Owner approve mới merge. B2.2 mở riêng, không tự triển khai tiếp trong PR này.
