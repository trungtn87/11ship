# M00 — Checklist nghiệm thu Owner

Phiên bản **2.0.0**; **TEMPLATE / NOT_RUN**. Task **M00-3APP**. ChatGPT thiết kế/review; Claude code/test/sửa; Owner Windows PC/thiết bị/nghiệm thu. Actual trống không phải PASS.

Trước test điền: branch/mode(main hoặc UAT), full backend/client SHA, build fingerprint/checksum, ngày giờ Việt Nam, Windows/PowerShell/Node/npm/Docker/browser, ba URL, DB DEV, người test. Không ghi password/token/QR secret. Link nguồn module/PR trong 00/07.

## 1. Gate kỹ thuật trước khi giao Owner

- [ ] UI/version được Owner duyệt; quyết định chưa áp dụng ghi rõ.
- [ ] Admin dependency #34/#35 đã review, tương thích migration với integration head.
- [ ] Verify + Windows5.1 + shell checks đạt trên exact final head; không skip case bắt buộc.
- [ ] ChatGPT review hết findings L01–L08 và liên thông; scope không mở business M01.
- [ ] HTTPS đúng SAN/trust, SYSTEM/bootstrap/TOTP/limit-config đã setup an toàn.
- [ ] DEV tách TEST/staging; giữ dữ liệu; backup nếu dependency migration cần.
- [ ] Runbook setup một lần, sau đó Owner chỉ double-click.

## 2. Hai mươi ca PC bắt buộc

Các fault cases chạy trên checkout/DEV thử tách khi cần; không làm hỏng dữ liệu Owner hoặc chiếm cổng máy làm việc ngoài phạm vi test.

| ID | Thao tác Owner | Kết quả phải đạt | Actual/evidence |
|---|---|---|---|
| PC01 | Bấm Admin shortcut từ Desktop | Update/verify đúng SHA, mở8443 đúng app, certificate không warning | Chưa chạy |
| PC02 | Login SYSTEM và nhập Authenticator | Chỉ vào shell sau TOTP hợp lệ; không lộ secret | Chưa chạy |
| PC03 | F5 Admin; logout; mở protected URL | State phục hồi từ server; logout thật, protected bị chặn | Chưa chạy |
| PC04 | Bấm Food shortcut | Food8444, logo/slogan/palette, phone canvas, health thật | Chưa chạy |
| PC05 | Bấm4tab Food và account | Navigation/empty/guest đúng; Auth chưa nối disabled/lý do | Chưa chạy |
| PC06 | Bấm Ship shortcut | Ship8445, đúng brand, guest và health; Online bị chặn rõ | Chưa chạy |
| PC07 | Bấm5tab Ship | Empty/account đúng; không fake wallet/thu nhập/GPS/assignment | Chưa chạy |
| PC08 | Bấm ba launcher gần đồng thời | Một backend; đúng ba frontend; update/build/migration tuần tự | Chưa chạy |
| PC09 | Đóng ba browser rồi mở lại | Backend/DEV còn; reuse verified process, không tạo trùng | Chưa chạy |
| PC10 | Cập nhật source được duyệt rồi launch | Rebuild/restart owned đúng source SHA/fingerprint; không backend cũ | Chưa chạy |
| PC11 | Dirty/diverged tracked file trong checkout thử | Refuse update; không stash/reset/chạy nhầm head | Chưa chạy |
| PC12 | Ngắt Internet rồi launch update | Git error cụ thể; không báo cập nhật thành công hoặc xóa DB | Chưa chạy |
| PC13 | Dừng backend/DB trong môi trường thử; Recheck | Banner đúng; live OK/ready503 không coi Connected | Chưa chạy |
| PC14 | Foreign service trả200 chiếm cổng frontend | PORT_IN_USE; không mở app lạ/kill foreign process | Chưa chạy |
| PC15 | Pending DEV migration; decline/accept | Đích/danh sách rõ; decline dừng; accept apply một lần/history thật | Chưa chạy |
| PC16 | Stop rồi Start | Chỉ owned processes dừng đủ; DEV sentinel còn; Start phục hồi | Chưa chạy |
| PC17 | Chạy technical Test khi có DEV sentinel | TEST riêng; DEV không thay đổi; log không secret | Chưa chạy |
| PC18 | Repo path có dấu/khoảng trắng; thiếu tool ở first setup | Đúng cwd hoặc báo thiếu tool/hướng sửa rõ | Chưa chạy |
| PC19 |360/390/430px, PC1366×768, zoom125% | Không clip/overflow; touch≥44px; focus/font/keyboard hợp lý | Chưa chạy |
| PC20 | Mở diagnostics/copy error | App/env/runtime SHA/health rõ; sanitized, không DSN/password/token | Chưa chạy |

Claude phải cung cấp thêm evidence automated: stale PID, corrupt state, cert expiry/SAN mismatch, build failure, migration failure, lock timeout, UAT SHA pin, lost/unparseable health và response cũ. Owner không phải tự dựng mọi fault injection bằng lệnh tay.

## 3. Ma trận ba bề mặt và liên thông

| Bề mặt | Thiết kế | Code/CI/review | Owner PC | Thiết bị/browser thật | Owner accept |
|---|---|---|---|---|---|
| Admin | Candidate | Chưa chứng minh integration head | Chưa | Theo scope M01 | Chưa |
| Food khách | Candidate | Chưa | Chưa | Native slice riêng | Chưa |
| Food quán | Entry/shell; Auth M01 | Chưa | Chưa | M01/M02 riêng | Chưa |
| Ship xế | Candidate | Chưa | Chưa | Native slice riêng | Chưa |
| Backend/DEV/liên thông | Có nền main | Cần final three-app head | Chưa | Remote gate riêng | Chưa |

## 4. Bằng chứng và điều kiện đóng

**M00-PC-ACCEPTED <full SHA>** chỉ ghi sau PC01–PC20 đạt, blocker được sửa/retest và Owner xác nhận đúng scope. Mốc này chứng nhận bộ ba bề mặt thử trên PC, không chứng nhận Auth CUSTOMER/M01business hoặc Android native.

Trước LOCK toàn M00, rà các slice remote/setup/portability/native trong roadmap và evidence D1–D5; gate phone áp dụng hoặc Owner duyệt N/A/phạm vi theo D01. Thông tin lịch sử “đã deploy/login” không tự chứng minh snapshot mới.

Quyết định Owner ghi task/module, approved scope, exact full SHA+checksum, environment, PASS/open/waiver có lý do, tester/date, link lời quyết định và PR được cho merge. CI xanh hoặc merge docs không thay acceptance.

Nếu lỗi: Owner ghi thao tác/mong muốn/thực tế và screen ID; ChatGPT cập nhật thiết kế/finding; Claude sửa/test; ChatGPT review new SHA; Owner retest affected cases và liên thông. Không mang acceptance head cũ sang code mới.
