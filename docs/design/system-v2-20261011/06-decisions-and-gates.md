# Quyết định, tương thích và gate

Phiên bản **2.0.3**; **OPEN_DECISIONS / NOT_LOCKED**. Không hỏi lại quyết định đã chốt. Nguồn tại [07](07-source-index.md); exact PR/CI heads tại audit-snapshot.json là lịch sử. [Revision USER/SMS test](09-m01-user-admin-test-sms.md) pin main mới cho phạm vi đó. Các quyết định mở chỉ chặn slice liên quan.

## 1. Đã chốt và áp dụng

| ID | Quyết định | Nguồn | Tác động |
|---|---|---|---|
| C01 | 1 Admin Web + 11Food khách/quán + 11Ship xế; chỉ Android trong phạm vi yêu cầu mới | Nhiệm vụ Owner11/10 | Thay topology4app cũ; giữ chức năng quán trong Food |
| C02 | CUSTOMER mặc định; SHOP_OWNER bổ sung và giữ CUSTOMER | Nhiệm vụ Owner11/10 | Adapter/migration M01, quyền do server cấp |
| C03 | Ba launcher cập nhật Git, mở trình duyệt, giữ backend khi đóng browser | Owner10/10, #40/#46 và nhiệm vụ mới | M00-PC |
| C04 | PLATFORM/EXTERNAL khác SYSTEM/ADMIN | Driver migration main và A2D | Không privilege escalation |
| C05 | Reset USER/ADMIN qua SMS OTP; SYSTEM qua server/email recovery; reset giữ TOTP; không Change Password | Nghiệp vụ Owner duyệt #43 | M01 reset |
| C06 | ChatGPT thiết kế/review; Claude code/test; Owner duyệt UI, PC/phone, merge/LOCK | Workflow main và nhiệm vụ mới | Mọi module/slice |
| C07 | Giữ logo, palette/font/slogan đã chốt | Brand main và ảnh nguồn đã xem | Không tự vẽ logo/thêm login hoặc ưu đãi từ ảnh |
| C08 | Quán ONLINE/OFFLINE tự động theo giờ; không công tắc thủ công | docs/tasks/M02-A-shop-management.md §2, Owner08/10; #21 main | Giữ endpoint/availability đã merge |
| C09 | Tiền thủ công, ví không COD/phí ship; operator ghi topup và tạo withdrawal | S01 B03/B06–B09; ADR004 #7 | Xế chỉ đọc ví/giao dịch và liên hệ operator |
| C10 | Baseline hiện tại không API khách sửa/hủy Order sau submit | S01 §1.1/2.1, manifest4.1 | Giữ mặc định; thay quyền chỉ qua D06 |
| C11 | Activation100k là funding net và available lần đầu; topup đúng actual60k+40k/150k; rút ≥10k; hoa hồng1k/delivery thành công | S01 A35–A39 và ADR004 §6/7 | Không ép minimum100k mỗi topup; không thu lại activation khi resume |
| C12 | Quản lý USER cơ bản trên Web Admin thuộc M01 | Owner11/10 phản hồi sau danh mục M01 | M01.29–.33; M12.02 chỉ mở rộng tác động vận hành, không viết lại core |
| C13 | SMS nhà cung cấp chuyển cuối dự án; backend có kênh giao OTP test trước | Owner11/10 cùng phản hồi C12 | M01.22 TEST_INBOX local; M12.12 SMS thật trước production; không chặn M01 test vì vendor |

C09/C11 là nguồn thiết kế nghiệp vụ, chưa chứng nhận controller/schema money tồn tại hoặc ADR004 đã LOCKED. Capability operator vẫn qua D11.

## 2. Điểm cần Owner quyết định theo slice

