# M01-ANDROID — tài khoản/phiên trên Food và Ship
Ngày: 13/10/2026. ChatGPT contract/giao việc; Claude implementation.
Nhánh feat/m01-android-account-session từ main. Không phụ thuộc CLI SYSTEM recovery #94, không chờ #94 để bắt đầu.

## 1. Kết quả, đã có và còn thiếu
Kết quả của cùng luồng: hai APK thật đăng ký không OTP theo config test -> đăng nhập -> đọc/sửa họ tên -> đăng xuất/hết phiên, bằng phiên ANDROID có proof, hai app cùng binding trên một điện thoại. Không đổi nghiệp vụ theo app.
Kế thừa #82 (register test), #83 (account/profile/session), #93 head 5272ceb / merge 91a0848 (reset USER/ADMIN), schema sessions và cơ chế transaction/replay hiện có.
Flutter main hiện có brand/theme/component/shell/health và hai applicationId. Chưa có native auth client/controller/màn auth; features.dart còn reason backend cũ.
Backend client-auth-policy.ts hiện trả 503 cho ANDROID; chưa có client_device_* storage/verifier/bridge. Không chỉ mở gate hoặc truyền device_id để đăng nhập.
mobile-apk.yml hiện fallback ephemeral; phải bỏ ngay trong luồng này. Signing/config/runtime/binding dùng chung làm một lần.
Đây là auth/phiên native, không phải toàn M01-ANDROID. Onboarding quán/xế, reset UI native nối ở luồng sau; giữ nút chưa nối có lý do đúng. Không kéo GPS vận hành/ví/đơn/Admin native/module khác.

## 2. Đọc một lần, sau đó đúng mục
AGENTS.md, CLAUDE.md, docs/process/11ship-delivery-workflow.md và handoff này khi bắt đầu. Không kiểm kê toàn M01.
- docs/current/M01-workstreams-20261012.md: M01-ANDROID, §5.
- docs/design/system-v2-20261011/11-m01-session-device-contract.md §1–9: identity/replay/native protocol/storage; §10 chỉ ca native ảnh hưởng luồng này.
- docs/design/system-v2-20261011/10-m01-client-contract.md §2–5 khi cần shape register/profile/consent.
- docs/ui/m01-food-web.md F01/F04/F07/F10/F11; docs/ui/m01-ship-web.md S01/S05/S10/S11: bố cục auth/account, không đọc catalog khác.
- mobile/README.md update-in-place; mobile/packages/n11_shared/lib/src/{shell,config,features,tokens,widgets/components}.dart; mobile/{food,ship}/lib/{main,*_tabs}.dart.
- .github/workflows/mobile-apk.yml; mobile/tool/prepare-android.sh; mobile/tool/android-templates/AndroidManifest.xml.
- apps/backend/src/client-auth/{client-auth-policy,client-auth-validation,client-registration-service,client-login-service,client-session-authority,client-session-service,client-auth-result,client-auth.controller}.ts: bổ sung proof/participant, giữ code nghiệp vụ.
- apps/backend/src/auth/{session-auth.guard,session-service,session-authorization-participant,session-repository,user-repository}.ts; app.setup.ts raw request bytes; customer-profile/ đúng controller/parser.
- apps/client-shared/src/auth/{contract,client,session}.ts và screens/auth.ts làm tham chiếu hành vi, không import TypeScript sang Flutter hoặc dựng backend thứ hai.

