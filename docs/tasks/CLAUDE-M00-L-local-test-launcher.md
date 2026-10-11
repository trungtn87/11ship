# Giao Claude — M00-L Local Test Launcher

Đọc `AGENTS.md`, `CLAUDE.md`, `docs/process/11ship-delivery-workflow.md` và hợp đồng đã duyệt tại [`M00-L-local-test-launcher.md`](M00-L-local-test-launcher.md) trước khi sửa file.

## Base và trạng thái đầu vào

- Repository: `trungtn87/11ship`.
- Design base: `46d21a92e9657bd16e4e64994c4c0023bc80288f`.
- Lấy nhánh/tài liệu thiết kế mới nhất, xác minh diff chỉ là documentation trước khi tạo nhánh implementation.
- Working copy Owner có untracked `tore package.json`. Không sửa, xóa, move, add, overwrite hay dùng thao tác có thể làm mất file đó.
- Không reset hard, force push, auto-stash, `down -v`, remote migration, Render/Supabase hoặc production.

Nếu main/head đã đổi, đọc diff và báo xung đột phạm vi; không tự suy rằng base cũ vẫn đúng.

## Nhiệm vụ

Triển khai đúng toàn bộ hợp đồng M00-L đã duyệt, gồm menu và năm entry point Windows, orchestration PowerShell, test guard/an toàn, `.gitignore` cho state/log local, runbook Owner và evidence.

Repo hiện chỉ có backend. Không tạo web/app giả và không thêm framework/dependency nếu không có lý do bắt buộc được Owner duyệt. Dùng `npm.cmd` trên Windows. Mọi script phải chạy theo vị trí script, không hard-code `D:\11Ship`.

## Trình tự IDEA → DATABASE → UI → IMPLEMENT → TEST → LOCK

1. **IDEA:** đối chiếu hợp đồng; liệt kê file dự kiến và mọi điểm chưa rõ. Không đổi nghiệp vụ.
2. **DATABASE:** giữ DEV volume; TEST riêng; thiết kế prompt migration DEV và guard cấm remote/wrong target trước khi code.
3. **UI:** menu/thông điệp tiếng Việt theo hợp đồng; không cần GUI. Giữ output ngắn, có action sửa lỗi.
4. **IMPLEMENT:** commit nhỏ, không unrelated refactor; launcher không che lỗi command con.
5. **TEST:** test behavior/negative guard, smoke Windows và suite repo; bằng chứng đúng SHA.
6. **LOCK:** cập nhật runbook/evidence, giữ PR Draft và giao Codex review. Không merge/Ready.

## Acceptance tối thiểu

- Start đưa DB về healthy, backend live/ready; không tự migrate DEV khi chưa xác nhận.
- Update chỉ fast-forward, bảo toàn dirty/untracked và chỉ `npm ci` khi lock/dependency state yêu cầu.
- Test không thể chạy integration vào DEV/staging/production, tạo log+summary gắn SHA và trả exit code đúng.
- Stop giữ volume/dữ liệu DEV, không giết process ngoài launcher.
- Status phản ánh đúng backend/DB/Git/toolchain; các app chưa tồn tại hiển thị N/A.
- Không secret nào xuất hiện trong console/log.
- `tore package.json` còn nguyên byte-for-byte.

## Bằng chứng phải giao

- Base, code head, final head và diff stat.
- PR Draft URL; labels/metadata đúng convention hiện có nếu tạo được.
- Kết quả từng acceptance/negative test, test counts, exit codes và log path đã redact.
- Windows smoke thực tế của cả năm entry point; nếu môi trường Claude không phải Windows hoặc không có Desktop interaction, ghi rõ phần chưa thực nghiệm, không gọi PASS.
- Node/npm/Docker/Compose versions; giải thích cách xử lý npm hiện tại khác `11.9.0`.
- `lint`, `typecheck`, `build`, `deploy:test`, unit, integration local, progress tests/check và exact-head CI. Không dùng log rỗng hoặc test trên SHA khác.
- DEV data marker tồn tại sau Stop/Start; TEST guard từ chối URL DEV.
- Hash trước/sau của `tore package.json` hoặc bằng chứng tương đương mà không add file vào Git.

Khi gặp thiếu thiết kế hoặc thay đổi cần mở rộng phạm vi, dừng và trả lại Codex/Owner. Không tự quyết định.
