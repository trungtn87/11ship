# Giao Claude từng gói nhỏ

Phiên bản **2.0.1**; **DESIGN_REVIEW / NOT_LOCKED**. Mở [danh mục và thứ tự](../08-work-packages.md), chọn một gói và chỉ gửi file gói đó. Các ID Mxx.NN là alias giao việc, không thay ID roadmap/plan.yml hiện hành.

## Cách giao và giữ scope

1. Bắt đầu M00.01. Claude fetch source main/PR46, đọc AGENTS/workflow và đúng phần audit L01/L05. Mỗi gói code dùng branch/Draft PR riêng; nếu chỉ sửa một integration PR đã duyệt, giữ commits và evidence từng gói tách rõ. Không gửi nguyên lệnh “làm hết M00/M01”.
2. Khi Claude trả PR: ChatGPT review exact head, trả finding thuộc gói; Claude sửa trên cùng nhánh và test lại phần bị ảnh hưởng. Không tự tạo một lô PR để triển khai các dependency chưa review.
3. Gói UI cần đúng mẫu và phiên bản Owner đã duyệt. M00-PC dùng bảng UI tám trang v2; M01 dùng catalog/UI tương ứng. Owner review trong vòng local có thể yêu cầu sửa; không suy việc chia gói là đã duyệt mẫu.
4. CODE/CI review đạt → bản Owner local → native/test build khi local được chấp nhận → Owner thiết bị thật. CODE_READY chỉ là contract đủ, không là acceptance. Backend-only không đóng module thiếu UI/phone.
5. Chỉ Owner quyết định merge/LOCK. UAT actual để Chưa chạy trước kết quả thật; CI hoặc bot progress không thay quyết định. N/A cũng cần lý do/Owner scope.

## Preflight cho mọi gói

Fetch main và design PR48 cùng PR dependencies được nêu; ghi full SHA. Không code sản phẩm trên branch design. Nguồn của danh mục là design5e351f5 và main891a73b (khác audit chỉ PROGRESS bot); kiểm diff mới khi bắt đầu. PR46 còn Draft cf9eecad và chưa thể coi CI/ba app PASS. Head thay đổi phải review lại; audit snapshot cũ không chứng nhận head mới.

Chỉ đọc đúng parent/contract/screens cần cho gói. PR có code sẵn thì reuse/reconcile thay vì viết lại. Branch có dependency Draft dùng integration base được duyệt hoặc báo BLOCKED; không tự merge cả #42/#41/#45.

## Ranh giới và contract gate

M00.01–.10 chỉ PC launcher, guest shells và Admin Auth đã code làm dependency. Không có CUSTOMER grant/reset/invitations/menu/orders/wallet mới trong M00. Migration Admin #34 chỉ reuse reviewed dependency và giữ xác nhận DEV. M00.11–.13 là remote/native riêng; phạm vi toàn M00 do Owner quyết định D01.

M01 bình thường cấp CUSTOMER từ server; quán thêm SHOP_OWNER alias storage SHOP và giữ CUSTOMER. SYSTEM/ADMIN qua Authenticator; scopes vẫn CUSTOMER/SHOP/DRIVER. Reset #43 giữ TOTP/role/status và revoke sessions, không Change Password/auto-login. Web bearer memory là limitation PC; native secure storage/D02 cần approved binding contract.

Các M02–M12 là backlog đã chia scope, không phải mọi API/DDL đã CODE_READY. Trước code mỗi slice cần exact path/method/request/response/examples/error/status/permissions/version/key/replay/events và physical DDL/check/FK/index/grants/backfill/rollout. ChatGPT hoàn thiện/review contract; Claude preflight báo gaps, không tự quyết policy. D02/D03/D04/D05/D08/D09/D11/D12/D13/D14 chỉ chặn phần liên quan; D07 auto-hours đã chốt, không hỏi lại switch.

Với UI M02+: làm PC của chức năng trước, Owner local chấp nhận rồi port/build native cùng scope theo D03 và kiểm điện thoại. Chưa có runtime/provider thì preflight/phần độc lập đủ contract vẫn làm, phần chặn ghi rõ; không coi responsive browser là Android đạt. M01 có các gói native24–28 riêng.

## Kiểm thử và dữ liệu

DEV5432 là Owner test, TEST5433 cho suite có guard. Không destructive suite vào DEV/staging, không fake business records/PII/funds/GPS. Demo chỉ môi trường test có nhãn; harness mocks không chứng nhận app/provider thật. Cert/key/DSN/token/password/OTP/TOTP và ảnh secret không vào repo/evidence.

Tests theo change: launcher behavioral/Windows, backend parser/auth/PG17/race/migration, UI browser+API/DB real, native lifecycle/storage/permissions và provider thật khi được cấp quyền. Required CI exact final head; không sửa assertions để xanh, không chạy lại toàn suite không liên quan chỉ để lấy số lượng. Migration append-only, compatibility/grants/fix-forward rõ.

## Evidence tối thiểu mỗi gói

Module/alias/canonical task mapping; version/approval source; branch/base/final SHA; dependencies và changed files; commands/results/CI URLs; runtime frontend/backend fingerprint; ảnh đúng screen ID; môi trường/machine/app; case expected/actual; findings/limitations/retest; Owner decisions đúng scope. Contract/read-only gói không cần product tests mới, chỉ chứng cứ nguồn và gaps.

Không gửi SMS/email/lời mời hoặc thao tác bank/production từ task design. Khi đến gói provider/ops, dùng target/recipient/credential được cấp cho kiểm thử; production action có authorization cụ thể. Không tự merge/deploy/enable auto-merge/LOCK, không sửa tay PROGRESS hoặc nhét alias/new fields vào plan.yml v1.

Sau khi một gói đủ review/gate, Owner/ChatGPT mới chọn gói tiếp. Claude không tự chạy danh mục hoặc mở toàn module. “Đã chia gói” không là “đã triển khai”.
