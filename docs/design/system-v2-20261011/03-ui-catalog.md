# Danh mục màn hình và UI/UX

Phiên bản **2.0.2**, các màn nền giữ **2.0.0**; **VISUAL_DESIGN_CANDIDATE / WAITING_OWNER_REVIEW**. Source: brand main, ảnh đã xem, API main/PR, thiết kế01/02/04/05 và [revision USER/SMS test](09-m01-user-admin-test-sms.md). Mã màn hình dùng trong PR, screenshot, E2E và Owner finding. Board 8trang và board USER mới là mẫu duyệt, không ảnh app đang chạy.

## 1. Design system

| Thành phần | Đặc tả |
|---|---|
| Màu | Vàng#D8AD18, đen#2A2A2E, trắng#FFFFFF, nền#F2F1EE; success#2E7D32/error#C62828/info#2563EB |
| Font | Plus Jakarta Sans local/OFL; body14–16px, caption12–13px, title20–24px; đủ dấu tiếng Việt |
| Layout | Grid4px; padding16px, gap12/16px, section24px; phone390×844, responsive360–430; safe areas/keyboard |
| Control | Button/input48px, radius12px; card16px; touch target≥44px; một CTA chính/section; disabled có lý do |
| Icon | Outline24px/stroke2; label/aria; status có chữ; không emoji production |
| Form | Label ngoài placeholder; error dưới field và summary gần CTA; focus first invalid; confirm Back khi dirty |
| Password/OTP | Mắt hiện/ẩn password; không lưu URL/log/localStorage; OTP6số một input accessible, trình bày6ô/paste/autofill |
| Admin | Desktop1366, sidebar240/content flexible; mobile drawer; toolbar/search/filter trước table; row actions có label |
| Table/list | Server cursor; filters/chips/date/status; giữ filter khi Back; empty khác forbidden/unavailable |
| Dialog | Title và đối tượng/hậu quả; Cancel trái/action phải; destructive đỏ; không hard-delete nghiệp vụ |
| Copy | “Đã lưu hồ sơ”, “Đã gửi yêu cầu”; unknown outcome “Chưa xác định kết quả. Đang kiểm tra lại”; không claim commit từ timeout |
| Accessibility | Contrast, focus-visible/keyboard/screen reader, text scale125/150%, reduced motion; không dùng màu riêng để báo lỗi |

Logo gốc giữ nguyên bytes; dùng logo11 đã cung cấp với tên ứng dụng. Chưa có asset wordmark riêng duyệt thì không tự vẽ lại. Slogan: hệ11 “Cần là có”, Food “Thèm là có”, Ship “Gọi là có”.

M00 trên PC mở Food/F01 và Ship/S01; guest navigation thật, chỉ health nối API. Welcome là lựa chọn thiết kế, không bắt Owner đi qua mỗi lần. Panel kỹ thuật app/env/SHA/health tách khỏi nội dung sản phẩm. Module ID/API không đặt trong flow người dùng thật; nhãn M00/test chỉ trong bề mặt thử.

## 2. Trạng thái chung áp cho mọi màn

| ID | Trạng thái | Hành vi bắt buộc |
|---|---|---|
| C01 | Loading | Skeleton dữ liệu; mutation spinner/disable double submit; timeout kết thúc chờ |
| C02 | Empty | Câu cụ thể, icon và CTA hợp lý; không thay dữ liệu thiếu bằng0 |
| C03 | Offline/timeout | Banner+retry, giữ navigation/draft text; không queue nhận đơn/tiền tự gửi sau |
| C04 | Session expired/revoked | Xóa token/PII cache, về login; response cũ không khôi phục; return URL chỉ safe GET |
| C05 | Forbidden | Lý do/quay lại; không màn trắng, không query dữ liệu khác để bypass |
| C06 | Version conflict | Refetch/diff, user xác nhận mới; không overwrite tự động |
| C07 | Unknown mutation outcome | Cùng key/body retry nếu contract cho hoặc đọc resource/state; không key mới/báo fail chắc chắn |
| C08 | Dirty Back/logout confirmation | Không mất draft vô tình; password/proof xóa khi rời flow; logout server cần kết nối |
| C09 | Rate limited | Countdown/Retry-After server; không loop OTP/TOTP hoặc retry timer gây quota |
| C10 | Component unavailable | Feature chưa nối API disabled và lý do ở bản thử; không màn/mock thành nghiệp vụ thật |

