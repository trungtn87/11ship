# M13 — Báo cáo sao lưu và triển khai

M13 **chỉ ghi nhận và theo dõi**; việc sao lưu/triển khai vẫn do quy trình hiện có làm. Không có nút triển khai máy chủ trong Admin Web.

Khóa: `npm run ops:ctl -- ingest-key create --label backup --scope BACKUP` và `--label deploy --scope DEPLOY` (mỗi khóa một phạm vi; in một lần). Lưu vào tệp 0600, dùng `OPS_INGEST_TOKEN_FILE`.

```
export OPS_INGEST_BASE=https://<host>/v1/ops/ingest OPS_INGEST_TOKEN_FILE=/etc/11ship/ops-backup-token
node scripts/ops-report.mjs backup --ok --size-bytes 123456      # hoặc: backup --fail --code DISK_FULL
node scripts/ops-report.mjs restore-test --ok

export OPS_INGEST_TOKEN_FILE=/etc/11ship/ops-deploy-token
id=$(node scripts/ops-report.mjs deploy-start --component BACKEND --to <ver> --from <ver> [--db-migration])
node scripts/ops-report.mjs deploy-finish --id "$id" --status SUCCEEDED --health PASSED   # FAILED | ROLLED_BACK
```
Thiếu báo cáo sao lưu quá hạn → cảnh báo "chưa có sao lưu"; không có báo cáo = "Chưa có dữ liệu", không phải đạt. Chưa gắn vào cron/CI nào: Owner quyết định chỗ gọi.
