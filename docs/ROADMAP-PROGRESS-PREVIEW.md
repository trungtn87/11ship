> Preview tự động từ snapshot inventory 09/10/2026, không phải dashboard live. Reproduce bằng generator + fixture ghi trong evidence. Dashboard live vẫn do bot quản lý.

<!-- AUTO-GENERATED — DO NOT EDIT MANUALLY. Source: docs/progress/plan.yml + GitHub. Generator: scripts/generate-progress.mjs -->

# 11Ship — Tiến độ dự án

> **TỰ ĐỘNG TẠO — KHÔNG SỬA THỦ CÔNG**
>
> Kế hoạch nằm trong [`docs/progress/plan.yml`](progress/plan.yml); trạng thái được suy ra từ GitHub (PR đã merge, draft/open/closed, label, head SHA, required check và dependency). Không ai, kể cả người hay AI, có thể tự ghi một task thành HOÀN THÀNH. Xem [cách suy ra trạng thái](progress/README.md).
> Dữ liệu theo mã main `75760bd` (HEAD là commit progress-bot chỉ sửa tài liệu; CI được đọc từ commit mã này) · CI main: ✅ Đạt (`PASS`)

## 🎯 VIỆC ĐANG LÀM

| | |
|---|---|
| **Task** | **M00-D2 — Test accounts without real SMS** |
| **Trạng thái** | 📐 Đang thiết kế (`DESIGNING`) |
| **Người phụ trách** | 🟣 **CHATGPT** |
| **ChatGPT** | Đang thiết kế |
| **Claude** | Đã có code/PR [#27](https://github.com/trungtn87/11ship/pull/27); vẫn phải xử lý gate hiện tại |
| **Chủ dự án** | Không cần thao tác |
| **Đang bị chặn bởi** | Không |
| **Điều kiện sang bước tiếp** | PR thiết kế sẵn sàng review |
| **PR đang hoạt động** | PR #26 |

## Tiến độ

Tính theo trọng số task trong kế hoạch (mỗi task lá = 1 nếu không ghi khác). Commit, số dòng code và PR đã hủy không được tính. Phần trăm được làm tròn xuống.

| Phạm vi | Hoàn thành / tổng |
|---|---|
| Milestone hiện tại — M00 Nền tảng | 6 / 22 (27%) |
| Toàn bộ — chỉ tính task đã lập kế hoạch (roadmap chưa chốt hết) | 11 / 121 (9%) |
| Module M01 Tài khoản và quyền | 4 / 23 (17%) |
| Module M02 Vùng và quán | 1 / 9 (11%) |
| Module M03 Hồ sơ và vòng đời xế | 0 / 9 (0%) |
| Module M04 Ví, nạp, rút và đối soát | 0 / 9 (0%) |
| Module M05 Khách và địa chỉ | 0 / 4 (0%) |
| Module M06 Phí, tuyến và điều kiện nhận | 0 / 5 (0%) |
| Module M07 Delivery và tìm xế | 0 / 6 (0%) |
| Module M08 GPS và thông báo | 0 / 6 (0%) |
| Module M09 Thực đơn | 0 / 4 (0%) |
| Module M10 Order khách | 0 / 6 (0%) |
| Module M11 Đánh giá và phản ánh | 0 / 5 (0%) |
| Module M12 Quản trị và vận hành | 0 / 13 (0%) |

## Trạng thái từng phần của module

Số gói đã đủ bằng chứng / số gói trong phần đó. Backend CI xanh chỉ hoàn tất gói backend. Khóa module cần đủ app test, test và xác nhận Owner; không suy ra từ phần trăm. Thiết kế nằm ở cột riêng của bảng task.

| Module | Backend | App test | Test tự động | Deploy | Owner nghiệm thu | Khóa module |
|---|---|---|---|---|---|---|
| M00 | 6/8 | 0/2 | 0/3 | 0/2 | 0/2 | Chưa |
| M01 | 4/10 | 0/5 | 0/4 | — | 0/4 | Chưa |
| M02 | 1/3 | 0/2 | 0/2 | — | 0/2 | Chưa |
| M03 | 0/3 | 0/2 | 0/2 | — | 0/2 | Chưa |
| M04 | 0/5 | 0/1 | 0/1 | — | 0/2 | Chưa |
| M05 | 0/1 | 0/1 | 0/1 | — | 0/1 | Chưa |
| M06 | 0/2 | 0/1 | 0/1 | — | 0/1 | Chưa |
| M07 | 0/3 | 0/1 | 0/1 | — | 0/1 | Chưa |
| M08 | 0/3 | 0/1 | 0/1 | — | 0/1 | Chưa |
| M09 | 0/1 | 0/1 | 0/1 | — | 0/1 | Chưa |
| M10 | 0/3 | 0/1 | 0/1 | — | 0/1 | Chưa |
| M11 | 0/2 | 0/1 | 0/1 | — | 0/1 | Chưa |
| M12 | 0/2 | 0/2 | 0/4 | — | 0/3 | Chưa |

Gate M01 → code mới M02: cần M01-UAT. M02-A-BE đã merge #21 giữ nguyên lịch sử; start gate chỉ chặn việc mới. M02-AREA-READ là prerequisite tối thiểu cho onboarding M01, không mở các nghiệp vụ M02 khác.

[Roadmap, milestone và quyết định còn mở](roadmap/README.md) · [Kiểm kê nguồn](roadmap/source-inventory.md)

| Task | Thiết kế | Phần việc | Gate bắt đầu còn thiếu | Code đã merge / PR đang chạy |
|---|---|---|---|---|
| M00-B1 | 🔒 Thiết kế đã khóa (`DESIGN_LOCKED`) [#1](https://github.com/trungtn87/11ship/pull/1) | backend | — | [#2](https://github.com/trungtn87/11ship/pull/2) / — |
| M00-C1A0 | 🔒 Thiết kế đã khóa (`DESIGN_LOCKED`) [#3](https://github.com/trungtn87/11ship/pull/3) | backend | — | [#4](https://github.com/trungtn87/11ship/pull/4) / — |
| M00-C1A1 | 🔒 Thiết kế đã khóa (`DESIGN_LOCKED`) [#3](https://github.com/trungtn87/11ship/pull/3) | backend | — | [#6](https://github.com/trungtn87/11ship/pull/6) / — |
| M00-C1B | 🔒 Thiết kế đã khóa (`DESIGN_LOCKED`) [#3](https://github.com/trungtn87/11ship/pull/3) | backend | — | [#9](https://github.com/trungtn87/11ship/pull/9) / — |
| M00-C1C | 🔒 Thiết kế đã khóa (`DESIGN_LOCKED`) [#3](https://github.com/trungtn87/11ship/pull/3) | backend | — | [#10](https://github.com/trungtn87/11ship/pull/10) / — |
| M01-A1 | 🔒 Thiết kế đã khóa (`DESIGN_LOCKED`) [#11](https://github.com/trungtn87/11ship/pull/11) | backend | — | [#12](https://github.com/trungtn87/11ship/pull/12) / — |
| M01-A2S | 🔒 Thiết kế đã khóa (`DESIGN_LOCKED`) [#15](https://github.com/trungtn87/11ship/pull/15) | backend | — | [#16](https://github.com/trungtn87/11ship/pull/16) / — |
| M01-A2D | 🔒 Thiết kế đã khóa (`DESIGN_LOCKED`) [#15](https://github.com/trungtn87/11ship/pull/15) | backend | — | [#17](https://github.com/trungtn87/11ship/pull/17) / — |
| M01-R1 | 🔒 Thiết kế đã khóa (`DESIGN_LOCKED`) [#19](https://github.com/trungtn87/11ship/pull/19) | backend | — | [#19](https://github.com/trungtn87/11ship/pull/19) / — |
| M00-D1 | 🔒 Thiết kế đã khóa (`DESIGN_LOCKED`) [#22](https://github.com/trungtn87/11ship/pull/22) | backend | — | [#25](https://github.com/trungtn87/11ship/pull/25) / — |
| M00-D2 | 📐 Đang thiết kế (`DESIGNING`) [#26](https://github.com/trungtn87/11ship/pull/26) | backend | — | — / [#27](https://github.com/trungtn87/11ship/pull/27) |
| M00-D3 | 📝 Đã lên kế hoạch (`PLANNED`) — | operations | — | — / — |
| M00-D4 | 📝 Đã lên kế hoạch (`PLANNED`) — | deployment | — | — / — |
| M00-D5 | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M00-LOCAL-RUN | 📝 Đã lên kế hoạch (`PLANNED`) — | operations | — | — / — |
| M00-LOCAL-DATA | 📝 Đã lên kế hoạch (`PLANNED`) — | operations | — | — / — |
| M00-LOCAL-QA | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M00-LOCAL-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M01-UI-AUTH | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M01-UI-ONBOARD | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M01-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M01-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M01-B-LOGOUT | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | — | — / — |
| M01-B-PASSWORD | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | — | — / — |
| M01-B-PHONE | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | — | — / — |
| M01-B-UI | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M01-B-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M01-B-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M01-C-SMS | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M12-FIGMA-UAT | — / — |
| M01-C-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M01-C-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M01-D-ACCESS | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | — | — / — |
| M01-D-2FA | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | — | — / — |
| M01-D-UI | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M01-D-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M01-D-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M02-A-BE | 🔒 Thiết kế đã khóa (`DESIGN_LOCKED`) [#18](https://github.com/trungtn87/11ship/pull/18) | backend | M01-UAT | [#21](https://github.com/trungtn87/11ship/pull/21) / — |
| M02-A-UI | 📐 Đang thiết kế (`DESIGNING`) [#23](https://github.com/trungtn87/11ship/pull/23) | app_test | M01-UAT | — / — |
| M02-A-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M02-A-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M02-B-BE | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | — | — / — |
| M02-B-UI | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M02-B-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M02-B-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M00-OPS-WORKER | 📝 Đã lên kế hoạch (`PLANNED`) — | operations | — | — / — |
| M00-OPS-CLEANUP | 📝 Đã lên kế hoạch (`PLANNED`) — | operations | — | — / — |
| M00-OPS-RELEASE | 📝 Đã lên kế hoạch (`PLANNED`) — | deployment | — | — / — |
| M01-FE0 | 📐 Đang thiết kế (`DESIGNING`) [#24](https://github.com/trungtn87/11ship/pull/24) | app_test | — | — / — |
| M02-AREA-READ | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | — | — / — |
| M02-AREAS | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | — | — / — |
| M02-AREAS-APP | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M02-AREAS-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M02-AREAS-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M00-UPLOAD | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | — | — / — |
| M00-TEST-SHELL | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M00-TEST-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M03-A | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M04-A1 | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M04-A2 | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M04-B | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M03-B1 | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M04-C1 | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M04-C2 | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M05-A | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M08-A | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M06-A | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M06-B | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M07-A | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT, M03-ACTIVATION-UAT, M04-MONEY-UAT | — / — |
| M07-B | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M07-C | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M03-B2 | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M08-B | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M10-A | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M10-B | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M10-C | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M08-ORDER-ADAPTER | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M11-A | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M11-B | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M12-A | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M12-B | 📝 Đã lên kế hoạch (`PLANNED`) — | backend | M01-UAT | — / — |
| M03-APP | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M03-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M03-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M04-APP | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M04-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M04-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M05-APP | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M05-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M05-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M06-APP | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M06-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M06-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M07-APP | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M07-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M07-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M08-APP | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M08-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M08-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M10-APP | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M10-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M10-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M11-APP | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M11-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M11-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M12-APP | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M12-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M12-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M03-ACTIVATION-APP | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M03-ACTIVATION-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M03-ACTIVATION-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M04-MONEY-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M00-NATIVE-CLIENTS | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M00-NATIVE-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M12-FIGMA | 📝 Đã lên kế hoạch (`PLANNED`) — | design | — | — / — |
| M12-FIGMA-IMPLEMENT | 📝 Đã lên kế hoạch (`PLANNED`) — | app_test | — | — / — |
| M12-FIGMA-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |
| M12-SYSTEM-E2E | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M12-SECURITY-MONEY | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M12-RESTORE | 📝 Đã lên kế hoạch (`PLANNED`) — | operations | — | — / — |
| M12-LOAD | 📝 Đã lên kế hoạch (`PLANNED`) — | automated_test | — | — / — |
| M12-RELEASE-UAT | 📝 Đã lên kế hoạch (`PLANNED`) — | owner_acceptance | — | — / — |

## Cây tiến độ

Mũi tên liền là dependency, mũi tên nét đứt là task cha → task con đầu tiên. Viền vàng đậm là việc đang làm.

Xem dependency đầy đủ trong bảng task và manifest; roadmap dùng sơ đồ milestone riêng để tránh cây 100+ task khó đọc.

## Chi tiết công việc

| Task | Trạng thái | Người phụ trách | PR | CI | Head | Dependency | Việc tiếp theo |
|---|---|---|---|---|---|---|---|
| M00-B1 · Nền tảng Backend | ✅ Hoàn thành (`DONE`) | — | [#2](https://github.com/trungtn87/11ship/pull/2) | ✅ Đạt (`PASS`) | `55c5d81` | — | — |
| **M00-C1** thiết kế · Lõi giao dịch | ✅ Hoàn thành (`DONE`) | — | [#3](https://github.com/trungtn87/11ship/pull/3) | ✅ Đạt (`PASS`) | `de82b15` | B1 Hoàn thành (DONE) | — |
| &nbsp;&nbsp;M00-C1A0 · Giao dịch + primitive dùng chung | ✅ Hoàn thành (`DONE`) | — | [#4](https://github.com/trungtn87/11ship/pull/4) | ✅ Đạt (`PASS`) | `688e796` | — | — |
| &nbsp;&nbsp;M00-C1A1 · Chống xử lý lặp (Idempotency) | ✅ Hoàn thành (`DONE`) | — | [#6](https://github.com/trungtn87/11ship/pull/6) | ✅ Đạt (`PASS`) | `44c0fa7` | C1A0 Hoàn thành (DONE) | — |
| &nbsp;&nbsp;M00-C1B · Audit + ghi Outbox | ✅ Hoàn thành (`DONE`) | — | [#9](https://github.com/trungtn87/11ship/pull/9) | ✅ Đạt (`PASS`) | `b418fd2` | C1A1 Hoàn thành (DONE) | — |
| &nbsp;&nbsp;M00-C1C · Dispatcher + tích hợp cuối | ✅ Hoàn thành (`DONE`) | — | [#10](https://github.com/trungtn87/11ship/pull/10) | ✅ Đạt (`PASS`) | `172931b` | C1B Hoàn thành (DONE) | — |
| M01-A1 · Lõi xác thực (Auth Core) | ✅ Hoàn thành (`DONE`) | — | [#12](https://github.com/trungtn87/11ship/pull/12) | ✅ Đạt (`PASS`) | `ef3afd4` | C1C Hoàn thành (DONE) | — |
| **M01-A2** thiết kế · Onboarding (Quán + Tài xế) | ✅ Hoàn thành (`DONE`) | — | [#15](https://github.com/trungtn87/11ship/pull/15) | ✅ Đạt (`PASS`) | `c329808` | A1 Hoàn thành (DONE) | — |
| &nbsp;&nbsp;M01-A2S · Onboarding quán (Shop) | ✅ Hoàn thành (`DONE`) | — | [#16](https://github.com/trungtn87/11ship/pull/16) | ✅ Đạt (`PASS`) | `620333f` | — | — |
| &nbsp;&nbsp;M01-A2D · Onboarding tài xế (Driver) | ✅ Hoàn thành (`DONE`) | — | [#17](https://github.com/trungtn87/11ship/pull/17) | ✅ Đạt (`PASS`) | `c37082a` | A2S Hoàn thành (DONE) | — |
| M01-R1 · Sửa sau merge (session, rollback, router, tiến độ) | ✅ Hoàn thành (`DONE`) | — | [#19](https://github.com/trungtn87/11ship/pull/19) | ✅ Đạt (`PASS`) | `cd0e6de` | A2 Hoàn thành (DONE) | — |
| **M00-D** thiết kế · Render Free + Supabase staging | 🔒 Thiết kế đã khóa (`DESIGN_LOCKED`) | — | [#22](https://github.com/trungtn87/11ship/pull/22) | ✅ Đạt (`PASS`) | `a846a68` | C1C Hoàn thành (DONE) | Tiếp tục các task con |
| &nbsp;&nbsp;M00-D1 · Connection and deploy configuration | ✅ Hoàn thành (`DONE`) | — | [#25](https://github.com/trungtn87/11ship/pull/25) | ✅ Đạt (`PASS`) | `44dbf10` | — | — |
| &nbsp;&nbsp;M00-D2 · Test accounts without real SMS | 📐 Đang thiết kế (`DESIGNING`) | ChatGPT | [#26](https://github.com/trungtn87/11ship/pull/26) | ✅ Đạt (`PASS`) | `fe235cc` | D1 Hoàn thành (DONE) | ChatGPT hoàn tất PR thiết kế #26 |
| &nbsp;&nbsp;M00-D3 · Operations and portability | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | D1 Hoàn thành (DONE) | ChatGPT thiết kế |
| &nbsp;&nbsp;M00-D4 · Remote deployment acceptance | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | D2 Đang thiết kế (DESIGNING), D3 Đã lên kế hoạch (PLANNED) | Chờ D2, D3 |
| &nbsp;&nbsp;M00-D5 · Owner acceptance of the staging backend | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | D4 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), TEST-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ D4, TEST-E2E |
| **M00-LOCAL** thiết kế · Môi trường test local | 📐 Đang thiết kế (`DESIGNING`) | ChatGPT | [#20](https://github.com/trungtn87/11ship/pull/20) | ⏳ Đang chạy (`RUNNING`) | `78cb319` | R1 Hoàn thành (DONE) | ChatGPT hoàn tất PR thiết kế #20 |
| &nbsp;&nbsp;M00-LOCAL-RUN · Backend và PostgreSQL chạy local | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | — | ChatGPT thiết kế |
| &nbsp;&nbsp;M00-LOCAL-DATA · Dữ liệu mẫu và OTP dành cho bản thử | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | LOCAL-RUN Đã lên kế hoạch (PLANNED) | Chờ LOCAL-RUN |
| &nbsp;&nbsp;M00-LOCAL-QA · Kiểm chứng môi trường và khôi phục dữ liệu | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | LOCAL-DATA Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ LOCAL-DATA |
| &nbsp;&nbsp;M00-LOCAL-UAT · Owner nghiệm thu môi trường local | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | LOCAL-QA Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ LOCAL-QA |
| **M01-UI** thiết kế · Thiết kế và triển khai UI Auth + onboarding | 🧐 Chờ duyệt thiết kế (`DESIGN_REVIEW`) | Chủ dự án | [#14](https://github.com/trungtn87/11ship/pull/14) | ✅ Đạt (`PASS`) | `0d16d7b` | R1 Hoàn thành (DONE) | Chủ dự án duyệt và khóa PR thiết kế #14 |
| &nbsp;&nbsp;M01-UI-AUTH · UI đăng ký, đăng nhập và chọn vai trò | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | D4 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), FE0 Đang thiết kế (DESIGNING) | Chờ D4, FE0 |
| &nbsp;&nbsp;M01-UI-ONBOARD · UI hồ sơ quán và hồ sơ xế | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | UI-AUTH Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), AREA-READ Đã lên kế hoạch (PLANNED) | Chờ UI-AUTH, AREA-READ |
| **M01-TEST** thiết kế · Kiểm thử và nghiệm thu M01-A1/A2 | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | R1 Hoàn thành (DONE) | ChatGPT thiết kế |
| &nbsp;&nbsp;M01-E2E · Test đầu cuối Auth và onboarding | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | UI-ONBOARD Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D5 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ UI-ONBOARD, D5 |
| &nbsp;&nbsp;M01-UAT · Owner nghiệm thu đầy đủ M01 trên staging (SMS thật khóa) | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ E2E, B-UAT, D-UAT |
| **M01-B** thiết kế · Nghiệp vụ bổ sung: tài khoản và phiên | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | R1 Hoàn thành (DONE) | ChatGPT thiết kế |
| &nbsp;&nbsp;M01-B-LOGOUT · Backend đăng xuất và thu hồi phiên | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | — | ChatGPT thiết kế |
| &nbsp;&nbsp;M01-B-PASSWORD · Backend đổi và khôi phục mật khẩu | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-LOGOUT Đã lên kế hoạch (PLANNED) | Chờ B-LOGOUT |
| &nbsp;&nbsp;M01-B-PHONE · Backend đổi số điện thoại đã xác minh | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-PASSWORD Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B-PASSWORD |
| &nbsp;&nbsp;M01-B-UI · UI quản lý tài khoản và phiên | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-PHONE Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), UI-AUTH Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B-PHONE, UI-AUTH |
| &nbsp;&nbsp;M01-B-E2E · Test đầu cuối tài khoản và phiên | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-UI Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D5 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B-UI, D5 |
| &nbsp;&nbsp;M01-B-UAT · Owner nghiệm thu tài khoản và phiên | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B-E2E |
| **M01-C** thiết kế · Nghiệp vụ bổ sung: SMS thật và chống lạm dụng | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | R1 Hoàn thành (DONE) | ChatGPT thiết kế |
| &nbsp;&nbsp;M01-C-SMS · Adapter SMS và giới hạn gửi/thử thật | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | — | Chờ FIGMA-UAT |
| &nbsp;&nbsp;M01-C-E2E · Test SMS thật trên số được phép | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | C-SMS Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), UI-AUTH Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D5 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ C-SMS, UI-AUTH, D5 |
| &nbsp;&nbsp;M01-C-UAT · Owner nghiệm thu OTP thật và thông báo lỗi | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | C-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ C-E2E |
| **M01-D** thiết kế · Nghiệp vụ bổ sung: ADMIN, SYSTEM và 2FA | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | R1 Hoàn thành (DONE) | ChatGPT thiết kế |
| &nbsp;&nbsp;M01-D-ACCESS · Backend khởi tạo và phân quyền quản trị | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | — | ChatGPT thiết kế |
| &nbsp;&nbsp;M01-D-2FA · Backend 2FA và khôi phục quyền quản trị | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | D-ACCESS Đã lên kế hoạch (PLANNED) | Chờ D-ACCESS |
| &nbsp;&nbsp;M01-D-UI · UI đăng nhập và bảo mật quản trị | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | D-2FA Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), UI-AUTH Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ D-2FA, UI-AUTH |
| &nbsp;&nbsp;M01-D-E2E · Test quyền và 2FA đầu cuối | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | D-UI Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D5 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ D-UI, D5 |
| &nbsp;&nbsp;M01-D-UAT · Owner nghiệm thu bảo mật quản trị | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | D-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ D-E2E |
| **M02-A** thiết kế · Nghiệp vụ hồ sơ quán và giờ hoạt động | 🔒 Thiết kế đã khóa (`DESIGN_LOCKED`) | — | [#18](https://github.com/trungtn87/11ship/pull/18) | ✅ Đạt (`PASS`) | `207133b` | R1 Hoàn thành (DONE) | Tiếp tục các task con |
| &nbsp;&nbsp;M02-A-BE · Backend hồ sơ, lịch tuần và trạng thái tự động | ✅ Hoàn thành (`DONE`) | — | [#21](https://github.com/trungtn87/11ship/pull/21) | ✅ Đạt (`PASS`) | `c7f0d5b` | — | — |
| &nbsp;&nbsp;M02-A-UI · UI hồ sơ, lịch tuần và trạng thái quán | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A-BE Hoàn thành (DONE), UI-ONBOARD Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ UI-ONBOARD |
| &nbsp;&nbsp;M02-A-E2E · Test đầu cuối hồ sơ và lịch hoạt động | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A-UI Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D5 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A-UI, D5 |
| &nbsp;&nbsp;M02-A-UAT · Owner nghiệm thu hoạt động quán tự động | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A-E2E |
| **M02-B** thiết kế · Thực đơn (mã task lịch sử PR20, owner M09) | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A-UAT |
| &nbsp;&nbsp;M02-B-BE · Backend menu, nhóm món và ảnh | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | UPLOAD Đã lên kế hoạch (PLANNED) | Chờ UPLOAD, A-UAT |
| &nbsp;&nbsp;M02-B-UI · UI quản lý menu và nhóm món | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-BE Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), FE0 Đang thiết kế (DESIGNING) | Chờ B-BE, FE0, A-UAT |
| &nbsp;&nbsp;M02-B-E2E · Test đầu cuối menu | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-UI Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D5 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B-UI, D5, A-UAT |
| &nbsp;&nbsp;M02-B-UAT · Owner nghiệm thu menu | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B-E2E, A-UAT |
| **M00-OPS** thiết kế · Vận hành nền tảng trước production | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | C1C Hoàn thành (DONE) | ChatGPT thiết kế |
| &nbsp;&nbsp;M00-OPS-WORKER · Publisher và worker outbox chạy thật | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | — | ChatGPT thiết kế |
| &nbsp;&nbsp;M00-OPS-CLEANUP · Lịch dọn dữ liệu và retention | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | — | ChatGPT thiết kế |
| &nbsp;&nbsp;M00-OPS-RELEASE · Triển khai, giám sát và diễn tập phục hồi | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | RELEASE-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ RELEASE-UAT |
| M01-FE0 · Nền frontend HTML/CSS responsive và API client | 📐 Đang thiết kế (`DESIGNING`) | ChatGPT | [#24](https://github.com/trungtn87/11ship/pull/24) | ✅ Đạt (`PASS`) | `ef29717` | R1 Hoàn thành (DONE) | ChatGPT hoàn tất PR thiết kế #24 |
| M02-AREA-READ · Nguồn vùng active tối thiểu cho nghiệm thu onboarding M01 | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | R1 Hoàn thành (DONE) | ChatGPT thiết kế |
| M02-AREAS · Quản lý vùng phục vụ, trạng thái và version/polygon | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ UAT, D-UAT |
| M02-AREAS-APP · App test quản lý vùng qua API có quyền | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | AREAS Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), FE0 Đang thiết kế (DESIGNING), D4 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ AREAS, FE0, D4 |
| M02-AREAS-E2E · Kiểm vùng active, boundary, version và quyền | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | AREAS-APP Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ AREAS-APP |
| M02-AREAS-UAT · Owner nghiệm thu vùng phục vụ thật | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | AREAS-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ AREAS-E2E |
| M00-UPLOAD · Upload ảnh, ownership và lưu trữ bền vững | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | R1 Hoàn thành (DONE) | ChatGPT thiết kế |
| M00-TEST-SHELL · Trang chẩn đoán app test: phiên bản, API và dữ liệu sau restart | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | D4 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ D4 |
| M00-TEST-E2E · PC, điện thoại 4G, HTTPS và restart | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | TEST-SHELL Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D4 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ TEST-SHELL, D4 |
| &nbsp;&nbsp;M03-A · Identity, PLATFORM/EXTERNAL, vùng và ngân hàng (cần contract vật lý m… | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A-UAT, D-UAT |
| M04-A1 · Ví zero, ledger, source và invariants | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A |
| M04-A2 · Hold reserve/capture/release | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A1 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A1 |
| M04-B · Topup và registry giao dịch ngân hàng | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A2 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A2, D-UAT |
| &nbsp;&nbsp;M03-B1 · Nạp-và-duyệt, reject, suspend, resume, bật nhận | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B, A |
| M04-C1 · Tạo rút và hủy pending, snapshot ngân hàng | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A2 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A2, A |
| M04-C2 · Processing, paid và reconciliation | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | C1 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ C1, D-UAT |
| M05-A · Hồ sơ khách, địa chỉ và default | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ UAT |
| M08-A · Location ingest, binding thiết bị và spike push | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ UAT |
| M06-A · Quote, routing provider và snapshot phí | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B1 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A-UAT, B1 |
| M06-B · Eligibility, ghép đơn và policy type | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), A2 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A, A, A2 |
| M07-A · Quán gọi giao, sửa, deadline, stop và hủy | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B1 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B, B1 |
| M07-B · Nhận/trả, assignment và hold nguyên tử | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), A2 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A, A2 |
| M07-C · Ghim giao, pickup, complete, fail và trách nhiệm hàng | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B |
| &nbsp;&nbsp;M03-B2 · Ngừng/đóng hồ sơ, money và custody guard | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | C2 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), C Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ C2, C |
| M08-B · Tracking, outbox delivery, WS và reminders | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), C Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), OPS-WORKER Đã lên kế hoạch (PLANNED) | Chờ A, C, OPS-WORKER |
| M10-A · Checkout, recipient, giá và hẹn giờ | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B-BE Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A, B-BE |
| M10-B · Quán sửa/confirm/reject/cancel | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A |
| M10-C · Order-delivery integration và lịch sử gọi lại | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), C Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B, C |
| M08-ORDER-ADAPTER · Tracking và thông báo order theo quyền khách | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | C Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ C, B |
| M11-A · Rating xế/quán, phản hồi và moderation | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | C Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), C Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ C, C |
| M11-B · Outcome report, correction và delta tiền | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), C2 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A, C2 |
| M12-A · App quản lý và web: projection, map, scope, policy | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | D-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), C Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ D-UAT, C |
| M12-B · Quyền, audit, báo cáo và case vận hành | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A, B |
| **M03-PLAN** thiết kế · Khung M03/M04 PR7 chưa khóa; không thay contract từng slice | 📐 Đang thiết kế (`DESIGNING`) | ChatGPT | [#7](https://github.com/trungtn87/11ship/pull/7) | ✅ Đạt (`PASS`) | `645a59b` | — | ChatGPT hoàn tất PR thiết kế #7 |
| M03-APP · App test HTML/CSS qua API thật | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B1 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B2 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), FE0 Đang thiết kế (DESIGNING), D4 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A, B1, B2, FE0, D4 |
| M03-E2E · Tự động, browser/API/DB, race và regression | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | APP Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ APP |
| M03-UAT · Owner nghiệm thu nghiệp vụ trên PC và điện thoại | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ E2E |
| M04-APP · App test HTML/CSS qua API thật | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A1 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), A2 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), C1 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), C2 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), FE0 Đang thiết kế (DESIGNING), D4 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A1, A2, B, C1, C2, FE0, D4 |
| M04-E2E · Tự động, browser/API/DB, race và regression | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | APP Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ APP |
| M04-UAT · Owner nghiệm thu nghiệp vụ trên PC và điện thoại | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ E2E |
| M05-APP · App test HTML/CSS qua API thật | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), FE0 Đang thiết kế (DESIGNING), D4 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A, FE0, D4 |
| M05-E2E · Tự động, browser/API/DB, race và regression | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | APP Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ APP |
| M05-UAT · Owner nghiệm thu nghiệp vụ trên PC và điện thoại | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ E2E |
| M06-APP · App test HTML/CSS qua API thật | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), FE0 Đang thiết kế (DESIGNING), D4 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A, B, FE0, D4 |
| M06-E2E · Tự động, browser/API/DB, race và regression | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | APP Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ APP |
| M06-UAT · Owner nghiệm thu nghiệp vụ trên PC và điện thoại | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ E2E |
| M07-APP · App test HTML/CSS qua API thật | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), C Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), FE0 Đang thiết kế (DESIGNING), D4 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A, B, C, FE0, D4 |
| M07-E2E · Tự động, browser/API/DB, race và regression | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | APP Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ APP |
| M07-UAT · Owner nghiệm thu nghiệp vụ trên PC và điện thoại | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ E2E |
| M08-APP · App test HTML/CSS qua API thật | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), ORDER-ADAPTER Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), FE0 Đang thiết kế (DESIGNING), D4 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A, B, ORDER-ADAPTER, FE0, D4 |
| M08-E2E · Tự động, browser/API/DB, race và regression | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | APP Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ APP |
| M08-UAT · Owner nghiệm thu nghiệp vụ trên PC và điện thoại | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ E2E |
| M10-APP · App test HTML/CSS qua API thật | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), C Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), FE0 Đang thiết kế (DESIGNING), D4 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A, B, C, FE0, D4 |
| M10-E2E · Tự động, browser/API/DB, race và regression | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | APP Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ APP |
| M10-UAT · Owner nghiệm thu nghiệp vụ trên PC và điện thoại | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ E2E |
| M11-APP · App test HTML/CSS qua API thật | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), FE0 Đang thiết kế (DESIGNING), D4 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A, B, FE0, D4 |
| M11-E2E · Tự động, browser/API/DB, race và regression | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | APP Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ APP |
| M11-UAT · Owner nghiệm thu nghiệp vụ trên PC và điện thoại | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ E2E |
| M12-APP · App test HTML/CSS qua API thật | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), FE0 Đang thiết kế (DESIGNING), D4 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A, B, FE0, D4 |
| M12-E2E · Tự động, browser/API/DB, race và regression | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | APP Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ APP |
| M12-UAT · Owner nghiệm thu nghiệp vụ trên PC và điện thoại | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ E2E |
| M03-ACTIVATION-APP · App test hồ sơ, ngân hàng và nạp-duyệt trước delivery | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B1 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), FE0 Đang thiết kế (DESIGNING), D4 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B1, B, FE0, D4 |
| M03-ACTIVATION-E2E · API/browser thật cho activation trước delivery | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | ACTIVATION-APP Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ ACTIVATION-APP |
| M03-ACTIVATION-UAT · Owner nghiệm thu hồ sơ, ngân hàng và nạp-duyệt trước delivery | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | ACTIVATION-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D5 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ ACTIVATION-E2E, D5 |
| M04-MONEY-UAT · Owner nghiệm thu nạp/rút và đối soát trước delivery | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D5 Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ E2E, D5 |
| M00-NATIVE-CLIENTS · Đóng gói 4 app, kiểm Android/iOS và kết nối cùng API | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ UAT, UAT, UAT, UAT, UAT, UAT, B-UAT, UAT, UAT, UAT |
| M00-NATIVE-E2E · Thiết bị thật: nền, GPS, push, reconnect và signing | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | NATIVE-CLIENTS Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ NATIVE-CLIENTS |
| M12-FIGMA · Thiết kế lại Figma toàn bộ ứng dụng và web quản trị | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | NATIVE-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ NATIVE-E2E |
| M12-FIGMA-IMPLEMENT · Triển khai giao diện Figma và regression các ứng dụng | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | FIGMA Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ FIGMA |
| M12-FIGMA-UAT · Owner nghiệm thu giao diện hoàn thiện | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | FIGMA-IMPLEMENT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ FIGMA-IMPLEMENT |
| M12-SYSTEM-E2E · Toàn hệ thống và ngoài thực địa Cao Bằng | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | C-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), FIGMA-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), B-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), NATIVE-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ C-UAT, FIGMA-UAT, B-UAT, D-UAT, NATIVE-E2E |
| M12-SECURITY-MONEY · Audit bảo mật, concurrency và tài chính xuyên module | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | SYSTEM-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ SYSTEM-E2E |
| M12-RESTORE · Backup/restore, server dự phòng và diễn tập sự cố | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | SECURITY-MONEY Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), OPS-CLEANUP Đã lên kế hoạch (PLANNED), D3 Đã lên kế hoạch (PLANNED) | Chờ SECURITY-MONEY, OPS-CLEANUP, D3 |
| M12-LOAD · Đo tải và xác định cấu hình release từ dữ liệu thật | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | RESTORE Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ RESTORE |
| M12-RELEASE-UAT · Owner chấp thuận phát hành theo exact release candidate | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | LOAD Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ LOAD |

