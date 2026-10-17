# M04-A1 — Lõi ví Shipper & sổ giao dịch (17/10/2026)

Nhánh `feat/m04-a1-wallet-core`, base `0dc483f` (main sau merge PR #124). Theo ADR-004 bản 0.2. Chỉ nền dữ liệu và participant nội bộ: **không endpoint, không nạp/rút/điều chỉnh/hoa hồng/hold, không đổi UI, không đụng M07, không deploy VPS, không chạy migration production.**

## Bảng và ràng buộc (migration `1793404800000_create-driver-wallet-core.sql`)
| Bảng | Nội dung |
|---|---|
| `app.driver_wallets` | PK `wallet_id`; `driver_id` UNIQUE NOT NULL, FK `app.drivers` ON DELETE RESTRICT (một ví/Shipper, chống tạo trùng khi đồng thời); `balance_vnd` (B), `held_vnd` (H), `version` bigint; CHECK `0<=H<=B<=9007199254740991`, `version>=1`, `updated_at>=created_at`. A = B−H tính ra, không lưu. |
| `app.wallet_ledger_entries` | PK `entry_id`; `wallet_id` FK RESTRICT; `sequence_no` UNIQUE theo ví, từ 1 liên tục; `entry_kind` ∈ TOPUP / WITHDRAWAL_DEBIT / COMMISSION_DEBIT / ADJUSTMENT_CREDIT / ADJUSTMENT_DEBIT; `delta_vnd` ≠ 0, dấu đúng kind; `balance_after_vnd` ≥ 0. Reserve/release không phải dòng ledger (chỉ đổi H) theo ADR-004 4.1. |

Trigger/hàm: `driver_wallets_guard` (chỉ tạo ở 0đ; danh tính bất biến; mỗi UPDATE tăng version đúng 1), `driver_wallets_no_delete` (DELETE/TRUNCATE bị chặn), `wallet_ledger_append_only` (UPDATE/DELETE/TRUNCATE bị chặn, cả khi không khớp dòng nào), `wallet_ledger_a_source_gate` (từ chối mọi INSERT ledger — xem dưới), `wallet_ledger_chain` (khóa ví; sequence = cuối+1; balance_after = trước + delta), và hai constraint trigger DEFERRED `driver_wallets_invariants` / `wallet_ledger_invariants` gọi `app.wallet_assert_invariants`: **số dư = SUM(ledger) = balance_after dòng cuối; held = 0** (chưa có hold). Lệch → `WALLET_INVARIANT_VIOLATION`, rollback cả transaction, không tự sửa. Số dư cache không bao giờ là nguồn quyết định: tổng ledger được tính lại tại commit.

## Không ghi được tiền đầu tiên khi chưa có chứng từ nguồn
Mọi dòng ledger cần nguồn hợp lệ (topup, rút, hoa hồng/assignment, adjustment) nhưng các bảng nguồn thuộc gói sau. Vì vậy trong A1 ledger **không có cột nguồn** và cổng `wallet_ledger_a_source_gate` từ chối mọi INSERT (`WALLET_LEDGER_SOURCE_NOT_AVAILABLE`); ví chỉ có thể ở 0đ. Không dùng `source_id` đa hình thiếu FK. Lộ trình từng bước (cũng ghi trong migration): migration của gói tạo bảng nguồn phải trong **một transaction** (1) khẳng định ledger còn rỗng, (2) thêm cột nguồn có FK thật + CHECK đúng một nguồn khớp `entry_kind` + UNIQUE theo nguồn, (3) thay `wallet_ledger_source_gate()` chỉ cho phép dòng có nguồn tồn tại cùng ví/số tiền; A2 thay điều kiện `held = 0` bằng `H = SUM(hold ACTIVE)`. Không có thời điểm nào ghi được ledger thiếu nguồn.

## API / port nội bộ (`apps/backend/src/wallet`)
- `WalletService.readWallet(context, driverId)`: chỉ đọc; Shipper chưa có ví → `{provisioned:false, 0n, 0n, 0n}` (GET không tạo ví).
- `WalletService.ensureZeroWallet(context, driverId)`: khóa driver (`DriverRepository.lockById`) rồi tạo ví 0đ nếu chưa có (UNIQUE + `ON CONFLICT DO NOTHING`); driver không tồn tại → `DRIVER_NOT_FOUND`. Không tạo tiền, không ledger.
- Tất cả nhận `TransactionContext` của người gọi: không mở/commit transaction, không giữ pool, không gọi mạng. Số tiền là `bigint` ở cả PostgreSQL và TypeScript.
- Không controller, không route, chưa đăng ký trong `AppModule`. `DRIVER_WALLET_PORT` giữ `NotIntegratedDriverWalletPort`: có ví (kể cả 0đ) **không** bật `readinessForOrders` và **không** cho đóng hồ sơ tự động.
- Quyền runtime (`ops/selfhosted/02-runtime-grants.sql`, runbook): `driver_wallets` SELECT+INSERT, `wallet_ledger_entries` SELECT. Chưa có UPDATE ví, INSERT ledger, DELETE.

## Test (PostgreSQL thật; CI dùng PostgreSQL 17)
`tests/integration/m04-wallet-core.int.spec.ts`: (1) chưa provision đọc 0 không tạo ví; (2) tạo đúng một lần; (3) hai yêu cầu đồng thời → một ví (barrier trên khóa driver); (4) driver không tồn tại; (5) không âm; (6) held ≤ B; (7) ledger không sửa/xóa/truncate; (8) không ledger mồ côi (kể cả cặp với số dư trong cùng transaction); (9) số dư ≠ ledger → rollback; (10) lỗi giữa transaction không để lại gì; chuỗi/dấu/ledger khi gỡ cổng **chỉ trong transaction rollback**; (11) M03 không đổi (driver, bank, events, tham số) và port vẫn "chưa sẵn sàng"; (12) không có route tiền. Cộng `wallet-types.spec.ts`, `wallet-boundary.spec.ts`, kiểm tra grants.

## Đề xuất điều chỉnh so với ADR-004 (ghi trước khi triển khai, không nới invariant)
1. Ledger ở A1 chưa có cột nguồn; cột nguồn có FK (mỗi loại một cột) được thêm bởi migration của gói tạo bảng nguồn, theo lộ trình trên. ADR-004 4.2 vẫn là đích.
2. `held_vnd = 0` được cưỡng chế bằng trigger cho tới khi A2 có `wallet_holds`.
3. Thêm `wallet_ledger_chain` (sequence liên tục + balance_after) — chặt hơn ADR, không nới.

## Phụ thuộc còn lại cho M04-A2
`wallet_holds` (UNIQUE (purpose, reference_id), ACTIVE→CAPTURED/RELEASED một lần) và thay điều kiện H; lệnh reserve/capture/release trong `WalletService` (khóa driver → ví); grant UPDATE ví; nối `DRIVER_WALLET_PORT` thật (readiness theo A, settlement theo hold/rút/số dư + guard M07); quyền Admin tài chính theo từng chức năng (backend `grantsFromPermissions`); bảng nguồn ledger (M04-B topup/bank registry, M04-C withdrawal, adjustment); M07 assignment FK cho hold hoa hồng.

## Điều kiện triển khai database production về sau
Chỉ khi Owner cho phép: sao lưu trước; migration chạy bằng role migrator (`npm run db:migrate:remote`), chỉ thêm 2 bảng + hàm/trigger, không đụng dữ liệu M03; sau đó chạy lại `02-runtime-grants.sql` (hai dòng mới); không dùng down migration trên dữ liệu thật; xác nhận role runtime không có DDL/DISABLE TRIGGER; kiểm tra sau migration: hai bảng rỗng, 4 trigger của ledger ở trạng thái enabled (`tgenabled='O'`).

## Client Shell CI trên base mới
(Xem báo cáo trong PR.)
