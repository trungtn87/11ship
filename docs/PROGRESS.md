<!-- AUTO-GENERATED — DO NOT EDIT MANUALLY. Source: docs/progress/plan.yml + GitHub. Generator: scripts/generate-progress.mjs -->

# 11Ship — Tiến độ dự án

> **TỰ ĐỘNG TẠO — KHÔNG SỬA THỦ CÔNG**
>
> Kế hoạch nằm trong [`docs/progress/plan.yml`](progress/plan.yml); trạng thái được suy ra từ GitHub (PR đã merge, draft/open/closed, label, head SHA, required check và dependency). Không ai, kể cả người hay AI, có thể tự ghi một task thành HOÀN THÀNH. Xem [cách suy ra trạng thái](progress/README.md).
> Dữ liệu theo mã main `e844276` (HEAD là commit progress-bot chỉ sửa tài liệu; CI được đọc từ commit mã này) · CI main: ✅ Đạt (`PASS`)

## Các luồng song song và checklist

Nghiệp vụ → thiết kế backend/UI → triển khai → E2E → Owner nghiệm thu. Backend DONE không đồng nghĩa UI hoặc bản dùng thử đã đạt.

| Luồng | Thiết kế | Công việc / checklist |
|---|---|---|
| M00 — môi trường test local | 📐 Đang thiết kế (`DESIGNING`) · #20 | [Checklist](tasks/M00-delivery-checklist.md) · xem dependency từng gói bên dưới |
| M01 — UI và bản thử Auth/onboarding | 🧐 Chờ duyệt thiết kế (`DESIGN_REVIEW`) · #14 | [Checklist](tasks/M01-delivery-checklist.md) · xem dependency từng gói bên dưới |
| M02 — nghiệp vụ hồ sơ và lịch quán | 📐 Đang thiết kế (`DESIGNING`) · #18 | [Checklist](tasks/M02-delivery-checklist.md) · xem dependency từng gói bên dưới |

Thiết kế UI được làm trong khi chuẩn bị môi trường. Frame Figma và xác nhận Owner nằm trong evidence; CI không tự xác nhận hai bước này. [Quy trình đầy đủ](tasks/module-delivery-workflow.md).

## 🎯 VIỆC ĐANG LÀM

| | |
|---|---|
| **Task** | **M00-LOCAL-RUN — Backend và PostgreSQL chạy local** |
| **Trạng thái** | 📐 Đang thiết kế (`DESIGNING`) |
| **Người phụ trách** | 🟣 **CHATGPT** |
| **ChatGPT** | Đang thiết kế |
| **Claude** | Chưa bắt đầu (chưa được mở khóa) |
| **Chủ dự án** | Không cần thao tác |
| **Đang bị chặn bởi** | Không |
| **Điều kiện sang bước tiếp** | PR thiết kế sẵn sàng review |
| **PR đang hoạt động** | PR #20 |

## Tiến độ

Tính theo trọng số task trong kế hoạch (mỗi task lá = 1 nếu không ghi khác). Commit, số dòng code và PR đã hủy không được tính. Phần trăm được làm tròn xuống.

| Phạm vi | Hoàn thành / tổng |
|---|---|
| Milestone hiện tại — M00 Nền tảng | 5 / 12 (41%) |
| Toàn bộ — chỉ tính task đã lập kế hoạch (roadmap chưa chốt hết) | 9 / 42 (21%) |
| Module M01 Xác thực | 4 / 22 (18%) |
| Module M02 Quán và thực đơn | 0 / 8 (0%) |

## Cây tiến độ

Mũi tên liền là dependency, mũi tên nét đứt là task cha → task con đầu tiên. Viền vàng đậm là việc đang làm.