Mỗi GET đọc lại khi trở về theo freshness policy; status/amount/capability server là nguồn chuẩn. Notification/deep-link không tự replay mutation sau login. “Không thể kết nối” dựa fetch; navigator.onLine chỉ gợi ý. Cache nếu có phải timestamp/last-known và không giữ badge live khi stale.

## 3. M00 — 11Food

| ID/route | Thành phần và nút | Hành vi/API | Lỗi/điều kiện riêng |
|---|---|---|---|
| F00 /welcome | Logo/slogan; Tiếp tục; login/register | Tiếp tục→F01; Auth nối M01 | CTA chưa nối disabled rõ |
| F01 /home | Logo/account; Giao đến; search; hero; Quán gần bạn;4tabs | Search→F02/account→F03/health background | Không quán/freeship/rating giả |
| F02 /search | Input/clear, scope Món/Quán; empty; Về trang chủ | Navigation thật, query giữ khi Back; public search M09 | Không tạo kết quả giả |
| F03 /account guest | Logo/login/register/help/privacy/diagnostics | M01 links F10/F11; M00 Auth disabled | Không tên/phone/role giả |
| F04 /orders | Title; Đang diễn ra/Lịch sử; empty | M10 list khi sẵn | Không mẫu đơn trong nghiệp vụ |
| F05 /diagnostics | App/env/source/fingerprint/live/ready/time; Kiểm lại/Copy lỗi | Health/runtime metadata local | Sanitize, không DSN/secret |
| F06 offline | Banner/last check/Retry, shell giữ | Health generation-safe | Gỡ Connected cũ |
| F07 shop entry preview | Vị trí “Quản lý cửa hàng” trong account | M01 capability routing | M00 chưa authenticated owner view |

Bottom Food: Trang chủ / Tìm kiếm / Đơn hàng / Tài khoản. Không thêm app quán hay tab yêu thích chưa contract. M00 không kết nối món/Order/quán giả; nguồn ảnh reference chỉ style.

## 4. M01 — khách và quán trong Food

| ID/route | Trường, control và CTA | Luồng/API | Validation/ngoại lệ |
|---|---|---|---|
| F10 /login | Phone/password/eye; Login/reset/register | client-auth login→me→home | Copy credentials chung, no Google/OTP login |
| F11 /register | Name/phone/password/confirm/consent links+checkbox; Tiếp tục | Request REGISTER OTP→F12 | Name120/pwd8–128; no role fields |
| F12 /register/otp | Masked phone/OTP6/expiry/resend/đổi phone | Verify proof→new register | Server cooldown/expiry/maxwrong; lost response same intent |
| F13 /reset | Phone/explanation/Login link; Gửi OTP | password-resets request→F14 | Generic existence, rate/provider unavailable |
| F14 /reset/otp | OTP6/masked phone/resend/Back | Verify RESET_PASSWORD grant→F15 | Không REGISTER proof |
| F15 /reset/password | New password/confirm/eye/session notice; Đặt lại | Complete→success→F10 | No auto login; timeout exact retry/read |
| F16 /account authenticated | Own name/phone; quản lý quán/profile/address/reset/logout | Me/capability routes | Quán disabled vẫn CUSTOMER nếu user active |
| F17 /account/profile | Name/phone readonly; Save | customer profile PUT/version/key | Không đổi login phone/tên pháp lý xế/bank |
| F18 logout dialog | “Đăng xuất khỏi11Food?” Cancel/Đăng xuất | Server204, clear cache | Offline không claim remote revoke |
| F20 /shop/start | Benefits/draft status; Đăng ký/Tiếp tục | Own onboarding GET | Một owner/quán, không duplicate |
| F21 /shop/onboarding | Name/contact/address/Zalo/Facebook/GPS; Lưu/Hoàn tất | Existing draft API; complete sau resolver | Bounds04; no UUID entry; version conflict |
| F22 location sheet | Map thật/marker/accuracy/age/permission; Lấy vị trí/Confirm | Actual position→server resolve | Deny vẫn draft; không map center giả |
| F23 /shop/home M01 | Back khách/shop status/profile/account; business links gated | Shop me/capabilities | ACTIVE profile khác schedule online |

