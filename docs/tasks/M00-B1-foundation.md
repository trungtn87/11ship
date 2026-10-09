# M00-B1 — Gói dựng nền backend

Phiên bản 1.1, ngày 06/10/2026. Trạng thái: CODE_READY cho phạm vi M00-B1; CODING chưa bắt đầu.
CODE_READY ở đây nghĩa task đã đủ đầu vào để giao người code; không có nghĩa FOUNDATION_READY hoặc Auth đã sẵn sàng.

## Nguồn và base

Repo: https://github.com/trungtn87/11ship. Nhánh thiết kế: docs/step-5-foundation.
Base đã kiểm tra: 5ed8c70439cd7f2773d1c14f4d8f860fcb35fbc6. Khi bắt đầu, lấy commit mới nhất chứa task v1.1 và hai ADR, ghi SHA thật vào báo cáo preflight. Không bắt đầu từ main chỉ có README và không bỏ qua ADR.

Đọc ADR-001, tài liệu 4.1 và task này; ADR-002 chỉ để hiểu interface Auth về sau. Không cần nạp toàn bộ đặc tả Shop/Wallet/Delivery vào context của gói này.

## Kết quả phải tạo

1. npm workspace apps/backend, package.json/lockfile thật; khóa dependency theo ADR-001.
2. NestJS bootstrap/AppModule; configuration, database, health modules; global /v1 prefix.
3. .env.example chỉ placeholder, .node-version; compose.dev.yml và CI database service riêng.
4. SQL migration runner bằng node-pg-migrate; thư mục database/migrations và fixture test. Không cần DDL nghiệp vụ ở gói này.
5. Health contract bên dưới và error filter tối thiểu; log chỉ metadata đã whitelist.
6. Test PostgreSQL thật, lệnh setup/build/test, CI và báo cáo test evidence.
7. README chạy local; hướng dẫn Windows dùng Docker Desktop cho DB và npm trên máy phát triển. Chưa tạo bản app cho Owner test.

## File scope

Được tạo/sửa: apps/backend/**, database/migrations/**, database/fixtures/**, tests/integration/**, scripts/**, ops/runbooks/**, .github/workflows/**, root package.json/package-lock.json/tsconfig*/eslint*/jest*, .env.example, .node-version, .gitignore, compose.dev.yml, README.md, docs/evidence/M00-B1.md.
ADR/source baseline giữ nguyên; nếu phát hiện mâu thuẫn, báo delta cụ thể. Các thư mục app khác chưa cần tạo placeholder.

## Config và hành vi

- APP_ENV bắt buộc enum development/test/staging/production; DATABASE_URL bắt buộc; PORT nguyên 1..65535, default 3000; HOST default 127.0.0.1 ở local, CI có thể cấu hình.
- NODE_ENV cho runtime dùng chuẩn development/test/production; không dùng NODE_ENV=staging.
- Pool có connection acquisition timeout và query timeout để readiness không treo. Đề xuất connect 1s, query 1s, pool max 10; đều cấu hình có giới hạn hợp lệ.
- Thiếu/sai config phải exit nonzero và chỉ nêu tên biến, không in giá trị secret.
- DB ngắt tạm thời không làm liveness thất bại; readiness báo 503. Pool tạo lazy, server có thể mở HTTP khi DB đang mất.
- Xử lý pool error event an toàn, graceful shutdown đóng HTTP và pool; không để open handles trong tests.
- Startup không migrate tự động. Cấu hình môi trường production không được fallback sang DB local, test hoặc OTP fake.
- UUID request_id do server tạo, phản hồi X-Request-ID và error.request_id; không phản chiếu chuỗi tùy ý của client vào log.

## HTTP contract của M00-B1

| Method/path | Response | Side effect / quyền |
|---|---|---|
| GET /v1/health/live | 200 {"data":{"status":"ok"}} | Public, không DB query |
| GET /v1/health/ready | 200 {"data":{"status":"ready"}} | Public, SELECT 1 và kiểm kết quả |
| GET /v1/health/ready khi DB lỗi | 503 error code SERVICE_UNAVAILABLE | Không trả host/user/DSN/SQL stack |

Envelope lỗi: {"error":{"code":"SERVICE_UNAVAILABLE","message":"Service unavailable","request_id":"<uuid>","details":{}}}. Unknown route trả 404 NOT_FOUND cùng envelope. Lỗi ngoài dự kiến trả 500 INTERNAL_ERROR với message chung. Không có mutation endpoint nên không có idempotency header hoặc expected_version tại bước này. Không phát business event.

## DB và migration

- DEV và TEST dùng credentials/database tách riêng. Service CI dùng user chỉ có quyền trên DB test.
- db:migrate chạy up đến mới nhất; lần chạy lại không áp trùng. Dùng lock của công cụ; không disable migration lock.
- Smoke migration tạo schema nền rỗng có tên rõ nếu cần; không tạo bảng user hoặc dữ liệu nghiệp vụ giả. Migration có đường down chỉ dùng DB thử nghiệm.
- M00-B1 chỉ cung cấp hướng dẫn restore cho tương lai, không nhận đã test restore production.
- Test commit/rollback dùng PoolClient giữ xuyên suốt transaction. Không thử tính nguyên tử qua các pool.query ngẫu nhiên.
- Chọn không tạo lệnh reset phá dữ liệu ở M00-B1. Tests chạy trên DB CI mới hoặc schema tạm do test sở hữu; cleanup chỉ xóa đúng schema test tên ngẫu nhiên vừa tạo. DEV data không bị đụng.
- Script/test integration bắt buộc APP_ENV=test, DB name=ship11_test và user=ship11_test; so sánh DB/user thực qua truy vấn trước DDL. Không chỉ tin suffix trong URL. Sai target phải fail trước mọi DDL. Không có cờ override production.