## 3. Contract bản test và rollout
Quyết định no-OTP chỉ bỏ xác minh SĐT, KHÔNG bỏ proof thiết bị/TOTP/TLS.
- Reuse CLIENT_AUTH_PHONE_VERIFICATION_MODE=DISABLED_TEST với APP_ENV development|test + backend HOST loopback. Register native ghi TEST_UNVERIFIED/phone_verified_at NULL; server config quyết định, không client bypass. REQUIRED không được tự bỏ OTP; ở gói test này chưa nối OTP thật thì báo chưa hỗ trợ bước xác minh, không fake code/proof.
- Native enable mới CLIENT_AUTH_ANDROID_ENABLED=true|false (default false); true chỉ development/test + HOST loopback trong gói này. Staging/production/bind remote + true -> startup refuse. Gate off luôn fail closed như hiện hữu. Không sửa rule LOCAL_WEB.
- Trust config server, không đến từ request: CLIENT_DEVICE_ENVIRONMENT (nonsecret identifier, cùng build); CLIENT_DEVICE_ALLOWED_SIGNERS_FILE (JSON exact {FOOD:{package_name,signer_sha256},SHIP:{package_name,signer_sha256}}, package test cố định); CLIENT_DEVICE_ATTESTATION_ROOTS_FILE (PEM roots Android attestation được operator pin); CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE (snapshot từ nguồn Android chính thức, kèm fetched_at).
- Khi enable mà config thiếu/sai -> startup refuse, chỉ nêu tên biến; snapshot revocation quá 24h/unavailable -> 503 lúc verify. Validate certificate chain/root/revocation/challenge/TEE hoặc STRONGBOX/verified boot locked/app+signer theo contract §7. Không dùng OS trust roots chung, client tự đưa trusted root, accept-all verifier hoặc software fallback.
- Fixture root/chain được inject trong test DI, không được chọn bằng HTTP/env của bản phân phối và không chứng nhận attestation điện thoại thật.
- Operator cung cấp trust files, workflow xuất public certificate fingerprint của persistent APK signer để cấu hình allowlist (không in secret/keystore). Không hardcode signer chưa biết, không lấy signer gửi từ client làm allowlist.
- Android user/profile khác là binding khác. Unsupported hardware hiển thị DEVICE_PROOF_UNSUPPORTED, không mở compatibility tier khi chưa có quyết định Owner.
- Chưa enable production/VPS, chưa cấu hình DB Owner. Test/native server chỉ local/CI. Email SYSTEM #94 độc lập.

## 4. Backend và bridge dùng chung
Bám nguyên native endpoint/proof message/TTL/rate/status trong contract §7–8; không sáng tác wire contract mới:
POST /v1/client-auth/device/challenges và /registrations; ANDROID register/login có registration proof, me/profile/context/logout có request proof. Raw bytes/exact URL được giữ trước parse, không ký JSON đã serialize lại ở server.
Migration append-only cho 7 bảng §9; nối app.sessions hiện có qua client_session_bindings, không tạo session/account store thứ hai. Mapping constraints/index phải được ghi trong PR; runtime grants cập nhật theo bảng mới nếu có matrix hiện hữu.
Lưu ý lifecycle §9: key_links cần quyền UPDATE tối thiểu để set detached_at theo §8; bổ sung rõ quyền này, không cho UPDATE quyền/owner/key tùy ý. Cleanup credential riêng chỉ delete expired challenges/grants/nonces.
- Giữ lock order idempotency -> user root -> binding/head -> session locks -> eligibility. Một current binding/user và max một current session/app trong binding. Same app relogin chỉ revoke phiên app đó; JOIN app kia giữ; new binding revoke mọi ordinary sessions, không admin_sessions.
- Proof không chỉ guard lần đầu: recheck binding/head trong transaction mutation/replay. Mọi ordinary session issuance/legacy routes đều enforce hoặc từ chối native issuance để không bypass.
- Reuse replay encrypted token; replay trả token gốc + CURRENT identity, fresh request nonce/proof, không dùng idempotency key làm authentication. Reset/logout/expiry/replacement không hồi sinh cached token.
- Auth nonce consume transaction riêng như §8, sống qua business rollback. Không external trust fetch/hash dưới DB lock.
- Native Kotlin bridge dùng Android Keystore P-256 nonexportable + attestation challenge; Flutter chỉ nhận public metadata/signature, không private key. Overlay/template source được commit, prepare-android.sh tái dựng được; không code chỉ nằm trong generated android/.
- Signature-permission Binder service explicit component, kiểm caller UID -> package + signer trước clearCallingIdentity; chỉ ký JOIN challenge có ngữ nghĩa đúng môi trường/key/app/binding. Không generic signing IPC, không share token/password, không sharedUserId.
- Hai app discovery/join theo §7; không pair bằng ANDROID_ID/device_id. device_id field chỉ legacy wire metadata, không quyền binding.

## 5. Flutter UI và session
Shared Dart typed contract/transport/session/controller trong n11_shared; views dùng lại shell/component/brand. Thêm màn auth/profile theo bố cục web đã duyệt, không dựng lại shell.
- Guest mở Trang chủ, chủ động đăng nhập ở Tài khoản. Đăng ký cả Food/Ship luôn CUSTOMER; không tự tạo shop/driver hay auto cấp quyền nhận đơn.
- Config registration chưa hợp lệ -> disable submit. DISABLED_TEST hiện ghi chú bản test và đăng ký trực tiếp, không OTP screen.
- Login wrong password hiện lỗi credentials, không biến thành hết phiên. Identity/capability/context từ server, không role trong storage/client tự grant.
- Họ tên customer profile GET/PUT dùng version/idempotency như web; VERSION_CONFLICT cho tải bản mới, không ghi đè. Mất phản hồi giữ cùng key/body, retry chỉ do user bấm, ký request nonce mới.
- Token lưu riêng từng app được mã hóa bằng Android Keystore; không plaintext preferences/log/backup hay share qua Binder. Không lưu password. Persist key/token qua APK update; cold start validate me trước hiện dữ liệu nhạy cảm; 401 xóa token/PII, giữ private key để login lại.
- Logout clear local sensitive state; server 204 xác nhận revoke, offline nói rõ chưa xác nhận. Rời màn bỏ response muộn, không cài lại phiên đã logout bằng stale request.
- 403 proof errors không cấp quyền; 503 dependency báo thử lại, không downgrade WEB.
- Nhận đơn/ví/onboarding quán/xế/reset native chưa nối vẫn khóa đúng reason “chưa nối trên Android”, không còn nói backend chưa tồn tại.