| ID | Trạng thái và vấn đề | Phương án/giới hạn | Gate |
|---|---|---|---|
| D01 | M00-PC là web shell; toàn M00 có remote/native/gate thiết bị | Chấp nhận mốc M00-PC riêng; native/phone là slice riêng. Phạm vi LOCK hoặc N/A phải có lời quyết định Owner | Không chặn shell; chặn tự đóng toàn M00 |
| D02 | **OWNER_APPROVED — 11/10/2026 09:44 Asia/Ho_Chi_Minh**: một tài khoản trên một thiết bị; Food và Ship được dùng đồng thời trên cùng điện thoại | Mỗi app có phiên/ngữ cảnh riêng; chuyển CUSTOMER↔SHOP_OWNER trong Food không đăng xuất Ship. Đăng nhập thiết bị mới thay thế binding cũ và thu hồi mọi phiên app của thiết bị cũ. Web local chỉ phiên trình duyệt, chưa chứng nhận giới hạn thiết bị vật lý. Không tin riêng device_id do client gửi; binding Android phải có technical contract trước code | Policy đã duyệt; implementation/binding và native D03 chưa CODE_READY, chưa nghiệm thu |
| D03 | 4.1 từng đề xuất Flutter; #31 Java chỉ diagnostics; Android product runtime chưa khóa | M00 PC TS/HTML nhỏ, kế thừa build Admin. Với Android ưu tiên đánh giá Flutter đã có trong thiết kế trước framework mới; chốt runtime và storage/GPS/push/package contract trước code phone | M00-NATIVE/M01 phone |
| D04 | Geometry vùng/provider/SMS/map/push/ngân hàng chưa có cấu hình thật được xác minh | Dùng dữ liệu/provider được Owner xác nhận; server resolve GPS. Không tự tạo polygon Cao Bằng, UUID nhập tay hoặc bank demo trong thật | M02 resolver/M06/M08/production SMS-money |
| D05 | SYSTEM mất recovery email/TOTP chưa có emergency technical contract | Server CLI audited/operator verification; password reset giữ TOTP. Không public bypass hoặc bootstrap reset. Emergency tách riêng để duyệt custody/verification | SYSTEM emergency recovery |
| D06 | Roadmap #28 O06 lưu xung đột memory cũ cho khách hủy trước confirm; S01/4.1 chọn không mở | Giữ C10, không CTA/API customer cancel. Owner chỉ cần quyết định nếu muốn khôi phục quyền khác baseline | M10 customer mutation |
| D07 | **RESOLVED / SUPERSEDED**: tài liệu cũ quán bật/tắt | Owner08/10 đã thay thế bằng C08, explicit main task. Không cần duyệt lại; không triển khai switch trong proposal | Không có gate mở |
| D08 | #28 O08: tại5000m nguồn cũ10k, baseline floor15k | Giữ hai nguồn trong policy review; trước M06 chốt 4999/5000/9999/10000m và fee modes. Baseline10k+floor(d/5000)×5k là phương án kế thừa; không tự đổi sang inclusive5km. Commission C11 giữ nguyên | M06 pricing |
| D09 | #28 O07: GPS1p/7d/nhắc5-15-30 khác baseline15/30s/30d và reminders | Chốt một policy version trước worker/native; luôn giữ server deadline30phút, stale-job guard và không reset khi return. Reminder30 không phát nếu đã terminal | M08 retention/interval/reminders |
| D10 | Ảnh có freeship/Google/chat/bonus và payout mẫu | Chỉ kế thừa layout/brand; bỏ chi tiết không có contract. Không cần Owner duyệt để bỏ dữ liệu minh họa; feature mới cần thiết kế riêng | Không chặn M00 |
| D11 | ADMIN permissions hiện CUSTOMER/SHOP/DRIVER view/review/lock; chưa financial/config/PII export capabilities | Giữ domain scopes dù2 apps; mặc định deny. Owner duyệt người/quyền topup/withdraw/approve/type/config/audit/export trước affected slices | M03/M04/M12 |
| D12 | Release budget/load/RPO/RTO/field targets chưa có số liệu | Đo/duyệt targets trước load/restore/release; Free staging không chứng minh HA | M12 production |
| D13 | A2D main bỏ driver areas; baseline EXTERNAL≤3/vùng đăng ký và PLATFORM chỉ miễn count/registered-area | Kế thừa policy baseline như proposal; Owner reconcile vùng/binding theo main và exemption trước M06. Search radius khác registered-area; không tự miễn funds/active/batching hoặc thêm bank guard vào accept | M03/M06 eligibility |
| D14 | Baseline cho đặt hẹn khi hiện tại đóng nếu bật nhận; main auto-hours không switch | Đề nghị cho scheduled Order khi thời điểm hẹn thuộc giờ và quán/user/vùng hợp lệ; đặt ngay vẫn cần open. Đây là thay đổi availability Order phải duyệt trước checkout | M10 scheduled Order |
| D15 | Cần chốt khóa identity USER có CUSTOMER/SHOP/DRIVER, khác suspend từng profile | Proposal: SYSTEM khóa USER thường; ADMIN cần view+lock mọi domain thuộc identity; giữ goods/funds và deny impact UNKNOWN. Read-only dùng view scope hiện có, không chờ mutation policy | M01.32/.33 và rollout account mutation; không chặn .30/.31/.22 |

