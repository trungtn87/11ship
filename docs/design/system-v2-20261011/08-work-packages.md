# Danh mục gói nhỏ giao Claude

Phiên bản **2.0.2**; **DESIGN_REVIEW / NOT_LOCKED**. Bổ sung cho thiết kế2.0.0 tại [PR48](https://github.com/trungtn87/11ship/pull/48); giữ ID roadmap; revision USER/SMS test theo C12/C13 Owner tại [09](09-m01-user-admin-test-sms.md).

Tổng **108 gói**, gồm M00-PC 10 gói, M00 remote/native 3 gói, M01 33 gói và các backlog M02–M12. Mỗi file có inventory/scope/flow/API-files/errors-tests/PASS-FAIL/prompt/gates. [Quy tắc giao](claude-tasks/README.md); [manifest](claude-tasks/manifest.json).

## 1. Giao việc theo một gói

Giao **M00.01 trước**. Sau PR/review, mở gói kế tiếp đủ dependency/gate. Mỗi gói code một branch/Draft PR, mỗi gói CONTRACT/REVIEW một báo cáo nguồn và gaps. Không paste prompt toàn M00/M01 để code cả module. Claude không tự chuyển gói.

M00-PC theo thứ tự .01→.02→.03, rồi .04/.05, .06→.07→.08, .09→.10. UI có approval gate riêng. M00.11–.13 là remote/native; không chặn chuẩn bị các M01 contract độc lập, nhưng chặn acceptance/phone liên quan.

M01 bắt đầu contract.01 rồi schema.02/register.03/session.04/read-model.05/shared.06; Food.07/.08, Ship.09/.10, shop.11/.12; Admin.13–.15; reset.16–.20; binding.21/inbox SMS test.22/native.24–.28; USER Admin.29–.33; regression/UAT.23 cuối. SMS vendor M12.12 cuối dự án, trước production; không chặn M01 test acceptance. Đọc dependencies từng dòng, số ID không tự chứng minh ready.

M02 resolver.01/.02 là prerequisite nhỏ của M01.12. Financial capabilities contract M12.01 có thể chuẩn bị sớm khi M03/M04 cần D11; không chờ dashboard/report mới chốt quyền.

## 2. Chuỗi phụ thuộc cần giữ

| Chuỗi | Mục đích |
|---|---|
| M04.02 ví zero → M04.03 hold primitives → M07.01 assignment schema → M04.08 commission bridge → M07.03 accept | Không bật nhận đơn khi chưa có typed source/FK/giữ tiền atomic |
| M01.21 binding → M08.01 ingress → M03.05 online → M06.03 evaluator → M07.03 accept | Input vị trí và quyền phải từ server, không fake client identity |
| M05.01 address CRUD + M09 menu → M10.01 checkout → M10.05 delivery link | Địa chỉ không phụ thuộc Order; snapshot và Order chung transaction |
| M07.05 custody + M04.06 payout → M03.06 closure | Không đóng hồ sơ khi hàng/hold/tiền chưa rõ |
| PC đã Owner chấp nhận → native cùng chức năng → Owner phone | Responsive PC không thay runtime Android |

Các gói future cần contract CODE_READY của slice trước code. Gói được chia nhỏ không bỏ invariant atomic, security hoặc migration. Không tạo API trung gian cho phép money/state nửa transaction.

## 3. Danh mục theo module

### M00 — 13 gói

| Gói/prompt | Phạm vi | Loại | Dependencies | Gate/chặn |
|---|---|---|---|---|
| [M00.01](claude-tasks/M00.01.md) | Sửa ba wrapper và lỗi kiểm thử launcher | BE/TOOL | Nguồn main/PR hiện có | Workflow/dependency review |
| [M00.02](claude-tasks/M00.02.md) | Khóa chung, Git update và chạy lại launcher mới | BE/TOOL | M00.01 | Workflow/dependency review |
| [M00.03](claude-tasks/M00.03.md) | Xác minh process, phiên bản build và restart an toàn | BE/TOOL | M00.02 | Workflow/dependency review |
| [M00.04](claude-tasks/M00.04.md) | Bộ UI chung, brand và trạng thái kết nối | UI/SHARED | M00.03 | OWNER_UI: mẫu M00 v2 và trạng thái liên quan được duyệt trước code UI. |
| [M00.05](claude-tasks/M00.05.md) | Build và HTTPS runtime cho ba entry PC | BE/RUNTIME | M00.03 | Certificate trust chỉ ở setup được Owner chấp thuận; không tự cài CA hệ thống. |
| [M00.06](claude-tasks/M00.06.md) | Khung 11Food chạy thử trên PC | UI | M00.04, M00.05 | OWNER_UI: F00-F06 được duyệt. |
| [M00.07](claude-tasks/M00.07.md) | Khung 11Ship chạy thử trên PC | UI | M00.04, M00.05 | OWNER_UI: S00-S06 được duyệt. |
| [M00.08](claude-tasks/M00.08.md) | Tích hợp Admin login và Authenticator đã có | INTEGRATION | M00.05 | Reviewed #34/#35 dependency; Owner duyệt UI slice Admin theo workflow. |
| [M00.09](claude-tasks/M00.09.md) | Tích hợp ba shortcut, Status/Stop và bản Windows | INTEGRATION | M00.06, M00.07, M00.08 | Workflow/dependency review |
| [M00.10](claude-tasks/M00.10.md) | Gói Owner nghiệm thu PC và vòng sửa M00 | UAT | M00.09 | Owner thực hiện test local và xác nhận; Claude chỉ chuẩn bị/check kỹ thuật, không test thay Owner hoặc ghi hộ PASS. |
| [M00.11](claude-tasks/M00.11.md) | Kiểm chứng môi trường test từ xa hiện có | REVIEW | M00.09 | Target/credential test được cấp; thay đổi/deploy có gói và authorization riêng. |
| [M00.12](claude-tasks/M00.12.md) | Bản Android chẩn đoán 11Food | NATIVE | M00.10 | D03 runtime/package/native storage/network; D04 test URL/provider khi áp dụng; Owner UI/local trước phone. |
| [M00.13](claude-tasks/M00.13.md) | Bản Android chẩn đoán 11Ship | NATIVE | M00.10 | D03 runtime/package; Owner UI/local trước phone. Shared foundation thay đổi phải retest Food. |

### M01 — 33 gói

| Gói/prompt | Phạm vi | Loại | Dependencies | Gate/chặn |
|---|---|---|---|---|
| [M01.01](claude-tasks/M01.01.md) | Chốt hợp đồng tương thích tài khoản cho hai app | CONTRACT | M00.09 | ChatGPT CODE_READY contract; Owner quyết định D02/D03 cho slice liên quan, không chặn preflight độc lập. |
| [M01.02](claude-tasks/M01.02.md) | Schema CUSTOMER, hồ sơ khách và consent | BE/SCHEMA | M01.01, M00.10 | Contract .01 và consent content/version đã duyệt; Owner local M00 gate trước triển khai M01. |
| [M01.03](claude-tasks/M01.03.md) | Đăng ký CUSTOMER và xác minh OTP phía backend | BE | M01.02, M01.22 | Contract .01 CODE_READY; SMS fixture chỉ isolated/labeled test, không chứng nhận SMS production. C13: SMS thật deferred M12.12; test kênh inbox có nhãn, không proof telecom. |
| [M01.04](claude-tasks/M01.04.md) | Login, me, context và logout phía server | BE | M01.03 | Đừng thực thi policy physical-device mới khi D02 chưa có contract. |
| [M01.05](claude-tasks/M01.05.md) | Read model hồ sơ khách và hồ sơ xế để resume | BE | M01.04 | Workflow/dependency review |
| [M01.06](claude-tasks/M01.06.md) | Transport và component Auth dùng chung | UI/SHARED | M01.03, M01.04 | Owner duyệt component/UI Auth M01 v2. |
| [M01.07](claude-tasks/M01.07.md) | 11Food: đăng ký và xác minh OTP | UI | M01.06 | Owner UI F11/F12; consent text/version nguồn đã duyệt. |
| [M01.08](claude-tasks/M01.08.md) | 11Food: login, tài khoản, hồ sơ và logout | UI | M01.06, M01.05 | Owner UI F10/F16-F18. |
| [M01.09](claude-tasks/M01.09.md) | 11Ship: đăng ký, OTP và login | UI | M01.06 | Owner UI S10/S11/S18. |
| [M01.10](claude-tasks/M01.10.md) | 11Ship: onboarding, hồ sơ chờ duyệt và tài khoản | UI | M01.09, M01.05 | Owner UI S12-S14/S19. |
| [M01.11](claude-tasks/M01.11.md) | 11Food: tạo và tiếp tục hồ sơ quán nháp | UI | M01.08 | Owner UI F20/F21; role/membership lấy API. |
| [M01.12](claude-tasks/M01.12.md) | 11Food: vị trí quán và hoàn tất SHOP_OWNER | UI/INTEGRATION | M01.11, M02.02 | D04 polygon/provider; Owner UI F22/F23; resolver exact contract approved. |
| [M01.13](claude-tasks/M01.13.md) | SYSTEM: danh sách và tạo lời mời ADMIN | UI/INTEGRATION | M00.08, M01.01 | Reviewed #41 dependency và Owner UI D10/D11. |
| [M01.14](claude-tasks/M01.14.md) | SYSTEM: cấp lại, thu hồi và quản lý scope lời mời | UI/INTEGRATION | M01.13 | Owner UI task, reviewed #41/#44 contract. |
| [M01.15](claude-tasks/M01.15.md) | ADMIN: kích hoạt lời mời bằng OTP và Authenticator | UI/INTEGRATION | M01.13, M01.22 | Reviewed #45 dependency; Owner UI activation. C13: SMS thật deferred M12.12; test kênh inbox có nhãn, không proof telecom. |
| [M01.16](claude-tasks/M01.16.md) | Reset mật khẩu USER/ADMIN phía backend | BE/SECURITY | M01.01, M01.04, M00.08, M01.22 | ChatGPT review security, physical schema và error contract; reset #43 đã chốt, không hỏi lại nghiệp vụ. C13: SMS thật deferred M12.12; test kênh inbox có nhãn, không proof telecom. |
| [M01.17](claude-tasks/M01.17.md) | 11Food: form lấy lại mật khẩu | UI | M01.16, M01.06 | Owner UI F13-F15. |
| [M01.18](claude-tasks/M01.18.md) | 11Ship: form lấy lại mật khẩu | UI | M01.16, M01.06, M01.17 | Owner UI S15-S17. |
| [M01.19](claude-tasks/M01.19.md) | Admin Web: form reset mật khẩu bằng SMS OTP | UI | M01.16, M00.08 | Owner duyệt UI Admin reset và public proxy security contract. |
| [M01.20](claude-tasks/M01.20.md) | SYSTEM: recovery server và email xác minh | BE/CLI | M01.16, M00.08 | D05 operator/email technical contract; emergency custody/verification chưa duyệt thì BLOCKED. Provider email thật được cấp quyền. |
| [M01.21](claude-tasks/M01.21.md) | Phiên một thiết bị và binding của hai app Android | BE/NATIVE | M01.04, M00.12, M00.13 | D02 policy và binding proof; D03 runtime/storage; Owner phone test. |
| [M01.22](claude-tasks/M01.22.md) | Backend hộp SMS test và công cụ lấy OTP trên PC | BE/TOOL | M01.01, M00.08 | C13 đã chốt ưu tiên test; không chờ D04 SMS vendor. Contract/security review và local test target guard; không public remote inbox. Owner local/phone actual theo luồng đã triển khai. |
| [M01.23](claude-tasks/M01.23.md) | Hồi quy Auth, phân quyền và nghiệm thu từng app | UAT/REGRESSION | M01.07, M01.08, M01.10, M01.12, M01.14, M01.15, M01.17, M01.18, M01.19, M01.20, M01.21, M01.22, M01.24, M01.25, M01.26, M01.27, M01.28, M01.31, M01.33 | Owner actual PC/phone/browser, USER Admin và security review; OTP dùng inbox có nhãn. D05 emergency/D02/D03/D15 còn mở chặn đúng scope; M12.12 không chặn M01 test acceptance nhưng chặn production release. |
| [M01.24](claude-tasks/M01.24.md) | Android 11Food: đăng ký và OTP | NATIVE | M00.12, M01.07, M01.21 | D03 runtime và Owner local F11/F12; C13 dùng inbox M01.22, SMS thật deferred M12.12. |
| [M01.25](claude-tasks/M01.25.md) | Android 11Food: login, tài khoản và reset | NATIVE | M01.24, M01.08, M01.17 | D03, Owner local các màn áp dụng, D02 binding. |
| [M01.26](claude-tasks/M01.26.md) | Android 11Food: hồ sơ quán và chuyển giao diện | NATIVE | M01.25, M01.12 | D03/D04 và Owner local F20-F23; map/provider approved. |
| [M01.27](claude-tasks/M01.27.md) | Android 11Ship: Auth, tài khoản và reset | NATIVE | M00.13, M01.09, M01.18, M01.21, M01.25 | D02/D03, Owner local Ship Auth/reset và phone test. |
| [M01.28](claude-tasks/M01.28.md) | Android 11Ship: onboarding và hồ sơ chờ duyệt | NATIVE | M01.27, M01.10 | Owner local S12-S14/S19; D03 runtime. |
| [M01.29](claude-tasks/M01.29.md) | Chốt hợp đồng quản lý USER và quyền khóa identity | CONTRACT | M01.01, M01.14 | ChatGPT chốt CODE_READY cho read; D15 Owner trước mutation. Không chờ M12 capabilities tiền/config/export để thiết kế read USER. |
| [M01.30](claude-tasks/M01.30.md) | Backend danh sách và chi tiết USER theo scope | BE | M01.29, M01.05, M00.08 | Read contract M01.29 CODE_READY; UI không trong gói. D15 chưa chốt không chặn read nhưng lock/unlock chưa được bật. |
| [M01.31](claude-tasks/M01.31.md) | Web Admin danh sách và chi tiết tài khoản USER | UI | M01.30 | Owner duyệt D81/D86 và board v2.0.2 trước code UI; .30 review exact SHA; Owner PC/browser UAT. |
| [M01.32](claude-tasks/M01.32.md) | Backend khóa và mở USER có audit, thu hồi phiên | BE/SECURITY | M01.29, M01.30, M01.04 | D15 Owner policy và .29 mutation contract CODE_READY. Không tự quyết mọi-domain vs một-domain, custody impact hay step-up. Read/UI độc lập tiếp tục khi mutation blocked. |
| [M01.33](claude-tasks/M01.33.md) | Web Admin xác nhận khóa và mở tài khoản USER | UI | M01.31, M01.32 | D15 + .32 review exact SHA; Owner duyệt D87/D88 trước UI code; Owner local/browser actual. |

### M02 — 5 gói

| Gói/prompt | Phạm vi | Loại | Dependencies | Gate/chặn |
|---|---|---|---|---|
| [M02.01](claude-tasks/M02.01.md) | Hợp đồng geometry và quản trị khu vực | CONTRACT | M01.01 | D04 polygon/provider; Owner quyền publish vùng. |
| [M02.02](claude-tasks/M02.02.md) | Resolver vùng và kiểm lại khi lưu/complete quán | BE | M02.01 | D04 và exact contract M02.01. |
| [M02.03](claude-tasks/M02.03.md) | Admin: tạo, sửa và publish vùng hoạt động | BE/UI | M02.02, M00.08 | D04 geometry/provider, Owner UI và writer capability. |
| [M02.04](claude-tasks/M02.04.md) | 11Food quán: hồ sơ active và trạng thái khả dụng | UI | M01.12 | Owner UI F30/F32. |
| [M02.05](claude-tasks/M02.05.md) | 11Food quán: lịch tuần và mở cửa tự động | UI | M02.04 | Owner UI F31. |

### M03 — 6 gói

| Gói/prompt | Phạm vi | Loại | Dependencies | Gate/chặn |
|---|---|---|---|---|
| [M03.01](claude-tasks/M03.01.md) | Hợp đồng hồ sơ xế, bank và lifecycle | CONTRACT | M01.05 | D11 capabilities, D13 khi chạm vùng/count; exact contract CODE_READY. |
| [M03.02](claude-tasks/M03.02.md) | 11Ship: hồ sơ và ngân hàng của xế | BE/UI | M03.01 | Owner UI S20/S21; bank technical/verification contract và dữ liệu ngân hàng thật. |
| [M03.03](claude-tasks/M03.03.md) | Admin: xác minh và kích hoạt xế lần đầu | BE/UI | M03.02, M04.04 | D11 approval/verification capability và contract atomic đã review. |
| [M03.04](claude-tasks/M03.04.md) | Admin: đình chỉ, khôi phục và phân loại xế | BE/UI | M03.03 | D11 capability; D13 exemption policy khi áp dụng; Owner UI. |
| [M03.05](claude-tasks/M03.05.md) | 11Ship: Online/Offline với guard server | BE/UI | M03.03, M08.01 | D13 eligibility, D09 location policy và Owner UI. |
| [M03.06](claude-tasks/M03.06.md) | 11Ship: xin ngừng, hủy yêu cầu và đóng hồ sơ | BE/UI | M03.04, M04.06, M07.05 | Exact closure/enum compatibility contract; D11 operator capability; Owner UI. |

### M04 — 8 gói

| Gói/prompt | Phạm vi | Loại | Dependencies | Gate/chặn |
|---|---|---|---|---|
| [M04.01](claude-tasks/M04.01.md) | Hợp đồng schema tiền và quyền operator | CONTRACT | M03.01, M01.01 | D11 financial capability/operator, bank config/evidence; ADR004 Draft chưa là schema LOCKED. |
| [M04.02](claude-tasks/M04.02.md) | Ví zero, ledger core và khóa tiền | BE | M04.01 | Physical schema M04.01 CODE_READY. |
| [M04.03](claude-tasks/M04.03.md) | Hold primitives cho withdrawal và source constraints | BE | M04.02 | Typed withdrawal schema/FK và hold contracts approved. |
| [M04.04](claude-tasks/M04.04.md) | Operator: ghi nạp tiền thực nhận | BE/UI | M04.02, M03.02 | D11 financial capability; bank config/evidence thật; Owner UI D40. |
| [M04.05](claude-tasks/M04.05.md) | Operator: tạo và hủy yêu cầu rút | BE/UI | M04.03, M04.04 | D11 payout capability; Owner UI D41 và approved bank snapshot contract. |
| [M04.06](claude-tasks/M04.06.md) | Operator: xử lý payout và đối soát kết quả chưa rõ | BE/UI | M04.05 | D11 operator/processing ownership và settlement contract; Owner UI/runbook. |
| [M04.07](claude-tasks/M04.07.md) | 11Ship: ví và giao dịch chỉ đọc | BE/UI | M04.04, M04.05 | Owner UI S30-S33; nạp/payout instructions được xác nhận. |
| [M04.08](claude-tasks/M04.08.md) | Nối hoa hồng với assignment delivery bằng typed FK | BE/INTEGRATION | M04.03, M07.01 | Contract source/FK/commission approved; D11 quyền adjustment nếu liên quan. |

### M05 — 2 gói

| Gói/prompt | Phạm vi | Loại | Dependencies | Gate/chặn |
|---|---|---|---|---|
| [M05.01](claude-tasks/M05.01.md) | Backend địa chỉ own và địa chỉ mặc định | BE | M01.05 | Final address CRUD/default contract; không cần policy mới để tạo contact riêng. |
| [M05.02](claude-tasks/M05.02.md) | 11Food: danh sách và sửa địa chỉ người nhận | UI | M05.01 | Owner UI F40/F41. |

### M06 — 4 gói

| Gói/prompt | Phạm vi | Loại | Dependencies | Gate/chặn |
|---|---|---|---|---|
| [M06.01](claude-tasks/M06.01.md) | Chốt hợp đồng phí, routing và eligibility | CONTRACT | M02.02, M03.01, M04.01 | D04 provider, D08 pricing, D13 eligibility; không code policy khi pending. |
| [M06.02](claude-tasks/M06.02.md) | Shipping quote theo provider và snapshot policy | BE | M06.01 | Provider/budget và pricing contract CODE_READY. |
| [M06.03](claude-tasks/M06.03.md) | Eligibility và batching trước accept | BE | M06.02, M03.05, M04.03, M08.01, M07.01 | D13 và evaluator physical/version contract. |
| [M06.04](claude-tasks/M06.04.md) | 11Ship: danh sách đơn khả dụng được lọc dữ liệu | BE/UI | M06.03, M07.02 | Owner UI S40; final projection/schema/errors và D13. |

### M07 — 7 gói

| Gói/prompt | Phạm vi | Loại | Dependencies | Gate/chặn |
|---|---|---|---|---|
| [M07.01](claude-tasks/M07.01.md) | Delivery aggregate, assignment và history schema | BE/SCHEMA | M04.03, M03.01 | Physical state/schema/lock-order contract CODE_READY. |
| [M07.02](claude-tasks/M07.02.md) | Quán tạo direct delivery và worker hết hạn tìm xế | BE | M07.01, M06.02 | Final create/worker contract; D08 fee khi áp dụng. |
| [M07.03](claude-tasks/M07.03.md) | Xế nhận và trả đơn trước pickup | BE | M07.02, M06.03, M04.08 | M04.08 bridge và D13 evaluator contract approved. |
| [M07.04](claude-tasks/M07.04.md) | Chốt điểm giao, phí và pickup một thao tác | BE | M07.03 | D08 fee và confirm/pickup contract. |
| [M07.05](claude-tasks/M07.05.md) | Hoàn tất, thất bại và trách nhiệm hàng | BE | M07.04 | Final custody/actions/capability contract; money bridge review. |
| [M07.06](claude-tasks/M07.06.md) | 11Food quán: gọi xế và theo dõi delivery | UI | M07.05, M06.04 | Owner UI F50-F52. |
| [M07.07](claude-tasks/M07.07.md) | 11Ship: giao hàng, lịch sử và kết quả | UI | M07.05, M06.04 | Owner UI S41/S50-S53; native/provider khi đến phone. |

### M08 — 5 gói

| Gói/prompt | Phạm vi | Loại | Dependencies | Gate/chặn |
|---|---|---|---|---|
| [M08.01](claude-tasks/M08.01.md) | Server binding, location ingress và latest/history | BE | M01.21, M03.02 | D02 binding proof, D09 GPS policy và exact schema/API. |
| [M08.02](claude-tasks/M08.02.md) | Android xế: GPS nền, quyền và trạng thái OS | NATIVE | M08.01, M00.13 | D03/D09, Owner UI và test điện thoại. |
| [M08.03](claude-tasks/M08.03.md) | Tracking cho quán/khách liên quan delivery | BE/UI | M08.01, M07.05 | D04 map provider, D09 retention/scope và Owner UI F60. |
| [M08.04](claude-tasks/M08.04.md) | Inbox, push binding và archive TTL | BE/UI | M01.21, M07.05 | D04 push provider, native permissions và Owner UI. |
| [M08.05](claude-tasks/M08.05.md) | Reminder jobs theo thời gian và trạng thái thật | BE/WORKER | M07.02, M07.04, M08.04 | D09 reminder policy; M10 contract khi mở Order reminders. |

### M09 — 5 gói

| Gói/prompt | Phạm vi | Loại | Dependencies | Gate/chặn |
|---|---|---|---|---|
| [M09.01](claude-tasks/M09.01.md) | Contract category và menu CRUD backend | BE | M01.12, M02.05 | Final menu/category contract và D11 system category writer. |
| [M09.02](claude-tasks/M09.02.md) | Upload ảnh món và kiểm dữ liệu file | BE | M09.01 | Storage/provider/budget và asset contract; Owner xác nhận nếu khác baseline. |
| [M09.03](claude-tasks/M09.03.md) | 11Food quán: danh sách và sửa thực đơn | UI | M09.02 | Owner UI F70/F71. |
| [M09.04](claude-tasks/M09.04.md) | 11Food khách: tìm quán và xem menu công khai | BE/UI | M09.01, M02.05 | Public discovery API contract và Owner UI F01/F02/F72. |
| [M09.05](claude-tasks/M09.05.md) | Admin: nhóm món hệ thống | BE/UI | M09.01, M00.08 | D11 writer và Owner UI D60. |

### M10 — 5 gói

| Gói/prompt | Phạm vi | Loại | Dependencies | Gate/chặn |
|---|---|---|---|---|
| [M10.01](claude-tasks/M10.01.md) | Backend checkout, Order snapshot và địa chỉ participant | BE | M05.01, M09.01, M02.05 | D14 scheduled availability; giữ C10, D06 chỉ khi muốn đổi policy. |
| [M10.02](claude-tasks/M10.02.md) | Backend quán sửa, xác nhận, từ chối và hủy Order | BE | M10.01 | State/cascade/custody contract; D06 nếu thay baseline. |
| [M10.03](claude-tasks/M10.03.md) | 11Food khách: giỏ, checkout và theo dõi Order | UI | M10.02, M05.02, M09.04 | Owner UI F80-F82 và D14; D06 nếu đổi quyền khách. |
| [M10.04](claude-tasks/M10.04.md) | 11Food quán: nhận và xử lý Order | UI | M10.02 | Owner UI F83-F85. |
| [M10.05](claude-tasks/M10.05.md) | Nối Order và delivery attempts | BE/INTEGRATION | M10.02, M07.05 | Final Order participant/cascade contract, Owner UI nút F85. |

### M11 — 3 gói

| Gói/prompt | Phạm vi | Loại | Dependencies | Gate/chặn |
|---|---|---|---|---|
| [M11.01](claude-tasks/M11.01.md) | Đánh giá quán/xế và lịch sử phản hồi | BE/UI | M10.05, M07.05 | Final rating contract và Owner UI F90-F92/S70. |
| [M11.02](claude-tasks/M11.02.md) | Backend phản ánh và correction ports có quyền | BE | M11.01, M04.01 | D11 moderation/correction và financial adjustment contract. |
| [M11.03](claude-tasks/M11.03.md) | UI phản ánh và hàng đợi xử lý Admin | UI | M11.02 | Owner UI F93/S71/D70 và D11. |

### M12 — 12 gói

| Gói/prompt | Phạm vi | Loại | Dependencies | Gate/chặn |
|---|---|---|---|---|
| [M12.01](claude-tasks/M12.01.md) | Hợp đồng capabilities quản trị theo domain/action | CONTRACT | M01.14, M01.29 | D11 Owner duyệt capabilities. |
| [M12.02](claude-tasks/M12.02.md) | Admin: mở rộng xử lý tác động vận hành khi quản lý tài khoản | BE/UI | M12.01, M01.33 | D11/case workflow và D15 impact policy; Owner UI chỉ phần bổ sung, không yêu cầu viết lại D81. |
| [M12.03](claude-tasks/M12.03.md) | Admin: danh sách quán, xế và khách theo scope | BE/UI | M12.01, M03.04, M02.04, M01.05 | D11 PII/review scopes và Owner UI. |
| [M12.04](claude-tasks/M12.04.md) | Admin: giám sát Order và Delivery | BE/UI | M12.01, M10.05 | D11 scopes và Owner UI monitor. |
| [M12.05](claude-tasks/M12.05.md) | Admin: giao dịch ví và hàng đợi tài chính | BE/UI | M12.01, M04.06 | D11 financial read/actions và Owner UI. |
| [M12.06](claude-tasks/M12.06.md) | Dashboard và chỉ số báo cáo từ dữ liệu thật | BE/UI | M12.02, M12.03, M12.04, M12.05 | Metric definitions/permissions và Owner UI dashboard. |
| [M12.07](claude-tasks/M12.07.md) | Tham số vận hành và publish policy version | BE/UI | M12.01, M06.03 | D11 config writer, exact contract; Owner duyệt khi đổi business value. |
| [M12.08](claude-tasks/M12.08.md) | Nhật ký audit, tìm kiếm và masking | BE/UI | M12.01 | D11 audit/PII capability, Owner UI D83. |
| [M12.09](claude-tasks/M12.09.md) | Export báo cáo theo job và download có quyền | BE/UI | M12.06, M12.08 | D11 export capability/columns, storage/budget và Owner UI. |
| [M12.10](claude-tasks/M12.10.md) | Vận hành: backup/restore, tải và bản phát hành test | OPS/REVIEW | M12.09, M08.02, M08.04, M11.03 | D12 targets/approved test target và restore/load scope; Owner release riêng. |
| [M12.11](claude-tasks/M12.11.md) | Dashboard tiến độ biểu diễn gate và migration schema | BE/TOOL | M01.01, M00.10 | Approved progress schema/process contract; không bịa Owner PASS. |
| [M12.12](claude-tasks/M12.12.md) | SMS nhà cung cấp thật và hồi quy trước phát hành | BE/PROVIDER | M01.23, M01.22, M12.10 | D04 provider/budget/test recipients và Owner cho phép kiểm SMS thật; cuối dự án trước production release. M01 test acceptance không phải evidence telecom. |

## 4. Trạng thái và nghiệm thu

Mọi gói mới ở DESIGN_REVIEW/candidate/backlog. Revision2.0.2 đối chiếu main f90b78a cho USER/OTP; [09](09-m01-user-admin-test-sms.md) là nguồn mới, D15/UI còn chờ duyệt; không code/test/UAT mới. Các số SHA tiếp theo là lịch sử của v2.0.1. Source main refresh891a73b chỉ PROGRESS bot so audit e5b50e8; design source5e351f5, PR46headcf9eecad không đổi. Claude fetch/review diff mới trước sửa. Không có Windows/Android/provider/Owner UAT mới trong việc chia gói này.

Nghiệm thu theo từng app: Admin Web, Food khách, Food quán, Ship, liên thông. Không App Quán/App Quản lý riêng. Owner có thể defer/N/A có lý do đúng phạm vi; không tự dùng một UAT gate để đóng toàn M00/M01.

Prompt CLAUDE-M00/CLAUDE-M01 ở thư mục cha là nguồn tổng hợp; danh mục này là cách giao hằng ngày. Chọn file gói và phụ lục đúng scope để giảm việc đọc lại, không tự giảm test bắt buộc.
