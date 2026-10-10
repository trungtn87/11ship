# Prompt triển khai Claude - M00-3APP

Version 2.0.0; **HANDOFF_CANDIDATE**. Sao chép nguyên prompt dưới đây, kèm cả thư mục design và ảnh review. Prompt không tự cấp quyền merge/deploy/LOCK hoặc bỏ gate Owner UI của workflow.

```text
Bạn là người triển khai code/test M00-3APP của repo trungtn87/11ship. ChatGPT đã audit và thiết kế; bạn code, test và tạo Draft PR; Owner chạy PC/phone và duyệt merge/LOCK.

Preflight:
1. Fetch main và PR #46/#34/#35/#42, đọc AGENTS.md, workflow, README cùng docs/design/system-v2-20261011. Main audit là e5b50e8567b8928646c83648dd70f577915dc14f; không giả định HEAD không đổi. Báo base thực tế và diff sau audit. Chưa duyệt UI thì vẫn preflight/chuẩn bị test, không tự code giao diện khác mẫu.
2. Giữ branch implementation riêng. Kế thừa #46 cf9eecadb6d50ec061d525d1bdf9b3f50d6d062b, launcher #40 đã main; không viết lại từ đầu. Review dependencies Admin #34 08910ed92608d102da29d45ae1a8e5afd14dbcd1 / #35 7b116c3d4551bf0028fa544278449598acf5991c; #42 13a596254fed75544bfc1f461d48086c863e4c43 là integration candidate, không cherry-pick wholesale fixture/deploy code hoặc các nhánh stacked không liên quan. Refresh head khi bắt đầu.
3. Không chỉnh PR43/41/45 hoặc thiết kế schema nghiệp vụ mới trong M00. Chỉ kế thừa migration Admin Auth #34 đã review làm dependency, kiểm tương thích và giữ DEV confirmation; không kéo invitations/reset vào M00. Không tạo App Quán/App Quản lý. Chỉ Admin Web + Food khách/quán + Ship xế.

Phạm vi cần hoàn thành:
A. Sửa L01-L08 của 00-audit.md: CI wrappers đang đỏ; process ownership đúng PID/start/repo/script/fingerprint; backend/frontend được rebuild/restart đúng owned process khi source SHA hoặc fingerprint thay; frontend foreign HTTP200 không pass; chốt cwd; local TLS được kiểm; lock chung cho ba launchers; re-exec khi launcher tự update.
B. Hai shell chạy thật theo 01-m00.md và 03-ui-catalog.md: apps/food-web, apps/ship-web, shared UI tokens/health/navigation. Food/Ship Auth buttons chưa nối phải disabled/giải thích; không fake login/role/online/wallet/order/GPS. Không thêm CUSTOMER grant vào existing register trong M00.
C. Tích hợp Admin hiện có với local TLS/init-limit-config/bootstrap SYSTEM an toàn; login/password -> Google Authenticator thật -> shell -> server logout. Hành vi/Auth APIs giữ #34/#35, chỉ sửa nếu finding cụ thể và test/contract phù hợp.
D. Ba wrapper mở https://localhost:8443/8444/8445; backend http://127.0.0.1:3000; DEV5432/TEST5433 giữ guard. Auto update main fast-forward, auto browser, keep backend khi browser đóng. Owner UAT branch/full SHA riêng không auto update lén head đang test. Migration pending vẫn hỏi đích DEV theo launcher đã có.
E. Build manifest app_id/source_sha/fingerprint/design_version; readiness health body+manifest+ownership, state atomic. Status/Stop đủ3 apps, Stop giữ DEV; Test không đụng DEV. Tạo Desktop shortcuts từ đúng repo path; source/project folder unicode và spaces phải chạy được.

File scope:
tools/local/11Ship-{Admin,Food,Ship}.cmd, tools/local/11ship-app-launch.ps1; sửa có giới hạn tools/local/11ship-launcher.ps1; apps/food-web, apps/ship-web, apps/client-shared; scripts/{food,ship}-web-{build,dev}.mjs; root package scripts; tests/local-launcher, tests/client-shell; ops/runbooks/three-app-local-test.md; docs/evidence/M00-3APP.md. Admin files reuse reviewed source. Không product code ở design docs branch.

Tests bắt buộc:
- Real Git guarded update: clean-main/dirty/diverged/untracked collision/network failure/detached/unknown upstream/UAT SHA; không reset/stash.
- PowerShell5.1 Windows và7. Hai kiểu wrappers được test behavior; sửa list expected6->9 chỉ khi kiểm từng wrapper giữ exit codes, không pause riêng, và gọi đúng app.
- Concurrent launch3 apps dùng1 backend; old backend fingerprint mismatch; same-source re-launch reuse; foreign8443/8444/8445 with HTTP200 reject; stale PID/record corruption; cwd có dấu/khoảng trắng.
- Cert missing/expired/mismatch; build fail; migration decline/fail; backend live OK ready503; timeout/unparseable health; close browser keeps backend; Stop only owned and preserves DEV sentinel; technical Test preserves DEV sentinel.
- Browser UI360/390/430 và PC1366: đúng brand/navigation/loading/empty/offline/timeout/retry/stale responses; health/proxy real API+PG17; Admin TOTP/F5/logout thật. Không dùng fixtures/mock để chứng nhận business app đã hoạt động.

Chạy checks hiện hành từ package.json: lint, typecheck, build, test:unit, test:integration trên TEST có guard, launcher:test (Windows included), deploy:test/progress:test/progress:check khi phạm vi thay đổi đòi hỏi; thêm shell build/test. CI Verify và Windows phải success trên exact final HEAD. Không chạy destructive suite trên DEV/staging. Không bỏ skips/guards hoặc sửa tests chỉ để xanh.

Đầu ra:
Draft PR theo chức năng, final SHA, dependency và changed-files, code/CI/browser smoke evidence; runbook setup một lần và chỉ double-click sau đó; checksum/version các build; bảng Owner UAT theo M00-UAT.md với actual còn trống; open findings/limits. Không viết Owner PASS, không auto merge/enable auto-merge/deploy production/LOCK. Bản PC chuyển Owner trước; phone là gate riêng theo scope.

PASS chỉ khi ba cửa sổ thật mở và backend/DB/version đúng, Admin Auth thật, hai app shell đúng UI và hết findings. CI xanh một mình chưa hoàn thành M00. Report BLOCKED dependency hoặc cần decision có tên, vẫn hoàn thiện việc độc lập còn được phép.
```

## Thứ tự PR đề nghị

1. Update #46 cho orchestration/test đã review (hoặc branch kế thừa rõ và đóng bản cũ sau Owner quyết định).
2. Food shell / Ship shell riêng commits; có thể trong một integration PR M00-3APP nhưng giữ chức năng tách để review.
3. Admin integration chỉ các slice reviewed, dependency recorded, không merge source Draft tự động.
4. Exact integration candidate -> review -> Owner PC. Giữ Draft đến Owner merge authorization.
