# Bước 5.1 — Kiểm tra repository và chuẩn bị nền
Ngày 06/10/2026 (Việt Nam). Trạng thái: PREFLIGHT_COMPLETE; FOUNDATION_NOT_IMPLEMENTED.

## Bằng chứng
- Repo chính thức: https://github.com/trungtn87/11ship
- Repo private, không archived; kết nối hiện tại có quyền pull/push.
- Nhánh duy nhất lúc kiểm tra: main; protected=false.
- Base commit: 8ebc07e9ed40fca0c4ce6095668d9f67836c13f1.
- Tree gốc chỉ có README.md (28 byte). Không có AGENTS.md, source, manifest, migration, CI hoặc test trong cây hiện hành.
- Chưa kiểm tra toàn bộ lịch sử bằng secret scanner. Không suy ra đã kiểm tra bảo mật từ việc repo gần trống.

## Cách đánh số
Bước 4.1–4.3 là tài liệu thiết kế có sẵn. Bước 5 bắt đầu chuẩn bị và triển khai thực tế; không có nghĩa Auth Core đã PASS. Mã module M00/M01 giữ nguyên.
Trình tự: 5.1 preflight → 5.2 khóa quyết định nền và dựng M00-B → 5.3 M00-C → 5.4 M01-A1 → review/test → M01-A2.

## Nền đã có và còn thiếu
| Hạng mục | Hiện trạng | Xử lý tiếp |
|---|---|---|
| Repository | Đã truy cập thật | Dùng repo này, không dùng repo OC11/PetServe |
| Modular backend NestJS + PostgreSQL | Mới là thiết kế 4.1 | Dựng ở M00-B |
| ORM/query, migration runner | Chưa chọn | Ghi ADR, kiểm tính tương thích và transaction context |
| Runtime/package versions | Chưa chọn | Kiểm tài liệu chính thức, pin phiên bản và lockfile |
| Token/session và password hash | Chưa chọn | ADR trước M01-A1; kiểm revoke mỗi request |
| Test runner/DB test/CI | Chưa có | M00-B |
| Idempotency/audit/outbox | Chưa có | M00-C trước Auth Core |
| Auth code/build/test | Chưa có | Không đánh PASS hoặc CODE_READY |

## Quy trình Git áp dụng
- main chứa phiên bản đã nghiệm thu; feature branch theo task, một PR cho một gói.
- Commit dạng docs(scope): ..., feat(scope): ..., fix(scope): ... hoặc test(scope): ...
- Ghi base commit, changed files, migration và test evidence cho mỗi bàn giao.
- Chỉ merge sau review PASS và kiểm tra thực chạy tương ứng. PASS_WITH_FIXES vẫn phải sửa và kiểm lại trước merge.
- Không force push main. Migration đã apply không sửa tại chỗ.
- Quy ước này chưa đồng nghĩa branch protection đã được cấu hình.

## Điểm cần chuẩn hóa trước Auth
1. Error envelope: 4.1 yêu cầu request_id, ví dụ 4.2/4.3 thiếu. Dùng error.code/message/details và thêm error.request_id. Chi tiết chỉ chứa trường cho phép.
2. Giữ mã HTTP cụ thể trong 4.2/4.3 cho Auth; 400 không bị đổi đồng loạt thành 422 theo mô tả chung 4.1.
3. Unknown/forbidden fields phải bị từ chối; không dùng lựa chọn ignored trong mô tả cũ.
4. Ví dụ app=11SHIP không tự thay kiến trúc 4 app; role không thay thế kiểm tra membership/profile ở module nghiệp vụ.
5. Replay register có access_token là dữ liệu nhạy cảm. Phải thiết kế cách replay có TTL, bảo vệ dữ liệu trả lại, bind đúng request; không lưu plaintext credential trong idempotency record hoặc log.
6. Mutation idempotency ngoài register phải có ma trận endpoint cụ thể trước code Auth; không để ví dụ thiếu header được hiểu là miễn kiểm soát.
7. A1 không được giả rằng có hồ sơ Shop/Driver. Adapter kiểm business profile chỉ đưa vào khi module sở hữu tồn tại.

## Tiến độ
- [x] Xác định repo và base commit thật.
- [x] Kiểm cây source hiện hành và nhánh.
- [x] Đưa bản gốc 4.1–4.3 vào docs/current (không tự đổi trạng thái trong bản nguồn).
- [x] Soạn task nền nhỏ tiếp theo.
- [ ] Khóa ADR và phiên bản nền.
- [ ] Dựng backend/PostgreSQL/migration/test.
- [ ] Thực thi test nền và CI.
- [ ] Auth Core 19 case PASS.
