# 11Ship — Handoff Phase 2: Graphify Codebase Discovery

**Ngày:** 2026-11-02 · **Người lập:** Claude Lead · **Trạng thái:** DỰ THẢO, chờ Owner giao việc. Chưa triển khai.
**Căn cứ:** Master Plan v3 (Phase 2, v3.1, v3.3, v3.4, v3.5); Owner chỉ thị 2026-11-02 14:32 UTC; baseline `docs/baseline/requirements.md` v0.7 (đã merge qua PR #298).

Phase 2 **chỉ khảo sát và phân tích**. Không sửa code sản phẩm, không deploy, không phát hành APK, không tự merge. Graphify là bắt buộc; không có bước vẽ sơ đồ thủ công.

## 1. Mốc commit khảo sát

| Mục | Giá trị |
|---|---|
| SHA khảo sát (đề xuất) | `549572696efb4bbc18af3c362b7f56a5fcd335e6` (merge PR #298 trên `main`) |
| Quan hệ với mốc Phase 0/1 | So với `fb3ba2ce18ada300dbbf65749096f400780f4e31` chỉ khác 5 file trong `docs/baseline/`. Mã nguồn thực thi giống hệt, kiểm bằng `git diff --stat fb3ba2c 5495726` |
| Ý nghĩa | Graph dựng trên SHA này áp dụng cho cả baseline `fb3ba2c`; ghi cả hai SHA vào Graph Run Record |
| Nếu `main` đổi trước khi bắt đầu | Executor phải báo; Lead quyết giữ SHA này hay dựng lại. Không tự chuyển SHA giữa chừng |
| Clone | Clone sạch, không có thay đổi cục bộ, không có `graphify-out/` cũ |

Phiên bản mã nguồn VPS và APK v480 (nguồn `9ed95a2`) không khác mobile so với `fb3ba2c`; Phase 2 không đụng tới chúng.

## 2. Khả năng chạy Graphify và phạm vi index

**Công cụ (theo Master Plan v3.4):** gói `graphifyy` (đã thử 0.9.100), cài kèm `graphifyy[sql]` để đọc 82 file SQL migration. Lệnh dựng `graphify update .` chạy bằng AST, không gọi LLM. Truy vấn: `graphify explain "<node>"`, `graphify path "<A>" "<B>"`.

**Kiểm tra bắt buộc trước khi dựng (Bước 0):**
1. `pip index versions graphifyy` cho thấy bản 0.9.100 còn có trên PyPI (Lead đã kiểm 2026-11-02). Ghi phiên bản thật khi cài.
2. Chạy thử trên clone sạch; xác nhận `graph.json` ghi `built_at_commit` đúng SHA mục 1.
3. Nếu không cài được hoặc không chạy được: **BLOCKED**, báo Lead. Không thay bằng công cụ khác, không vẽ tay.

**Phạm vi index (theo `git ls-files` tại 5495726, 2.614 file):**

| Khu vực | Số file | Ghi chú |
|---|---|---|
| `apps/backend` | 811 | NestJS: M00–M14, SMS Gateway, Valhalla/M14, tác vụ nền, thông báo, ví |
| `apps/admin-web` | 164 | Admin Web |
| `apps/client-shared`, `food-web`, `ship-web`, `ui-foundation` | 65 | Web dùng chung |
| `mobile/food`, `mobile/ship`, `mobile/packages`, `mobile/gateway`, `mobile/tool`, `mobile/gps-test` | 40, 44, 207, 17, 31, 301 | Flutter (Dart) và Kotlin; `gps-test` rất lớn do `.pbf` |
| `database` | 68 | 82 file `.sql` toàn repo; cần extra `[sql]` |
| `tests` | 308 | Phục vụ liên kết yêu cầu ↔ test, không tính là code sản phẩm |
| `ops`, `scripts`, `tools`, `config`, `.github/workflows` | 81, 61, 12, 3, 11 workflow | Hạ tầng, runner, workflow CI/deploy |

**Chủ trương:** index toàn repo một lần để Graphify có đủ cạnh liên thành phần, rồi *lọc theo khu vực khi phân tích*. Ghi rõ các thư mục bị bỏ (ví dụ `.pbf`, ảnh) và lý do.

**Giới hạn đã biết (từ lần thử trên `6c2bdffd`, ghi để không ngộ nhận):**
- Khoảng 28.762 node, 81.885 cạnh, 637 cộng đồng, dựng ~55 giây. 7% cạnh là INFERRED.
- SQL không đọc được nếu thiếu `[sql]`. 4 file Kotlin lỗi parse. 336 file không phân loại (`.pbf`, `.xml`...).
- AST **không thấy** nối động của NestJS: DI, decorator route, event, cron. Đường ngắn nhất không phải đường gọi thật. Ví dụ: `graphify path AdminOrderController TransactionManager` trả về đường qua import của `admin-limiter.ts`, không phải lời gọi từ controller.
- Hệ quả: **mọi đường dùng làm bằng chứng phải được mở ở source**. Graph là công cụ khám phá, không phải nguồn sự thật.

## 3. Việc cần làm (không có code sản phẩm)

Mọi kết quả ghi SHA graph và cờ EXTRACTED/INFERRED của cạnh.

| # | Việc | Đầu ra |
|---|---|---|
| G-1 | Dựng graph, ghi Graph Run Record: SHA, phiên bản, lệnh, số node/cạnh, tỉ lệ INFERRED, file bỏ qua hoặc lỗi parse | `graph-run-record.md` |
| G-2 | Graph module/dependency/call cho backend M00–M14, Admin Web, 11Food, 11Ship, SMS Gateway, Valhalla/M14, tác vụ nền. Dùng module NestJS làm đơn vị chính | Bảng component + đồ thị dạng bảng chữ |
| G-3 | Luồng entry point → service → database/external (xem mục 4) | `flows.md` |
| G-4 | Vòng phụ thuộc: ở cấp module NestJS, cấp file, cấp package Flutter. Mỗi vòng ghi đường đi và mở source xác nhận | `cycles.md` |
| G-5 | Ứng viên code không còn dùng: nút không có cạnh vào (loại trừ entry point do framework gọi: controller, cron, event, DI, `main`) | `dead-code-candidates.md`, mỗi dòng ghi cách đã loại trừ nối động |
| G-6 | Vùng tác động: với 15 điểm nóng (ví, đơn hàng, OTP/đăng nhập, phân quyền, hoa hồng, đối soát nạp tiền, GPS, định tuyến, thông báo...) liệt kê module bị ảnh hưởng khi sửa | `impact-areas.md` |
| G-7 | Trust boundaries: Internet → controller/guard, Admin → API, mobile → API, backend → SMS Gateway, backend → Valhalla, backend → DB, runner/tác vụ nền, ngoại vi (thanh toán, push). Mỗi ranh giới ghi guard/validator đứng ở đâu | `trust-boundaries.md` |
| G-8 | Liên kết với 198 yêu cầu: mỗi `M??-R-??` gắn component, entry point, test và cờ độ tin. Ghi rõ yêu cầu nào **không** tìm thấy nút code | `graph-baseline-links.csv` |
| G-9 | Tổng hợp: System Map dạng bảng chữ (Master Plan v3.5), danh sách giới hạn, câu hỏi cho Phase 3 | `phase2-report.md` |

### Luồng tối thiểu (G-3)

Đăng ký/đăng nhập/OTP/quên mật khẩu; đặt đơn, sửa đơn, hủy đơn; giao đơn cho tài xế, online/GPS; thanh toán, nạp ví, rút tiền, hoa hồng, đối soát; thông báo; quản trị (Admin duyệt, khóa, hủy đơn); tác vụ nền theo lịch; định tuyến Valhalla và tính khoảng cách (liên quan #294, #299); đăng xuất và xóa tài khoản (liên quan #295).

## 4. Liên kết với 198 yêu cầu baseline

- Nguồn: `docs/baseline/requirements.md` v0.7 (198 dòng, M00–M14); ma trận trạng thái B-02 của Codex; `b00-inventory.md` (234 mục gán chưa xác minh ngữ nghĩa, xem errata).
- Kết quả G-8 là **đầu vào cho Phase 3**, không phải kết luận. Không đánh dấu yêu cầu nào là "đạt" nhờ graph.
- Lead không dùng B-02 hay B-00 làm đáp án; Phase 3 sẽ đối chiếu Graph ↔ Baseline độc lập.

## 5. Bằng chứng đầu ra và nơi lưu

| Hạng mục | Nơi lưu |
|---|---|
| `graphify-out/` | **Không commit** (đã nằm trong `.gitignore` từ PR #297). Bản dùng chung ở `/mnt/project-files/graphify/<sha>/` |
| Các file G-1..G-9 | `/mnt/project-files/graphify/<sha>/reports/` và bản tóm tắt dạng Markdown trong nhánh tài liệu của PR Phase 2 (`docs/review/phase2/`) |
| Truy vấn | Mỗi kết luận ghi lệnh `graphify` đã dùng, SHA graph và đường dẫn source đã mở |
| Dữ liệu nhạy cảm | Không tài khoản, token, số điện thoại thật; không log thô |

## 6. Tiêu chí hoàn thành

Phase 2 hoàn thành khi **tất cả** đúng:
1. Graph Run Record đủ trường, SHA khớp mục 1, có danh sách file bỏ qua và lỗi parse.
2. G-2..G-9 đều có đầu ra; mỗi mục có thể kiểm bằng source (đường dùng làm bằng chứng đã mở source).
3. Vòng phụ thuộc và ứng viên code chết: **mỗi dòng ghi trạng thái "đã xác nhận ở source" hay "chỉ từ graph"**. Dòng chỉ từ graph không được xếp vào finding.
4. 198/198 yêu cầu có dòng trong G-8 (có thể là "không tìm thấy").
5. Mọi giới hạn công cụ ở mục 2 được nêu trong báo cáo, không giấu.
6. Không có thay đổi mã nguồn sản phẩm, workflow, cấu hình hay deploy (PR Phase 2 chỉ chứa tài liệu).
7. Review độc lập (mục 7) đã xong và mọi phát hiện có disposition.

Phase 2 **không** tuyên bố: code đúng, code đạt baseline, hay có lỗi. Đó là việc của Phase 3–7.

## 7. Review độc lập

**Codex** (đọc `main@5495726` và bản tóm tắt trong PR):
1. Dựng lại graph trên cùng SHA và cùng phiên bản; so số node/cạnh với Graph Run Record. Lệch trên 2% thì giải thích.
2. Chọn ngẫu nhiên 15 vòng/ứng viên chết/đường entry point, mở source xác nhận hoặc bác. Ghi tỉ lệ đúng.
3. Kiểm 20 dòng G-8 bất kỳ, ưu tiên yêu cầu liên quan ví, OTP, phân quyền.
4. Kiểm trust boundaries bằng cách đọc guard/middleware thật.

**Antigravity** (không sửa code, không vẽ sơ đồ):
1. Kiểm chéo luồng G-3 ở các luồng liên module (đặt đơn → giao → ví) và luồng mobile ↔ Admin Web.
2. Tìm luồng hoặc thành phần mà graph bỏ sót (nối động NestJS, cron, event, workflow, runner).
3. Rà vùng tác động G-6 xem có module bị thiếu.

**Lead** tổng hợp, ghi disposition; **Owner** nghiệm thu. Không ai tự chấp nhận kết quả của chính mình.

## 8. Bàn giao cho Phase 3 (Graph ↔ Baseline)

Gói bàn giao: `phase2-report.md`, `graph-baseline-links.csv`, `flows.md`, `trust-boundaries.md`, `cycles.md`, `dead-code-candidates.md`, `impact-areas.md`, cùng Graph Run Record và `graphify/<sha>/graph.json` (không commit).

Phase 3 nhận thêm các việc tồn từ Phase 1:
- Rà ngữ nghĩa lại **214 dòng** gán B-00 chưa được rà (234 dòng gán, 20 dòng mẫu đã rà, 10 dòng sai hoặc quá rộng đã ghi errata).
- Ứng viên B-04: B04-14 (DiagnosticsView, bảng Admin không có nguồn), VoucherScreen so với quy tắc không voucher, thiếu xóa tài khoản trong app.
- B04-19: kế hoạch rà soát bằng chứng 174 dòng "chưa đủ bằng chứng" theo rủi ro.

## 9. Ràng buộc chung

- Không sửa code sản phẩm, không deploy VPS, không phát hành APK, không merge nếu Owner chưa ra lệnh rõ.
- Mỗi lần chỉ một agent viết vào nhánh/PR; không hai agent cùng ghi.
- Không đưa log thô, thông tin đăng nhập, token vào GitHub.
- Không ghi PASS, "đạt" hay "đã xác minh" khi thiếu bằng chứng; chưa kiểm là NOT TESTED hoặc BLOCKED.
- Không vẽ sơ đồ thủ công.

## 10. Việc chờ Owner

- Giao Phase 2 và chọn executor (đề xuất: Claude Lead dựng graph và lập hồ sơ theo Master Plan v3; Codex và Antigravity review mục 7).
- Xác nhận SHA khảo sát mục 1.
- CI `main` trên `5495726`: chỉ coi là nền hợp lệ sau khi run 41461112293 thành công. Xem trạng thái trong báo cáo thread.