Form tạo hồ sơ quán: tên120/contactphone/address500 required; Zalo160/Facebook300 optional; GPS cặp optional cho draft. Complete cần actual GPS/vùng ACTIVE. Lưu active profile là full replacement theo parser04. Contact phone không đổi login identity. Link chính sách phải có content/version đã duyệt; không checkbox trỏ trang trống để PASS.

Account→Quản lý cửa hàng: nếu chưa hồ sơ mởF20/F21; draft mởTiếp tục; completed eligible mởF23; disabled hiển thị trạng thái và lý do trong own account, protected mutations deny. Adapter legacy context chọn bằng API thật và đọc lại me, không đổi role ở client.

## 5. M00/M01 — 11Ship

| ID/route | UI và nút | API/luồng | Ràng buộc |
|---|---|---|---|
| S00 /welcome | Logo/slogan; Tiếp tục/login/đăng ký xế | M00→S01; Auth M01 | Không auto ACTIVE |
| S01 /home guest | Chưa đăng nhập; profile prompt;5tabs; Online disabled | Navigation+health thật | Không fake map/position/status |
| S02 /orders shell | Đang giao/Lịch sử; empty | M07 sau | Không assigned order giả |
| S03 /income shell | Title/date filter disabled/no-data | M04/M07 data sau | Unknown khác0; phí ship không tự credit ví |
| S04 /wallet shell | No-data/hướng dẫn nạp/liên hệ rút disabled | M04 sau | Không bank/balance/COD giả |
| S05 /account guest | Logo/login/register/help/privacy | M01 Auth | Không driver/type giả |
| S06 /diagnostics | SameF05, app SHIP_WEB | Health/runtime | Origin riêng, backend chung |
| S10 /login | SharedF10, Ship brand | Login/me | Không role chooser SYSTEM/ADMIN |
| S11 /register | SharedF11, lời giải thích tài khoản+xế | Request REGISTER→S18 | CUSTOMER mặc định do server |
| S12 /driver/onboarding | Legal name/plate optional; Gửi hồ sơ | onboarding driver/key | EXTERNAL/PENDING, name120/plate32 |
| S13 /driver/status | Own fields/type/status/reason/requirements; Xem hồ sơ | GET driver/me/resume | PENDING không nhận đơn |
| S14 /account | Own identity/type/status/profile/bank/wallet/reset/logout | Own me/capabilities | PLATFORM label “Xế hệ thống”, không admin |
| S15 /reset | SharedF13 Ship brand | Reset request | Generic copy |
| S16 /reset/otp | SharedF14 | RESET_PASSWORD grant | Purpose/one-use |
| S17 /reset/password | SharedF15 | Complete→S10 | Revoke old, no auto login |
| S18 /register/otp | SharedF12 Ship brand | Verify→register→S12 | Không cấp DRIVER trước profile transaction |
| S19 logout dialog | “Đăng xuất khỏi11Ship?” Cancel/Đăng xuất | Server logout | Stale response/remote revoke |

