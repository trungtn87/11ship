# Evidence — tái lập kế hoạch bàn giao module

Ngày 08/10/2026. Phạm vi PR #20: kế hoạch, checklist, manifest, trình bày dashboard và regression tests cho kế hoạch. Không triển khai runtime local, frontend hoặc nghiệp vụ M02 trong PR này.

## Nguồn và quyết định

- Lịch sử backend giữ nguyên pin của 9 leaf; M01-R1 đã merge qua #19, merge commit e84427649208aae20ace2f81a80e5a6a1464cc95.
- UI M01 tham chiếu #14; M02-A tham chiếu #18; môi trường M00-LOCAL tham chiếu thiết kế #20. Không coi merge workflow UI là Owner đã duyệt mọi frame.
- Checklist M00/M01/M02 và mẫu cho module tiếp theo nằm trong docs/tasks/module-delivery-workflow.md cùng ba file *-delivery-checklist.md.
- 33 leaf mới bổ sung vào 9 leaf lịch sử. roadmap_complete=false. Các gói chưa có spec/PR thiết kế tiếp tục PLANNED.
- Thiết kế M02-A chạy song song môi trường local và UI M01. Backend M02-A không chờ M01-UAT; UI/E2E/UAT vẫn giữ dependency thực tế.

## Kiểm chứng

- Local: Node test runner, `node --test tests/progress/*.test.mjs`: 181/181, 29 suites, không skip.
- Giữ bộ regression 46 case của mô hình repair trong repair-plan.test.mjs với fixture plan-2026-10-08-repairs.yml. Bộ current-plan kiểm manifest mới, lịch sử pin, không báo hoàn tất module khi chỉ backend xong, dependency song song, UAT bị chặn, checklist paths và dashboard mới.
- Dashboard được sinh bằng collector hiện có trên các response GitHub REST thật lưu tạm; không gán thủ công trạng thái PR/CI. Snapshot gồm 20 PR; main HEAD 89ad78125ab4cf1a5698ccc376bdd4b7a53e8c25. Collector xác thực 6 commit progress-bot chỉ đổi PROGRESS.md rồi đọc required CI SUCCESS tại e84427649208aae20ace2f81a80e5a6a1464cc95.
- `node scripts/generate-progress.mjs --snapshot /tmp/11ship-snapshot.json --check` xác nhận dashboard khớp cùng snapshot. Đây là kiểm tái lập snapshot, không phải lời hứa GitHub không đổi sau lúc đọc.
- Kết quả snapshot: 9/42 tổng gói, M00 5/12, M01 4/22, M02 0/8. Mẫu số tăng do bổ sung phần còn thiếu, không xóa thành quả backend.
- Không chạy lại backend Jest/PostgreSQL trong phiên lập kế hoạch. CI backend lịch sử không được dùng để khẳng định runtime/UI/UAT đã có.

## Việc còn phải khóa trước implementation

- M00: contract port/HTTPS Android, cấu hình local, seed/OTP/reset.
- M01: frontend/session-storage ADR và frame UI_LOCKED; thiết kế riêng B/C/D.
- M02: lựa chọn lịch hoạt động và contract sau R1 trong #18; thiết kế menu riêng.
- Owner nghiệm thu thực tế trên đúng SHA sau khi các bản chạy đã được triển khai.
