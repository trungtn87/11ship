# M01 — APK WebView dùng giao diện VPS
Ngày 13/10/2026, Asia/Saigon. Owner yêu cầu triển khai hai app test theo hướng cài APK một lần, sau đó cập nhật giao diện/nghiệp vụ trên VPS. ChatGPT thiết kế/handoff; Claude code, build và kiểm tra. Đây là phương án TEST mới, không phải chứng nhận native production.

## Quyết định
- Hai APK 11Food/11Ship là vỏ Flutter WebView mỏng; tải đúng app web live trên HTTPS VPS. Không đóng gói màn nghiệp vụ trong APK và không tải remote Dart/native code.
- Dùng lại UI/controllers/backend trên main; đăng ký chung, CUSTOMER mặc định, SHOP/DRIVER chỉ qua onboarding. Không tạo role/hồ sơ giả hoặc làm thêm tính năng chưa nối.
- Trang chủ public khi mở app; đăng nhập chủ động từ Tài khoản. Nâng cấp web/API trên VPS sẽ hiện ở APK đã cài. Assets có version/hash và chính sách cache để không mắc ở bản cũ; không tự reload làm mất form đang nhập.
- Phạm vi “không build lại” là thay đổi web/backend. Android permissions, cầu nối native, WebView plugin, signer hoặc package vẫn cần APK mới. Không hứa APK không bao giờ cập nhật.
- applicationIds giữ vn.eleven.food.test và vn.eleven.ship.test. Dùng khóa ký bền vững hiện có; thiếu secrets thì dừng phân phối. versionCode tăng. Kiểm chứng cập nhật đè bản đang cài; nếu bản trước mất khóa ký, báo trở ngại thật trước khi phân phối, không âm thầm đổi signer.

## Triển khai theo thứ tự
1. Đồng bộ phần deploy có sẵn PR #70/#71 với main, giải quyết conflict; dùng lại builder/verifier Ubuntu và lệnh operator, không viết lại bộ deploy. Artifact cần chứa backend + Admin + Food/Ship web live và migrations phù hợp. Không gộp PR nghiệp vụ đang dở để lấy chức năng chưa sẵn sàng.
2. Host Food/Ship trên URL HTTPS ổn định của VPS hiện có 103.9.78.67.sslip.io. Ưu tiên /food/ và /ship/ nếu base path/router/assets/API hoạt động đúng; sửa build base path tối thiểu, tránh redirect sang Admin hoặc nhầm app. Admin và API hiện có giữ chạy.
3. Mở luồng tài khoản web trên cấu hình TEST VPS được ghi rõ. Code hiện chỉ nhận platform WEB trong development/test + loopback; staging hiện đóng consent test/DISABLED_TEST. Không chỉ nhúng WebView rồi tuyên bố login chạy. Dùng instance test riêng, listener loopback qua nginx, database/credentials test được xác định rõ; không đổi instance staging/production thành development để lách policy và không reset dữ liệu đang dùng. Ghi thay đổi cấu hình cần Owner áp trên VPS. Giữ TOTP Admin/SYSTEM; không giả xác minh điện thoại.
4. APK WebView khai báo platform WEB, app FOOD/SHIP tương ứng; không giả ANDROID để bỏ qua verifier. Đây là test web trên điện thoại, chưa chứng minh native binding/one-device trong contract11 §7–9. Không bỏ/chứng nhận hoàn tất native protocol. Cập nhật contract11 §6 và mobile/README.md để phân biệt phương án test này, không sửa tài liệu lịch sử thành bằng chứng nghiệm thu.
5. Dùng wrapper dùng chung: HTTPS và kiểm tra chứng chỉ bình thường; allowlist origin/path app, link ngoài mở trình duyệt; trang lỗi mạng có Thử lại; nút Back theo lịch sử web rồi hành vi đóng app rõ ràng. Chỉ cấp geolocation khi màn yêu cầu và Android cho phép, không bridge JS tùy ý. Không lưu token/password ở URL/log hoặc native storage mới; dùng chính session web hiện có.
6. Build hai APK ký bền vững và artifact VPS. Trả link tải, source SHA, checksum, URL app, lệnh upload/install/migrate/restart/health và rollback phù hợp dữ liệu. Owner đã yêu cầu cập nhật VPS, nhưng Claude không tự truy cập server khi không có khả năng/kết nối; trả lệnh chính xác cho phiên SSH Owner.

## File/contract đọc đúng phạm vi
- AGENTS.md và docs/process/11ship-delivery-workflow.md; quy trình Owner “nhanh, đủ, đúng”.
- mobile/README.md; mobile/food, mobile/ship, mobile/packages/n11_shared; .github/workflows/mobile-apk.yml.
- apps/client-shared/src/auth, apps/food-web, apps/ship-web; scripts/client-web-build.mjs, scripts/client-web-dev.mjs.
- apps/backend/src/config/client-auth-config.ts và client-auth-policy.ts; contract11 §1–6, chỉ đọc §7–9 để giữ ranh giới native.
- PR #70/#71: scripts/deploy/build-ubuntu-artifact.mjs, verify-ubuntu-artifact.mjs; ops/runbooks/ubuntu-vinahost-staging.md và selfhosted-postgres-staging.md; ops/vinahost.
- VPS đã có service 11ship-staging, WorkingDirectory=/opt/11ship/current; cấu hình theo lần triển khai trước /etc/11ship/staging.env. Xác minh file env thực tế từ unit trước đưa lệnh ghi. /root/ship11-incoming đang có artifact cũ 75a0a2938dc89418970dc4e1bbf16f8094a1c586.

## Kiểm tra và đầu ra
- Kiểm tra APK mở đúng home/app và API trên test VPS; đăng ký không OTP theo test mode → đăng nhập → sửa tên → logout cho Food/Ship dùng chung harness. Màn chưa nối vẫn hiện lý do thật.
- Kiểm tra cache: deploy web có một thay đổi nhìn thấy, mở lại app đã cài thấy bản mới mà không cài APK. Kiểm tra build/install update-in-place và dữ liệu còn; trình duyệt không thay thế Android runtime. GPS thật chỉ kiểm khi tính năng được nối.
- Focused build/checks phần thay đổi, tái dùng CI; không lặp full suite hoặc thêm audit toàn M01. Không chờ ví/đơn/GPS vận hành module sau.
- Một Draft PR code + báo cáo ngắn: SHA, checks, gói tải, lệnh deploy và giới hạn thực tế. Không claim đã deploy/đã test thiết bị khi chưa làm. Không tự đóng M01.