Bottom Ship: Trang chủ / Đơn hàng / Thu nhập / Ví / Tài khoản. Online/accept yêu cầu backend eligibility thuộc M03/M06/M07, không mở trong M01 chỉ vì login thành công. SUSPENDED/CLOSING vẫn hiển thị hồ sơ và assignment đang giữ theo quyền; account disabled cần operational case.

## 6. Web Admin — Auth và tài khoản

| ID | Trường/control | API/luồng | Ràng buộc |
|---|---|---|---|
| D00 login | Phone/password/eye; Login, reset ADMIN | #34 login | SYSTEM recovery server; no public signup |
| D01 TOTP | Account masked/code6/back login; Xác minh | Verify; lost response GET state | Expired/replay/429; không SMS thay TOTP |
| D02 enrollment | QR/secret-copy/instructions/code6; Confirm | Enrollment/verify | No log/cache/evidence secret; manual secret fallback |
| D03 shell | Sidebar theo capability/profile/admin_role/logout | state/me | F5 restored cookie; PREAUTH denied |
| D04 invitations | Searchphone/name/status/date/cursor; create/detail | #41 list/create | SYSTEM-only contract, không secret list |
| D05 create invite | Name/phone/note; domain×view/review/lock; Confirm | Step-up TOTP→operation→create/key | Giữ CUSTOMER/SHOP/DRIVER scopes |
| D06 invite detail | Target/scopes/status/expiry/version/history; reissue/revoke reason dialog | Operation/expected_version | Lost reply GET operation; không tự gửi link |
| D07 activation | Invitationstatus→SMS OTP→password→TOTP→complete | #45 state/cookie flow | Revoke/expiry/phone conflict/races |
| D08 reset ADMIN | Phone→OTP→newpwd/confirm | Public reset→D00 | TOTP giữ; SYSTEM không dùng flow này |
| D09 SYSTEM recovery | Masked verified email/status/help server procedure | D05 decision gate | Không public bypass/reset bootstrap |
| D81 USER list `/accounts/users` | Tên/SĐT/roles_visible/status/created; search/role/status/date/cursor; Xem | M01.30 read API; M01.31 UI | Một identity một dòng; loại SYSTEM/ADMIN; không tạo/xóa/export |
| D86 USER detail `/accounts/users/:id` | Identity/version/profile đúng scope; account timeline; Quay lại/Làm mới | Read .30; action .32/.33 sau D15 | Không bank/GPS/password/token; hồ sơ riêng khác account status |
| D87 khóa USER dialog | Mục tiêu/lý do/cảnh báo mất phiên hai app; Hủy/Khóa | Mutation .32 và UI .33 sau D15 | Scope mọi role theo policy duyệt; timeout đọc command, không new intent |
| D88 mở USER dialog | Mục tiêu/lý do/giải thích login lại; Hủy/Mở khóa | Mutation .32 và UI .33 | Không restore phiên, profile, funds; no optimistic state |

[Board USER Admin v2.0.2](assets/m01-user-admin-v2.0.2.svg) và revision09 §2.3 là nguồn UI mới, chờ Owner duyệt. D81 trước nằm M12 nay thuộc M01; M12 chỉ mở rộng case/tác động vận hành. Auth test banner “SMS mô phỏng — môi trường test” và hướng dẫn mở tool PC; OTP không hiện trên public Auth UI. SMS vendor copy/handset delivery đến M12.12; không SMS thay Authenticator.

M00 chỉ reuse D00–D03. Invitations/activation/reset riêng M01; full business menus riêng module owner. Local HTTPS8443/cookie/Origin/CSRF giữ nguyên. QR secret không xuất bản vào screenshot evidence.

## 7. M02–M12 — màn hình chức năng

Mỗi row kế thừa C01–C10. List có search/status/date/cursor theo API, detail có status/version/timeline/action đúngstate; edit có Save/Cancel/version; money có balance/held/available/bank snapshot/reason; map có timestamp/permission/source. Screen không có capability hiển thị forbidden/disabled, server vẫn guard.