## 6. HTTPS local và APK
API_BASE_URL bắt buộc HTTPS origin; không badCertificateCallback/trust-all/cleartext token. Không deploy proxy/API lên VPS trong gói này.
Dùng TLS/local frontend có sẵn nếu giữ nguyên raw body/proof headers/URL được; hiện proxy dev chưa forward native proof nên không giả định dùng được. Nếu cần bổ sung gateway local tối thiểu: allowlist đúng native device/client-auth/customer-profile route+method; chỉ forward headers proof/Authorization/Idempotency-Key cần thiết; không mở wildcard backend, không đổi web proxy semantics. Ghi cách Owner trỏ điện thoại vào PC qua HTTPS/certificate trust của bản test; không tự tắt TLS. Certificate/user CA policy chỉ trong test package, không production.
Không tự bật auth trên API VPS health mặc định: chưa deploy native verifier thì UI báo chưa sẵn sàng. Bản test có thể build bằng API_BASE_URL local cấu hình operator; không quảng cáo đã chạy trên điện thoại từ mock/CI.
- applicationId giữ vn.eleven.food.test / vn.eleven.ship.test, cùng persistent signer để Binder join. Không đổi package khi tăng version.
- Thiếu bất kỳ 4 ANDROID_TEST_KEYSTORE_* secrets -> fail rõ trước sign/upload; bỏ hoàn toàn ephemeral signing và key generation fallback. Analyze/test có thể chạy không secret, chỉ distribution dừng.
- Giữ sequence github.run_number hiện hữu làm versionCode; không reset workflow/sequence. Rerun cùng build không phải bản phân phối mới. Xác nhận APK versionCode/applicationId/signing fingerprint trước upload; nguồn build checkout phải khớp SOURCE_SHA.
- Không đưa keystore/password vào repo/log/artifact. Lưu token/key qua update, không yêu cầu uninstall, không force clear data. Không đổi logo/brand/permission GPS chưa dùng.

## 7. Kiểm tra cần thiết, không mở audit mới
Làm lần lượt backend participant/protocol -> native bridge/shared client -> auth/profile UI -> sign/build. Giữ một nhánh/PR; cập nhật ngắn ở mốc có kết quả, không báo mỗi lệnh đọc file.
- Backend focused integration DB thật: hai app cùng binding, login lại một app không revoke app kia, new binding revoke cả hai, old token thiếu key denied, raw request tamper/nonce replay denied; reset #93 làm native token/replay cũ hỏng; unknown response retry không duplicate session. Reuse fixture/helpers, không chạy full local trước CI.
- Focused verifier/parser ca valid/bad/expired signer/root/challenge và gate fail closed; tests dùng fixture attestation phải ghi rõ.
- Flutter controller/widget: config gate, register->account, login/profile/version-conflict/logout/401; bridge signer và JOIN restricted. Analyze/build đúng phần cần thiết một lần.
- CI bắt buộc hiện hữu + Mobile APK build cho cả app. Nếu không có persistent signer, hoàn tất code/checks khác, báo tên secret còn thiếu; không regenerate/fallback, không chờ poll vô hạn.
- Actual Owner: hai APK cập nhật đè giữ dữ liệu/key/token, hai app cùng điện thoại; hai điện thoại replacement. Claude không đánh PASS khi chưa chạy hardware. Unsupported emulator không phải lý do bypass hardware attestation.
- Không review tìm lỗi sâu từng gói, không thêm full matrix báo cáo lặp; review toàn M01 ở M01-FINAL sau các luồng đã nối.
- Cập nhật mobile/README.md và runbook native local với env/trust input, SHA, artifact, ca chưa chạy. PR tóm tắt gọn, CI link; không sửa PROGRESS/manifest sinh tự động.
- Commit/push đúng nhánh, Draft PR. Không merge/deploy/đụng VPS, không tự mở luồng onboarding/reset hoặc module khác.
