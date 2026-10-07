# 11Ship — Quy trình Figma + phát triển UI v1.0

Status: OWNER REQUESTED WORKFLOW  
Date: 2026-10-08  
Applies to: mọi task có giao diện người dùng của 11Ship

## 1. Mục tiêu

Figma là **nguồn chuẩn duy nhất của giao diện**. ChatGPT chịu trách nhiệm UX/spec/Figma và review; Claude triển khai frontend theo Figma; Owner duyệt giao diện và nghiệp vụ.

Quy trình này không biến Figma thành dependency của backend. Backend, database và API được phép chạy song song khi contract đã đủ ổn định.

Figma nguồn của dự án hiện tại:

- File: **11Ship — UI Design System & Auth**
- URL: https://www.figma.com/design/VFIs4Hablp9z4KnV19gNzv
- File key: `VFIs4Hablp9z4KnV19gNzv`

## 2. Phân loại UI bắt buộc khi thiết kế task

Mỗi task trước khi giao Claude phải được ChatGPT ghi rõ một trong hai giá trị:

- `UI_SCOPE: NONE` — backend/infra thuần, không có giao diện.
- `UI_SCOPE: FIGMA_REQUIRED` — có màn hình, component, trạng thái hiển thị hoặc interaction cần người dùng thao tác.

Không được để Claude tự quyết định layout hoặc interaction cho task `FIGMA_REQUIRED`. Màu, logo, typography, spacing, radius, shadow, control sizing và core component baseline lấy bắt buộc từ [UI Foundation v1](11Ship-ui-foundation-v1.0.md) ngay từ wireframe đầu tiên.

## 3. Pipeline chuẩn

### 3.1 Task không có UI

`SPEC -> DESIGN LOCK -> CLAUDE CODE -> CI -> CHATGPT REVIEW -> OWNER MERGE`

Không cần Figma.

### 3.2 Task có UI

Backend và UI được phép chạy cuốn chiếu:

```
                    +-> BACKEND/API IMPLEMENTATION ------------------+
SPEC / UX CONTRACT -+                                               +-> INTEGRATION
                    +-> FIGMA DRAFT -> OWNER REVIEW -> UI_LOCKED ----+
                                                   |
                                                   +-> FRONTEND IMPLEMENTATION
                                                       -> VISUAL QA
                                                       -> CHATGPT REVIEW
                                                       -> OWNER MERGE
```

Quy tắc:

1. Mọi frame mới bắt đầu từ `FOUNDATION_LOCKED`: logo, background, color, Plus Jakarta Sans, spacing/radius/shadow/control baseline đã có sẵn; không dựng wireframe bằng style tạm riêng.
2. Khi API/data contract đủ ổn định, Figma bắt đầu ngay; không chờ backend hoàn thành.
3. Backend có thể tiếp tục song song nếu không phụ thuộc quyết định UI còn mở.
4. Claude chỉ được code **frontend của frame đã `UI_LOCKED`**.
5. Trong khi Claude code màn A, ChatGPT/Figma tiếp tục màn B.
6. Sau code phải có visual QA so với frame Figma trước khi review PASS.

## 4. UI gate

Task `FIGMA_REQUIRED` chỉ được coi là sẵn sàng bàn giao frontend khi task/handoff có đủ:

- Figma file URL/file key;
- frame hoặc node ID cụ thể;
- platform/app đích;
- các trạng thái bắt buộc: default/loading/empty/error/disabled và business states liên quan;
- interaction/navigation;
- text quan trọng;
- responsive/safe-area/keyboard behavior nếu áp dụng;
- ngày hoặc revision `UI_LOCKED`;
- Owner đã duyệt UI.

Một link tới toàn bộ file Figma mà không chỉ rõ frame/node **không đủ** để giao code.

## 5. Sau khi UI_LOCKED