```mermaid
flowchart TD
  subgraph M00_box["M00 · Nền tảng"]
    M00_B1["M00-B1<br/>Nền tảng Backend<br/>⚪ —<br/>Hoàn thành (DONE)"]
    M00_C1["M00-C1 (thiết kế)<br/>Lõi giao dịch<br/>⚪ —<br/>Hoàn thành (DONE)"]
    M00_C1A0["M00-C1A0<br/>Giao dịch + primitive dùng chung<br/>⚪ —<br/>Hoàn thành (DONE)"]
    M00_C1A1["M00-C1A1<br/>Chống xử lý lặp (Idempotency)<br/>⚪ —<br/>Hoàn thành (DONE)"]
    M00_C1B["M00-C1B<br/>Audit + ghi Outbox<br/>⚪ —<br/>Hoàn thành (DONE)"]
    M00_C1C["M00-C1C<br/>Dispatcher + tích hợp cuối<br/>⚪ —<br/>Hoàn thành (DONE)"]
    M00_LOCAL["M00-LOCAL (thiết kế)<br/>Môi trường test local<br/>🟣 CHATGPT<br/>Đang thiết kế (DESIGNING)"]
    M00_LOCAL_RUN["M00-LOCAL-RUN<br/>Backend và PostgreSQL chạy local<br/>🟣 CHATGPT<br/>Đang thiết kế (DESIGNING)"]
    M00_LOCAL_DATA["M00-LOCAL-DATA<br/>Dữ liệu mẫu và OTP dành cho bản thử<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M00_LOCAL_QA["M00-LOCAL-QA<br/>Kiểm chứng môi trường và khôi phục dữ liệu<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M00_LOCAL_UAT["M00-LOCAL-UAT<br/>Owner nghiệm thu môi trường local<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M00_OPS["M00-OPS (thiết kế)<br/>Vận hành nền tảng trước production<br/>🟣 CHATGPT<br/>Đã lên kế hoạch (PLANNED)"]
    M00_OPS_WORKER["M00-OPS-WORKER<br/>Publisher và worker outbox chạy thật<br/>🟣 CHATGPT<br/>Đã lên kế hoạch (PLANNED)"]
    M00_OPS_CLEANUP["M00-OPS-CLEANUP<br/>Lịch dọn dữ liệu và retention<br/>🟣 CHATGPT<br/>Đã lên kế hoạch (PLANNED)"]
    M00_OPS_RELEASE["M00-OPS-RELEASE<br/>Triển khai, giám sát và diễn tập phục hồi<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
  end
  subgraph M01_box["M01 · Xác thực"]
    M01_A1["M01-A1<br/>Lõi xác thực (Auth Core)<br/>⚪ —<br/>Hoàn thành (DONE)"]
    M01_A2["M01-A2 (thiết kế)<br/>Onboarding (Quán + Tài xế)<br/>⚪ —<br/>Hoàn thành (DONE)"]
    M01_A2S["M01-A2S<br/>Onboarding quán (Shop)<br/>⚪ —<br/>Hoàn thành (DONE)"]
    M01_A2D["M01-A2D<br/>Onboarding tài xế (Driver)<br/>⚪ —<br/>Hoàn thành (DONE)"]
    M01_R1["M01-R1<br/>Sửa sau merge (session, rollback, router, tiến độ)<br/>⚪ —<br/>Hoàn thành (DONE)"]
    M01_UI["M01-UI (thiết kế)<br/>Thiết kế và triển khai UI Auth + onboarding<br/>🟠 CHỦ DỰ ÁN<br/>Chờ duyệt thiết kế (DESIGN_REVIEW)"]
    M01_UI_AUTH["M01-UI-AUTH<br/>UI đăng ký, đăng nhập và chọn vai trò<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M01_UI_ONBOARD["M01-UI-ONBOARD<br/>UI hồ sơ quán và hồ sơ xế<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M01_TEST["M01-TEST (thiết kế)<br/>Kiểm thử và nghiệm thu M01-A1/A2<br/>🟣 CHATGPT<br/>Đã lên kế hoạch (PLANNED)"]
    M01_E2E["M01-E2E<br/>Test đầu cuối Auth và onboarding<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M01_UAT["M01-UAT<br/>Owner nghiệm thu bản thử M01-A1/A2<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M01_B["M01-B (thiết kế)<br/>Nghiệp vụ bổ sung: tài khoản và phiên<br/>🟣 CHATGPT<br/>Đã lên kế hoạch (PLANNED)"]
    M01_B_LOGOUT["M01-B-LOGOUT<br/>Backend đăng xuất và thu hồi phiên<br/>🟣 CHATGPT<br/>Đã lên kế hoạch (PLANNED)"]
    M01_B_PASSWORD["M01-B-PASSWORD<br/>Backend đổi và khôi phục mật khẩu<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M01_B_PHONE["M01-B-PHONE<br/>Backend đổi số điện thoại đã xác minh<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M01_B_UI["M01-B-UI<br/>UI quản lý tài khoản và phiên<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M01_B_E2E["M01-B-E2E<br/>Test đầu cuối tài khoản và phiên<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M01_B_UAT["M01-B-UAT<br/>Owner nghiệm thu tài khoản và phiên<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M01_C["M01-C (thiết kế)<br/>Nghiệp vụ bổ sung: SMS thật và chống lạm dụng<br/>🟣 CHATGPT<br/>Đã lên kế hoạch (PLANNED)"]
    M01_C_SMS["M01-C-SMS<br/>Adapter SMS và giới hạn gửi/thử thật<br/>🟣 CHATGPT<br/>Đã lên kế hoạch (PLANNED)"]
    M01_C_E2E["M01-C-E2E<br/>Test SMS thật trên số được phép<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M01_C_UAT["M01-C-UAT<br/>Owner nghiệm thu OTP thật và thông báo lỗi<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M01_D["M01-D (thiết kế)<br/>Nghiệp vụ bổ sung: ADMIN, SYSTEM và 2FA<br/>🟣 CHATGPT<br/>Đã lên kế hoạch (PLANNED)"]
    M01_D_ACCESS["M01-D-ACCESS<br/>Backend khởi tạo và phân quyền quản trị<br/>🟣 CHATGPT<br/>Đã lên kế hoạch (PLANNED)"]
    M01_D_2FA["M01-D-2FA<br/>Backend 2FA và khôi phục quyền quản trị<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M01_D_UI["M01-D-UI<br/>UI đăng nhập và bảo mật quản trị<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M01_D_E2E["M01-D-E2E<br/>Test quyền và 2FA đầu cuối<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M01_D_UAT["M01-D-UAT<br/>Owner nghiệm thu bảo mật quản trị<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
  end
  subgraph M02_box["M02 · Quán và thực đơn"]
    M02_A["M02-A (thiết kế)<br/>Nghiệp vụ hồ sơ quán và giờ hoạt động<br/>🟣 CHATGPT<br/>Đang thiết kế (DESIGNING)"]
    M02_A_BE["M02-A-BE<br/>Backend hồ sơ, lịch tuần và trạng thái tự động<br/>🟣 CHATGPT<br/>Đang thiết kế (DESIGNING)"]
    M02_A_UI["M02-A-UI<br/>UI hồ sơ, lịch tuần và trạng thái quán<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M02_A_E2E["M02-A-E2E<br/>Test đầu cuối hồ sơ và lịch hoạt động<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M02_A_UAT["M02-A-UAT<br/>Owner nghiệm thu hoạt động quán tự động<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M02_B["M02-B (thiết kế)<br/>Nghiệp vụ menu và nhóm món<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M02_B_BE["M02-B-BE<br/>Backend menu, nhóm món và ảnh<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M02_B_UI["M02-B-UI<br/>UI quản lý menu và nhóm món<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M02_B_E2E["M02-B-E2E<br/>Test đầu cuối menu<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
    M02_B_UAT["M02-B-UAT<br/>Owner nghiệm thu menu<br/>⚪ —<br/>Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY)"]
  end

  M00_B1 --> M00_C1
  M00_C1 -.-> M00_C1A0
  M00_C1A0 --> M00_C1A1
  M00_C1A1 --> M00_C1B
  M00_C1B --> M00_C1C
  M01_R1 --> M00_LOCAL
  M00_LOCAL -.-> M00_LOCAL_RUN
  M00_LOCAL_RUN --> M00_LOCAL_DATA
  M00_LOCAL_DATA --> M00_LOCAL_QA
  M00_LOCAL_QA --> M00_LOCAL_UAT
  M00_C1C --> M01_A1
  M01_A1 --> M01_A2
  M01_A2 -.-> M01_A2S
  M01_A2S --> M01_A2D
  M01_A2 --> M01_R1
  M01_R1 --> M01_UI
  M00_LOCAL_DATA --> M01_UI_AUTH
  M01_UI_AUTH --> M01_UI_ONBOARD
  M01_R1 --> M01_TEST
  M01_UI_ONBOARD --> M01_E2E
  M00_LOCAL_UAT --> M01_E2E
  M01_E2E --> M01_UAT
  M01_R1 --> M01_B
  M01_B -.-> M01_B_LOGOUT
  M01_B_LOGOUT --> M01_B_PASSWORD
  M01_B_PASSWORD --> M01_B_PHONE
  M01_B_PHONE --> M01_B_UI
  M01_UI_AUTH --> M01_B_UI
  M01_B_UI --> M01_B_E2E
  M00_LOCAL_UAT --> M01_B_E2E
  M01_B_E2E --> M01_B_UAT
  M01_R1 --> M01_C
  M01_C -.-> M01_C_SMS
  M01_C_SMS --> M01_C_E2E
  M01_UI_AUTH --> M01_C_E2E
  M00_LOCAL_UAT --> M01_C_E2E
  M01_C_E2E --> M01_C_UAT
  M01_R1 --> M01_D
  M01_D -.-> M01_D_ACCESS
  M01_D_ACCESS --> M01_D_2FA
  M01_D_2FA --> M01_D_UI
  M01_UI_AUTH --> M01_D_UI
  M01_D_UI --> M01_D_E2E
  M00_LOCAL_UAT --> M01_D_E2E
  M01_D_E2E --> M01_D_UAT
  M01_R1 --> M02_A
  M02_A -.-> M02_A_BE
  M02_A_BE --> M02_A_UI
  M01_UI_ONBOARD --> M02_A_UI
  M02_A_UI --> M02_A_E2E
  M00_LOCAL_UAT --> M02_A_E2E
  M02_A_E2E --> M02_A_UAT
  M02_A_BE --> M02_B
  M02_B -.-> M02_B_BE
  M02_B_BE --> M02_B_UI
  M02_A_UI --> M02_B_UI
  M02_B_UI --> M02_B_E2E
  M00_LOCAL_UAT --> M02_B_E2E
  M02_B_E2E --> M02_B_UAT
  M00_C1C --> M00_OPS
  M00_OPS -.-> M00_OPS_WORKER
  M00_OPS -.-> M00_OPS_CLEANUP
  M00_LOCAL_UAT --> M00_OPS_RELEASE
  M00_OPS_WORKER --> M00_OPS_RELEASE
  M00_OPS_CLEANUP --> M00_OPS_RELEASE
  M01_C_UAT --> M00_OPS_RELEASE
  M01_D_UAT --> M00_OPS_RELEASE

  classDef done fill:#d1fae5,stroke:#047857,color:#064e3b
  classDef locked fill:#e0e7ff,stroke:#4338ca,color:#312e81
  classDef ready fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a
  classDef active fill:#fef9c3,stroke:#a16207,color:#713f12
  classDef failed fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  classDef review fill:#f3e8ff,stroke:#7e22ce,color:#581c87
  classDef blocked fill:#f3f4f6,stroke:#9ca3af,color:#4b5563,stroke-dasharray:4 3
  classDef planned fill:#ffffff,stroke:#9ca3af,color:#374151
  classDef focus stroke:#f59e0b,stroke-width:5px
  class M00_B1,M00_C1,M00_C1A0,M00_C1A1,M00_C1B,M00_C1C,M01_A1,M01_A2,M01_A2S,M01_A2D,M01_R1 done
  class M01_UI review
  class M00_LOCAL_DATA,M00_LOCAL_QA,M00_LOCAL_UAT,M01_UI_AUTH,M01_UI_ONBOARD,M01_E2E,M01_UAT,M01_B_PASSWORD,M01_B_PHONE,M01_B_UI,M01_B_E2E,M01_B_UAT,M01_C_E2E,M01_C_UAT,M01_D_2FA,M01_D_UI,M01_D_E2E,M01_D_UAT,M02_A_UI,M02_A_E2E,M02_A_UAT,M02_B,M02_B_BE,M02_B_UI,M02_B_E2E,M02_B_UAT,M00_OPS_RELEASE blocked
  class M00_LOCAL,M00_LOCAL_RUN,M01_TEST,M01_B,M01_B_LOGOUT,M01_C,M01_C_SMS,M01_D,M01_D_ACCESS,M02_A,M02_A_BE,M00_OPS,M00_OPS_WORKER,M00_OPS_CLEANUP planned
  class M00_LOCAL_RUN focus
```

