# Hệ thống theo dõi tiến độ (Progress Tree)

Trang xem tiến độ: [docs/PROGRESS.md](../PROGRESS.md). File đó **tự sinh**, không sửa tay. Dashboard hiển thị bằng **tiếng Việt**; các mã kỹ thuật như `DONE`, `READY_FOR_CLAUDE`, `PASS` vẫn được giữ trong ngoặc để audit và đối chiếu log.

Nguyên tắc: **kế hoạch nằm trong repo, thực tế nằm trên GitHub.** Không ai, kể cả AI, đánh dấu một task là DONE bằng cách viết ra. Trạng thái được suy ra từ `merged_at`, `state`, `draft`, head SHA, check run, label và dependency giữa các task. Mô tả PR (title, body) và tên tác giả không bao giờ được dùng để suy ra trạng thái.

## Các file

| File | Vai trò |
|---|---|
| `docs/progress/plan.yml` | Kế hoạch: module, task, dependency, vai trò, PR đã ghim, required check. Không chứa trạng thái runtime. |
| `scripts/generate-progress.mjs` | CLI: đọc plan + GitHub, sinh `docs/PROGRESS.md`. |
| `scripts/progress/resolve.mjs` | State resolver thuần (không mạng, không đồng hồ). |
| `scripts/progress/render.mjs` | Sinh markdown và Mermaid, tất định từng byte. |
| `scripts/progress/github.mjs` | Đọc GitHub bằng REST (không GraphQL); tách `head_sha` / `ci_sha` của main. |
| `scripts/progress/constants.mjs` | Hằng số dùng chung: commit message và danh tính bot, label review, vai trò cố định. |
| `scripts/progress/review.mjs`, `scripts/reset-review-labels.mjs` | Gỡ label `review:*` khi head PR đổi. |
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
- Kết quả review chỉ có hiệu lực cho **đúng head SHA** đã được review. Gốc của việc ràng buộc là một **commit status** `11ship/chatgpt-review` gắn trực tiếp vào SHA (không phải branch, timestamp, title hay body). Label `review:*` chỉ là input do người đặt; label một mình **không bao giờ** là bằng chứng PASS. Job `review-status` (trusted) đổi label thành status trên head SHA hiện tại: `review:in-progress` → `pending`, `review:changes-requested` → `failure`, `review:pass` → `success`. Resolver chỉ chấp nhận label khi snapshot có status đúng context, đúng state theo label, và `sha` **bằng** head SHA hiện tại của PR. Thiếu status, status ở SHA cũ, sai context, sai state, hoặc có nhiều hơn một label `review:*` thì không ai được coi là review hợp lệ (fail closed): task ở `WAITING_CHATGPT_REVIEW`, không bao giờ `READY_TO_MERGE`. Vì status nằm trên một SHA, push head B sau khi A đã PASS thì B không có status nên chờ review mới, kể cả khi label `review:pass` cũ vẫn còn vài giây, kể cả khi `reset-review` chưa chạy, kể cả khi commit B bị backdate.
- `reset-review` (gỡ cả ba label khi head đổi) được giữ lại chỉ để dọn UI và làm lớp phòng thủ thêm; đúng đắn không phụ thuộc vào nó.
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

## PR gộp thiết kế + triển khai (ngoại lệ tường minh)

Trường tùy chọn `combined_design_implementation: true` trong `plan.yml`, mặc định `false` và không bao giờ được suy ra từ tiêu đề, tác giả, label, đường dẫn hay mô tả PR. Chỉ hợp lệ trên một task **lá** có `design_pr` và `implementation_pr` là **cùng một** số PR dương; đây là trường hợp duy nhất được phép ghim lặp một PR. PR gộp bị phân loại **một lần** (vai trò `combined`, hiển thị "thiết kế + triển khai"), không nhân đôi dòng PR, trọng số hay cảnh báo. Vòng đời của nó là vòng đời triển khai của task, dùng nguyên các quy tắc hiện có: draft → `CLAUDE_CODING`; CI lỗi → `CI_FAILED`; ready + CI xanh, chưa có review gắn đúng head → `WAITING_CHATGPT_REVIEW`; review hợp lệ → các trạng thái review hiện có; merge + required check xanh trên head thật + dependency xong → `DONE` đúng một lần; merge nhưng CI lỗi/thiếu → `CI_FAILED`/`CI_RUNNING`; đóng không merge → `PLANNED` (không bao giờ `READY_FOR_CLAUDE`). Dependency chưa xong vẫn chặn kể cả khi PR đã merge. Task thường giữ nguyên quy trình thiết kế trước. Vai trò cố định (owner/design/review) không đổi.