- Thay đổi lớn về layout/flow: mở lại UI, cập nhật Figma, Owner duyệt lại rồi mới sửa frontend.
- Thay đổi nhỏ không đổi flow (typo/copy nhỏ): có thể sửa nhưng phải đồng bộ lại Figma trong cùng task.
- Claude không được "cải tiến" thiết kế ngoài Figma trong lúc code.
- Nếu code cần khác Figma vì giới hạn kỹ thuật, phải báo trước; không tự lệch thiết kế.

## 6. Visual QA

Mỗi màn hình/component chính sau khi code cần ít nhất:

- screenshot hoặc bản chạy thật ở kích thước mục tiêu;
- đối chiếu hierarchy, spacing, typography, màu, radius, state và interaction với Figma;
- không overlap/crop;
- touch target hợp lý trên mobile;
- loading/error/empty không bị bỏ quên.

Sai khác có chủ đích phải được ghi lại và đồng bộ về Figma hoặc task doc trước khi merge.

## 7. Design System 11Ship

Lớp nền đã được Owner khóa thành **UI Foundation v1** và phải dùng ngay từ màn đầu tiên: brand colors/background, logo, Plus Jakarta Sans, type ramp, spacing, radius, shadows, control sizes, breakpoints và core component baseline.

Xem [11Ship UI Foundation v1](11Ship-ui-foundation-v1.0.md).

Chỉ các **component domain** (Shop/Driver/Wallet/Delivery...) và bố cục/interaction cụ thể được phát triển dần theo module. Màn hình mới không được tạo style nền riêng.

## 8. Áp dụng vào tiến độ hiện tại

| Phạm vi | UI_SCOPE | Hành động |
|---|---|---|
| M00 Foundation / Transactional Core | NONE | Không Figma; tiếp tục backend bình thường. |
| M01-A1 Auth Core hiện tại | NONE đối với implementation A1 | Không chặn backend. Song song chuẩn bị Figma Auth cho lớp app dùng A1. |
| M01 phần user-facing tiếp theo (login/register/OTP/role/onboarding shell) | FIGMA_REQUIRED | Bắt đầu Figma trước khi giao frontend Claude. |
| Driver/Profile/Bank/Availability/Approval UI | FIGMA_REQUIRED | Thiết kế Figma ngay khi contract M03 tương ứng chuẩn bị CODE_READY. |
| Wallet/Topup/Withdrawal/Reconciliation UI | FIGMA_REQUIRED | Thiết kế Figma ngay khi contract M04 tương ứng chuẩn bị CODE_READY. |
| Các module sau | đánh giá bắt buộc | Có màn hình => FIGMA_REQUIRED; backend thuần => NONE. |

## 9. Quan hệ với Progress Dashboard

Progress Dashboard schema v1 hiện theo dõi design PR/code PR/CI/review và cố định vai trò ChatGPT/Claude. Không thêm field Figma tùy tiện vào `plan.yml` vì parser đang fail-closed.

Trong schema v1:

- Figma gate được ghi trong task/handoff của task UI.
- `READY_FOR_CLAUDE` ở dashboard đối với task UI **không có nghĩa frontend được phép bỏ qua UI_LOCKED**.
- Khi roadmap UI đủ lớn, có thể nâng dashboard schema để theo dõi UI gate chính thức bằng một thay đổi riêng có test.

## 10. Quy tắc bàn giao Claude cho task UI

Prompt/handoff frontend phải nói rõ:

- implement đúng frame/node Figma;
- không tự đổi layout/style;
- tái sử dụng component/token;
- không sửa API contract để tiện UI nếu chưa được duyệt;
- cung cấp screenshot/test evidence;
- dừng và báo BLOCKED nếu Figma/spec/API mâu thuẫn.

## 11. Quyền quyết định

- **ChatGPT:** UX, task contract, Figma, audit.
- **Figma:** source of truth cho UI đã khóa.
- **Claude:** implementation.
- **Owner:** duyệt UI, nghiệp vụ và merge.

Quy trình mặc định từ 08/10/2026: **Spec -> Figma chạy song song backend -> UI_LOCKED -> frontend -> visual QA -> review -> merge**.
