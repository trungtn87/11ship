# QUY TẮC TRIỂN KHAI & REVIEW TOÀN DỰ ÁN

Nguồn: Owner (Trung Black), 07/11/2026. Áp dụng cho mọi PR từ thời điểm này. Quy tắc merge/deploy/APK của `AGENTS.md` và `CLAUDE.md` vẫn có hiệu lực: chỉ merge khi Owner ra lệnh "merge N" cho đúng PR.

## Mục tiêu
- Giảm số vòng sửa → test → review lại.
- Không để lỗi cơ bản lọt sang reviewer.
- Reviewer không đọc lại toàn repository.
- Không sửa lỗi nhỏ không ảnh hưởng nghiệm thu trong PR hiện tại.
- Mỗi agent một vai trò. Ưu tiên an toàn và đúng đắn, tránh over-engineering.

## Mô hình chuẩn
Owner → Claude Lead → Claude Code → Antigravity → Codex → Claude Lead → Merge. Không đổi thứ tự trừ khi Owner yêu cầu.
Một người triển khai, một người test, một người phản biện, một Lead quyết định.

## 1. Claude Lead (duyệt và điều phối)
Không làm thay Claude Code, Antigravity, Codex. Lead:
1. Đọc yêu cầu Owner; xác định mục tiêu, phạm vi, file/module ảnh hưởng, acceptance criteria, mức rủi ro, test bắt buộc.
2. Chốt quyết định nghiệp vụ còn mơ hồ TRƯỚC khi giao code.
3. Giao Claude Code triển khai. Chỉ chuyển Antigravity sau khi Claude Code self-check xong. Chỉ chuyển Codex sau khi Antigravity PASS.
4. Phân loại finding: sửa ngay / để PR sau / không hợp lệ / vượt scope. Ngăn scope creep: vấn đề ngoài phạm vi và không do PR gây ra thì ghi backlog/issue.
5. Duyệt cuối; merge khi đủ điều kiện và có lệnh của Owner.

## 2. Claude Code (triển khai một lượt hoàn chỉnh)
Không tự đổi nghiệp vụ, không refactor ngoài vùng cần thiết, không sửa LOW/cosmetic không liên quan acceptance criteria.
Bắt buộc trước khi push:
1. Xem `git diff`.
2. Build/typecheck/compile liên quan.
3. Unit test của TOÀN BỘ module/vùng bị ảnh hưởng, không chỉ test mới.
4. `npm run build:test` khi repo có lệnh này.
5. `check-pr-report.mjs` khi áp dụng.
6. Android/Kotlin: compile và test Kotlin thực tế, không chỉ kiểm tra source.
7. Kiểm danh sách error code/enum/schema nếu đổi contract.
8. Không `.skip`, fixture tạm, debug flag, log bí mật, TODO phục vụ sửa lỗi.
9. Lấy SHA bằng `git rev-parse HEAD`, không gõ tay.
10. Sau push, cập nhật PR body bằng đúng SHA đó trong cùng bước.
PR chưa qua các bước trên là CHƯA SẴN SÀNG REVIEW.

## 3. Gói bàn giao (ngắn; PR body là nguồn sự thật duy nhất)
PR; base SHA; head SHA; mục tiêu; file/module đổi; acceptance criteria; test đã chạy và kết quả; quyết định Owner liên quan; finding cũ cần xác nhận đóng; rủi ro biết trước. Không gửi lịch sử làm việc, không paste log thành công; chỉ paste đoạn lỗi khi có lỗi.

## 4. Antigravity (tester độc lập)
Kiểm toàn bộ phạm vi PR MỘT lần trên head hiện tại; không review từng commit nhỏ khi Claude Code còn sửa. Kiểm: acceptance criteria, regression vùng liên quan, build, typecheck, unit/integration phù hợp, runtime khi cần, Android compile khi liên quan, contract/schema/error code, edge case thực tế. Gom TOÀN BỘ finding vào một comment. Kết quả chỉ PASS hoặc FAIL kèm đủ finding hiện biết. Không đòi refactor chỉ vì code chưa đẹp.

## 5. Codex (phản biện cuối)
Chỉ nhận sau khi Antigravity PASS. Không làm lại việc của Antigravity. Tập trung: logic sai, race condition, mất dữ liệu, security thực chất, idempotency, state transition, rollback/recovery, contract mismatch, edge case khó, regression kiến trúc, trường hợp test chưa bao phủ. Đọc `base SHA → head SHA`; chỉ ra ngoài diff khi diff phụ thuộc trực tiếp. Kết quả: ĐỦ hoặc CHƯA ĐỦ ĐIỀU KIỆN MERGE, với finding thực sự chặn merge, trong MỘT comment, không log thô.

## 6. Phân loại finding
- BLOCKER/HIGH: phải sửa trước merge nếu có thể gây sai nghiệp vụ chính, mất dữ liệu, sai tiền, sai quyền, lỗi bảo mật thực tế, crash/runtime failure, trạng thái không phục hồi, regression chức năng, vi phạm acceptance criteria.
- MEDIUM: chỉ chặn merge nếu trực tiếp vi phạm acceptance criteria, tạo regression, hoặc có khả năng gây lỗi production đáng kể; ngược lại tạo issue/backlog.
- LOW: không chặn merge; ghi danh sách ngắn vào PR/issue; không mở vòng sửa chỉ để xử lý LOW.

