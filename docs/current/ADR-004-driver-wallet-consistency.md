# ADR-004 — Driver, Wallet và workflow consistency

Ngày: 07/10/2026 (bản 0.1), cập nhật 17/10/2026 (bản 0.2). Version: 0.2. Trạng thái: DESIGN PATCH — chưa CODE_READY. Phần "Thay đổi bản 0.2" bên dưới là quyết định của Owner ngày 17/10/2026 cho gói UI M04; phần còn lại giữ nguyên nội dung bản 0.1 (draft 07/10, trước đây chỉ nằm ở PR #7 đã đóng, chưa vào main).

## Thay đổi bản 0.2 so với bản 0.1 (Owner, 17/10/2026)

| # | Bản 0.1 (07/10) | Bản 0.2 (17/10) |
|---|---|---|
| 1 | Yêu cầu rút do **quản lý/Admin** tạo (`wallet.withdrawal.create`); Shipper chỉ đọc. | **Shipper tự tạo yêu cầu rút trên App** (tài khoản đã xác minh, ≥10.000đ, đủ khả dụng); Admin xử lý trên Web (nhận xử lý, xác nhận đã chuyển, đối soát). Shipper có thể hủy khi còn PENDING. |
| 2 | Nạp tiền do Admin ghi (`wallet.topup.create`). | **Shipper tạo yêu cầu nạp** (và có thể gửi ảnh chuyển khoản); **chỉ Admin** ghi nhận tiền thực nhận sau đối soát giao dịch ngân hàng. "Tôi đã chuyển tiền" không cộng ví. |
| 3 | Shipper SUSPENDED/CLOSING không tự rút; qua quản lý. | Shipper vẫn được **yêu cầu rút** theo trạng thái cho phép; trường hợp không truy cập được tài khoản cần kênh Admin xác minh danh tính (chưa thiết kế). |
| 4 | Quyền theo lệnh cho người quản lý. | Quyền tài chính của Admin **cấp riêng từng chức năng** (xem 9). Không mặc định cho mọi ADMIN. |

Không đổi: reserve ngay khi tạo rút; chỉ PAID mới capture/debit; kết quả chuyển khoản chưa biết giữ hold và vào RECONCILIATION; snapshot ngân hàng cố định từ lúc tạo; ledger append-only; mọi khóa/idempotency/constraint trong tài liệu. Mọi mục dưới đây nói "quản lý tạo rút/nạp" phải đọc theo bảng trên; các đoạn đã sửa được đánh dấu **[0.2]**.

Dependency cho M04 backend: (a) endpoint Shipper tạo/hủy/đọc yêu cầu nạp–rút với ownership theo session driver (không IDOR); (b) quyền Admin theo từng chức năng do SYSTEM cấp (9); (c) kênh xử lý cho Shipper không đăng nhập được; (d) bảng quyền/endpoint ở 9 và idempotency ở 5 cập nhật tương ứng khi vào CODE_READY. Gói UI (PR #124) không triển khai API tiền nào.

Design base thực đọc: `main@cfd901f698dde33dc8db07ad24b5fa0551bc4a56`. PR #3 và #4 đã merge; PR #5 đóng, không merge và không dùng làm nguồn implementation. Chỉ sửa tài liệu. ChatGPT thiết kế/review; Claude implementation sau gate riêng.

## 1. Phạm vi, precedence và điều giữ nguyên

Tài liệu này sửa audit F01–F08/F10–F11 ở ranh giới M01/M03/M04/M06/M07. F09 (fresh DB time) đã được ADR-003 v0.3 sửa; không sửa lại M00 hoặc mở rộng scope A0/A1.

Đối với phần Driver/Wallet được mô tả ở đây, chỉ dẫn Owner hiện tại đứng đầu; ADR này khi được duyệt thay điều khoản mâu thuẫn trong manifest 4.1, onboarding 4.2 và baseline rà soát 1.1. Các phần không liên quan giữ nguyên. ADR-003 v0.3 tiếp tục sở hữu transaction/idempotency/audit/outbox primitives.

Các invariant không đổi:
- Driver type chỉ `PLATFORM | EXTERNAL`. PLATFORM chỉ miễn active delivery count và registered service-area restriction. Không miễn ACTIVE/accepting, available, hold, GPS, route/batching, delivery version/state hoặc các eligibility khác. Không cấp admin.
- Hoa hồng hiện tại 1.000 VND/successful delivery: reserve lúc accept, capture/debit khi completed, release khi cancel/return/fail. Snapshot amount/policy theo assignment; không lấy cấu hình mới để capture hold cũ.
- Kích hoạt lần đầu 100.000 VND tiền thực nạp vào cùng wallet. Không tạo security deposit, không khóa 100.000 sau ACTIVE.
- Withdrawal minimum 10.000 VND; create reserve ngay. Chỉ PAID mới capture/debit; unknown bank outcome giữ hold.
- Driver status: PENDING, ACTIVE, REJECTED, SUSPENDED, CLOSING, PENDING_BALANCE_RESOLUTION, CLOSED. `accepting_deliveries` tách status.
- Không hard-delete tiền/lịch sử, không tự chuyển khoản/thu hồi tiền, không COD ledger, không tự hủy assignment khi suspend/tắt nhận/đổi type/closure.

## 2. Ownership và dependency không vòng

| Owner | Bảng/source of truth | Mutation interface cho participant |
|---|---|---|
| M01 | users, sessions, user_roles, admin_scopes, admin_permissions | authorization guard, grant/revoke qua owner; không quyền suy ra từ driver type |
| M03-A | drivers identity/type/name; driver_service_areas; driver_bank_accounts | lock/read driver aggregate, profile/type/bank commands; không credit |
| M03-B | lifecycle fields trong drivers; driver_closure_requests | approve/suspend/resume/availability/closure; không SQL vào wallet/assignment |
| M04 | driver_wallets, wallet_ledger_entries, wallet_holds, wallet_bank_transactions, wallet_topups, wallet_withdrawals, wallet_adjustments | ensureZeroWallet, creditTopup, reserve, capture, release, postAdjustment, money guards |
| M06 | driver_routing_states, route_evaluations, policy_versions, shipping_quotes | evaluate ngoài transaction; validate và invalidate/update routing trong context |
| M07 | deliveries, delivery_assignments, delivery_events, delivery_incidents | delivery/assignment mutation; responsibility guard và incident resolution |

M03-A và M03-B là boundary tách thật: M04 chỉ được phụ thuộc identity/bank ports của M03-A, không import lifecycle/coordinator M03-B. M07 dùng M03-A/M04/M06 participant ports, không import closure workflow. Coordinator M03-B được đặt ở lớp workflow/composition phía trên các owner services. M03-B dùng port read/guard trách nhiệm hàng; adapter gọi M07 được nối tại app composition, không tạo import vòng M03↔M07. M00 không import module nghiệp vụ.

Quyền sở hữu bảng drivers vẫn là M03; tách A/B không tạo bảng driver thứ hai. `status` là nguồn lifecycle duy nhất; không duy trì đồng thời `approval_status` như trạng thái độc lập. Dashboard/projection không quyết định eligibility hoặc số tiền.

| Command | Outer coordinator | Cùng TransactionContext |
|---|---|---|
| Driver onboarding | M01 onboarding workflow | M03-A tạo profile/area + M01 grant role; wallet chưa cần tồn tại |
| Topup thường | M04-B | M03-A driver guard + zero-wallet nếu chưa có + topup/ledger/balance + audit/outbox |
| NEW_TOPUP + APPROVE | M03-B approval workflow | M04-B creditTopup + M03 activation marker/status + audit/outbox |
| EXISTING_FUNDS + APPROVE | M03-B approval workflow | M04 read/lock funding eligibility, không credit + M03 activation |
| Withdrawal create/processing/reconcile/paid/cancel | M04-C | M03-A bank/driver guard + withdrawal/hold/ledger/balance + audit/outbox |
| Accept/return/cancel/complete/fail | M07 workflow | owner mutations M07 + M04 + M06; M10 adapter khi có order |
| Closure request/cancel/evaluate | M03-B closure workflow | M03 driver + M04 money guard + M07 responsibility guard + closure audit |

M04-B không activate driver. Không có endpoint công khai gọi reserve/capture/release/credit tự do. Tất cả participant mutations nhận context, không inject pool/TransactionManager, không COMMIT và không gọi HTTP giữa các owner.

## 3. Serialization và thứ tự khóa thống nhất

READ COMMITTED theo ADR-003. Chọn protocol bảo thủ, ưu tiên dễ chứng minh. Không dựa vào cache hay process mutex. Chuẩn bị routing/provider ngoài transaction.

### 3.1 Thứ tự

Outer command lấy khóa theo thứ tự sau; trong cùng nhóm, UUID tăng theo cùng thứ tự byte ổn định:

1. M00 idempotency advisory lock và exact idempotency row nếu có (không lấy lại sau business locks).
2. M01 users của actor và các target có thể cần guard; sau đó session actor, authorization rows cần đọc. User rows FOR UPDATE là guard root cho role/scope/session revoke/disable; mọi writer quyền của user phải lấy cùng user root trước. Target disabled không tự chặn admin settlement hợp lệ (§9).
3. M06 policy version được evaluation tham chiếu FOR SHARE và M02 service-area rows ảnh hưởng eligibility FOR SHARE (nếu command dùng), sau đó M03 drivers FOR UPDATE — guard root của identity/status/type/availability/bank/areas và mọi thay đổi assignment/hold/trách nhiệm hàng của driver.
4. M03 bank rows cần dùng; rồi M04 wallet FOR UPDATE; rồi M06 driver routing root FOR UPDATE.
5. M10 order rows nếu có; M07 delivery rows; assignment rows; incident rows.
6. M03 closure rows; M04 withdrawal/topup/adjustment source rows; M04 hold rows.
7. Insert ledger/history/audit/outbox/idempotency result; commit.

Không bắt command lấy khóa của mọi nhóm: chỉ tài nguyên nó dùng, nhưng không đảo thứ tự. Các root đã giữ không được lấy lại theo thứ tự thấp hơn sau đó. Một command không chuyển tiền giữa ví; nếu tương lai có multi-wallet phải review riêng. Không mở batch nhiều topup/withdrawal trong một transaction ở phạm vi này.

Pre-read để khám phá owner IDs được phép nhưng không có giá trị cấp quyền. Nếu delivery/withdrawal chuyển owner/version trong lúc chờ: đọc lại dưới khóa, mismatch -> 409 và rollback. Không giữ delivery lock rồi phát hiện cần khóa driver mới. Với cancel order nhiều delivery, khám phá tập driver trước, khóa đúng thứ tự, recheck tập quan hệ sau lock; nếu đổi rollback. Không tự restart callback.

Tạo wallet khi chưa có: giữ driver root rồi M04 insert zero wallet (UNIQUE driver_id); read/lock wallet đó. Không đặt tiền mở đầu không ledger. Read wallet chưa provision trả projection zero rõ ràng; GET không INSERT.

### 3.2 Vì sao driver root bắt buộc

Mọi command reserve/capture/release/topup/adjustment/withdrawal, assignment create/end, fail incident create/resolve, driver edit/suspend/closure đều lấy cùng driver root. Vì vậy closure không phải khóa một tập row rỗng rồi hy vọng không có phantom; transaction khác không thể thêm assignment/hold/incident giữa guard và CLOSED.

Nếu driver A/B tranh delivery D, mỗi command giữ driver riêng rồi tranh D. Một bên thắng; bên thua đọc lại D và rollback, không để hold dư. Driver cùng nhận hai delivery khác nhau tranh cùng root, nên count/routing/available được đọc lại tuần tự.

Route evaluation chứa driver version, routing version, delivery version, policy version, location sample IDs và expiry. Sau khóa, so toàn bộ binding/expiry bằng fresh DB time; khác thì 409 ROUTE_EVALUATION_STALE. Không tính lại tuyến/provider trong transaction. Policy payload bất biến; policy_versions có is_current metadata, partial UNIQUE một current/scope. Accept khóa đúng expected policy row FOR SHARE rồi recheck is_current. Activator khóa current row FOR UPDATE, unset current và set version mới trong một transaction; hai activator dùng expected version, không tự retry trên winner mới. Nếu activation commit trước, evaluation cũ bị reject; nếu accept giữ share lock trước, activation đợi. Bootstrap current đầu tiên thuộc provisioning có unique guard, không chấp nhận scope không current. Không cho deployment lén coi policy mới là snapshot cũ. M03 đổi vùng khám phá affected area IDs trước, lấy area locks rồi driver root và recheck driver version; M02 disable area lấy UPDATE trên cùng area row. Không đọc area active từ cache để accept. PLATFORM miễn registered-area restriction, không tự miễn mọi service-area business rule.

### 3.3 Lỗi và điểm quyết định

Linearization là quyết định dưới root locks trước commit; commit làm hiệu lực bền vững. Nếu suspend/type edit thắng root trước, accept đọc state mới; nếu accept thắng và commit trước, assignment đó hợp lệ và không bị hủy bởi edit đến sau.

ADR-003 xử lý timeout/deadlock/unknown COMMIT, không automatic retry. Rollback sạch mới có thể retry request cùng key. COMMIT unknown trả lỗi của M00; client không đổi key hoặc tự chuyển khoản lại. Lock timeout nghiệp vụ không được giả thành IDEMPOTENCY_BUSY. Không dùng Promise.all như bằng chứng race đã được kiểm.

## 4. Money model và constraints

### 4.1 Kiểu tiền và nguồn

VND nguyên, không float. DB bigint; application tính bằng bigint, không parse bigint DB thành JS Number trước kiểm bound. API JSON number chỉ nhận Number.isSafeInteger và range 0..9007199254740991; amount mutation phải >0 (withdrawal >=10000). CHECK mọi balance/held/amount lưu trong range tương ứng; cộng vượt bound fail toàn transaction. Đây là giới hạn biểu diễn kỹ thuật, không quota sản phẩm. Tất cả FK lịch sử ON DELETE RESTRICT; không cascade xóa tiền.

Với mỗi wallet: B=balance_vnd, H=held_vnd, A=B-H. CHECK 0<=H<=B; available là giá trị tính, không cột mutable thứ ba. Wallet có version tăng ở mỗi mutation tiền/hold; mọi UPDATE có guard/version phù hợp. Ledger lưu signed delta_vnd !=0 và balance_after; UNIQUE(wallet_id, sequence_no), sequence tăng dưới wallet lock.

| Mutation x | Delta B | Delta H | Ledger | Guard |
|---|---|---|---|---|
| Credit topup | +x | 0 | +x | Bank identity chưa sử dụng |
| Reserve | 0 | +x | Không | Available >= x; nguồn reserve hợp lệ |
| Capture | -x | -x | -x | Hold ACTIVE, đúng owner/source/amount |
| Release | 0 | -x | Không | Hold ACTIVE, đúng owner/source |
| Adjustment credit | +x | 0 | +x | Adjustment decision chưa post |
| Adjustment debit | -x | 0 | -x | Available >= x; decision chưa post |

Capture không kiểm lại available>=x: tiền đã reserve. Kiểm hold ACTIVE và B>=H>=x; nếu sai fail closed. Không thu hoa hồng bằng config hiện tại; dùng amount bất biến của hold/assignment. Failed không tạo refund credit vì lúc accept chưa debit.

### 4.2 Ràng buộc schema phải được chuyển thành migration ở task sau

| Table | Ràng buộc bắt buộc |
|---|---|
| driver_wallets | PK wallet_id; UNIQUE NOT NULL driver_id FK drivers; B/H CHECK; version; zero initialization |
| wallet_holds | PK hold_id; wallet FK; purpose COMMISSION/WITHDRAWAL; amount>0; ACTIVE/CAPTURED/RELEASED; UNIQUE(purpose, reference_id); source/amount/wallet immutable |
| wallet_ledger_entries | PK entry_id; wallet FK; signed delta; sequence; entry kind; UNIQUE(kind, source_id); capture_hold_id UNIQUE khi có; UPDATE/DELETE/TRUNCATE bị chặn |
| wallet_topups | PK topup_id; wallet FK; amount; normalized bank identity UNIQUE NOT NULL; received_at; actor; immutable committed record |
| wallet_bank_transactions | Registry bank identity dùng chung IN/OUT: PK bank_record_id; UNIQUE(bank_id, system_owned_account_id, canonical_transaction_id); direction/actual amount/source immutable; FK tới đúng topup hoặc withdrawal, không hai source |
| wallet_withdrawals | PK withdrawal_id; wallet FK; amount>=10000; bank snapshot/version; state/version; UNIQUE hold_id; processing owner/attempt marker; payout evidence; no hard delete |
| wallet_adjustments | PK adjustment_id; original entry/decision FK theo loại; immutable reason/actor/delta; UNIQUE decision_id cho mỗi quyết định tài chính |
| delivery_assignments | PK assignment_id; driver/delivery FK; commission amount/policy snapshot; partial UNIQUE delivery_id WHERE ended_at IS NULL |

Source-specific linkage không chỉ một polymorphic UUID không kiểm tra: COMMISSION hold phải có assignment FK (thêm ở migration tích hợp M07), WITHDRAWAL hold có withdrawal FK; CHECK đúng một source theo purpose. `reference_id` bằng ID source đó. Composite FK/constraint trigger kiểm cùng wallet/driver và amount. Ledger TOPUP/WITHDRAWAL/COMMISSION/ADJUSTMENT phải trỏ tới đúng bảng source và đúng ví; không chấp nhận source_id orphan. Với cycle withdrawal↔hold, dùng UUID tạo trước và DEFERRABLE INITIALLY DEFERRED FK/constraint, kiểm tại commit; không commit placeholder thiếu hold. M04-A trước M07 chưa expose COMMISSION production path; migration M07 bổ sung FK/source contract trước khi bật accept.

Ledger và topup/adjustment đã post immutable, trigger chặn UPDATE/DELETE/TRUNCATE; app role không DDL/disable-trigger. Hold chỉ cho ACTIVE→CAPTURED hoặc ACTIVE→RELEASED; transition terminal bất biến. Conditional UPDATE state=ACTIVE, kiểm affected row count. Already same terminal chỉ idempotent khi source/result khớp; opposite terminal -> HOLD_STATE_CONFLICT, không mutation tiền.

Các constraint liên bảng dùng deferred constraint trigger để assert tại commit cho wallet bị chạm: SUM(ledger.delta)=B, SUM(ACTIVE holds.amount)=H; từng hold/source/withdrawal/debit consistency. Các writer vẫn bắt buộc parent locks; trigger không thay protocol concurrency. Task migration phải kiểm trigger có chạy khi đổi wallet/source/hold/ledger và kiểm actual app role. Có index wallet_id/state và source FK; chưa tối ưu bỏ full per-wallet sum trước khi có evidence tương đương. Không dùng CHECK chứa subquery giả hợp lệ. Nếu mismatch rollback WALLET_INVARIANT_VIOLATION, không tự sửa B/H hoặc thêm adjustment để che lỗi.

### 4.3 Đối chiếu và sửa sai

Đối chiếu read-only bằng một consistent database snapshot; không đọc ledger và wallet ở hai snapshot khác nhau rồi báo drift giả. So B/H/A, sources, debit count và terminal hold. Drift tạo lỗi vận hành, không auto-repair. Sửa sai nghiệp vụ thêm adjustment với authorization/nguồn/lý do; không rewrite ledger. Debit thiếu available dừng ở case chưa post, không lấy tiền hold. Một correction không được vừa replay complete vừa post adjustment. Spec adjustment reconciliation chi tiết thuộc task tương ứng; không mở endpoint generic delta từ driver.

## 5. Request và business idempotency

Mọi mutation công khai trong tài liệu yêu cầu UUID Idempotency-Key. Scope=server-derived authenticated user_id (không session_id để retry qua phiên mới vẫn đúng actor), operation_id ổn định. Fingerprint gồm target ID, normalized body, funding mode, expected versions, bank-account version và mọi input ảnh hưởng kết quả. Reject unknown fields. Không nhận actor/scope/TTL từ client.

Same key/body replay sau current authorization guard; different body 409 IDEMPOTENCY_KEY_REUSED. Replay không chạy lại business eligibility chuyển trạng thái cũ (ví dụ PENDING→ACTIVE), nhưng phải check quyền đọc kết quả hiện tại. Window/default crypto theo ADR-003: không hứa retention 90 ngày trái bound 7 ngày. Hết replay window trả REPLAY_EXPIRED, client GET resource có quyền; hết dedupe vẫn phải qua business uniqueness vĩnh viễn theo lịch sử.

| Business effect | Permanent key |
|---|---|
| Money received | Canonical bank transaction identity chung normal topup và NEW_TOPUP approval, không gồm admin/driver trong unique key |
| Initial activation | drivers.initial_activated_at + initial_activation_id chỉ set một lần; approval status/version guard |
| Commission hold | (COMMISSION, assignment_id), không delivery_id |
| Commission debit | (COMMISSION_DEBIT, assignment_id) và capture_hold_id unique |
| Withdrawal hold | (WITHDRAWAL, withdrawal_id) |
| Withdrawal debit | (WITHDRAWAL_DEBIT, withdrawal_id) và capture_hold_id unique |
| External payout record | Canonical outgoing bank transaction identity unique trên withdrawals |
| Adjustment | immutable decision_id/adjustment_id; không original_entry_id đơn thuần nếu có nhiều correction hợp lệ |

Hai withdrawal khác key là hai request khác nhau nếu đủ tiền; không unique amount/driver để che race. Bank key reused cho target/amount khác -> 409 BANK_TRANSACTION_ALREADY_RECORDED, không tiết lộ target khác. Same bank key qua new request không silently credit hoặc activate; trả conflict với resource tham chiếu chỉ nếu caller có quyền. Người dùng chọn EXISTING_FUNDS rõ ràng để duyệt từ tiền đã ghi.

## 6. Topup và initial approval

Canonical bank identity = (bank_id, system_owned_account_id, bank_transaction_id). Đây là ID giao dịch do ngân hàng/sao kê cung cấp, không nội dung chuyển tiền, screenshot, ID client tự đặt hoặc tên file. Chuẩn hóa trim biên; không tự lowercase/bỏ số 0/dấu trong transaction ID nếu ngân hàng không định nghĩa tương đương. Namespace của ngân hàng có reuse ID theo kỳ phải có statement namespace đáng tin trong canonical ID theo adapter đã review; không cho admin tùy ý đổi namespace để dùng lại ref. Thiếu identity đối chiếu được: không credit; giữ hồ sơ đối soát ngoài lệnh post, không giả đã nhận.

M04 dùng wallet_bank_transactions làm registry identity duy nhất xuyên topup và payout. Topup/withdrawal lưu bank_record_id, không tạo namespace uniqueness độc lập cho từng endpoint hoặc mỗi admin. Một bank record gắn đúng một source, direction IN cho topup và OUT cho withdrawal; immutable actual amount và liên kết. Typed deferred FK cho cycle source↔registry, unique bank_record_id ở source; constraint xác nhận source trong registry trỏ ngược đúng record. Đây là thêm bảng kỹ thuật để bảo vệ uniqueness, không phải ví hay sổ cái thứ hai; registry không thay ledger.

MVP tiền nhận do quản lý xác minh thủ công; uniqueness chỉ ngăn cùng identity được dùng hai lần, không tự chứng minh chứng từ thật. API không gọi ngân hàng và không coi ảnh là proof tự động.

Topup thường: actor có wallet.topup.create + scope target; driver không CLOSED; lock driver/wallet; insert bank source, ledger +actual amount, update B; audit/outbox/idempotency cùng commit. Không tự ACTIVE. Tiền thực nhận 60.000 + 40.000 hoặc 150.000 được ghi đúng thực nhận, không ép mọi khoản thành 100.000. CLOSED không được ghi topup thông thường; tiền chuyển nhầm sau đóng phải đối soát riêng, không xóa sự thật tiền ngoài hệ thống hoặc tự mở lại hồ sơ.

Approve command của M03-B có input oneOf:
- NEW_TOPUP: actual_amount_vnd, canonical bank identity, received_at, expected_driver_version.
- EXISTING_FUNDS: funding_topup_ids không rỗng/không trùng, expected_driver_version; không có amount/bank credit fields.

Actor NEW_TOPUP cần cả driver.approve và wallet.topup.create; EXISTING_FUNDS cần driver.approve và wallet.funding.verify. Target PENDING, chưa initial activation, hồ sơ và vùng theo onboarding hợp lệ. M04 khóa và kiểm các funding IDs thuộc đúng wallet; tổng net tiền nạp hợp lệ sau correction gắn nguồn >=100.000, và available hiện tại >=100.000. NEW_TOPUP dùng khoản mới cộng các khoản đã có để đánh giá cùng predicate. Credit và activation cùng commit; thiếu điều kiện thì rollback cả khoản mới. Nếu muốn ghi nhận tiền dù chưa đủ activate, dùng topup thường riêng, không trả thành công nửa chừng.

EXISTING_FUNDS không INSERT topup/credit ledger. Activation set status ACTIVE, initial marker bất biến, accepting_deliveries=false; xế bật nhận bằng command riêng. Sau lần đầu không kiểm lại ngưỡng 100.000 để accept/resume. Không dùng tổng nạp lifetime đã bị đảo ngược làm bằng chứng funding. Resume suspended không gọi lại initial approval và không thu 100.000 lần nữa.

## 7. Withdrawal và external settlement

### 7.1 Create và payout snapshot

**[0.2]** Actor tạo là **chính Shipper** (DRIVER role, driver binding từ session phía server, không nhận driver_id từ client); Admin xử lý, không tạo thay trừ kênh hỗ trợ riêng cho Shipper không truy cập được (chưa thiết kế, cần quyền riêng + xác minh + audit). Shipper không tự credit/debit; chỉ tạo yêu cầu và reserve hold. amount>=10.000, available đủ, bank đã verified và name verification còn hiệu lực; driver không CLOSED. Driver PENDING/REJECTED/SUSPENDED/CLOSING/PENDING_BALANCE_RESOLUTION vẫn được yêu cầu rút tiền của mình theo trạng thái cho phép. User disabled không tự tịch thu tiền; Admin xử lý bằng quyền riêng, không mượn session driver.
(Bản 0.1: "Actor tạo là quản lý có wallet.withdrawal.create ... driver chỉ đọc của mình".)

Under driver root + bank + wallet locks: snapshot bank_id/account_number/account_holder_name và verified bank version, insert withdrawal PENDING và reserve WITHDRAWAL hold cùng amount, audit/outbox. Bank details chỉ trong restricted stored snapshot/authorized detail, không trong audit/outbox/log. Snapshot immutable từ create, không chỉ từ processing. M03 thay bank hoặc tên xế luôn lấy driver root, tăng version và reset verification. Create hoặc thấy verified version cũ và chụp đúng snapshot trước edit, hoặc thấy bản mới chưa verified và bị chặn; không ghép old verified flag với new account.

Trước start-processing, nếu bank/name version khác snapshot hoặc verification đã mất, trả BANK_SNAPSHOT_STALE; PENDING có thể cancel và tạo request mới sau verify. Khi đã PROCESSING, không đổi snapshot vì profile đổi: xử lý/đối soát đúng thông tin payout đã claim.

### 7.2 Transition contract

| From | Command / guard | To | Money |
|---|---|---|---|
| None | Create hợp lệ | PENDING | Reserve hold ACTIVE |
| PENDING | cancel với quyền, expected version | CANCELLED | Release, 0 debit |
| PENDING | start-processing, bank snapshot current verified | PROCESSING | Hold vẫn ACTIVE |
| PROCESSING | mark-paid với evidence chuyển đúng amount/destination | PAID | Capture + đúng 1 debit |
| PROCESSING | báo unknown/timeout/mismatch hoặc cần takeover | RECONCILIATION | Hold ACTIVE |
| RECONCILIATION | outcome UNKNOWN, evidence chưa kết luận | RECONCILIATION | Hold ACTIVE |
| RECONCILIATION | outcome CONFIRMED_PAID, đúng amount/destination/ref unique | PAID | Capture + đúng 1 debit |
| RECONCILIATION | outcome CONFIRMED_NOT_SENT_FINAL, không còn lệnh chuyển pending/in-flight | CANCELLED | Release, 0 debit |

Không có PROCESSING→CANCELLED bằng cancel thường; không RECONCILIATION→PENDING/PROCESSING để chuyển lại; không PAID→CANCELLED; không auto-expire hold vì mất kết nối. CONFIRMED_NOT_SENT_FINAL cần evidence ngân hàng xác nhận không thực hiện/đã hủy dứt điểm, người xử lý và reason. Không tìm thấy ngay trên sao kê chưa đủ chứng minh chưa chuyển. Đây là resolution có quyền, không cancel thường.

### 7.3 Ai được thực chuyển

start-processing có expected_version, serialize root+withdrawal; commit processing_owner_user_id và processing_attempt_id bất biến cho lần request này. Chỉ owner đã nhận kết quả claim commit chắc chắn, còn quyền wallet.withdrawal.process mới được thực chuyển thủ công theo payout snapshot. Request start bị conflict hoặc commit unknown không cấp một lần chuyển khác; phải đọc lại request và đối soát hành động đã làm. API mark-paid chỉ ghi xác nhận, tuyệt đối không gọi bank transfer.

Không lease timeout tự giao quyền chuyển cho người khác. Nếu owner mất quyền/không liên lạc được/không chắc đã chuyển: vào RECONCILIATION. Admin có wallet.withdrawal.reconcile có thể xác minh kết quả, không được hiểu takeover là giấy phép chuyển thêm. Hai admin không được đồng thời thực chuyển trên cùng withdrawal. Runbook này là kiểm soát vận hành cho chuyển thủ công; DB không thể ngăn một người tự chuyển thêm ngoài quy trình.

Outgoing bank identity có cùng nguyên tắc canonical như tiền vào, chiếm registry ngay khi được ghi nhận vào RECONCILIATION hoặc PAID, không đợi PAID mới chống trùng; không gồm withdrawal_id trong unique key. Registry direction OUT, source withdrawal bất biến. Ghi chứng từ, state, capture, ledger, B/H, audit/outbox/idempotency một transaction khi PAID. Reference đã gắn source khác fail toàn transaction, không lộ bank data của source khác. PENDING không được mark-paid trực tiếp. Bank record đã xác nhận có tiền OUT không thể kết luận CONFIRMED_NOT_SENT_FINAL để release; mâu thuẫn chứng từ giữ RECONCILIATION, không xóa registry cho reuse.

Nếu real amount hoặc destination khác snapshot: RECONCILIATION, hold ACTIVE, giữ evidence an toàn; không sửa request amount cho bằng chuyển thực, không post PAID giả. Correction riêng phải có thiết kế amount/source rõ ràng và review trước xử lý; chưa có chức năng partial payout hay split transfer trong scope này. Không cho Claude tự thêm để thoát case.

### 7.4 State invariants tại commit

PENDING/PROCESSING/RECONCILIATION => exactly one matching ACTIVE hold, no withdrawal debit.
PAID => matching CAPTURED hold, exactly one equal debit và payout ref/evidence.
CANCELLED => matching RELEASED hold, no withdrawal debit.
All states preserve snapshot, amount, source and history. Deferred constraints §4 bảo vệ quan hệ, authorization/transition service bảo vệ command.

## 8. Driver lifecycle và trách nhiệm hàng

### 8.1 State changes

| From | Command | To / effect |
|---|---|---|
| None | Onboarding | PENDING, EXTERNAL, accepting_deliveries=false |
| PENDING | Initial approval §6 | ACTIVE, accepting=false |
| PENDING | Reject có lý do | REJECTED, accepting=false; giữ tiền/history |
| ACTIVE | Suspend có quyền/lý do | SUSPENDED, accepting=false; không hủy đơn |
| SUSPENDED | Resume có quyền, account/profile hợp lệ | ACTIVE, accepting=false; không nạp lại 100.000 |
| ACTIVE | Set accepting true/false | Status giữ nguyên; true phải vượt eligibility bật nhận, chưa reserve commission |
| PENDING/REJECTED/SUSPENDED | Set accepting false | Không đổi status; set true bị chặn |
| PENDING/REJECTED/ACTIVE/SUSPENDED | Request closure | CLOSING, accepting=false; lưu prior status/availability; không rút tiền |
| CLOSING | Evaluate còn nghĩa vụ/hold | Giữ CLOSING |
| CLOSING | Hết nghĩa vụ, 0<balance<10000 | PENDING_BALANCE_RESOLUTION |
| CLOSING | Hết nghĩa vụ, balance>=10000 | Giữ CLOSING; quản lý dùng withdrawal riêng |
| CLOSING/PENDING_BALANCE_RESOLUTION | Hết nghĩa vụ và balance=0 | CLOSED |
| PENDING_BALANCE_RESOLUTION | Có hold/nghĩa vụ hoặc balance>=10000 | CLOSING; không tự tạo payout |
| CLOSING/PENDING_BALANCE_RESOLUTION | Driver hủy closure còn mở | Khôi phục prior status hợp lệ; bật lại chỉ nếu trước đó bật và toàn bộ eligibility hiện hành đạt |
| CLOSING/PENDING_BALANCE_RESOLUTION | Admin suspend trong lúc chờ đóng | Giữ status closing hiện tại, cập nhật resume restriction thành SUSPENDED, accepting=false; audit/version |

Trong khi closing, suspend/admin restriction mới được lưu vào closure resume guard; đây là điều kiện khôi phục khi hủy request, không phải driver status thứ hai cho accept. Hủy closure không được vượt restriction hoặc khôi phục ACTIVE mù. Nếu prior ACTIVE nhưng account/profile hiện không đủ điều kiện thì khôi phục SUSPENDED/accepting=false và ghi reason; không reject việc tiếp tục xử lý tiền. CLOSED terminal, không reopen trong scope này. REJECTED→PENDING resubmission chưa mở. Mọi chuyển không liệt kê bị chặn; không public PATCH status. Closure request có partial UNIQUE(driver_id) WHERE open; nhiều lần evaluate không tạo request mới. Khi cancel/final CLOSED, request kết thúc có actor/time, giữ lịch sử.

PLATFORM→EXTERNAL giữ toàn bộ assignment/policy snapshot cũ. Eligibility mới chỉ áp lần accept sau; count đang vượt ngưỡng không khiến auto-cancel. Bank verified không tự trở thành điều kiện nhận đơn nếu contract đã chốt chỉ cần cho rút. Không thêm security deposit hoặc số dư tối thiểu sau active.

### 8.2 Delivery failed không có nghĩa hàng đã giải quyết

Assignment là lịch sử lần nhận, có thể ended khi fail; trách nhiệm hàng chưa giải quyết nằm ở M07 delivery_incidents với responsible_assignment_id FK và resolved_at/evidence. Đây là chi tiết hóa incident đã có trong manifest, không thêm module hàng/COD.

Khi fail sau pickup: cùng transaction kết thúc delivery/assignment, release commission hold, tạo incident hàng unresolved gắn assignment/driver. Không xóa driver association; không tự báo returned. Chỉ incident resolution hợp lệ ghi hàng đã về/đã xử lý có actor/evidence mới gỡ guard trách nhiệm. Incident resolution cũng lấy driver root. Không dùng event bất đồng bộ để tạo guard sau khi fail đã commit vì closure có thể chạy ở khoảng trống.

Closure evaluate dưới driver+wallet locks gọi M07 guard: active assignments count=0 VÀ unresolved responsibility incidents count=0; gọi M04 guard: ACTIVE holds=0, không withdrawal PROCESSING/RECONCILIATION hoặc source tiền inconsistent; B=0 mới CLOSED. Nếu guard thiếu adapter/M07 chưa triển khai/DB read lỗi: fail closed CLOSURE_GUARD_UNAVAILABLE, không mặc định count=0. Do đó closure finalization có gate M07 dù identity/approval có thể làm trước.

Driver SUSPENDED/CLOSING vẫn có thể thực hiện command hợp lệ cho assignment mình đang giữ nếu user/session còn hợp lệ; guard accept ACTIVE không dùng chung cho pickup/complete/fail. Nếu user bị disable hoàn toàn, session vẫn deny; operational case có admin xử lý và audit, không fake complete/release trách nhiệm. Không thay trách nhiệm hàng chỉ vì đổi role hoặc bật/tắt nhận.

## 9. Authorization và privacy

Quyền ADMIN/SYSTEM thuộc M01. Driver PLATFORM dùng đúng quyền driver, không có admin API. Module scope hoặc dashboard read không suy ra permission mutation.

| Command | Required permission/context |
|---|---|
| Self profile/bank/availability/closure | DRIVER role của chính user, driver binding server-side; field allowlist |
| Driver type | driver.type.write + driver scope; reason/version |
| Approve | driver.approve + funding quyền theo §6 |
| Reject/suspend/resume | driver.lifecycle.write + target scope; reason/version |
| Topup request create/cancel | **[0.2]** DRIVER role của chính user, binding server-side (Shipper tạo yêu cầu; không cộng ví) |
| Topup record (xác nhận/từ chối, ghi tiền thực nhận) | **[0.2]** wallet.topup.record (trước: wallet.topup.create) + target money scope; chỉ Admin |
| Withdrawal create/cancel pending | **[0.2]** DRIVER role của chính user, binding server-side (trước: wallet.withdrawal.create / cancel cho quản lý). Admin cancel (nếu có) cần wallet.withdrawal.cancel + scope |
| Start processing / mark-paid | wallet.withdrawal.process / wallet.withdrawal.confirm + scope; processing owner match |
| Reconcile | wallet.withdrawal.reconcile + scope; evidence/reason; không cấp quyền chuyển mới |
| Adjustment | wallet.adjustment.post + source decision scope |
| Driver wallet/history | Chính driver, projection cho phép; không IDOR qua URL |
| Admin wallet/bank detail | wallet.read / driver.bank.read tương ứng + scope; không từ dashboard.read |

**[0.2]** Quyền tài chính của ADMIN do SYSTEM cấp riêng từng chức năng (ví/giao dịch, nạp, rút, đối soát, tham số ví). Không hardcode cho mọi ADMIN; hiện backend chưa phát các grant này (Admin Web chỉ SYSTEM thấy menu Tài chính) → dependency cho M04 backend.

M01 guard sau locks đọc active user/session/role/permissions thực; không tin JWT/client snapshot. Admin session phải đáp ứng 2FA hiện hành; không mở API tiền production chỉ bằng role fixture của Auth A1. Revoke/role/scope updates lấy user root cùng protocol. Khi target user disabled, admin có quyền vẫn được settle tiền/incident theo command; không cấp quyền driver đang disabled. Self replay phải còn ownership/role; admin replay phải còn permission của command/target. Trả 404 cho resource ngoài phạm vi khi cần tránh enumeration; không leak SQL constraint detail.

Client không được PATCH balance/held/ledger/status/type/verification/processing owner; unknown fields reject. Driver IDs trong admin URL là target, actor từ session. FK ownership được kiểm dưới lock và tại commit.

Audit allowlist cho tiền: action, actor/resource IDs, amount_vnd, source IDs, before/after versions, reason_code; không raw note/request/bank ref/account/name/proof/token. Bank evidence detail chỉ trong authorized business record; log/push/outbox không chứa nó. Event payload dùng resource IDs/version + state code cần thiết; consumer fetch theo quyền. Không nhét bank snapshot vào replay_guard. Sensitive API result replay dùng encryption ADR-003 và current guard; ưu tiên trả resource IDs/state/amount, bank masked; full bank detail qua GET có quyền riêng. Không hứa generic denylist tự bảo vệ PII.

## 10. Crash recovery và events

| Failure point | Required recovery |
|---|---|
| Trước commit | Rollback tất cả business/ledger/hold/audit/outbox/idempotency |
| Commit đã xảy ra, HTTP mất | Retry same key; business uniqueness vẫn bảo vệ sau TTL/khác key |
| COMMIT acknowledgement unknown | Không auto-retry callback; retry same key, GET current state; không thực chuyển lại |
| Sau manual transfer, trước PAID | Hold ACTIVE, RECONCILIATION; không release hoặc resend |
| PAID committed, response mất | Một debit/payout identity; retry không gọi bank |
| Outbox committed, chưa push | Dispatcher xử lý theo ADR-003; DEAD không làm rollback money |
| Publish thành công, ack mất | Có thể duplicate cùng event_id; consumer atomic dedupe+effect |

Không dùng outbox consumer để thực hiện capture/debit/activation vốn phải atomic với command gốc. Push không là source of truth, không trigger chuyển tiền. Consumer projection cần unique inbox/event receipt và update projection cùng transaction; schema receipt thuộc consumer task, không thêm vào M00-C1. Không tuyên bố exactly-once external transfer/push.

## 11. Rename và rollout

Chỉ đổi namespace driver type SYSTEM→PLATFORM, kể cả tài liệu/test/fixture/config tên theo loại xế. Giữ `role=SYSTEM`, `SYSTEM_DISTANCE`, system_categories, system clock và SYSTEMROOT. Field driver `approval_status` được hợp nhất thành status; driver `accepting_orders` đổi accepting_deliveries. Shop accepting_orders giữ nguyên. Hold/withdrawal/driver enums dùng uppercase theo Owner; delivery/order snake_case giữ nguyên.

Tại design base chưa có business driver enum/table/migration/code; vì vậy không tạo migration chạy UPDATE vào bảng không tồn tại. Migration đầu tiên tạo tên chuẩn. Nếu lúc Claude preflight đã có dữ liệu legacy, STOP để lập mapping/rollout cụ thể: chỉ cột driver_type, preserve admin roles; check counts, contract clients và rollback compatibility. Không search/replace toàn repo chữ SYSTEM. Negative test driver_type=SYSTEM vẫn được giữ nếu mục đích rõ là reject legacy input; test PLATFORM privilege isolation riêng.

## 12. Gate và điều chưa được tuyên bố

Đây là bản sửa thiết kế (0.2, 17/10/2026) để review, không runtime PASS. Bản 0.2 chỉ phản ánh quyết định Owner 17/10; PR #124 là UI only. Task map và acceptance (`docs/tasks/M03-M04-design-patch-plan.md`, `docs/current/M03-M04-acceptance-matrix.md`) hiện chỉ có ở nhánh PR #7 đã đóng, chưa vào main.

Trước từng CODE_READY: DDL/migration plan chính xác (đặc biệt deferred FK/constraint triggers), endpoint schemas/error examples, owner ports và expected versions, fixtures/barriers, design SHA và code base đã kiểm. M00-C1 A1/B/C và M01 authorization phải đạt gate phụ thuộc trước implementation tương ứng. Không dùng PR #5 đã đóng làm nền. Không thay quy trình Claude code, ChatGPT review, Owner duyệt.

Không có quyết định nghiệp vụ khóa nào cần đảo vì P0. Các lựa chọn thêm ở đây là protocol kỹ thuật và resolution của state còn thiếu; Owner review toàn bộ ADR trước lock. Không tự đánh CLOSED khi thiếu adapter, không tự mở partial payout, không viết implementation trong PR tài liệu.
