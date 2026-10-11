# Chỉ mục nguồn, PR và phiên bản

Phiên bản **2.0.2**; **SOURCE_TRACE / NOT_ACCEPTANCE**. Repo [trungtn87/11ship](https://github.com/trungtn87/11ship); nhánh main kiểm kê gốc [e5b50e8567b8928646c83648dd70f577915dc14f](https://github.com/trungtn87/11ship/commit/e5b50e8567b8928646c83648dd70f577915dc14f). Bộ thiết kế được lưu tại [PR #48](https://github.com/trungtn87/11ship/pull/48), nhánh `docs/three-app-system-design-20261011`, trạng thái Draft và chờ Owner duyệt. Trạng thái các PR bên dưới là **tại audit gốc**, không trạng thái hôm nay; nguồn revision USER/OTP xem bảng mới.

## Nguồn revision USER Admin/SMS test v2.0.2

Owner11/10 yêu cầu đưa quản lý USER vào M01, SMS dịch vụ về cuối dự án và backend có kênh test trước. Source design `80938a32b9b6fdb469346fb1183891e751a4d936`; main đã đọc `f90b78a938036aa169179185aba6adab81e6d473`. [Đặc tả09](09-m01-user-admin-test-sms.md), [board](assets/m01-user-admin-v2.0.2.svg), [danh mục108 gói](08-work-packages.md); M01 có33/M12 có12. Không chạy app/DB/Owner UAT mới.

| Nguồn main đã đọc | Phát hiện và kế thừa |
|---|---|
| [Admin routes](https://github.com/trungtn87/11ship/blob/f90b78a938036aa169179185aba6adab81e6d473/apps/admin-web/src/core/routes.ts) và [shell](https://github.com/trungtn87/11ship/blob/f90b78a938036aa169179185aba6adab81e6d473/apps/admin-web/src/dom/shell-app.ts) | Có home/invitations/activate, chưa USER accounts route |
| [OTP binding](https://github.com/trungtn87/11ship/blob/f90b78a938036aa169179185aba6adab81e6d473/apps/backend/src/auth/otp-provider-binding.ts) | Register fake chỉ dev/test; staging/production startup refuse khi thiếu adapter |
| [Activation providers](https://github.com/trungtn87/11ship/blob/f90b78a938036aa169179185aba6adab81e6d473/apps/backend/src/admin-activation/activation-otp-providers.ts) và [config](https://github.com/trungtn87/11ship/blob/f90b78a938036aa169179185aba6adab81e6d473/apps/backend/src/config/admin-activation-config.ts) | FAKE/TEST_DISPLAY explicit dev/test; accepted/rejected/unknown giữ contract; mode SMS chưa binding |
| [Auth Core DDL](https://github.com/trungtn87/11ship/blob/f90b78a938036aa169179185aba6adab81e6d473/database/migrations/1791504000000_create-auth-core.sql), [origin DDL](https://github.com/trungtn87/11ship/blob/f90b78a938036aa169179185aba6adab81e6d473/database/migrations/1791936000000_add-users-account-origin.sql), [Admin Auth DDL](https://github.com/trungtn87/11ship/blob/f90b78a938036aa169179185aba6adab81e6d473/database/migrations/1792022400000_create-admin-auth.sql) | users status/version, PHONE_VERIFIED/ADMIN_PROVISIONED, admin_memberships; không dùng origin thay permission |
| [Invitation DDL](https://github.com/trungtn87/11ship/blob/f90b78a938036aa169179185aba6adab81e6d473/database/migrations/1792108800000_create-admin-invitations.sql), [activation DDL](https://github.com/trungtn87/11ship/blob/f90b78a938036aa169179185aba6adab81e6d473/database/migrations/1792281600000_create-admin-activation.sql) | CUSTOMER/SHOP/DRIVER scopes, view/review/lock, admin_permissions; M01.29 phải pin authorization/target lock semantics trước mutation |

Các file source/API mới trong09 là proposal, chưa là implementation. Chỉ docs được sửa ở revision; không sửa evidence/PROGRESS hoặc nhận các gói đã PASS.

## 1. Nguồn main được kế thừa

| Nguồn | Nội dung áp dụng |
|---|---|
| [AGENTS](https://github.com/trungtn87/11ship/blob/e5b50e8567b8928646c83648dd70f577915dc14f/AGENTS.md) | ChatGPT docs/design/read-only review; Claude code/test |
| [Workflow](https://github.com/trungtn87/11ship/blob/e5b50e8567b8928646c83648dd70f577915dc14f/docs/process/11ship-delivery-workflow.md) | Owner duyệt UI trước code UI; PC/phone/merge/LOCK |
| [M00-A/manifest4.1](https://github.com/trungtn87/11ship/blob/e5b50e8567b8928646c83648dd70f577915dc14f/docs/current/11Ship-buoc-4.1-nen-trien-khai-M00-A-v1.0.md) | Ownership/tên bảng/transaction/mapping; topology cũ bị nhiệm vụ mới thay |
| [ADR001](https://github.com/trungtn87/11ship/blob/e5b50e8567b8928646c83648dd70f577915dc14f/docs/current/ADR-001-backend-foundation.md) | NestJS11/Node24/PG17, không ORM/broker mới |
| [ADR002](https://github.com/trungtn87/11ship/blob/e5b50e8567b8928646c83648dd70f577915dc14f/docs/current/ADR-002-auth-security-foundation.md) | Opaque token/Argon2id/absolute session, không refresh |
| [ADR003](https://github.com/trungtn87/11ship/blob/e5b50e8567b8928646c83648dd70f577915dc14f/docs/current/ADR-003-transactional-core.md) | Transaction/idempotency/audit/outbox |
| [Brand](https://github.com/trungtn87/11ship/blob/e5b50e8567b8928646c83648dd70f577915dc14f/docs/current/11-brand-guideline-v1.0.md) | Palette/font/logo/slogan; sửa mô tả phân phối khi code |
| [M02-A đã chốt](https://github.com/trungtn87/11ship/blob/e5b50e8567b8928646c83648dd70f577915dc14f/docs/tasks/M02-A-shop-management.md) | Owner08/10 auto-hours, không manual switch |
| [Template delivery](https://github.com/trungtn87/11ship/blob/e5b50e8567b8928646c83648dd70f577915dc14f/docs/templates/module-delivery-checklist.md) | Gate từng bề mặt và evidence |

## 2. PR/head và trạng thái thực khi audit

| PR | Head kiểm kê | Vai trò và trạng thái |
|---|---|---|
| [#46](https://github.com/trungtn87/11ship/pull/46) | cf9eecadb6d50ec061d525d1bdf9b3f50d6d062b | Draft three launchers; Verify/Windows failure; Food/Ship chưa tích hợp |
| [#40](https://github.com/trungtn87/11ship/pull/40) / [#39](https://github.com/trungtn87/11ship/pull/39) | Xem snapshot/main | Launcher nền đã merge, không phải three-app UAT |
| [#34](https://github.com/trungtn87/11ship/pull/34) |08910ed92608d102da29d45ae1a8e5afd14dbcd1 | Draft Admin backend; Verify success |
| [#35](https://github.com/trungtn87/11ship/pull/35) |7b116c3d4551bf0028fa544278449598acf5991c | Draft Admin UI/TOTP/F5/logout; Verify success |
| [#42](https://github.com/trungtn87/11ship/pull/42) |13a596254fed75544bfc1f461d48086c863e4c43 | Draft integration/D2; Verify/Windows success; không merge toàn bộ làm dependency |
| [#27](https://github.com/trungtn87/11ship/pull/27) |18cb54b6afc524655c075958bb61b84164e43532 | Draft fixture; CI success, không SMS thật |
| [#37](https://github.com/trungtn87/11ship/pull/37) / [#41](https://github.com/trungtn87/11ship/pull/41) | #41:4ab9c9cff8db730699d234c56bacf567506c5bbf | Invitation/data/step-up; Draft, ngoài M00 |
| [#44](https://github.com/trungtn87/11ship/pull/44) / [#45](https://github.com/trungtn87/11ship/pull/45) | #45:f37c1ad6ad5a5b2e7a6cadabe12f13c02f0ace10 | Activation contract/code; Draft, ngoài M00 |
| [#43](https://github.com/trungtn87/11ship/pull/43) |b853c88f8f7f54b7ecb8a74df67f75ca807aeb33 | Open business reset Owner duyệt, chưa implementation |
| [#28](https://github.com/trungtn87/11ship/pull/28) |cdf030d28c85b6ecf9e9143e1e63b4a165ddb4c1 | Draft roadmap13modules/121leaves; không module LOCK |
| [#30](https://github.com/trungtn87/11ship/pull/30) |bb5d6c97ab2f1b2853765d218ad76cc9816c9952 | Draft M01 roadmap |
| [#31](https://github.com/trungtn87/11ship/pull/31) |be45bee840945a189668b459427afcd433dc09d8 | Draft Java diagnostics3flavors, không product app Auth |
| [#29](https://github.com/trungtn87/11ship/pull/29) |363a526b68c6db4488c3a8b19108271c47be9aa4 | Trial web cũ, không full Admin |
| [#21](https://github.com/trungtn87/11ship/pull/21) | Xem snapshot/main | M02-A backend merged, module UI/UAT chưa đủ |
| [#12](https://github.com/trungtn87/11ship/pull/12), [#16](https://github.com/trungtn87/11ship/pull/16), [#17](https://github.com/trungtn87/11ship/pull/17) | Xem snapshot/main | Auth/onboarding backend merged |
| [#7](https://github.com/trungtn87/11ship/pull/7) | Draft design | ADR004 money/closure/source invariants, chưa physical schema/code |

CI #46 trực tiếp: [Verify failure](https://github.com/trungtn87/11ship/actions/runs/38072423120/job/114272409163) và [Windows job](https://github.com/trungtn87/11ship/actions/runs/38072423120/job/114272409345). Canonical URL của từng check trong audit-snapshot.json là nguồn nếu workflow run path thay. Kết quả CI exact head không thay nghiệm thu Owner.

## 3. Nguồn roadmap/history

[S01 baselinev1.1](https://github.com/trungtn87/11ship/blob/cdf030d28c85b6ecf9e9143e1e63b4a165ddb4c1/docs/roadmap/references/library/baseline-v1.1.md), [owner-decisionsO01–O12](https://github.com/trungtn87/11ship/blob/cdf030d28c85b6ecf9e9143e1e63b4a165ddb4c1/docs/roadmap/owner-decisions.md), [ADR004 reference](https://github.com/trungtn87/11ship/blob/cdf030d28c85b6ecf9e9143e1e63b4a165ddb4c1/docs/roadmap/references/pr7/ADR-004-driver-wallet-consistency.md).

Không coi toàn bộ roadmap Draft là quyết định mới thay code main. Nhiệm vụ mới chốt topology/CUSTOMER rõ; M02-A Owner08/10 chốt auto-hours rõ. Các source conflict còn được ghi D02/D06/D08/D09/D13; chỉ slice liên quan cần decision.

## 4. Ảnh và tài sản thiết kế

Đã xem ba upload thực tại project_sources: 01-1000002801-1-.jpg, 02-1000002790.jpg, 03-1000002796.jpg. Đã xem ba UI reference “11ship_driver_brand_yellow(1).png”, “Giao diện 11Food trên điện thoại(2).png”, “Bảng giao diện ứng dụng 11Food hiện đại(1).png”.

Font gốc từ PR35 [PlusJakartaSans-wght.woff2](https://github.com/trungtn87/11ship/blob/7b116c3d4551bf0028fa544278449598acf5991c/apps/admin-web/public/fonts/PlusJakartaSans-wght.woff2), kèm [OFL](https://github.com/trungtn87/11ship/blob/7b116c3d4551bf0028fa544278449598acf5991c/apps/admin-web/public/fonts/OFL.txt). Logo11 JPEG giữ nguyên, dùng làm asset tham chiếu; cần asset vector/wordmark chuẩn nếu có trước release, không tự dựng lại.

Deliverable trực quan riêng: **11Ship_UI_M00_M01_v2.pdf**,8trang, DESIGN_CANDIDATE; thể hiện M00/M01 và Admin reuse, không runtime/UAT evidence. Asset pack kèm ảnh/font/OFL nguyên gốc; không code sản phẩm.

## 5. Giới hạn audit và thay đổi

Đã đọc repository/migrations/PR diff/CI logs; chưa xác minh DB live data/migration history từ xa, Windows PC của Owner hoặc app Android. Không tự build/test triển khai thay Claude, deploy/merge/LOCK. Không sửa product source, migration, runtime/deploy config, PROGRESS hoặc plan.yml.

Review tiếp theo phải refresh main/PR head, kiểm diff sau audit và ghi design version mới nếu contract thay. Owner UI/business decision phải trỏ đúng scope/version/head; không dùng silent assumption.

## 6. Bổ sung chia gói giao Claude v2.0.1

[Danh mục gói nhỏ](08-work-packages.md), [quy tắc giao](claude-tasks/README.md), [manifest phụ thuộc](claude-tasks/manifest.json). IDs Mxx.NN chỉ là alias giao việc, không thay roadmap hay plan.yml. Nguồn thiết kế trước bổ sung: commit `5e351f5a570aac096c1ebb3504aa788cfd06822d` của PR48. Main kiểm lại `891a73b10b470b0a3a751c389e502eac576196bb` chỉ khác audit ở PROGRESS bot, không đổi code/schema/API; PR46 head vẫn `cf9eecadb6d50ec061d525d1bdf9b3f50d6d062b`.

Việc chia gói không đổi nghiệp vụ/UI v2.0.0, không tự đánh CODE_READY các API future hoặc nghiệm thu module. Mỗi gói có prompt riêng, dependencies và gate của app liên quan; gửi một gói mỗi lượt.
