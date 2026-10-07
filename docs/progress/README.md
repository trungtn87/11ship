# Hệ thống theo dõi tiến độ (Progress Tree)

Trang xem tiến độ: [docs/PROGRESS.md](../PROGRESS.md). File đó **tự sinh**, không sửa tay.

Nguyên tắc: **kế hoạch nằm trong repo, thực tế nằm trên GitHub.** Không ai, kể cả AI, đánh dấu một task là DONE bằng cách viết ra. Trạng thái được suy ra từ `merged_at`, `state`, `draft`, head SHA, check run, label và dependency giữa các task. Mô tả PR (title, body) và tên tác giả không bao giờ được dùng để suy ra trạng thái.

## Các file

| File | Vai trò |
|---|---|
| `docs/progress/plan.yml` | Kế hoạch: module, task, dependency, vai trò, PR đã ghim, required check. Không chứa trạng thái runtime. |
| `scripts/generate-progress.mjs` | CLI: đọc plan + GitHub, sinh `docs/PROGRESS.md`. |
| `scripts/progress/resolve.mjs` | State resolver thuần (không mạng, không đồng hồ). |
| `scripts/progress/render.mjs` | Sinh markdown và Mermaid, tất định từng byte. |
| `scripts/progress/github.mjs` | Đọc GitHub bằng REST (không GraphQL). |
| `scripts/progress/yaml-subset.mjs` | Parser YAML tối thiểu, không dependency. |
| `.github/workflows/update-progress.yml` | Tự cập nhật. |
| `tests/progress/` | Unit test (P01–P10 và các quy tắc khác) + snapshot thật ngày 07/10/2026. |

Chạy test: `npm run progress:test`. Sinh lại: `npm run progress:generate` (cần `GITHUB_TOKEN` hoặc `GH_TOKEN`; PowerShell: `$env:GITHUB_TOKEN = (gh auth token)`). Kiểm tra file có cũ không: `npm run progress:check`.

## Nhãn (label) — cách duy nhất để một PR mới được tính

Agent được xác định bằng label, **không** bằng tên tài khoản GitHub (nhiều commit có thể cùng push bằng tài khoản Owner).

| Nhóm | Label | Ý nghĩa |
|---|---|---|
| Agent | `agent:claude`, `agent:chatgpt`, `agent:owner` | Ai làm PR này |
| Loại | `type:design`, `type:implementation`, `type:review-fix` | Loại công việc |
| Ngoài kế hoạch | `type:infra` | PR hạ tầng, không thuộc task nào |
| Task | `module:<task id>` ví dụ `module:M00-C1A1` | PR thuộc task nào (đúng một) |
| Review | `review:in-progress`, `review:changes-requested`, `review:pass` | Kết quả ChatGPT review |

Quy tắc bắt buộc:

