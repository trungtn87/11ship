# M03–M04 — Acceptance và concurrency matrix

Ngày 07/10/2026. Version 0.1. DESIGN TEST CONTRACT, CHƯA CHẠY. Normative source: ADR-004 v0.1 và ADR-003 v0.3. Không thay C01–C30 hay báo PASS vì tài liệu đã viết.

## 1. Harness và assertion chung

PostgreSQL thật, independent connections và barrier chủ động ở điểm đọc/lock/update/commit; mỗi race chạy hai thứ tự thắng khi hợp lệ. Không sleep dài, không chỉ Promise.all. HTTP tests qua auth/error pipeline thật; fault-inject commit acknowledgement ở boundary có thể chứng minh DB đã commit bằng connection khác. Không mock toàn DB rồi gọi là concurrency integration.

Sau mọi transaction thành công hoặc bị từ chối, dùng consistent snapshot kiểm:
1. B=SUM(signed ledger), H=SUM(ACTIVE holds), A=B-H>=0; 0<=H<=B.
2. Capture debit count đúng 1 theo source; release debit count=0; cùng amount/wallet/driver/source.
3. Một active assignment/delivery; xế thua không mất available, không có orphan hold/ledger/source.
4. PENDING/PROCESSING/RECONCILIATION có ACTIVE withdrawal hold; PAID CAPTURED+1 debit; CANCELLED RELEASED+0 debit.
5. Audit/outbox/idempotency success cùng commit; rollback không để success record rời.
6. Tiền/hash/record count không chỉ kiểm HTTP status. Query state và row counts chính xác.

Fixture tối thiểu: PENDING/ACTIVE/SUSPENDED/CLOSING drivers; PLATFORM và EXTERNAL; verified/unverified/version-changed bank; admin read-only, topup-only, approval-only, processing-owner, reconciliation-only, revoked; 2 admin cùng bank receipt; wallet 0/999/1000/9999/10000/11000/100000; ACTIVE/terminal holds; active assignment; failed delivery còn incident hàng; 2 routing versions; một request PAID và một RECONCILIATION.

## 2. Race matrix bắt buộc

| ID | Race và lịch xen kẽ | Bảo vệ cần kiểm | Expected DB outcome |
|---|---|---|---|
| R01 | Hai admin, khác key, cùng bank ref; cả hai qua pre-read trước insert | Bank unique toàn ví/API; wallet root | Một topup/credit; bên thua conflict, không activation/audit success dư; thử target cùng và khác ví |
| R02 | NEW_TOPUP+APPROVE commit rồi mất HTTP; same key retry, new key retry; normal topup cùng ref | M03-B coordinator, bank unique, activation marker | Credit 1 lần, ACTIVE 1 lần; new key không credit lại; existing mode không thêm ledger |
| R03 | Available=10000; accept reserve=1000 tranh withdrawal=10000 | Driver/wallet locks | Chỉ một khả năng đủ tiền thắng; A không âm; thua không orphan |
| R04 | Available=1000; accept=1000 tranh adjustment debit=1000 | Cùng driver/wallet root | Một thắng, một insufficient; hold/ledger chính xác |
| R05 | Available=10000; hai withdrawal mỗi 10000 khác key; sau đó thử B=20000 | Wallet serialized + mỗi withdrawal/hold atomic | B=10000 chỉ 1 request; B=20000 có thể cả 2, H=20000; không unique giả theo amount |
| R06 | 20 driver (trộn type), 20 connections accept cùng delivery D | Driver rồi D lock; partial unique active assignment | Đúng 1 winner, 1 ACTIVE assignment/commission hold; 19 loser không mất tiền |
| R07 | EXTERNAL đang 2/limit3, accept D3/D4 đồng thời; PLATFORM available chỉ 1000 thử 2 accept | Driver/routing/wallet roots | EXTERNAL không thành 4; PLATFORM miễn count nhưng vẫn chỉ reserve được 1 khi thiếu tiền |
| R08 | Complete và fail cùng assignment delivering; barrier trước terminal mutation | Delivery/assignment/hold cùng transaction | Hoặc completed/captured/1 debit hoặc failed/released/0 debit+incident; không kết hợp chéo |
| R09 | Capture và release cùng hold bằng participant harness; thử key khác | Wallet/hold lock, conditional terminal, unique debit | Một terminal thắng; opposite conflict; H giảm đúng một lần |
| R10 | Suspend lấy driver root trước accept; đảo thứ tự | Driver root và fresh status | Suspend trước -> accept deny; accept trước -> assignment tồn tại sau suspend, không auto-cancel |
| R11 | Set accepting=true với suspend; cả hai dùng version cũ | Root/version + whitelist updates | Không ghi đè status ACTIVE từ snapshot; suspended accepting=false; stale toggle conflict |
| R12 | PLATFORM→EXTERNAL trong lúc evaluation/accept, đang vượt count/ngoài registered area | Driver/type/routing versions | Edit trước -> accept mới dùng EXTERNAL; accept trước giữ đơn cũ; không hủy assignment cũ |
| R13 | Closure guard đọc 0 assignment tranh accept; thêm fail có hàng ở xế | Driver root chung tất cả writer + incident guard | Không CLOSED kèm assignment/incident unresolved; fail release tiền không gỡ trách nhiệm hàng |
| R14 | Closure evaluate tranh withdrawal start/PAID; có PROCESSING/RECONCILIATION | Wallet/withdrawal guard dưới driver root | ACTIVE hold luôn chặn CLOSED; chỉ sau paid và balance0, hết nghĩa vụ mới closed |
| R15 | Bank edit/name edit tranh withdrawal create; thử create lấy root trước rồi edit trước start | Driver/bank version + snapshot | Snapshot cũ đồng nhất hoặc create deny bản chưa verified; start với version đổi bị BANK_SNAPSHOT_STALE |
| R16 | Hai admin start-processing; owner A chuyển rồi mất kết nối, B thử takeover | Version/processing owner, no transfer lease | Một claim; B chỉ reconciliation, không quyền chuyển mới; unknown giữ hold |
| R17 | Permission revoke/disable tranh credit/paid/replay; đảo thứ tự root | M01 user root và current guard | Revoke trước -> deny; mutation trước -> revoke đợi; không giữ quyền bằng client/JWT stale |
| R18 | Incident resolution tranh closure; fail incident creation tranh closure | Driver root + M07 guard | Không khoảng trống failed/ended trước khi incident durable; resolve hợp lệ rồi mới có thể closed |