| Module/ID | UI, trường và nút | Hành vi/API và ngoại lệ |
|---|---|---|
| M02 F30 | Shop profile name/contact/address/social/pickuparea; Edit/Save | Own full replacement; login phone riêng; GPS/area/version |
| M02 F31 |7days, intervals/start/end/overnight, copy cả tuần; Save | Existing hours PUT; overlap/Sun wrap/[] closed/max28 |
| M02 F32 | Availability badge/reasons/evaluated time/giờ tiếp theo | Read schedule; không toggle; ngoài giờ/disabled rõ |
| M02 D20 | Areas code/name/status/version/updated/search | View/create/edit sau D04, permission |
| M02 D21 | Actual map polygon/name/code/status/version; Validate/Publish | Invalid ring/overlap/impact preview, no fakepilot |
| M03 S20 | Legalname/plate/type/status/verification; Edit | Type readonly; name edit invalidates bank proof |
| M03 S21 | Bankcode/account/holder/status; Save | Masked reads/version; review thật, no automatic verification |
| M03 D30 | Identity/funding/bank review/history; approve/reject/suspend/resume reason | Bank payout khác accept; phone/funding criteria theo contract |
| M03 S22 | Stop explanation/current goods/balance/payout; Request/Cancel | Closure không auto payout/delete; chặn nhận mới |
| M03 S23 | Closurestate/holds/custody/under10k; Resume action hợp lệ | Adapter missing fail closed, funds preserved |
| M04 S30 | Wallet balance/held/available/time; History/instructions/contact | Own read, stale indicator; không edit |
| M04 S31 | Official receiving bank/reference/QR nếu configured; Copy/help | Actual tiền nhận;100k activation tổng, không minimum topup |
| M04 S32 | Own withdrawal detail amount/bankmasked/state/history/help | Operator tạo/transfer; xế không input mutation amount |
| M04 S33 | Transactions date/type/amount/balance/reference/cursor | Own read/filter/detail, no foreign wallet |
| M04 D40 | Target/actualamount/canonicalbankref/receivedat/evidence/note | Operator confirm actual; unique bank, role/replay |
| M04 D41 | Payoutqueue/create/detail amount/hold/bank/version/evidence; claim/paid/reconcile | Operator only; owner claim, uncertainty giữ hold |
| M05 F40 | Label/recipient/phone/address/default; Add/edit/default/delete | Own address; default replacement confirmation |
| M05 F41 | Recipient/phone/address/note/optional GPS; Save/map | GPS deny cho text save; snapshots cũ giữ |
| M06 F50 | Direct ship recipient/address/value/itemnote/optionalpoint; Quote/Call xế | Không tạo fake Order; unknown point xếtrống |
| M06 S40 | Available delivery sanitized distance/value/fee/eligibility; Accept | No phone/exactmap trước accept; commit recheck |
| M06 S41 | Deliverypoint/map/note/fee mode/quote; Confirm | Provider lỗi, phí>500k confirmreason; lock saupickup |
| M07 F51 | Waitingdeadline/alerts/status; Cancel/Retry khi terminal | Deadline create giữ; retry new ID, custody guard |
| M07 F52 | Shop timeline/currentdriver/fee/location/incident/report | Own tracking scope, cancel trướcpickup |
| M07 S50 | Active list accepttime/status/nextaction; Open | Xế chọn thứ tự; activecount server |
| M07 S51 | Pickup shop/contact/cargo/value/fee/point; Call/navigation/Đã nhận hàng | Current assignment/point/fee/version; atomic milestones |
| M07 S52 | Delivering receiver/address/route/time; Call/navigation/Đã giao/Thất bại | Không self cancel saupickup; offline blocks commit |
| M07 S53 | Result confirmation ID/outcome/reason/custody | Same intent once; lost response reread; capture/release |
| M07 D50 | Monitor date/state/shop/driver/eventtimeline/incident | Read/case/correctionport; không forced dispatch |
| M08 S60 | Foreground/background/precision/battery/lastsample; OSsettings | Android permissions lifecycle/reboot |
| M08 F60 | Shop/driver/receiver markers, lastseen/accuracy/stale | Current related delivery only; no fake live movement |
| M08 F61/S61 | Inbox unread/type/time/resource; Read/deep-link | Resourcegone/forbidden/TTL; fetch authority |
| M09 F70 | Category/name/photo/price/visible/available/search; Add/edit/hide/delete | Own menu; softdelete/history giữ |
| M09 F71 | Name/photo/price/system/shopcategory; Save/upload | Image decode/owner/size/version/timeout |
| M09 F72 | Publicshop/menu availability/name/photo/price/groups; Addcart/note | Hidden/pricechanged/closed; no fakepromo |
| M09 D60 | Systemcategory name/order/status; Save | SYSTEM/scoped writer; category ngừng nhómKhác |
| M10 F80 | One-shop cart qty/note/subtotal; Checkout/change-shop confirm | Offline không commit; menu current price compare |
| M10 F81 | Buyer/receiver/address/now-or-scheduled/note/totals; Submit | Inline/default effects rõ; schedule gateD14 |
| M10 F82 | Customer order agreeditems/total/state/time/history/report | Baseline no customeredit/cancel; attention failed |
| M10 F83 | Shop list pending/confirmed/history/time/filter | Server freshness/version conflict |
| M10 F84 | Pendingqty/unitprice/agreedtotal/note/revision; Save/confirm/reject reason | Sau traođổi; confirm immutable, race |
| M10 F85 | Confirmeditems/receiver/time/deliveryhistory; Call xế | Chủđộng, onecurrent; no auto dispatch |
| M11 F90 | Shoprating5stars/text/orderref; Submit once | Own completed Order only |
| M11 F91/S70 | Driverstars/text/deliveryref hoặc rating history | Quán rate completed/failed; xế đọc; không tự thêm customer actor |
| M11 F92 | Shopratings/customeroriginal/reply/history | Owner reply/update, không xóa rating |
| M11 F93/S71 | Report resource/type/description/evidence; Submit/status | No auto refund/penalty/terminal reopen |
| M11 D70 | Queue type/state/resource/actions/history/evidence | Investigate/correctionports/scope/audit |
| M12 D80 | Actualorders/deliveries/alerts/payoutpending/GPSstale; Drilldown | Same filters; unavailable khác0 |
| M12 D81 | Account phone/name/roles/status/origin/scope; View/lock/unlock reason | Revoke sessions; goods case; no SYSTEM delete |
| M12 D82 | Param key/value/unit/version/effective/dependency; Validate/publish | SYSTEM/capability; in-flight snapshot giữ |
| M12 D83 | Audit actor/action/resource/outcome/date/requestid; filter/export | Mask PII/no secrets/cursor |
| M12 D84 | Reportfilters/metrics/exportjobstate; Create/download | Totals reconcile; auth download expiry |
| M12 D85 | Health/outboxdead/jobs/backup/restore evidence | Read/retryapproved; no credential/destructive bypass |

## 8. Liên thông và nghiệm thu UI

Back từ quán về khách giữ CUSTOMER/session. Deep-link sau login chỉ fetch allowed resource; không tự nhận/giao/rút. Returned driver history chỉ assignment mình, không contacts mới. Failure giữ custody và attention; wallet không cộng COD/phí ship. Mọi message phải nói đúng commit.

Board mô tả M00 shell/diagnostics/error, M01 Auth/onboarding và Admin reuse; screens phụ theo catalog/component/state. Claude bổ sung screenshot đúng screen ID ở slice triển khai, Owner duyệt trước code UI theo workflow. Screen tương lai chưa có API dùng disabled lý do ở bản thử; không tính stub là business acceptance. Không nhận collage/reference hoặc CI là Owner PASS.
