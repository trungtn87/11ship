# M01 — review cuối module, 13/10/2026

Trạng thái mới nhất (review delta 14/10/2026): **F1 còn mở; F2–F6 đã xử lý ở mức code; chưa đóng M01**. Finding và bằng chứng vòng 13/10 giữ nguyên bên dưới; xem kết quả delta cuối tài liệu. Codex review và chuẩn bị giao sửa; Claude viết code. Phạm vi theo `docs/current/M01-workstreams-20261012.md`. Không triển khai lại, không mở rộng module, không merge/deploy.

## Mốc review và bằng chứng kế thừa

- PR [#95](https://github.com/trungtn87/11ship/pull/95), head đã xác nhận lại: `fe3cae1633307813997a0d6e90c895611eb2fd00`; OPEN/DRAFT, chưa merge. Mọi vị trí code bên dưới là tại SHA này.
- Base PR: `05d02eac704fd506f5a4862853d885a6fa8ab896`. Main khi bắt đầu review: `787fc24f0ce1e2197786556ed4d04797e8f27a01`; khi chốt: `3844934ea78aab36b632a2494b91c6c5a24e12b4`. Compare base → main cuối: ahead 10, behind 0, chỉ `docs/PROGRESS.md` thay đổi; không có delta sản phẩm cần audit lại. PR #96 xuất hiện trong PROGRESS nhưng chưa merge, không tính là bằng chứng sửa #95.
- Kế thừa các slice đã merge: #68/#76/#78/#80/#81/#82/#83 (account/session/client), #85 (shop), #88 (driver), #89 (activation), #90 (admin read), #92 (lock), #93 (reset), #94 (SYSTEM local recovery). Không yêu cầu chạy lại bộ test của từng PR.
- [CI 38412964530](https://github.com/trungtn87/11ship/actions/runs/38412964530) tại đúng head: SUCCESS. Các bước lint/typecheck/build, unit/integration, client/admin UI, migrations, PowerShell 7 và Windows PowerShell 5.1 xanh.
- [Mobile APK 38412964040](https://github.com/trungtn87/11ship/actions/runs/38412964040) tại đúng head: FAILURE tại bước yêu cầu persistent signing secrets. Cả Food/Ship đã xanh analyze/test, native Binder unit, build release, permission allowlist. Sign/upload và kiểm signer sau ký chưa chạy. Đây không phải APK đã ký/phát hành; thiếu secrets không chặn review code.
- PR ghi nhận focused backend native remaining 6 ca, nhóm trước đó 99 ca; Dart shared 68/Food 13/Ship 8; gateway 7 ca. Đây là bằng chứng kế thừa, không phải số test Codex vừa chạy.

AGENTS.md, CLAUDE.md, quy trình hiện hành và kế hoạch đã đọc một lần; sau đó chỉ truy vết phần liên quan. Do git transport không truy cập được, review dùng bản base local và toàn bộ 111 file patch từ GitHub connector, kiểm context/số dòng hunk, dựng snapshot riêng ngoài working tree. Không sửa code sản phẩm. Không chạy full local suite, không poll CI, không truy cập VPS/DB Owner.

## Phạm vi đã đối chiếu

| Luồng | Kết quả đối chiếu code/contract và giới hạn |
| --- | --- |
| Đăng ký test, login, hồ sơ, logout/hết phiên | DISABLED_TEST tạo TEST_UNVERIFIED, không OTP giả; consent/customer/profile/session atomic. Kiểm authority/replay hiện tại và thu hồi; còn F1/F3/F6. |
| Food | Draft/readback, expected_version, khu vực server, GPS candidate, complete thêm SHOP_OWNER giữ CUSTOMER, không tự bật nhận đơn; đổi context do người dùng. Còn F3/F4/F5. |
| Ship | Gửi/đọc profile, trạng thái, EXTERNAL/PENDING và accepting_deliveries=false; không tự chuyển context/mở nhận đơn. Còn F3 và luồng auth dùng chung. |
| ADMIN/SYSTEM | Password preauth không cấp phiên đầy đủ; TOTP, chống dùng lại bước TOTP, invitation/activation, quyền đọc/projection và lock theo quyền hiện tại; lock thu hồi, unlock không phục hồi phiên. Chưa thấy finding bổ sung trong phần đã truy vết; không suy nghiệm thu UI thật. |
| Reset/CLI | Reset USER/ADMIN chỉ trong mode test đã chốt, ack chung, revoke phiên/preauth, giữ TOTP/status; SYSTEM bị loại khỏi HTTP reset. CLI SYSTEM local kiểm environment/DB identity/expectedVersion, mật khẩu qua stdin. Còn F2/F3 ở Android. |
| Android proof/binding | Attestation roots pin/revocation snapshot, TEE/StrongBox, nonce/time/body, binding recheck, Binder UID/signature và join-only signing đã đối chiếu. Còn F1/F5/F6; fixture không chứng nhận phần cứng. |
| APK | applicationId Food `vn.eleven.food.test`, Ship `vn.eleven.ship.test`; signer persistent, không fallback khóa tạm; versionCode theo run_number; kiểm id/version/signer trong workflow. Giữ dữ liệu/key/token khi update vẫn là NOTE thiết bị. |

## Danh sách finding duy nhất

### F1 — P1: legacy login dựa vào nhãn do client gửi để chặn đường né proof

- **Vị trí:** `apps/backend/src/auth/auth-validation.ts:68–71` (`assertLegacyDeviceAllowed`), đường gọi trong `auth/login-service.ts`; phân loại native trong guard/session dựa trên cùng nhãn platform/app.
- **Tình huống:** gửi legacy `/v1/auth/login` với credentials hợp lệ nhưng device `ANDROID/OTHER` hoặc `IOS/FOOD`. Hàm chỉ cấm đúng ANDROID + FOOD/SHIP; nhãn khác được cấp phiên ordinary không proof, sau đó guard cũng không coi là native. Legacy account/onboarding surface còn sử dụng phiên đó. Native gateway không forward legacy login, nên điều kiện khai thác là có đường tới backend/legacy surface; không khẳng định gateway đang expose route này.
- **Tác động:** policy one-device/proof có thể bị né khi legacy surface khả dụng. Contract session/device §6 yêu cầu policy server kiểm soát compatibility local và không để legacy thành đường bypass khi rollout native.
- **Bằng chứng:** probe gọi parser/LoginService/SessionAuthGuard thật với repository/password/transaction giả: cả hai nhãn đều `sessionIssued=true`, `guardAccepted=true`, `proofCalls=0`. Đây là kiểm tra nhánh code, không phải HTTP/DB hoặc điện thoại thật.
- **Hướng sửa:** gate issuance và usage legacy bằng policy môi trường/surface phía server; giới hạn compatibility local đã duyệt. Không dùng nhãn tự khai để quyết định bỏ proof. Giữ web local hợp lệ và bảo vệ production.
- **Kiểm tra cần thêm:** HTTP regression nhãn thay thế, policy local/native/production và phiên legacy sau thay binding; bảo đảm không phá web local.

### F2 — P2: mở lại reset dùng trạng thái và intent của lần trước

- **Vị trí:** `mobile/packages/n11_shared/lib/src/flows/reset_controller.dart:51–79,119`; `reset_views.dart:35–55`; controller được giữ bởi flows của app.
- **Tình huống:** reset thành công, rời màn hình rồi mở lại. `_done` vẫn true, view hiện thành công cũ thay vì form. Với kết quả chưa rõ, `abandon()` chỉ đổi epoch/busy, giữ failure và pending body chứa phone/password; mở lại form trống vẫn có thể retry intent cũ.
- **Tác động:** không thực hiện được reset mới bình thường; retry có thể nhắm dữ liệu không còn hiển thị và giữ mật khẩu trong controller lâu hơn vòng đời form.
- **Hướng sửa:** xác định vòng đời một lần mở form; xóa done/error/pending/password khi bỏ intent hoặc mở lượt mới, loại phản hồi muộn; chỉ giữ retry cho intent hiện đang hiển thị.
- **Kiểm tra cần thêm:** widget reset thành công → đóng → mở; unknown outcome → bỏ màn hình → mở, không còn retry dữ liệu cũ.

### F3 — P2: gateway 504 làm mất key/body của thao tác có thể đã commit

- **Vị trí:** `scripts/native-gateway.mjs:90,174–177`; `mobile/packages/n11_shared/lib/src/account/session_controller.dart:370–378`; `flows/shop_controller.dart:403–410`, `driver_controller.dart:217–224`, `reset_controller.dart:131–135` (cùng gốc package). Kiểm cả nhánh đổi context dùng chung quy tắc retry.
- **Tình huống:** backend commit nhưng phản hồi bị mất/chậm; gateway timeout trả 504 `SERVICE_UNAVAILABLE`. Client map thành serverUnavailable, nhưng chỉ giữ pending nếu unknownOutcome hoặc code `TRANSACTION_OUTCOME_UNKNOWN`; do đó xóa key/body dù chưa biết kết quả mutation.
- **Tác động:** lần tiếp theo tạo intent mới: register có thể báo số đã tồn tại, shop conflict, reset lặp đổi mật khẩu/thu hồi phiên; mất khả năng replay đúng kết quả cũ.
- **Hướng sửa:** phân biệt từ chối chắc chắn với lỗi vận chuyển/gateway không xác định kết quả. Giữ key/body và dữ liệu replay cần thiết; proof/nonce mới theo contract; người dùng chủ động retry. Áp dụng nhất quán auth/context/shop/driver/reset.
- **Kiểm tra cần thêm:** gateway trả 504 sau commit, retry giữ key/body, không có mutation thứ hai; thêm nhánh context. Probe socket local bị sandbox từ chối `listen EPERM`, **không tính PASS**; finding dựa vào producer/consumer code rõ ràng.

### F4 — P2: form quán ghi đè dữ liệu mới sau xử lý version conflict

- **Vị trí:** `mobile/packages/n11_shared/lib/src/flows/shop_views.dart:125–132,155–161,195–197`; `shop_controller.dart:187–220,413–416`.
- **Tình huống:** Food đang mở draft v1; web cập nhật tên/địa chỉ thành v2. Save Food gặp conflict rồi controller GET v2 và cập nhật version/model. TextEditingController chỉ khởi tạo một lần, vẫn hiện giá trị v1. Sửa một trường hoặc bấm Save gọi `_push()` chép tất cả text cũ vào model với version v2.
- **Tác động:** lần save tiếp được chấp nhận và âm thầm ghi đè các trường vừa cập nhật ở web, dù nhánh conflict có ý định đọc lại dữ liệu mới.
- **Hướng sửa:** đồng bộ form text khi chấp nhận snapshot reload/conflict, hoặc giữ version cũ cho đến khi người dùng xử lý xung đột rõ ràng. Không đẩy text cũ trở lại controller khi dispose sau session invalidation.
- **Kiểm tra cần thêm:** widget có external v2 → 409 → readback → sửa một trường → save; các trường không sửa giữ giá trị v2. Test controller-only hiện có không bao phủ TextEditingController.

### F5 — P2: đọc hồ sơ quán không kiểm lại phiên/binding trong transaction

- **Vị trí:** `apps/backend/src/onboarding/shop-onboarding.controller.ts:39`; `shop-profile-query-service.ts:61–63`.
- **Tình huống:** request qua guard rồi chờ transaction/pool; reset, khóa tài khoản hoặc thay binding commit trước lúc query đọc. Controller chỉ truyền userId; service mở transaction chỉ SELECT owned shop, không recheck session/user/binding/expiry.
- **Tác động:** trả hồ sơ quán, số liên hệ và vị trí từ phiên đã hết hiệu lực sau điểm kiểm guard; khác contract recheck authority trong transaction và các protected reads khác.
- **Hướng sửa:** truyền actor/session vào query service, dùng authority và lock order hiện hành trước đọc; vẫn cho chủ draft roleless đọc hồ sơ của mình theo contract, không tự thêm yêu cầu SHOP_OWNER.
- **Kiểm tra cần thêm:** chặn giữa guard và service, commit revoke/reset/replace rồi tiếp tục đọc; không trả profile. Kiểm roleless draft vẫn đọc được khi phiên hợp lệ.

### F6 — P2: tự JOIN binding của app kia trước khi biết tài khoản gây kẹt register/login

- **Vị trí:** `mobile/packages/n11_shared/lib/src/account/native_auth.dart:58–84`; `session_controller.dart:264–300`; `apps/backend/src/client-device/client-device-binding-participant.ts:96–113`.
- **Tình huống:** Ship đang giữ binding user A; Food chưa thuộc binding đó, đăng ký user B mới hoặc đăng nhập B. `obtainGrant()` luôn JOIN peer trước, không biết tài khoản đích. JOIN grant có thể cấp thành công nhưng bước auth sau đó bị backend từ chối vì binding.userId khác user đích (với đăng ký mới, luôn khác). Fallback trong `obtainGrant` chỉ bắt lỗi khi lấy grant, không bắt lỗi auth sau đó; bấm lại vẫn chọn JOIN A. Logout peer vẫn giữ metadata binding.
- **Tác động:** app còn lại không đăng ký/đăng nhập tài khoản khác được theo luồng thông thường khi peer có binding; đăng ký mới bị kẹt bởi trạng thái app kia.
- **Hướng sửa:** chọn ENROLL/NEW_BINDING đúng cho đăng ký tài khoản mới; có đường xử lý login khác tài khoản sau từ chối xác định. Giữ JOIN cùng user và kiểm ownership phía server; không tự thay intent khi kết quả auth chưa rõ.
- **Kiểm tra cần thêm:** peer user A + register B/login B, cả Food→Ship và Ship→Food; cùng user vẫn coexist; lỗi unknown không tạo binding lần hai.

## NOTE thiết bị — tách khỏi finding code

Tất cả các mục sau: **CHƯA KIỂM — ĐỂ SAU**. Owner thử sau với tài khoản/dữ liệu test; không suy PASS từ mock, fixture, CI hoặc code review.

| Mục | Điều kiện cần | Kết quả mong đợi |
| --- | --- | --- |
| PC launcher/update | PC Owner, bản đang dùng và bản cập nhật hợp lệ | Launcher chạy/cập nhật đúng phiên bản, dữ liệu/cấu hình giữ nguyên, lỗi update có thông báo và phục hồi được. |
| PC DB/TLS | DB test do Owner cấu hình, CA/cert/hostname đúng và một cấu hình sai để đối chiếu | Kết nối đúng thành công; TLS/DB sai bị từ chối rõ, không fallback bỏ xác minh. Codex không truy cập DB/VPS. |
| PC giao diện thật | Trình duyệt/launcher thật, ordinary/ADMIN/SYSTEM test, TOTP thật | Đi hết account/Food/Ship/admin/reset; quyền và lỗi phiên phản ánh đúng, không lộ màn hình/dữ liệu cũ sau logout/lock. |
| Ký/phát APK | Đủ persistent signing secrets, workflow ký và artifact thực tế | Hai applicationId đúng, signer persistent đã kiểm, versionCode tăng, không khóa tạm; cài được artifact đã ký. |
| Cài đè giữ dữ liệu/key/token | APK cũ có phiên/draft, APK mới cùng id/signer và versionCode cao hơn | Update không xóa draft/key/token hợp lệ; phiên đã revoke không sống lại. Ghi nhận fingerprint/version trước và sau. |
| Attestation phần cứng | Điện thoại hỗ trợ TEE/StrongBox, trust roots/revocation config hợp lệ | Chấp nhận key phần cứng đúng; từ chối cấu hình/thiết bị không đạt, không fallback software. |
| GPS tại quán | Food trên điện thoại thật tại quán; thử cho phép, từ chối và tắt GPS | Chỉ lấy khi bấm, hiển thị vị trí để xác nhận; thất bại vẫn lưu draft nhưng không complete thiếu vị trí; không vị trí giả/mặc định. |
| Hai app cùng máy, hai thứ tự cài | APK cùng signer; Food→Ship rồi Ship→Food; cùng user và tình huống F6 | Cùng user JOIN và cả hai phiên hoạt động; app không có quyền không gọi Binder; khác user không kẹt/ghép nhầm. |
| Hai điện thoại thay nhau | Hai thiết bị thật, cùng user, Food/Ship và dữ liệu draft đã lưu | Login thay binding thu hồi phiên máy cũ kể cả offline rồi online; máy mới đọc đúng dữ liệu; replay/proof cũ không phục hồi phiên. |
| Nền/offline/khởi động lại | Phiên đang hoạt động và intent pending; thử mất mạng, background/kill/reboot; reset/lock từ phiên khác | Khôi phục token/key hợp lệ, revalidate; intent retry không nhân đôi mutation, không tự mở nhận đơn; phiên revoked/expired bị xóa khỏi UI và không lộ cache cũ. |

## Giao Claude và phạm vi review tiếp

```text
Claude: sửa F1–F6 trong docs/evidence/M01-final-review-20261013.md trên nhánh M01 phù hợp với head PR #95 fe3cae1633307813997a0d6e90c895611eb2fd00.
Đọc delta nếu head đã đổi; không triển khai lại M01, không audit/refactor module khác.
Giữ quyết định bản test không xác minh SĐT, không OTP giả; giữ TOTP ADMIN/SYSTEM và production guards.
Thêm/chạy regression tập trung đúng các khoảng trống ghi tại từng finding; kế thừa CI/test xanh phần không đổi, không lặp full local suite hoặc poll CI.
Không làm thay các NOTE thiết bị, không truy cập VPS/DB Owner; thiếu signing secrets không chặn sửa/review code.
Trả fix SHA, ánh xạ F1–F6 → diff/test và link CI hiện có. Cập nhật bằng chứng vào chính tài liệu review này, không tạo báo cáo trùng/không sửa PROGRESS tự sinh.
Không merge, deploy hoặc đóng M01. Codex sau đó chỉ review delta và phần chịu ảnh hưởng.
```

Đây là handoff để Owner chuyển cho Claude; Codex chưa gửi thông điệp qua dịch vụ ngoài và chưa sửa code sản phẩm.

## Review delta F1–F6 — 14/10/2026 (Codex, một lượt)

**Kết luận: F1 còn mở; F2–F6 đã xử lý ở mức code trong delta đã kiểm. Không đóng M01.** Các finding gốc phía trên giữ nguyên để truy vết; bảng này là trạng thái mới nhất.

- PR sửa: [#97](https://github.com/trungtn87/11ship/pull/97), OPEN/DRAFT, chưa merge; head review `6bb83813d45ce37d1c971b0e850a675ca4c39313`.
- Commit sửa F1–F6: `e25c70e346427d8765e8dc6df7491d09f7e4619e`. So với baseline `fe3cae1633307813997a0d6e90c895611eb2fd00`, review chỉ các thay đổi sửa finding và dependency trực tiếp. Các commit SYSTEM recovery/signing/PROGRESS do đồng bộ nhánh không mở lại audit module.
- PR #95 hiện đã merge, head cuối `5b50644079ccd147acb1e9af7ac9ed74d302d34c`, merge commit `c15eb20e715f485d55526173bf8115d26a65e301`; đây là metadata đọc được, không phải hành động merge của Codex.
- [CI 38434182758](https://github.com/trungtn87/11ship/actions/runs/38434182758) tại đúng head #97: SUCCESS; lint/typecheck/build/unit/integration local và CI mode xanh. Kế thừa kết quả, không chạy lại full suite.
- [Mobile APK 38434182859](https://github.com/trungtn87/11ship/actions/runs/38434182859) tại đúng head #97: SUCCESS; cả hai app analyze/test/Binder/build/permission/sign/verify/upload xanh, Public signer allowlist xanh. Thay thế giới hạn thiếu secrets của vòng trước ở mức CI/artifact; không chứng minh cài đè hoặc phần cứng thật.
- Không poll CI, không kiểm PC/Android thật, không truy cập VPS/DB Owner, không sửa code sản phẩm.

| Finding | Trạng thái delta | Đối chiếu và bằng chứng |
| --- | --- | --- |
| F1 | **CHƯA HẾT — P1** | Legacy login/register nhận gate từ settings trong AuthModule và chặn nhãn thay thế khi gate bật; integration regression mới đã nằm trong CI xanh. Nhưng guard ở module khác không được inject settings vì AuthModule không export token; xem phần còn mở bên dưới. |
| F2 | Đã xử lý ở mức code | ResetScreen gọi begin khi mở, abandon khi rời; cả hai xóa done/failure/key/body và đổi epoch. Retry chỉ hiện nếu phone/password đang hiển thị khớp intent. Regression controller và widget mở lại đã thêm; Mobile tests xanh. |
| F3 | Đã xử lý tình huống gateway của finding | outcomeUnknown nhận 502/504 SERVICE_UNAVAILABLE từ gateway; auth/shop/driver/reset giữ key/body; context kiểm cả exception và response trước xóa intent. Profile save dùng cùng phân loại. Test gateway 504 cho shop/driver/reset/context và JOIN auth; Mobile tests xanh. Không suy kết quả điện thoại/offline thật. |
| F4 | Đã xử lý ở mức code | formRevision tăng khi nhận snapshot/clear; view nghe controller và cập nhật text khi revision đổi; dispose không đẩy text sau sign-out. Widget regression v1 → conflict → v2 → sửa một trường giữ nguyên các trường v2 đã thêm; Mobile tests xanh. |
| F5 | Đã xử lý ở mức code; còn giới hạn bằng chứng | Controller truyền actor; query gọi lockAuthorizedActorShared trước SELECT trong cùng transaction. Participant hiện hành recheck user/session, clock sau lock và native binding; không yêu cầu role nên draft roleless giữ quyền đọc. Unit kiểm authorize trước read và không read khi bị từ chối đã thêm, CI xanh. **Chưa có integration race chuyên biệt giữa guard và service**; PR #97 cũng ghi rõ. |
| F6 | Đã xử lý ở mức code | Register allowJoin=false; login JOIN bị từ chối xác định cho device thì discard key, lấy grant riêng và thử một lần với key idempotency mới; unknown outcome giữ intent cũ. Backend vẫn kiểm owner/binding và không đổi policy JOIN. Test register, login khác user, lần từ chối thứ hai và unknown retry đã thêm; Mobile tests xanh. Chuỗi Flutter fallback + backend thật chưa có test tích hợp riêng; không suy PASS thiết bị. |

### Phần còn mở của F1 — settings không đến guard ở module sử dụng

- **Mức độ:** P1 (thuộc F1 gốc, không tạo danh sách audit mới).
- **Vị trí tại head #97:** `apps/backend/src/auth/session-auth.guard.ts:20,41`; `apps/backend/src/auth/auth.module.ts:144` (exports); `apps/backend/src/onboarding/onboarding.module.ts:33–35` (module nhập Auth và dùng controller có guard).
- **Tình huống:** một phiên ordinary còn hợp lệ mang nhãn IOS/FOOD hoặc ANDROID/OTHER được cấp trước khi bật native gate. Guard trong AuthModule có settings nên từ chối; guard của controller ở module khác được Nest tạo trong module đó chỉ resolve các dependency đã export. CLIENT_AUTH_SETTINGS không có trong exports, injection Optional trở thành undefined và nhánh chặn bị bỏ qua. Read/write onboarding dùng guard đó và authorization participant không áp policy nhãn mới, nên phiên có thể tiếp tục sử dụng bề mặt này khi chưa bị revoke.
- **Tác động:** sửa issuance không bảo vệ đầy đủ usage của các phiên legacy đã tồn tại; policy mới phụ thuộc endpoint đang ở module nào.
- **Xác nhận tập trung:** probe Nest TestingModule dùng **SessionAuthGuard đúng nội dung head #97**, settings androidEnabled=true, provider sessions/proof giả và topology export/import tương ứng (không export settings). Kết quả: `authGuardRejects=true`, `consumerGuardAccepts=true`. Không mở listener, không DB; đây là xác nhận wiring/nhánh guard, không test HTTP hoặc thiết bị.
- **Hướng sửa:** export CLIENT_AUTH_SETTINGS cho các module dựng guard (hoặc cung cấp một dependency policy đã export và dùng nhất quán). Kiểm toàn bộ module dùng SessionAuthGuard; giữ compatibility WEB local theo contract, không hạ yêu cầu proof.
- **Regression cần thêm:** tạo/cấp phiên với nhãn thay thế trước gate rồi kiểm endpoint Auth và ít nhất GET shop/profile + mutation onboarding sau khi gate bật, dùng module thật để bắt thiếu export. Guard direct-constructor test và test chỉ login mới hiện có chưa bao phủ lỗi này.

### Giao Claude sau lượt delta này

```text
Claude: trên nhánh sửa PR #97, sửa tiếp phần còn mở F1 — CLIENT_AUTH_SETTINGS chưa export tới SessionAuthGuard ở module sử dụng — theo docs/evidence/M01-final-review-20261013.md, mục Review delta 14/10/2026.
Thêm regression qua module thật cho phiên nhãn thay thế đã tồn tại; không lặp sửa/audit F2–F6 đã xử lý.
Bổ sung focused integration race F5 giữa guard và service nếu có harness hiện hành: revoke/reset hoặc thay binding commit trước query, không trả profile; giữ roleless draft read hợp lệ.
Giữ test không xác minh SĐT/không OTP giả, TOTP ADMIN/SYSTEM và production guards.
Kế thừa CI xanh đúng SHA, chỉ kiểm phần ảnh hưởng; không full local suite/poll CI, không NOTE thiết bị/VPS/DB Owner.
Trả fix SHA và diff/test/CI; không merge/deploy/đóng M01. Codex chỉ review delta tiếp theo.
```

Các NOTE PC/Android phía trên tiếp tục **CHƯA KIỂM — ĐỂ SAU**. Việc ký/upload xanh không thay thế nghiệm thu cài đè, key/token, GPS, hai thứ tự cài, thay điện thoại, nền/offline/khởi động lại.

