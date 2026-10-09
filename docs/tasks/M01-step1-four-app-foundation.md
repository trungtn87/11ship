# M01 — Bước 1: nền web quản trị và 3 app Android

Owner yêu cầu ngày 09/10/2026: triển khai đồng bộ, kiểm tra từng app và liên thông, bao phủ toàn bộ M01 theo các bước đã thống nhất. Bước này chỉ dựng khung và kiểm tra kết nối; không tuyên bố M01 hoàn thành.

## Phạm vi

| Ứng dụng | Nguồn | Package test |
|---|---|---|
| Web quản trị | apps/foundation/web | web |
| Khách | Android flavor customer | vn.eleven.foundation.customer |
| Quán | Android flavor shop | vn.eleven.foundation.shop |
| Xế | Android flavor driver | vn.eleven.foundation.driver |

Ba package cài đồng thời. Quán và Xế cùng thương hiệu 11Ship, nhưng tách package test theo chỉ đạo Owner; không tự thay đổi mô hình tài khoản, role hoặc phân phối production. Flavor chỉ là nhận diện, không cấp quyền. Không tạo tài khoản/phiên/backend giả ở bước 1.

## Nguồn và quyết định

- Main đầu vào: df37b2e89baafa343bf429a8c128b329b69b3e3d; README, health controller, brand guideline v1.0.
- Đối chiếu PR #24 (FE0) và PR #29 (web UI); giữ nguyên hai PR để review riêng. Khung này cô lập dưới apps/foundation, không nhân bản màn Auth/onboarding. Khi tích hợp bước 2 phải hợp nhất vào frontend được review, không để hai transport Auth cạnh tranh.
- Dùng HTML/CSS/JS cho shell web theo quyết định HTML tạm; native Java Activity tối giản cho Android, không dependency UI mới. AGP 8.7.3, Gradle 8.9, JDK17, compile/target35, min26. Bộ phiên bản phục vụ bản test, không phải lựa chọn kiến trúc production đã khóa.
- Token CSS kế thừa PR #29 (363a526b68c6db4488c3a8b19108271c47be9aa4), màu từ brand LOCKED. Android dùng cùng màu; chưa có resource token/component system hoàn chỉnh.
- Logo chính thức SVG/PNG và font self-host chưa có trong repo main. Dùng text identity tạm theo FE0, không vẽ logo giả. Các ảnh Owner đính kèm đã được xem, không dùng slogan cũ trong ảnh 1000002790.jpg. Font thực tế đang fallback; không đánh dấu nhận diện đầy đủ đạt.

## Kết nối

Web config.js chứa apiOrigin public HTTPS, Android dùng Gradle -PapiOrigin=https://API_HOST. Không URL database, token hoặc password trong bundle. Thiếu origin: báo chưa cấu hình và không request. Health gọi GET /v1/health/live và GET /v1/health/ready, bắt buộc envelope/status chính xác; live thành công không đủ xác nhận DB.

Web cần CORS allowlist chính xác trên backend khi tách origin. Bước này không sửa CORS/backend và không deploy Sites vì cần dùng staging chung đã thiết kế. Android dùng HTTPS/TLS mặc định, cấm cleartext, không redirect và không gửi bearer ở health.

## Build và kiểm tra

- Web: node --test tests/foundation/health.test.mjs; phục vụ bằng static HTTP server. Không mở index bằng file:// để test module.
- Android: Gradle 8.9, Android SDK35, JDK17; chạy gradle assembleCustomerDebug assembleShopDebug assembleDriverDebug lint trong apps/foundation/android. Thêm -PapiOrigin chỉ sau xác nhận địa chỉ API thật.
- Workflow .github/workflows/m01-foundation.yml build/upload web và cả 3 APK trên PR; workflow_dispatch nhận HTTPS origin. Artifact debug chỉ dùng test, signing key runner là tạm: build khác có thể phải gỡ bản cũ trước cài. Chưa phải signing/update contract production.
- Checklist thiết bị: cài đồng thời 3 APK, tên đúng; mở từng app, chữ/touch/insets; xoay màn hình/quay lại; có mạng/mất mạng; gọi live/ready trên cùng API; không crash; không xin GPS/danh bạ/quyền không dùng.

## Gate riêng từng app

| Kiểm tra | Web admin | Khách | Quán | Xế |
|---|---|---|---|---|
| Source shell | Có | Có | Có | Có |
| Font/logo chuẩn | Thiếu | Thiếu | Thiếu | Thiếu |
| Build CI đúng head | Chờ CI | Chờ CI | Chờ CI | Chờ CI |
| Kết nối API/DB thật | Chưa đạt | Chưa đạt | Chưa đạt | Chưa đạt |
| Browser/thiết bị | Chưa test | Chưa test | Chưa test | Chưa test |
| Owner nghiệm thu | Chưa | Chưa | Chưa | Chưa |

## Hiện trạng môi trường đã kiểm tra

Render Monitor: Owner chọn Trung's workspace (tea-cvu8f4be5dus73ch67sg), list_services ngày 09/10/2026 không có dịch vụ repo trungtn87/11ship. Không kết luận môi trường local không tồn tại; chỉ chưa có endpoint Render trong workspace đã kiểm tra. Runbook main vẫn ghi prepared/not executed; PR #27 staging fixture chưa merge. Không tự tạo/deploy backend hoặc đổi APP_ENV=development để vượt gate.

Máy thực hiện có JDK17, Node; không có Android SDK/Gradle. Vì vậy chỉ xác minh test logic web và syntax cục bộ; Android phải được CI build/lint và test điện thoại mới đạt.

Chưa đủ điều kiện khóa bước 1: cần endpoint test thật, hosting/CORS, assets chuẩn, CI xanh và Owner test riêng 4 ứng dụng. Bước 2 chỉ bắt đầu sau nghiệm thu bước 1.