## Lệnh phải có từ root

- npm ci (sau lần npm install tạo lockfile đầu tiên)
- npm run lint
- npm run typecheck
- npm run build
- npm run db:migrate
- npm run test:unit
- npm run test:integration
- npm run dev

Test compiler output .test-dist phải được ignore và xóa trước build test. Không dùng passWithNoTests, skip integration khi thiếu DB, hoặc test.todo để làm CI xanh. Unit test dùng cho config validation/error sanitization; integration thật cho DB/HTTP/lifecycle.

## Acceptance — input và expected

| ID | Input / thao tác | Expected |
|---|---|---|
| F01 | npm ci trên checkout sạch, chạy lint/typecheck/build | Exit 0; lockfile không đổi |
| F02a | App hợp lệ + PostgreSQL chạy; GET live/ready | 200 với body đúng contract |
| F02b | App trỏ DB không truy cập được; GET live/ready | live 200, ready 503 trong 3s; response/log không lộ DSN |
| F03 | DB test sạch, chạy migrate up hai lần | Không duplicate; migration history nhất quán |
| F04a | BEGIN, INSERT vào bảng tạm, COMMIT, SELECT cùng client | Row tồn tại |
| F04b | BEGIN, INSERT rồi cố tình lỗi, ROLLBACK, SELECT | Row mới không tồn tại; connection được release |
| F05 | Thiếu DATABASE_URL hoặc PORT không hợp lệ | Process exit nonzero; chỉ nêu biến bị lỗi |
| F06 | Chạy integration với APP_ENV!=test hoặc DB/user ngoài allowlist | Thất bại trước DDL; DB khác không bị sửa |
| F07 | CI ở commit bàn giao thực chạy | Có run URL/log, không chỉ file YAML |
| F08 | GET route không tồn tại; error DB có secret đánh dấu | Envelope/request_id đúng; secret không xuất hiện |
| F09 | Đóng app/pool sau test | Process thoát sạch, không cưỡng ép forceExit |

F06 thay cách reset phá dữ liệu trong v1.0 bằng chặn target và cleanup phạm vi test; không giảm yêu cầu bảo vệ DEV/production. F04 không dùng assertion chỉ mock pg.

## Definition of Done

Tất cả F01–F09 có bằng chứng thật. Mỗi dòng evidence ghi command, commit, môi trường, expected/actual, PASS/FAIL/BLOCKED. Không có Docker/DB/quyền CI thì vẫn viết được code, nhưng ghi test tương ứng BLOCKED và không tự đánh PASS. Không hỏi Owner chọn lại stack đã được ADR quyết định.

Không thuộc scope: Auth endpoints, role grant, schema nghiệp vụ, idempotency/audit/outbox implementation, mobile/web, SMS thật, tài khoản admin, cloud production hoặc dịch vụ trả phí.

Sau khi bàn giao, ChatGPT review diff và test trước merge. M00-C1 chỉ bắt đầu khi nền PASS. Auth vẫn chờ M00-C và bản contract Auth đã chuẩn hóa.

## Quy trình và phân công giai đoạn — Owner chốt 09/10/2026

Áp dụng [quy trình bắt buộc](../process/11ship-delivery-workflow.md), [AGENTS.md](../../AGENTS.md) và [mẫu module](../templates/module-delivery-checklist.md). Mục này điều chỉnh phân công/gate; giữ nguyên phạm vi kỹ thuật và evidence lịch sử ở trên.

| Giai đoạn | Thực hiện | Gate chuyển |
|---|---|---|
| Nghiệp vụ/API/dữ liệu | ChatGPT thiết kế | Owner duyệt |
| Ảnh UI chi tiết và trạng thái liên quan | ChatGPT thiết kế | Owner duyệt UI; backend-only ghi N/A có lý do |
| Gói giao task | ChatGPT | Scope/base/hợp đồng/checklist đã rõ |
| Code/build/test/CI và sửa finding | Claude | CI đúng final head + ChatGPT review đạt |
| Test local, phản hồi/sửa | Owner test; ChatGPT phân tích; Claude sửa | Owner xác nhận local đạt |
| Bản web/điện thoại test | Claude chuẩn bị | Local đạt, bản/SHA hiện tại review đạt |
| Test thiết bị thật và liên thông | Owner | Từng app liên quan đạt |
| Nghiệm thu/merge/đóng | Owner quyết định | Đủ gate và bằng chứng; không suy từ backend DONE |

Checklist gate mới (chưa kiểm chứng, không phủ nhận kết quả test kỹ thuật lịch sử):
- [ ] Xác định task con và ứng dụng liên quan; điền ma trận theo mẫu.
- [ ] Ghi link Owner duyệt nghiệp vụ/UI, hoặc N/A có lý do.
- [ ] Claude cung cấp bản local, hướng dẫn và bằng chứng đúng SHA; ChatGPT review.
- [ ] Owner test local, sửa phản hồi và xác nhận đạt.
- [ ] Owner test thiết bị thật riêng từng app và liên thông, xác nhận đạt.
- [ ] Owner quyết định phạm vi nghiệm thu, merge và đóng M00 khi đủ các task liên quan.

M00 phải tách môi trường Owner test local khỏi DB test tự động; bổ sung task local và gói giao Claude trước triển khai. Cấu hình staging hoặc CI đạt không thay nghiệm thu local/thiết bị.