D04 SMS provider/budget/recipient chỉ chặn **M12.12/release thật** theo C13. D04 map/geometry/push/bank vẫn áp dụng module tương ứng. TEST_INBOX là delivery mô phỏng dev/test local, không thay OTP core/TOTP hoặc cho staging/production test fallback. Owner duyệt D81/D86/D87/D88 trước code UI; C12 không tự phê duyệt mọi quyền lock mới.

D02 đã được Owner giải quyết theo quyết định 11/10/2026 09:44; không hỏi lại policy này. D06/D08/D09/D13 có nguồn xung đột được ghi trong roadmap Draft, không nhận memory là quy tắc đã xác minh lại. Chúng không chặn M00. Không dùng D07 để hỏi Owner lại một quyết định đã rõ.

## 3. Quy trình triển khai và LOCK

Thiết kế có phiên bản → Owner duyệt UI/nghiệp vụ áp dụng → Claude code/test Draft → ChatGPT review exact SHA → Owner PC → bản Android/browser test → Owner thiết bị thật → Owner quyết định merge → LOCK khi đủ mọi slice.

| Gate | Evidence tối thiểu | Chưa đủ để thay thế |
|---|---|---|
| DESIGN | Source/PR/version/screen IDs/decision status | Collage hoặc ảnh không field/state |
| CODE/CI | Backend/client full SHA, commands/results, CI URLs | Generated progress/bot SHA |
| REVIEW | Findings blocker được sửa ở head đang test | CI xanh |
| LOCAL | Owner actual từng case, machine/browser/env | Automated smoke hoặc ảnh mock |
| PHONE | APK version/checksum/SHA, thiết bị/quyền/mạng actual | Responsive PC |
| ACCEPT/MERGE | Quyết định Owner đúng scope và head | Draft docs merge hoặc suy đoán |
| LOCK | Tất cả mandatory slice đủ gate, deferred/waiver rõ | Một task backend DONE |

N/A cần lý do và Owner quyết định. Code đổi sau UAT phải xác định affected cases và retest; không mang acceptance SHA cũ sang head mới. Bảng ba bề mặt gồm Admin, Food (khách/quán), Ship và liên thông. Mọi actual trong bộ này chưa chạy.

## 4. Ghi nhận duyệt D02

Nguồn: Owner trả lời **“Ok duyệt”** ngày 11/10/2026 09:44 (Asia/Ho_Chi_Minh), sau phương án phiên cụ thể trong cuộc trao đổi M01.01/PR #52. Phạm vi duyệt: policy phiên D02; không suy ra duyệt runtime Android D03, consent production, CODE_READY cho toàn M01.01, merge/deploy hoặc LOCK.

Đăng xuất app chỉ thu hồi phiên hiện tại; chính sách thay thiết bị phải áp dụng phía server với binding đã thiết kế và kiểm thử. Các phiên Admin giữ contract riêng. Hiện tại code chỉ giới hạn SHOP-context; quyết định này chưa chứng nhận enforcement đã được triển khai.

ChatGPT hoàn thiện contract; Claude code/test; ChatGPT review đúng SHA; Owner test local/điện thoại, quyết định merge và đóng. Mọi gate code/local/phone/acceptance cho D02 vẫn chưa đạt.