## Danh sách Pull Request

Cách hệ thống xử lý từng PR. PR chỉ được tính qua metadata rõ ràng (label hoặc số PR được ghim trong kế hoạch), không bao giờ suy ra từ tiêu đề, nội dung hay tác giả.

| PR | Vòng đời | Task | Vai trò | CI trên head | Head | Cách tính |
|---|---|---|---|---|---|---|
| [#1](https://github.com/trungtn87/11ship/pull/1) Bước 5.1–5.2: kiểm tra repo, chốt nền và bàn giao M00-B1 | Đã merge (`MERGED`) | M00-B1 | thiết kế | — | `a07bbf7` | được tính |
| [#2](https://github.com/trungtn87/11ship/pull/2) feat(m00-b1): backend foundation — F01–F09 verified PASS | Đã merge (`MERGED`) | M00-B1 | triển khai | ✅ Đạt (`PASS`) | `55c5d81` | được tính |
| [#3](https://github.com/trungtn87/11ship/pull/3) docs(m00-c1): transactional core design | Đã merge (`MERGED`) | M00-C1 | thiết kế | ✅ Đạt (`PASS`) | `de82b15` | được tính |
| [#4](https://github.com/trungtn87/11ship/pull/4) M00-C1A0: transaction lifecycle and shared primitives | Đã merge (`MERGED`) | M00-C1A0 | triển khai | ✅ Đạt (`PASS`) | `688e796` | được tính |
| [#5](https://github.com/trungtn87/11ship/pull/5) feat(m00-c1a1): idempotency executor, replay and cleanup | 🚫 Đã hủy / bỏ qua (`CANCELLED / IGNORED`) | M00-C1A1 | triển khai | ✅ Đạt (`PASS`) | `e1c67b1` | 🚫 không tính (đã hủy) — PR triển khai do ChatGPT mở sai quy trình, đã đóng và không merge. Không được chấp nhận. |
| [#6](https://github.com/trungtn87/11ship/pull/6) M00-C1A1: Idempotency (draft) | Đã merge (`MERGED`) | M00-C1A1 | triển khai | ✅ Đạt (`PASS`) | `44c0fa7` | được tính |
| [#7](https://github.com/trungtn87/11ship/pull/7) docs(m03-m04): financial consistency, withdrawal reconcilia… | Bản nháp (`DRAFT`) | M03-PLAN | thiết kế | ✅ Đạt (`PASS`) | `645a59b` | được tính |
| [#8](https://github.com/trungtn87/11ship/pull/8) chore(progress): GitHub-derived project progress dashboard | Đã merge (`MERGED`) | — | hạ tầng | ✅ Đạt (`PASS`) | `1ce1e50` | ngoài kế hoạch — Ngoài kế hoạch (type:infra) |
| [#9](https://github.com/trungtn87/11ship/pull/9) M00-C1B: Audit + Outbox write primitives | Đã merge (`MERGED`) | M00-C1B | triển khai | ✅ Đạt (`PASS`) | `b418fd2` | được tính |
| [#10](https://github.com/trungtn87/11ship/pull/10) feat(outbox): M00-C1C outbox dispatcher + final | Đã merge (`MERGED`) | M00-C1C | triển khai | ✅ Đạt (`PASS`) | `172931b` | được tính |
| [#11](https://github.com/trungtn87/11ship/pull/11) docs(m01-a1): lock Auth Core implementation contract | Đã merge (`MERGED`) | M01-A1 | thiết kế | ✅ Đạt (`PASS`) | `a17935f` | được tính |
| [#12](https://github.com/trungtn87/11ship/pull/12) feat(auth): M01-A1 Auth Core (READY CANDIDATE) | Đã merge (`MERGED`) | M01-A1 | triển khai | ✅ Đạt (`PASS`) | `ef3afd4` | được tính |
| [#13](https://github.com/trungtn87/11ship/pull/13) chore(progress): Việt hóa dashboard tiến độ | Đã merge (`MERGED`) | — | hạ tầng | ✅ Đạt (`PASS`) | `25a62e9` | ngoài kế hoạch — Ngoài kế hoạch (type:infra) |
| [#14](https://github.com/trungtn87/11ship/pull/14) docs(ui): add Figma workflow and frontend UI gate | Đang mở (`OPEN`) | M01-UI | thiết kế | ✅ Đạt (`PASS`) | `0d16d7b` | được tính |
| [#15](https://github.com/trungtn87/11ship/pull/15) docs(m01-a2): lock onboarding contract and task split | Đã merge (`MERGED`) | M01-A2 | thiết kế | ✅ Đạt (`PASS`) | `c329808` | được tính |
| [#16](https://github.com/trungtn87/11ship/pull/16) feat(onboarding): M01-A2S shop onboarding | Đã merge (`MERGED`) | M01-A2S | triển khai | ✅ Đạt (`PASS`) | `620333f` | được tính |
| [#17](https://github.com/trungtn87/11ship/pull/17) feat(m01-a2d): DRIVER onboarding (no Driver service area) | Đã merge (`MERGED`) | M01-A2D | triển khai | ✅ Đạt (`PASS`) | `c37082a` | được tính |
| [#18](https://github.com/trungtn87/11ship/pull/18) docs(m02-a): hồ sơ quán và tự động hoạt động theo giờ | Đã merge (`MERGED`) | M02-A | thiết kế | ✅ Đạt (`PASS`) | `207133b` | được tính |
| [#19](https://github.com/trungtn87/11ship/pull/19) docs(m00-m01): session authorization, bounded rollback, rou… | Đã merge (`MERGED`) | M01-R1 | thiết kế + triển khai | ✅ Đạt (`PASS`) | `cd0e6de` | được tính |
| [#20](https://github.com/trungtn87/11ship/pull/20) docs(plan): M00 local, M01 UI/test and M02 parallel deliver… | Bản nháp (`DRAFT`) | M00-LOCAL | thiết kế | ⏳ Đang chạy (`RUNNING`) | `78cb319` | được tính |
| [#21](https://github.com/trungtn87/11ship/pull/21) feat(shop): M02-A shop management backend (draft) | Đã merge (`MERGED`) | M02-A-BE | triển khai | ✅ Đạt (`PASS`) | `c7f0d5b` | được tính |
| [#22](https://github.com/trungtn87/11ship/pull/22) design(M00-D): Render Free + Supabase staging | Đã merge (`MERGED`) | M00-D | thiết kế | ✅ Đạt (`PASS`) | `a846a68` | được tính |
| [#23](https://github.com/trungtn87/11ship/pull/23) design(M02-A-UI): shop profile and weekly schedule screens | Bản nháp (`DRAFT`) | M02-A-UI | thiết kế | ✅ Đạt (`PASS`) | `8a0bafe` | được tính |
| [#24](https://github.com/trungtn87/11ship/pull/24) design(M01-FE0): responsive frontend foundation and session… | Bản nháp (`DRAFT`) | M01-FE0 | thiết kế | ✅ Đạt (`PASS`) | `ef29717` | được tính |
| [#25](https://github.com/trungtn87/11ship/pull/25) feat(M00-D1): Render Free blueprint, strict Supabase TLS, r… | Đã merge (`MERGED`) | M00-D1 | triển khai | ✅ Đạt (`PASS`) | `44dbf10` | được tính |
| [#26](https://github.com/trungtn87/11ship/pull/26) design(M00-D2): tài khoản staging chưa xác minh SĐT | Bản nháp (`DRAFT`) | M00-D2 | thiết kế | ✅ Đạt (`PASS`) | `fe235cc` | được tính |
| [#27](https://github.com/trungtn87/11ship/pull/27) feat(M00-D2): staging accounts without SMS (fixture mode, s… | Bản nháp (`DRAFT`) | M00-D2 | triển khai | ✅ Đạt (`PASS`) | `c8b410e` | được tính |

## ⚠️ Cần chú ý

Không có vấn đề nào cần chú ý.

## Quy trình

`NGHIỆP VỤ → DATABASE/API/STATE MACHINE → REVIEW/KHÓA THIẾT KẾ → CLAUDE CODE → REVIEW CODE → TEST TỰ ĐỘNG → APP TEST API THẬT → OWNER NGHIỆM THU → KHÓA MODULE`

ChatGPT thiết kế và kiểm tra, Claude triển khai và test, Chủ dự án chốt quyết định và merge. Không có gì được tự động merge.