- PR `type:design` phải có `agent:chatgpt`. PR `type:implementation` và `type:review-fix` phải có `agent:claude`. Sai agent thì PR **không được tính** và bị liệt kê ở mục Attention.
- Chỉ mở PR có `module:` + `type:` hợp lệ mới được tính. PR thiếu metadata hiện ở mục Attention (`UNCLASSIFIED_PR`) và không làm đổi trạng thái nào.
- Label `review:*` chỉ có hiệu lực nếu được gắn **sau** commit head hiện tại. Push thêm commit thì `review:pass` cũ tự mất hiệu lực (`STALE_REVIEW_LABEL`).
- PR lịch sử chưa có label (#1–#4) được chấp nhận vì số PR được **ghim trong `plan.yml`** (`design_pr`, `implementation_pr`).

Tạo bộ label một lần: `npm run progress:generate -- --print-labels` in ra các lệnh `gh label create ...` để chạy (script không tự tạo label).

## Trạng thái của task

| Trạng thái | Điều kiện (suy ra từ GitHub) | Owner hiện tại |
|---|---|---|
| `BLOCKED_BY_DEPENDENCY` | Có dependency chưa `DONE` (kể cả dependency kế thừa từ task cha). Có branch/PR cũng không mở khoá. | — |
| `BLOCKED_BY_CI` | Task có `requires_main_ci_green`, chưa có PR đang chạy và required check trên `main` chưa xanh. | — |
| `PLANNED` | Chưa có design PR hợp lệ. | ChatGPT |
| `DESIGNING` / `DESIGN_REVIEW` | Design PR đang draft / đã ready, chưa merge. | ChatGPT / Owner |
| `DESIGN_LOCKED` | (nhóm) Design PR đã merge, các task con chưa xong. | — |
| `READY_FOR_CLAUDE` | Dependency xong, design đã khoá, chưa có implementation PR hợp lệ đang mở. | Claude |
| `CLAUDE_CODING` | Implementation PR hợp lệ (`agent:claude`) đang draft. | Claude |
| `CI_RUNNING` / `CI_FAILED` | PR ready mà required check đang chạy / có check fail. | CI / Claude |
| `WAITING_CHATGPT_REVIEW` | PR ready, CI xanh, chưa có kết quả review hợp lệ cho head hiện tại. | ChatGPT |
| `CHATGPT_REVIEW` / `CHANGES_REQUESTED` | Có `review:in-progress` / `review:changes-requested` hợp lệ. | ChatGPT / Claude |
| `READY_TO_MERGE` | CI xanh + `review:pass` hợp lệ cho head hiện tại. | Owner |
| `DONE` | Implementation PR hợp lệ đã merge (`merged_at`) **và** required check xanh trên head của PR **và** mọi dependency `DONE` **và** PR không bị loại. | — |

Trạng thái ở mức PR: `MERGED`, `DRAFT`, `OPEN`, `CANCELLED`. PR bị đóng mà không merge là `CANCELLED`; PR liệt kê trong `ignored_prs` luôn là `CANCELLED` dù bị mở lại hay có label. Ví dụ PR #5: đã đóng, `merged_at = null`, CI trên head của nó xanh, vẫn không được tính và không mở được C1B.

Required check được khai trong `plan.yml` (`required_checks`) vì repo private không dùng được API branch protection. Nếu đổi tên job CI thì phải đổi ở đó.

## Tiến độ %

Tính theo trọng số (`weight`) của task lá, mặc định mỗi task lá bằng 1. Không tính theo commit, số dòng code hay PR bị huỷ. Làm tròn xuống để không nói quá. Khi `roadmap_complete: false`, con số toàn dự án được ghi rõ là "planned tasks only".

## Thêm hoặc đổi task

Sửa `docs/progress/plan.yml` (mô tả các trường ở đầu file), chạy `npm run progress:test`, rồi mở PR. Không ghi trạng thái vào plan. Khi một task có PR mới, chỉ cần gắn đủ label; không cần sửa plan.

## Tự động cập nhật và bảo mật

- `preview` (sự kiện `pull_request`): token **chỉ đọc**, chạy test và in dashboard vào job summary. Có thể chạy mã của chính PR vì không có quyền ghi.
- `publish` (sự kiện `push` vào `main`, `workflow_run` của CI, `workflow_dispatch`, `pull_request_target`): có `contents: write`, chỉ checkout **nhánh mặc định**, không bao giờ checkout head của PR, không đưa title/body/branch/label vào lệnh shell, và không có `npm ci`. `pull_request_target` được dùng vì thay đổi label chỉ tới được workflow có quyền ghi theo cách này; rủi ro của nó (chạy mã PR với quyền ghi) bị loại bằng các ràng buộc trên.
- Không bị lặp vô hạn: bot đẩy bằng `GITHUB_TOKEN` nên GitHub không kích hoạt workflow nào; `push` bỏ qua thay đổi chỉ chạm `docs/PROGRESS.md`; `workflow_run` chỉ nghe workflow `CI`; chỉ commit khi nội dung thật sự đổi.
- Text lấy từ GitHub (title PR, tên label) được escape trước khi vào bảng và không bao giờ đi vào Mermaid.
- Muốn làm mới ngay: Actions → Update progress → Run workflow.

## Giới hạn đã biết

- Commit của bot vào `main` không có CI (GitHub không chạy workflow cho push bằng `GITHUB_TOKEN`). "CI của main" vì vậy được tính ở commit mới nhất trên `main` **có** chạy required check; commit của bot bị bỏ qua.
- Dashboard trên `main` cập nhật theo sự kiện, nên có thể trễ vài chục giây so với GitHub. Trong PR, job summary của `preview` luôn lấy dữ liệu mới nhất.
- Nếu branch protection yêu cầu PR cho `main` thì bot không đẩy trực tiếp được; khi đó cần cho phép github-actions bypass hoặc chuyển sang nhánh riêng.
