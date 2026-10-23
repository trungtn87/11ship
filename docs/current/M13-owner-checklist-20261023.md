# M13 — Checklist Owner (ngắn)

Cần cung cấp để kích hoạt (không chặn code/PR):
- [ ] Webhook Discord cho backend (nhập trong Admin Web › Cấu hình) và webhook riêng cho probe.
- [ ] Máy chạy probe ngoài VPS.
- [ ] `OPS_ARTIFACT_DIR` trên VPS + các biến `OPS_*` (mẫu `ops/vinahost/ops.env.example`).
- [ ] Khóa nhận báo cáo: PROBE, BACKUP, DEPLOY (`ops:ctl`), và chỗ gọi `ops-report.mjs`.
- [ ] Quyền triển khai: migration `1795737600000_create-m13-ops` + grants + restart (runbook VPS).
- [ ] Chọn ADMIN được xem/xử lý sự cố (mặc định không ai ngoài SYSTEM).

Thử sau khi bật: 6 màn hình Admin Web mở được theo quyền; Gửi thử Discord; điện thoại Gateway hiện pin/SIM/phiên bản; đăng ký một bản Gateway/11Food/11Ship mới và cập nhật trên máy thật (tải → SHA-256 → trình cài đặt Android).