## 3. Tiền, uniqueness và sai liên kết

| ID | Case | Expected |
|---|---|---|
| F01 | Zero wallet, credit60k+40k rồi EXISTING_FUNDS; credit150k+approve | Không mất tiền dư; existing không thêm credit; đủ available và net funding mới activate |
| F02 | NEW_TOPUP insufficient/profile invalid/audit failure sau credit primitive | Toàn transaction rollback; có thể topup thường ở command khác, không thành công nửa |
| F03 | Existing funding của driver khác; IDs trùng; reversed funding; available đã hold | Reject; không tự đủ100k bằng tổng nạp gross hoặc IDOR |
| F04 | ACTIVE balance xuống dưới100k; commission hold1000 còn đủ; PLATFORM thiếu999 | ACTIVE vẫn accept khi đủ mọi rule; PLATFORM999 deny; không enforce deposit |
| F05 | Hold duplicate same assignment vs assignment mới sau return | Duplicate không reserve lại; assignment mới có hold mới, history cũ RELEASED |
| F06 | Capture wrong wallet/driver/amount/source; ledger source không tồn tại | Service và deferred constraint reject, full rollback |
| F07 | Withdrawal9999/10000, fractional/NaN/string/unsafe-number/overflow | Reject invalid; 10000 hợp lệ chỉ khi available đủ; không rounding |
| F08 | Same key same body; changed amount/mode/ref/version; khác actor; sau replay/dedupe expiry | Replay/conflict theo ADR; business unique sống lâu hơn cache; current guard vẫn chạy |
| F09 | UPDATE/DELETE/TRUNCATE ledger; sửa source/amount hold; terminal→ACTIVE | DB/application reject; không reassign nguồn, không rewrite history |
| F10 | Direct inconsistent projection/hold/source inserts trong tx dưới app role | Commit bị chặn invariant; thử orphan ledger/hold, no matching debit, duplicate capture |
| F11 | Same outgoing bank ref cho hai withdrawal; ref đã ghi RECONCILIATION; reuse IN/OUT khác source; khác amount/destination | Shared bank registry unique/conflict; không gắn cùng chứng từ cho hai debit hoặc đổi direction; mismatch vào reconciliation, không nhả registry cho reuse |
| F12 | B/H mismatch injected qua privileged test fixture; reconcile read dưới concurrent writer | Báo đúng consistent snapshot, không tự overwrite B/H; fixture đặc quyền không giả app write hợp lệ |

## 4. Withdrawal/lifecycle/security

