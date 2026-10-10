# 00 - Kiểm kê hiện trạng

Version 2.0.0; 11/10/2026; **READ_ONLY_AUDIT / NOT_ACCEPTANCE**. Main [e5b50e8](https://github.com/trungtn87/11ship/commit/e5b50e8567b8928646c83648dd70f577915dc14f). Đã clone và đọc code, migration, workflow và các nhánh/PR liên quan. Chưa audit dữ liệu DB đang chạy; chưa tự chạy lại full product suite trong phiên thiết kế. CI dưới đây là kết quả GitHub đã truy xuất tại exact SHA.

## 1. Đã có / Thiếu / Cần sửa / Bổ sung mới

| Hạng mục | Đã có | Thiếu/cần sửa | Bổ sung thiết kế |
|---|---|---|---|
| Nền backend | Main: health, error envelope, config, PG/TLS, migration | Bản ba app chạy thực tế và chứng cứ UAT | M00-PC gate |
| Transaction | Main: transaction manager, idempotency, audit, outbox dispatcher | Adapter delivery/wallet/push chưa có | Giữ ports và lock ordering |
| Auth USER | Main: REGISTER OTP, register, login, role/select, me | CUSTOMER, logout public, reset, phiên một thiết bị toàn tài khoản | M01-B/CLIENT |
| Quán | Main: onboarding draft/read/complete, profile, weekly hours | UI hoàn chỉnh; geofence; giữ auto-hours Owner08/10 đã chốt | M01 phần hồ sơ; M02 vận hành |
| Xế | Main: create profile EXTERNAL/PENDING, DRIVER role/guard | Read/resume/profile/bank/approve/online/stop, UI | M03; không làm activation giả trong M00 |
| Launcher local cũ | Main #39/#40: Start/Update/Test/Stop/Status, DEV/TEST riêng | Chỉ backend, Status còn tên 5 app cũ | Giữ lệnh cũ, thêm ba app |
| Ba launcher | #46 Draft `cf9eecadb6d50ec061d525d1bdf9b3f50d6d062b` | CI đỏ; Food/Ship throw chưa triển khai | Hoàn thiện #46; không viết lại launcher nền |
| Admin backend | #34 Draft `08910ed92608d102da29d45ae1a8e5afd14dbcd1`, CI Verify success | Chưa main/UAT | Tích hợp reviewed login/TOTP/bootstrap |
| Admin Web | #35 Draft `7b116c3d4551bf0028fa544278449598acf5991c`, Verify success | Chưa main; cần local TLS/bootstrap | Giữ UI/API đã có |
| Staging tích hợp | #42 Draft `13a596254fed75544bfc1f461d48086c863e4c43`, Verify/Windows success | Chưa merge; deploy/Owner login chưa kiểm lại trong phiên này | D4/D5 evidence riêng |
| Fixture staging | #27 Draft `18cb54b6afc524655c075958bb61b84164e43532`, Verify/Windows success | Không phải SMS thật; cần rà license/tài khoản test đúng origin | Không đưa fixture vào prod |
| ADMIN invitations | #37/#41/#45 Draft; #41 `4ab9c9c...`, #45 `f37c1ad...`, Verify success | UI provisioning/activation/scope test chưa đủ toàn M01 | Dùng lại contract, không gộp M00 |
| Reset password | #43 open `b853c88f8f7f54b7ecb8a74df67f75ca807aeb33`: Owner đã duyệt nghiệp vụ | Chưa code/schema/API | Reset USER/ADMIN, SYSTEM CLI/email |
| UI thử cũ | #29 web quán/xế; #31 native Java diagnostics, 3 flavor | Chưa main; #31 không phải app Auth hay app bán hàng hoàn chỉnh | Kế thừa token/health sau review, đổi 2 package ở native slice |
| Thực đơn/Order/Delivery/Ví/GPS/Reports | Roadmap #28 và finance design #7 Draft | Không có business controllers/tables tương ứng trên main | M04-M12 theo slice |

## 2. Mã nguồn/API thực có

Main chỉ có `apps/backend` trong npm workspace. Không có `apps/admin-web`, `apps/food-web`, `apps/ship-web` trên main. 7 SQL migration, schema `app`: `idempotency_records`, `audit_logs`, `outbox_events`, `users`, `user_roles`, `phone_verifications`, `verification_proofs`, `sessions`, `service_areas`, `shops`, `shop_members`, `drivers`, `shop_business_hours`. Tên ledger migration của local là `public.pgmigrations`; runner từ xa quản lý `app.pgmigrations`. Không trộn hai môi trường.

Auth hiện `SUPPORTED_ROLES=['DRIVER','SHOP']`; register trả `available_roles:[]`, `active_role:null`, `onboarding_required:true`. Không thể làm UI tự giả CUSTOMER. Quán complete mới cấp SHOP; active/selectability còn phụ thuộc hồ sơ. Driver self-onboarding bắt buộc EXTERNAL/PENDING; không cấp PLATFORM từ body.

Một thiết bị: code chỉ revoke các phiên **SHOP-context khác** khi select SHOP, chưa enforce toàn USER. Onboarding quán vẫn nhận `service_area_id`; `service_areas` chưa có polygon/geometry. M02-A bỏ route manual switch theo quyết định Owner08/10, availability theo weekly schedule. Giữ hành vi này; D02 session và D04 geometry là các khoảng trống phải xử lý ở slice tương ứng.

## 3. Findings launcher #46

| ID | Mức | Bằng chứng | Claude cần làm |
|---|---|---|---|
| L01 | Chặn | Linux Verify job 114272409163 và Windows job 114272409345 failure; Windows summary 209 pass / 4 fail, Linux 191 pass / 4 fail / 2 skip | Bổ sung behavioral test ba wrapper, exit code, readiness và regressions; không chỉ xóa assertion |
| L02 | Chặn | `Start-Launcher` nhận backend owned đang chạy mà không so SHA/built fingerprint | Restart đúng process owned khi artifact thay đổi; không báo app mới với backend cũ |
| L03 | Chặn | Admin probe chỉ kiểm cổng/HTTP 200, không state PID/path/start time/fingerprint | Ownership + manifest + API health; foreign 8443 phải báo lỗi |
| L04 | Chặn | Food/Ship hiện throw | Shell chạy thật, ba URL và tích hợp health thật |
| L05 | Cao | Admin `npm run build:admin-web` dùng cwd của caller | Mọi build/start phải chốt cwd về repo; test đường dẫn có dấu/khoảng trắng |
| L06 | Cao | `curl -k` bỏ xác minh TLS; file cert chưa được prepare | Local cert đúng SAN/trust hoặc pin cert để health probe; không global bypass; browser HTTPS đúng origin |
| L07 | Cao | Không lock chung quanh Update/Start; ba double-click có thể build/migrate đồng thời | Single orchestration lock, bounded wait, recheck, PID state atomic |
| L08 | Vừa | `Status` vẫn N/A với 5 app; sau pull orchestrator cũ tiếp tục chạy | Ba app; process/asset SHA; re-exec launcher nếu chính script vừa đổi |

L02/L03/L05-L08 là review từ code, chưa chứng minh bằng runtime fault test. L01 là lỗi thực từ CI. Handoff yêu cầu Claude tạo test kiểm chứng để review kết luận.

## 4. Nguồn giao diện

Đã xem ba ảnh upload local: `1000002801(1).jpg` (brand/slogan), `1000002790.jpg` (palette cũ + slogan cũ), `1000002796.jpg` (logo mark). Đã xem các ảnh UI được chọn: `11ship_driver_brand_yellow(1).png`, `Giao diện 11Food trên điện thoại(2).png`, `Bảng giao diện ứng dụng 11Food hiện đại(1).png`.

Màu chính theo guideline: #D8AD18/#2A2A2E/#FFFFFF/#F2F1EE; font Plus Jakarta Sans. Slogan hiện hành: Cần là có / Thèm là có / Gọi là có. Các caption trong ảnh cũ không thay đổi app topology mới. Google login, OTP login, ưu đãi/freeship/thưởng, ví COD và chat không có contract nên không kích hoạt.

## 5. Kết luận tiến độ và next task

M00 **có nền backend và launcher cũ**, chưa đạt bộ ba app chạy local. M01 **có Auth A1/A2 trên main và nhiều slice quản trị trên Draft**, chưa hoàn tất tài khoản CUSTOMER, logout/reset/scope/UI/UAT. M02 có backend A trên main, chưa đóng module. M03-M12 mới ở mức thiết kế/kế hoạch trong các nguồn đã kiểm.

Task tiếp theo: **M00-3APP** - sửa/integrate launcher, hai shell web, reuse Admin, build manifest/diagnostics/test Windows, giao Owner PC. Không đóng M00 hoặc merge các Draft tự động.

## 6. Kiểm lại trước bàn giao

Main refresh `6aa363ce7b2d412fd2ee1fcd5c2ea3ab2132811e`: chỉ bot cập nhật docs/PROGRESS.md, không đổi code/schema/API so audit base. PR34/35/46 head không đổi. Thiết kế tiếp tục dựa vào source audit đã pin; Claude phải fetch head mới khi nhận việc.
