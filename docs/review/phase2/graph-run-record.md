# G-1 Graph Run Record

**SHA khảo sát:** `549572696efb4bbc18af3c362b7f56a5fcd335e6` (`main`, merge PR #298) · **Graphify:** graphifyy 0.9.100 · **Ngày:** 2026-11-02 · **Người lập:** Claude Lead (Executor Phase 2)

**Quy ước độ tin:** `ĐÃ MỞ SOURCE` = người lập đã đọc đoạn mã nêu (file:dòng). `CHỈ TỪ GRAPH` = chỉ thấy trong graph, chưa mở source, không được xếp vào finding. `HEURISTIC` = suy từ script đọc source nhưng chưa đọc từng dòng.


| Trường | Giá trị |
|---|---|
| SHA graph (`built_at_commit` trong graph.json) | `549572696efb4bbc18af3c362b7f56a5fcd335e6` (khớp SHA Owner chốt) |
| Quan hệ với baseline Phase 0/1 | `fb3ba2ce18ada300dbbf65749096f400780f4e31`; Phase 1 báo chỉ khác 5 file `docs/baseline/` (lệnh `git diff --stat fb3ba2c 5495726` chưa chạy lại trong phiên này: **chưa tự kiểm**) |
| Gate CI | `main` run 41461112293 = **success**, cả 6 job (đã kiểm bằng `gh run view`), head `5495726` |
| Công cụ | `graphifyy[sql]==0.9.100` (PyPI), Python 3.13, venv riêng, không gọi LLM |
| Lệnh dựng | `graphify update .` trên clone shallow sạch của `main` (không có `graphify-out/` cũ, `git status` sạch) |
| Thời gian dựng | 61 giây (4 worker) |
| Quy mô | 29.524 node, 83.282 cạnh, 700 cộng đồng (graph.html chỉ có bản gộp 700 nút vì vượt giới hạn 5.000 nút) |
| Cạnh theo độ tin | EXTRACTED 77.341 · INFERRED 5.941 (7,1%): calls 4.961, indirect_call 550, references 426, imports_from 4 |
| Hyperedges | 0 |
| File được index | 2.276 trong `manifest.json` / 2.614 file `git ls-files` |
| File bị bỏ (338) | 257 `.pbf` (mobile/gps-test), 18 `.xml`, 11 `.cmd`, 8 `.service` + 5 `.timer` (ops/vinahost), 6 `.css`, 6 `.ttf`, 5 `.example`, 4 `.conf`, 4 `.gitignore`, 2 `.woff2`, 2 `.gz`, 2 `.properties`, 1 `.apk`, 1 `.jar`, 1 `.pem`, 1 `Dockerfile`, v.v. Ghi chú: unit systemd, nginx conf, pg_hba và Dockerfile **không** vào graph nên mọi kết luận về hạ tầng phải đọc tay |
| Lỗi parse | 4 file Kotlin: `mobile/gps-test/app/.../MainActivity.kt`, `mobile/gps-test/gps/.../LocationReporterTest.kt` (một phần), `mobile/tool/android-templates/kotlin/MainActivity.kt`, `.../MainActivityFood.kt` (0 symbol) |
| File không có symbol (94) | chủ yếu `*.spec.ts` của admin-web, `business-sw.js` |
| Loại nút | code 26.860, document 2.433, concept 211, rationale 20; theo đuôi: ts 14.524, dart 6.491, md 2.433, mjs 968, yml 645, sql 635, kt 476 |
| SQL | extra `[sql]` đã cài; 635 nút `.sql` có trong graph (82 file migration/fixture). Số bảng đọc bằng script riêng từ `create table`: 141 |
| sha256 graph.json | `965591a857a8a50ce8ce31beec5341e562db2eed9e396d053c68d6a93a6c019d` (38.579.054 byte) |
| Nơi lưu | `/mnt/project-files/graphify/549572696efb4bbc18af3c362b7f56a5fcd335e6/` (không commit; `graphify-out/` đã nằm trong `.gitignore`) |
| Khác biệt so với lần thử trước (`6c2bdffd`: 28.762 node, 81.885 cạnh) | +762 node, +1.397 cạnh: hợp lý do repo đã thêm code sau mốc đó; không đối chiếu từng node |

**Cạnh nhạy cảm:** graph xây vô hướng theo cờ `directed:false` nhưng `graphify path` mặc định tìm có hướng. Mọi đường dẫn trong báo cáo ghi rõ cờ này.

## Công cụ phụ trợ (script đọc source, không thay Graphify)

Graphify AST không thấy DI, route, cron, event của NestJS. Để đối chiếu, người lập viết 4 script **chỉ đọc** (regex + ghép ngoặc, không chạy mã dự án) tại `reports/scripts/`: `nest.py` (module/controller/route/guard/timer), `imports.py` (đồ thị import file + SCC), `g8b.py` + `hints.py` (liên kết yêu cầu). Chúng bổ trợ Graphify chứ không thay thế; kết quả của chúng cũng là `HEURISTIC` trừ chỗ ghi `ĐÃ MỞ SOURCE`. Codex được yêu cầu dựng lại bằng Graphify độc lập.