| ID | Case | Expected |
|---|---|---|
| W01 | PENDING cancel; processing cancel; paid cancel; reconciliation unknown | Chỉ pending cancel release; các nhánh không được mở bị deny, unknown giữ hold |
| W02 | Reconcile CONFIRMED_NOT_SENT_FINAL với/không bằng chứng final | Chỉ đủ proof không in-flight mới CANCELLED/release; không tìm thấy tạm thời giữ RECONCILIATION |
| W03 | Reconcile CONFIRMED_PAID sau owner bị revoke | Reconciler có quyền độc lập post một lần; không mượn session owner, không gửi tiền |
| W04 | Bank/name thay sau PROCESSING | Payout snapshot giữ nguyên; không sửa account đang xử lý; new request dùng verification mới |
| W05 | Amount/destination thực lệch; owner timeout | RECONCILIATION, no PAID/debit giả; không partial payout tự sinh |
| L01 | Suspend/toggle off/type downgrade khi đang giữ hàng | Assignment/responsibility còn; accept mới deny theo policy; xử lý đơn cũ không dùng ACTIVE-only guard |
| L02 | Closure với balance9000,10000,0; active hold hoặc unresolved incident | 9000 pending balance; 10000 closing không auto withdrawal; 0 chỉ closed khi mọi guard sạch |
| L03 | M07 responsibility adapter thiếu/lỗi | CLOSURE_GUARD_UNAVAILABLE; không assume không có assignment |
| L04 | Hủy closure sau admin suspend mới; trước đó accepting=true | Không khôi phục quyền vượt restriction; chỉ bật lại khi prior và eligibility hiện tại đều cho phép |
| S01 | PLATFORM driver gọi mọi admin mutation; driver PATCH type/status/balance/verify flag | 403/strict validation; không quyền quản trị phát sinh |
| S02 | Dashboard reader gọi topup/paid/adjustment, wrong-scope admin, forged target ID | Deny, không resource/bank detail leak |
| S03 | Driver đọc wallet/withdrawal người khác; replay sau mất role/permission | Deny; record key không là credential |
| S04 | Secret/bank markers trong request/note/evidence; inspect logs/audit/outbox/push/replay_guard | Không marker nhạy cảm; authorized business snapshot vẫn đúng; không raw request/event |
| S05 | Driver user disabled nhưng còn tiền/hàng | Driver session deny; admin có quyền vẫn settlement/incident; không auto tịch thu/complete |
| N01 | Rename namespace và fixtures | PLATFORM/EXTERNAL hợp lệ; legacy SYSTEM bị reject ở driver type; role SYSTEM/SYSTEM_DISTANCE/SYSTEMROOT nguyên vẹn |

## 5. Crash/fault injection

| ID | Điểm dừng | Expected |
|---|---|---|
| C01 | Sau từng participant write nhưng trước COMMIT của approve/accept/complete/fail/withdraw/create/paid | Rollback đồng bộ; không orphan và không success audit/outbox |
| C02 | DB commit đã xảy ra, trước HTTP; retry cùng key và sau dedupe TTL | Một effect theo business source; không callback money mới cho source đã dùng |
| C03 | COMMIT ack lost, server commit hoặc server rollback, process restart | M00 unknown outcome; same key phân xử; không kết luận rollback từ thrown error |
| C04 | Transfer thủ công đã thành công nhưng API chưa PAID; retry/cancel/start từ admin khác | Hold ACTIVE, đối soát; không cho transfer lại hoặc release |
| C05 | PAID commit rồi mất response | Một capture/debit/payout ref; GET/replay đúng, không bank call |
| C06 | Outbox commit rồi worker chết; publish rồi ack mất; stale token; DEAD | Money không lặp; event id ổn định; consumer atomic dedupe; không tuyên bố guaranteed push |

## 6. Review evidence và gate

Map mỗi ID -> test file/assertion path, commit, database version, command, PASS/FAIL/BLOCKED. R06 dùng >=20 connections đủ pool capacity hoặc harness explicit; không giả 20 concurrency với pool1. R03/R04/R05 chạy hai thứ tự winner. Fault injection phải ghi boundary thật/mô phỏng.

Design review chỉ kiểm contract đủ. Runtime acceptance chỉ khi Claude đã implementation/migration và test thật; task nhỏ chỉ claim các case của mình. M04-A chưa có M07 có thể test hold bằng fixture constrained source trong harness, nhưng không gọi production COMMISSION integration PASS trước M07 migration/ports. Closure runtime chưa PASS trước M07 responsibility adapter thật. Không skip các case này rồi vẫn mở pilot.