## Thêm hoặc đổi task

Sửa `docs/progress/plan.yml` (mô tả các trường ở đầu file), chạy `npm run progress:test`, rồi mở PR. Không ghi trạng thái vào plan. Khi một task có PR mới, chỉ cần gắn đủ label; không cần sửa plan.

## Tự động cập nhật và bảo mật

- `preview` (sự kiện `pull_request`): token **chỉ đọc** (kể cả `statuses: read`), chạy test và in dashboard vào job summary. Có thể chạy mã của chính PR vì không có quyền ghi.
- `review-status` (sự kiện `pull_request_target` loại `labeled` / `unlabeled` với label `review:*`): quyền `contents: read` + `pull-requests: read` + `statuses: write`, checkout nhánh mặc định, không chạy code của PR, không `npm ci`. Chỉ nhận số PR và head SHA của event qua biến môi trường (script kiểm tra số nguyên dương và 40 ký tự hex), không đưa title/body/branch/tên label vào shell. Nó đọc PR bằng API một lần (head SHA và label cùng một thời điểm) rồi ghi status lên đúng SHA đó; description là chuỗi cố định. Nếu head đã đổi so với SHA trong event (label được gắn cho head cũ) thì không ghi gì, head mới không có status và phải chờ review. Sau khi ghi nó đọc lại PR: nếu head đã đổi thì status cũ ở lại SHA cũ và không bao giờ được chép sang head mới; nếu label đổi trên cùng head thì ghi lại. Mỗi PR chạy một lượt một lúc (`concurrency`). API lỗi hoặc không ổn định sau 3 lần thì job fail và `publish` của cùng lượt chạy không chạy.
- `reset-review` (sự kiện `pull_request_target` loại `synchronize`): dọn UI và phòng thủ thêm, không phải gốc của đúng đắn. Quyền `contents: read` + `pull-requests: write`, checkout nhánh mặc định, không chạy code của PR, chỉ nhận số PR (kiểm tra số nguyên dương) và chỉ gỡ ba label `review:*`.
- `publish` (sự kiện `push` vào `main`, `workflow_run` của CI, `workflow_dispatch`, `pull_request_target`): có `contents: write` (và `statuses: read` để đọc status review), chờ cả `reset-review` và `review-status` và không chạy nếu một trong hai lỗi, chỉ checkout **nhánh mặc định**, không bao giờ checkout head của PR, không đưa title/body/branch/label vào lệnh shell, và không có `npm ci`. `pull_request_target` được dùng vì thay đổi label chỉ tới được workflow có quyền ghi theo cách này; rủi ro của nó (chạy mã PR với quyền ghi) bị loại bằng các ràng buộc trên.
- Không bị lặp vô hạn: bot đẩy bằng `GITHUB_TOKEN` nên GitHub không kích hoạt workflow nào; `push` bỏ qua thay đổi chỉ chạm `docs/PROGRESS.md`; `workflow_run` chỉ nghe workflow `CI`; chỉ commit khi nội dung thật sự đổi.
- Text lấy từ GitHub (title PR, tên label) được escape trước khi vào bảng và không bao giờ đi vào Mermaid.
- Muốn làm mới ngay: Actions → Update progress → Run workflow.

## Giới hạn đã biết