## Chi tiết công việc

| Task | Trạng thái | Người phụ trách | PR | CI | Head | Dependency | Việc tiếp theo |
|---|---|---|---|---|---|---|---|
| M00-B1 · Nền tảng Backend | ✅ Hoàn thành (`DONE`) | — | [#2](https://github.com/trungtn87/11ship/pull/2) | ✅ Đạt (`PASS`) | `55c5d81` | — | — |
| **M00-C1** thiết kế · Lõi giao dịch | ✅ Hoàn thành (`DONE`) | — | [#3](https://github.com/trungtn87/11ship/pull/3) | ✅ Đạt (`PASS`) | `de82b15` | B1 Hoàn thành (DONE) | — |
| &nbsp;&nbsp;M00-C1A0 · Giao dịch + primitive dùng chung | ✅ Hoàn thành (`DONE`) | — | [#4](https://github.com/trungtn87/11ship/pull/4) | ✅ Đạt (`PASS`) | `688e796` | — | — |
| &nbsp;&nbsp;M00-C1A1 · Chống xử lý lặp (Idempotency) | ✅ Hoàn thành (`DONE`) | — | [#6](https://github.com/trungtn87/11ship/pull/6) | ✅ Đạt (`PASS`) | `44c0fa7` | C1A0 Hoàn thành (DONE) | — |
| &nbsp;&nbsp;M00-C1B · Audit + ghi Outbox | ✅ Hoàn thành (`DONE`) | — | [#9](https://github.com/trungtn87/11ship/pull/9) | ✅ Đạt (`PASS`) | `b418fd2` | C1A1 Hoàn thành (DONE) | — |
| &nbsp;&nbsp;M00-C1C · Dispatcher + tích hợp cuối | ✅ Hoàn thành (`DONE`) | — | [#10](https://github.com/trungtn87/11ship/pull/10) | ✅ Đạt (`PASS`) | `172931b` | C1B Hoàn thành (DONE) | — |
| **M00-LOCAL** thiết kế · Môi trường test local | 📐 Đang thiết kế (`DESIGNING`) | ChatGPT | [#20](https://github.com/trungtn87/11ship/pull/20) | ✅ Đạt (`PASS`) | `a15278e` | R1 Hoàn thành (DONE) | ChatGPT hoàn tất PR thiết kế #20 |
| &nbsp;&nbsp;M00-LOCAL-RUN · Backend và PostgreSQL chạy local | 📐 Đang thiết kế (`DESIGNING`) | ChatGPT | [#20](https://github.com/trungtn87/11ship/pull/20) | ✅ Đạt (`PASS`) | `a15278e` | — | ChatGPT hoàn tất PR thiết kế #20 |
| &nbsp;&nbsp;M00-LOCAL-DATA · Dữ liệu mẫu và OTP dành cho bản thử | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | LOCAL-RUN Đang thiết kế (DESIGNING) | Chờ LOCAL-RUN |
| &nbsp;&nbsp;M00-LOCAL-QA · Kiểm chứng môi trường và khôi phục dữ liệu | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | LOCAL-DATA Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ LOCAL-DATA |
| &nbsp;&nbsp;M00-LOCAL-UAT · Owner nghiệm thu môi trường local | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | LOCAL-QA Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ LOCAL-QA |
| M01-A1 · Lõi xác thực (Auth Core) | ✅ Hoàn thành (`DONE`) | — | [#12](https://github.com/trungtn87/11ship/pull/12) | ✅ Đạt (`PASS`) | `ef3afd4` | C1C Hoàn thành (DONE) | — |
| **M01-A2** thiết kế · Onboarding (Quán + Tài xế) | ✅ Hoàn thành (`DONE`) | — | [#15](https://github.com/trungtn87/11ship/pull/15) | ✅ Đạt (`PASS`) | `c329808` | A1 Hoàn thành (DONE) | — |
| &nbsp;&nbsp;M01-A2S · Onboarding quán (Shop) | ✅ Hoàn thành (`DONE`) | — | [#16](https://github.com/trungtn87/11ship/pull/16) | ✅ Đạt (`PASS`) | `620333f` | — | — |
| &nbsp;&nbsp;M01-A2D · Onboarding tài xế (Driver) | ✅ Hoàn thành (`DONE`) | — | [#17](https://github.com/trungtn87/11ship/pull/17) | ✅ Đạt (`PASS`) | `c37082a` | A2S Hoàn thành (DONE) | — |
| M01-R1 · Sửa sau merge (session, rollback, router, tiến độ) | ✅ Hoàn thành (`DONE`) | — | [#19](https://github.com/trungtn87/11ship/pull/19) | ✅ Đạt (`PASS`) | `cd0e6de` | A2 Hoàn thành (DONE) | — |
| **M01-UI** thiết kế · Thiết kế và triển khai UI Auth + onboarding | 🧐 Chờ duyệt thiết kế (`DESIGN_REVIEW`) | Chủ dự án | [#14](https://github.com/trungtn87/11ship/pull/14) | ✅ Đạt (`PASS`) | `0d16d7b` | R1 Hoàn thành (DONE) | Chủ dự án duyệt và khóa PR thiết kế #14 |
| &nbsp;&nbsp;M01-UI-AUTH · UI đăng ký, đăng nhập và chọn vai trò | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | LOCAL-DATA Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ LOCAL-DATA |
| &nbsp;&nbsp;M01-UI-ONBOARD · UI hồ sơ quán và hồ sơ xế | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | UI-AUTH Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ UI-AUTH |
| **M01-TEST** thiết kế · Kiểm thử và nghiệm thu M01-A1/A2 | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | R1 Hoàn thành (DONE) | ChatGPT thiết kế |
| &nbsp;&nbsp;M01-E2E · Test đầu cuối Auth và onboarding | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | UI-ONBOARD Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), LOCAL-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ UI-ONBOARD, LOCAL-UAT |
| &nbsp;&nbsp;M01-UAT · Owner nghiệm thu bản thử M01-A1/A2 | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ E2E |
| **M01-B** thiết kế · Nghiệp vụ bổ sung: tài khoản và phiên | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | R1 Hoàn thành (DONE) | ChatGPT thiết kế |
| &nbsp;&nbsp;M01-B-LOGOUT · Backend đăng xuất và thu hồi phiên | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | — | ChatGPT thiết kế |
| &nbsp;&nbsp;M01-B-PASSWORD · Backend đổi và khôi phục mật khẩu | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-LOGOUT Đã lên kế hoạch (PLANNED) | Chờ B-LOGOUT |
| &nbsp;&nbsp;M01-B-PHONE · Backend đổi số điện thoại đã xác minh | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-PASSWORD Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B-PASSWORD |
| &nbsp;&nbsp;M01-B-UI · UI quản lý tài khoản và phiên | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-PHONE Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), UI-AUTH Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B-PHONE, UI-AUTH |
| &nbsp;&nbsp;M01-B-E2E · Test đầu cuối tài khoản và phiên | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-UI Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), LOCAL-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B-UI, LOCAL-UAT |
| &nbsp;&nbsp;M01-B-UAT · Owner nghiệm thu tài khoản và phiên | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B-E2E |
| **M01-C** thiết kế · Nghiệp vụ bổ sung: SMS thật và chống lạm dụng | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | R1 Hoàn thành (DONE) | ChatGPT thiết kế |
| &nbsp;&nbsp;M01-C-SMS · Adapter SMS và giới hạn gửi/thử thật | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | — | ChatGPT thiết kế |
| &nbsp;&nbsp;M01-C-E2E · Test SMS thật trên số được phép | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | C-SMS Đã lên kế hoạch (PLANNED), UI-AUTH Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), LOCAL-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ C-SMS, UI-AUTH, LOCAL-UAT |
| &nbsp;&nbsp;M01-C-UAT · Owner nghiệm thu OTP thật và thông báo lỗi | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | C-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ C-E2E |
| **M01-D** thiết kế · Nghiệp vụ bổ sung: ADMIN, SYSTEM và 2FA | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | R1 Hoàn thành (DONE) | ChatGPT thiết kế |
| &nbsp;&nbsp;M01-D-ACCESS · Backend khởi tạo và phân quyền quản trị | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | — | ChatGPT thiết kế |
| &nbsp;&nbsp;M01-D-2FA · Backend 2FA và khôi phục quyền quản trị | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | D-ACCESS Đã lên kế hoạch (PLANNED) | Chờ D-ACCESS |
| &nbsp;&nbsp;M01-D-UI · UI đăng nhập và bảo mật quản trị | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | D-2FA Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), UI-AUTH Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ D-2FA, UI-AUTH |
| &nbsp;&nbsp;M01-D-E2E · Test quyền và 2FA đầu cuối | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | D-UI Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), LOCAL-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ D-UI, LOCAL-UAT |
| &nbsp;&nbsp;M01-D-UAT · Owner nghiệm thu bảo mật quản trị | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | D-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ D-E2E |
| **M02-A** thiết kế · Nghiệp vụ hồ sơ quán và giờ hoạt động | 📐 Đang thiết kế (`DESIGNING`) | ChatGPT | [#18](https://github.com/trungtn87/11ship/pull/18) | ✅ Đạt (`PASS`) | `ebb0f3a` | R1 Hoàn thành (DONE) | ChatGPT hoàn tất PR thiết kế #18 |
| &nbsp;&nbsp;M02-A-BE · Backend hồ sơ, lịch tuần và trạng thái tự động | 📐 Đang thiết kế (`DESIGNING`) | ChatGPT | [#18](https://github.com/trungtn87/11ship/pull/18) | ✅ Đạt (`PASS`) | `ebb0f3a` | — | ChatGPT hoàn tất PR thiết kế #18 |
| &nbsp;&nbsp;M02-A-UI · UI hồ sơ, lịch tuần và trạng thái quán | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A-BE Đang thiết kế (DESIGNING), UI-ONBOARD Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A-BE, UI-ONBOARD |
| &nbsp;&nbsp;M02-A-E2E · Test đầu cuối hồ sơ và lịch hoạt động | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A-UI Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), LOCAL-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A-UI, LOCAL-UAT |
| &nbsp;&nbsp;M02-A-UAT · Owner nghiệm thu hoạt động quán tự động | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ A-E2E |
| **M02-B** thiết kế · Nghiệp vụ menu và nhóm món | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | A-BE Đang thiết kế (DESIGNING) | Chờ A-BE |
| &nbsp;&nbsp;M02-B-BE · Backend menu, nhóm món và ảnh | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | — | Chờ A-BE |
| &nbsp;&nbsp;M02-B-UI · UI quản lý menu và nhóm món | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-BE Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), A-UI Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B-BE, A-UI, A-BE |
| &nbsp;&nbsp;M02-B-E2E · Test đầu cuối menu | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-UI Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), LOCAL-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B-UI, LOCAL-UAT, A-BE |
| &nbsp;&nbsp;M02-B-UAT · Owner nghiệm thu menu | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | B-E2E Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ B-E2E, A-BE |
| **M00-OPS** thiết kế · Vận hành nền tảng trước production | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | C1C Hoàn thành (DONE) | ChatGPT thiết kế |
| &nbsp;&nbsp;M00-OPS-WORKER · Publisher và worker outbox chạy thật | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | — | ChatGPT thiết kế |
| &nbsp;&nbsp;M00-OPS-CLEANUP · Lịch dọn dữ liệu và retention | 📝 Đã lên kế hoạch (`PLANNED`) | ChatGPT | — | — | — | — | ChatGPT thiết kế |
| &nbsp;&nbsp;M00-OPS-RELEASE · Triển khai, giám sát và diễn tập phục hồi | ⛔ Đang chờ công việc trước (`BLOCKED_BY_DEPENDENCY`) | — | — | — | — | LOCAL-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), OPS-WORKER Đã lên kế hoạch (PLANNED), OPS-CLEANUP Đã lên kế hoạch (PLANNED), C-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY), D-UAT Đang chờ công việc trước (BLOCKED_BY_DEPENDENCY) | Chờ LOCAL-UAT, OPS-WORKER, OPS-CLEANUP, C-UAT, D-UAT |

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
| [#7](https://github.com/trungtn87/11ship/pull/7) docs(m03-m04): financial consistency, withdrawal reconcilia… | Bản nháp (`DRAFT`) | — | — | ✅ Đạt (`PASS`) | `645a59b` | ⚠️ không tính — thiếu metadata hợp lệ (thiếu module:&lt;task id&gt;, type:design¦implementation¦review-fix, agent:*); PR khôn… |
| [#8](https://github.com/trungtn87/11ship/pull/8) chore(progress): GitHub-derived project progress dashboard | Đã merge (`MERGED`) | — | hạ tầng | — | `1ce1e50` | ngoài kế hoạch — Ngoài kế hoạch (type:infra) |
| [#9](https://github.com/trungtn87/11ship/pull/9) M00-C1B: Audit + Outbox write primitives | Đã merge (`MERGED`) | M00-C1B | triển khai | ✅ Đạt (`PASS`) | `b418fd2` | được tính |
| [#10](https://github.com/trungtn87/11ship/pull/10) feat(outbox): M00-C1C outbox dispatcher + final | Đã merge (`MERGED`) | M00-C1C | triển khai | ✅ Đạt (`PASS`) | `172931b` | được tính |
| [#11](https://github.com/trungtn87/11ship/pull/11) docs(m01-a1): lock Auth Core implementation contract | Đã merge (`MERGED`) | M01-A1 | thiết kế | ✅ Đạt (`PASS`) | `a17935f` | được tính |
| [#12](https://github.com/trungtn87/11ship/pull/12) feat(auth): M01-A1 Auth Core (READY CANDIDATE) | Đã merge (`MERGED`) | M01-A1 | triển khai | ✅ Đạt (`PASS`) | `ef3afd4` | được tính |
| [#13](https://github.com/trungtn87/11ship/pull/13) chore(progress): Việt hóa dashboard tiến độ | Đã merge (`MERGED`) | — | hạ tầng | — | `25a62e9` | ngoài kế hoạch — Ngoài kế hoạch (type:infra) |
| [#14](https://github.com/trungtn87/11ship/pull/14) docs(ui): add Figma workflow and frontend UI gate | Đang mở (`OPEN`) | M01-UI | thiết kế | ✅ Đạt (`PASS`) | `0d16d7b` | được tính |
| [#15](https://github.com/trungtn87/11ship/pull/15) docs(m01-a2): lock onboarding contract and task split | Đã merge (`MERGED`) | M01-A2 | thiết kế | ✅ Đạt (`PASS`) | `c329808` | được tính |
| [#16](https://github.com/trungtn87/11ship/pull/16) feat(onboarding): M01-A2S shop onboarding | Đã merge (`MERGED`) | M01-A2S | triển khai | ✅ Đạt (`PASS`) | `620333f` | được tính |
| [#17](https://github.com/trungtn87/11ship/pull/17) feat(m01-a2d): DRIVER onboarding (no Driver service area) | Đã merge (`MERGED`) | M01-A2D | triển khai | ✅ Đạt (`PASS`) | `c37082a` | được tính |
| [#18](https://github.com/trungtn87/11ship/pull/18) docs(m02-a): hồ sơ quán và tự động hoạt động theo giờ | Bản nháp (`DRAFT`) | M02-A | thiết kế | ✅ Đạt (`PASS`) | `ebb0f3a` | được tính |
| [#19](https://github.com/trungtn87/11ship/pull/19) docs(m00-m01): session authorization, bounded rollback, rou… | Đã merge (`MERGED`) | M01-R1 | thiết kế + triển khai | ✅ Đạt (`PASS`) | `cd0e6de` | được tính |
| [#20](https://github.com/trungtn87/11ship/pull/20) docs(plan): thiết kế M02 song song bản thử UI M01 | Bản nháp (`DRAFT`) | M00-LOCAL | thiết kế | ✅ Đạt (`PASS`) | `a15278e` | được tính |

## ⚠️ Cần chú ý

- `UNCLASSIFIED_PR` PR #7: thiếu metadata hợp lệ (thiếu module:&lt;task id&gt;, type:design¦implementation¦review-fix, agent:*); PR không được tính. Trạng thái không bao giờ được suy ra từ tiêu đề, nội dung hoặc tác giả.

## Quy trình

`KẾ HOẠCH → CHATGPT THIẾT KẾ → THIẾT KẾ ĐÃ KHÓA → SẴN SÀNG GIAO CLAUDE → CLAUDE CODE → CI → CHỜ CHATGPT KIỂM TRA → CHATGPT KIỂM TRA → SẴN SÀNG MERGE → ĐÃ MERGE / ĐÃ KHÓA → task tiếp theo`

ChatGPT thiết kế và kiểm tra, Claude triển khai và test, Chủ dự án chốt quyết định và merge. Không có gì được tự động merge.