## 7. Sửa finding
Sau Antigravity FAIL hoặc Codex FAIL, Lead gom TOÀN BỘ finding hợp lệ thành MỘT gói sửa giao Claude Code (không giao từng finding). Sau push: self-check lại, cập nhật SHA tự động, cập nhật PR body, chuyển reviewer tiếp theo.

## 8. Re-review chỉ kiểm delta
Reviewer đã xem SHA A thì lần sau chỉ kiểm `git diff A..HEAD` + finding chưa đóng. Không review lại toàn PR, không nhắc finding đã đóng, trừ khi delta đổi giả định cũ.

## 9. Giới hạn vòng lặp
Một PR bình thường: 1 vòng Claude Code; 1 vòng Antigravity; 1 vòng sửa tổng hợp nếu cần; 1 vòng Codex; 1 vòng sửa tổng hợp nếu thật sự có blocker. Nếu sau 2 vòng sửa vẫn xuất hiện finding nhỏ lẻ mới: DỪNG, không tự động sửa tiếp; Lead phân loại (blocker thật / scope mới / backlog / test thiếu / reviewer mở rộng phạm vi) và quyết định trước khi có thêm code.

## 10. Không review khi PR chưa ổn định
Không gọi Antigravity khi Claude Code còn code. Không gọi Codex khi Antigravity chưa PASS. Không cho hai reviewer phản biện song song cùng một head. Thứ tự: Claude Code DONE → Antigravity PASS → Codex APPROVED → Lead merge (theo lệnh Owner).

## 11. Tối ưu token
- Claude Code nhận: yêu cầu, acceptance criteria, file/module, quyết định Owner, test bắt buộc.
- Antigravity nhận: PR, base/head SHA, acceptance criteria, vùng code, test cần xác minh.
- Codex nhận: PR, reviewed SHA, head SHA, acceptance criteria, kết quả Antigravity, finding cũ.
- Re-review chỉ gửi: SHA cũ, SHA mới, finding cần đóng, delta.

## 12. Output của agent
Ngắn. Không kể quá trình đọc file, không paste log thành công, không liệt kê lệnh đã chạy nếu tất cả PASS. Chỉ báo phạm vi kiểm tra, kết quả, finding, test quan trọng, kết luận. Finding có dạng: `Severity — file/vùng — vấn đề — tác động — yêu cầu sửa`.

## 13. SHA và PR body
Cấm gõ SHA thủ công: `HEAD_SHA=$(git rev-parse HEAD)`, dùng chính giá trị đó cập nhật `Remote-head-SHA`/trường tương tự trong cùng bước push. Agent handoff không được chạy trước bước này. Sai SHA do gõ tay là lỗi quy trình.

## 14. Test trước reviewer
Reviewer không phải CI cơ bản. Build fail, Kotlin không compile, unit fail, thiếu error code, PR body sai SHA, lint/typecheck fail phải bị Claude Code bắt trước khi Antigravity nhận việc.

## 15. Điều kiện merge
Scope đúng; acceptance criteria đạt; Claude Code self-check PASS; CI PASS; Antigravity PASS; Codex ĐỦ ĐIỀU KIỆN MERGE; không còn BLOCKER/HIGH hợp lệ; MEDIUM còn lại đã được Lead quyết; LOW không chặn; PR body trùng head SHA hiện tại; Owner đã ra lệnh merge. PR không cần hoàn hảo, chỉ cần đúng scope, an toàn và đủ điều kiện nghiệm thu.

## Mẫu phân công
- Lead → Claude Code: Triển khai đúng scope đã chốt, không mở rộng. Trước push chạy toàn bộ pre-push gate (build/test, unit vùng đổi, check-pr-report, compile nền tảng liên quan). Lấy SHA bằng `git rev-parse HEAD`, cập nhật PR body cùng bước. Chỉ báo DONE khi self-check PASS; không gửi reviewer khi còn lỗi đã biết.
- Lead → Antigravity: Test độc lập PR tại head chỉ định; kiểm toàn bộ acceptance criteria một lượt, gom mọi finding vào một comment; không sửa code, không mở rộng scope; LOW không chặn; kết luận PASS/FAIL.
- Lead → Codex: Chỉ phản biện sau khi Antigravity PASS; ưu tiên logic, state, concurrency, security thực tế, data integrity, recovery, edge case chưa test; không làm lại việc Antigravity; re-review chỉ delta từ SHA đã review; LOW ghi riêng; một comment; kết luận ĐỦ/CHƯA ĐỦ.

## Nguyên tắc cuối
Không để bốn agent cùng làm lại một việc. Không tối ưu PR tới hoàn hảo; tối ưu để tìm lỗi nghiêm trọng sớm, sửa gộp một lần và merge an toàn.
