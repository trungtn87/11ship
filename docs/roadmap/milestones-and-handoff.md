# Milestone và các gate giao việc

## Thứ tự triển khai

| Mốc | Gói chính | Điều kiện qua mốc / bằng chứng |
|---|---|---|
| S0 — staging dùng được | D2/D3 → D4 → PC/4G/restart → D5 | #26 review/lock, #27 audit/retest; HTTPS/API thật/TLS/DB bền vững; remote evidence đúng deployed SHA; Owner nghiệm thu môi trường |
| S1 — M01 bản test | FE0, API vùng tối thiểu, UI Auth/onboarding → E2E → M01-UAT | Staging chưa xác minh rõ; registration khóa; quán/xế đúng contract; 2 thiết bị SHOP, mất mạng/retry/restart; Owner duyệt Auth/onboarding + B tài khoản/phiên + D quyền quản trị/2FA, blocker=0 |
| S2 — quán/xế/tiền | M02 UI/UAT, M01-D quyền/2FA, M03-A, M04, M03-B1 | Không code mới M02 trước S1; app test nạp/rút/đối soát; nghiệm thu activation/money, không guard admin giả |
| S3 — giao ngoài app | M08-A + M06 → M07 → M08-B + dashboard M12 | Tranh nhận/hold, pickup/cancel, terminal/custody/deadline, GPS/nhắc đúng quyền; M03-B2 closure sau custody guard |
| S4 — khách đặt món | M05 + M09 → M10 → M11 | Snapshot giá/recipient/giờ, quán confirm, order-delivery-history, rating/correction đúng tiền và quyền |
| S5 — ứng dụng và UI | M00 native clients/E2E → Figma → triển khai/regression → Figma-UAT | 4 app + web, Android/iOS/PC; native background có evidence riêng; UI thống nhất, không blocker usability |
| S6 — SMS thật | M01-C-SMS → C-E2E → C-UAT | Provider contract, nhà mạng/receipt/timeout/limit; phone verified thật; production deny fixture |
| S7 — release candidate | System/field E2E → security/concurrency/money → restore/failover → load → Owner release-UAT | Exact release SHA; không blocker; đo tải và recovery số liệu thật, secrets/DB production tách; rollback/incident runbook |
| S8 — production | M00-OPS-RELEASE | Owner release acceptance; migration có review và kế hoạch rollback; deploy evidence; không suy production từ CI hoặc blueprint |

Không làm S8 trong PR roadmap. M01-UAT phải có M01-E2E + M01-B-UAT + M01-D-UAT để mở M02; không chờ SMS production/khóa toàn module M01; phone/recovery ở staging không có SMS thật thì không giả Owner đã nghiệm thu gửi mã. Nghiệm thu phone/provider thật nằm S6/S7.

## Gate M01 → M02

- [ ] D2 được review và thiết kế khóa; #27 green không tự merge #26 hoặc xóa thiết kế đã tồn tại.
- [ ] D4 deployed SHA, migration history, fixture thật chưa verified, dữ liệu giữ sau API restart/redeploy; web test HTTPS từ PC và điện thoại dùng 4G, không lệ thuộc máy Owner bật/LAN.
- [ ] D5 Owner nghiệm thu môi trường; FE0/hosting/copy/retry contract đã khóa; app M01 đủ API thật.
- [ ] M01-E2E chạy; lỗi chặn được sửa và retest cùng release candidate.
- [ ] M01-UAT evidence đủ case và exact client/backend SHA, explicit Owner acceptance.
- [ ] Sau đó mở code mới M02. #21 đã merge trước gate: ghi exception lịch sử, bảo toàn code, test integration/regression; nếu có finding chặn sửa theo gói repair có scope M01/staging rõ trước code feature mới.

M02-AREA-READ chỉ cung cấp danh sách vùng active tối thiểu mà onboarding M01 cần; là exception prerequisite được ghi công khai. Không dùng nó để triển khai cả quản lý vùng/M02. Nếu Owner không duyệt exception, dùng dữ liệu vùng staging operator đã khóa và chỉnh gate UI contract, không tự nới API.

## Công việc song song và công việc phải chờ

Design/review M03/M04/route/order, tài liệu SMS/provider, chọn thiết bị và runbook backup có thể làm trong khi S0/S1 triển khai. D2/D3 độc lập sau D1; FE0 và thiết kế màn M01 chuẩn bị cùng lúc. Thiết kế không đồng nghĩa code.

API tiền chờ quyền/2FA + ledger/hold contract; delivery chờ route/location/activation/money accepted; closure chờ custody M07; tracking adapter order chờ M10; SMS integration chờ Figma-UAT. Final test/recovery/load không lấy kết quả giả làm chứng nhận production. Có thể thu thập baseline tải/backup sớm, nhưng nghiệm thu cuối theo đúng release candidate.

Local RUN/DATA/QA/UAT giữ là lane dev phụ từ PR20; không phải prerequisite app online 4G. Không tự mở DB/LAN Internet hoặc dùng fake OTP local trên staging.

## Gói giao Claude

1. DESIGN: nguồn/version, nghiệp vụ và exclusions, quyền, schema vật lý/migration, OpenAPI/error/events, state machine, lock order, replay, tests/assertions; ChatGPT review, Owner lock. Thiếu nguồn ghi BLOCKED rõ.
2. BACKEND: một task/slice, base/design exact SHA, file allowlist/ports, chỉ invariant thuộc slice; giữ Draft; không code UI/provider/deploy ngoài scope. Bàn giao CI final head, tests, evidence, diff/findings.
3. APP TEST: màn/copy và token CSS baseline; endpoint/error chính xác; API thật; hosting HTTPS/4G, retry giữ key/body, token/session generation; PC/phone usable. Chưa Figma gate.
4. TEST: case từ module checklist, positive/negative/race/fault, CI + browser + DB + remote/thiết bị thật; không cho test fixtures mang vào production.
5. OWNER: URL/version/client/backend SHA, hướng dẫn thao tác và expected, form finding/blocker/retest, evidence PR; khóa slice khi Owner chấp nhận đúng head, không tự suy từ merge.

## Recovery, server dự phòng và tải

M12-RESTORE phải chốt RPO/RTO theo khả năng hạ tầng và ngân sách; inventory DB/object storage/keys/config/migration versions; lịch backup, retention, encryption/permission; khôi phục vào target cô lập, đối chiếu ledger/holds/bank registry/assignment/outbox/custody. Giữ keys replay cần thiết nhưng không copy secrets test vào production.

Server dự phòng chưa bảo đảm dữ liệu: cần thiết kế replication hay restore từ backup, dữ liệu object/DB nhất quán, DNS/traffic cutover, fencing tránh 2 writer, secret injection, recovery worker dedupe, monitoring/alert, failback. Phải diễn tập node/DB lỗi, restore, COMMIT unknown, publish/ack lost và đối soát trước mở lại. Không dùng “có server thứ hai” để tuyên bố zero loss/HA.

M12-LOAD đo số người/xế/đơn đồng thời mục tiêu do Owner cung cấp, latency/error/DB locks/provider budget, spike và soak, benchmark Argon2, worker backlog, native OS; chọn cấu hình từ kết quả. Không cam kết số ngày hoặc tải khi chưa có dữ liệu. Độ lớn S/M/L trong bảng là số ranh giới cần review, không công sức tuyến tính hay tỷ lệ production ready.