- Commit của bot vào `main` không có CI (GitHub không chạy workflow cho push bằng `GITHUB_TOKEN`). Collector giữ riêng hai SHA: `head_sha` (đầu thật của `main`, không bao giờ bị thay) và `ci_sha` (commit dùng để đánh giá CI). Hai SHA chỉ khác nhau khi head là commit progress-bot **được xác minh**: message đúng từng chữ `chore(progress): update docs/PROGRESS.md [skip ci]`, author và committer đều là `github-actions[bot]` (đúng tên và email), một parent, và commit chỉ sửa `docs/PROGRESS.md`. Khi đó CI lấy từ commit ngay dưới (lặp lại nếu có nhiều commit bot liên tiếp, tối đa 15 commit). Một head bình thường chưa có required check **không** bị đi xuống commit cũ: CI là `NONE` hoặc `RUNNING`, không bao giờ `PASS`. Chuỗi parent bị đứt, hoặc không tìm thấy commit có CI trong cửa sổ 15 commit, cũng cho `NONE`. Dashboard ghi `main HEAD <sha>` khi head là commit thường; khi head là commit bot thì ghi `main code <sha>` (commit code mà CI được đọc) và nói rõ head là commit bot chỉ sửa docs, không in SHA của commit bot vì SHA đó đổi sau mỗi lần cập nhật dashboard.
- Review: thứ tự chạy của các workflow không ảnh hưởng đúng đắn. Giữa lúc push head B và lúc `reset-review` chạy, label cũ có thể còn; trong khoảng đó `publish` (ví dụ do `workflow_run` của CI B) vẫn chạy được, nhưng resolver không thấy status cho B nên B ở `WAITING_CHATGPT_REVIEW`. Hướng ngược lại cũng an toàn: nếu label vừa gắn mà `review-status` chưa ghi xong thì dashboard tạm thời hiện `WAITING_CHATGPT_REVIEW` rồi tự đúng ở lần cập nhật sau. Gốc tin cậy là quyền `statuses: write`: collector chỉ nhận status do `github-actions[bot]` tạo, nên một người hoặc app khác ghi cùng context chỉ có thể làm review không hợp lệ, không thể tạo review PASS. Một workflow nằm trong chính PR (sự kiện `pull_request`) mà tự xin `statuses: write` có thể ghi status dưới danh nghĩa bot; chặn việc đó thuộc về quy trình review code thay đổi `.github/workflows`, không phải của resolver.
- Vai trò trong `plan.yml` (`owner_role`, `design_role`, `review_role`) là cố định ở schema v1 (CLAUDE / CHATGPT / CHATGPT), được validate chặt và chưa cấu hình được.
- Dashboard trên `main` cập nhật theo sự kiện, nên có thể trễ vài chục giây so với GitHub. Trong PR, job summary của `preview` luôn lấy dữ liệu mới nhất.
- Nếu branch protection yêu cầu PR cho `main` thì bot không đẩy trực tiếp được; khi đó cần cho phép github-actions bypass hoặc chuyển sang nhánh riêng.


## Roadmap tổng thể và nghiệm thu riêng (09/10/2026)

Giữ schema v1 và vai trò Claude/ChatGPT, không đổi binding CI/review head. phase chia backend/app_test/automated_test/deployment/owner_acceptance/operations/design. requires_own_design cần design PR của chính slice, không kế thừa kế hoạch tổng quát thành CODE_READY. start_after chặn việc mới nhưng giữ merged implementation PR; design_state được trình bày độc lập. Trạng thái blocked vẫn hiển thị PR đang chạy.

Owner acceptance khác CI: evidence PR phải merged, required CI xanh và có comment của owner_login trungtn87 đúng một dòng OWNER_ACCEPTED <task-id> <40-char-head-sha>. OWNER_REJECTED hoặc comment cho head cũ không mở gate. Collector đọc comments qua API, giữ identity/head/task, không suy từ title/body PR, không tự đăng comment thay Owner. Evidence phải mô tả bản đã test theo client/backend SHA, từng case và blocker/retest. Merge tài liệu hoặc thiết kế không đủ để coi Owner test.

module_delivery chỉ đủ khóa khi tất cả leaf DONE và có phần backend/app_test/automated_test/owner_acceptance. Module M01 còn SMS/admin/account; M01-UAT chỉ A1/A2 gate mở M02. Số task là gói, không module/công sức/thời gian. roadmap_complete chưa được chốt nên phần trăm vẫn planned-tasks-only. Snapshot thật ngày09/10 là evidence tái lập dashboard, không chứng nhận deploy/UAT.

Các test pre-roadmap dùng fixtures frozen để không sửa lịch sử; project-roadmap.test.mjs kiểm plan mới. Xem docs/roadmap/README.md, source-inventory.md và 13 checklist.
