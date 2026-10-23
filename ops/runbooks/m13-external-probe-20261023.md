# M13 — Probe độc lập bên ngoài

Mục đích: biết khi API công khai không truy cập được **từ bên ngoài**, kể cả khi chính VPS (và Discord của backend) không báo được. **Phải chạy ở máy khác VPS**; đặt cùng VPS thì không còn độc lập.

## Cài (máy ngoài, Node >= 20, không phụ thuộc gói)
1. Chép `ops/external-probe/probe.mjs` tới `/opt/11ship-probe/`, `config.example.json` → `/etc/11ship-probe/config.json` (sửa `target_url`, `m13_ingest_url`), unit `11ship-probe.service` → `/etc/systemd/system/`. Tạo user `ship11probe`, thư mục `/var/lib/11ship-probe`.
2. Webhook Discord riêng cho probe: ghi vào `/etc/11ship-probe/discord-webhook` (quyền 0600). Không đặt trong JSON.
3. Trên VPS (shell vận hành, có biến DB của migrator): `npm run ops:ctl -- ingest-key create --label probe --scope PROBE` — in khóa **một lần**; lưu vào `/etc/11ship-probe/ingest-token` (0600). Thu hồi: `ingest-key revoke --key-id <uuid>`; liệt kê: `ingest-key list`.
4. `systemctl enable --now 11ship-probe`.

## Hành vi (theo thiết kế đã duyệt)
Kiểm tra mỗi 60 giây, timeout 10 giây; 3 lần hỏng liên tiếp = sự cố, 2 lần đạt liên tiếp = phục hồi; heartbeat 300 giây. Gửi Discord trực tiếp. Khi VPS trả lời lại, báo đợt gián đoạn cho M13 qua `/v1/ops/ingest/probe`. Chỉ nói điều đã đo: "không truy cập được API công khai từ bên ngoài", không khẳng định nguyên nhân.

## Chưa kích hoạt
Chưa có máy chủ probe, webhook hay khóa nào được tạo. Cần Owner cung cấp (xem checklist).
