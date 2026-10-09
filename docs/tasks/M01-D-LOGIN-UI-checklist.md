# M01-D-LOGIN-UI — checklist giao (điền theo mẫu)
Mẫu: [module-delivery-checklist](../templates/module-delivery-checklist.md). Quy trình: [11ship-delivery-workflow](../process/11ship-delivery-workflow.md).

- **Module/task:** M01-D-LOGIN-UI (web quản trị: đăng nhập, Authenticator, giữ trạng thái khi F5, shell, đăng xuất).
- **Handoff:** `docs/tasks/CLAUDE-M01-D-LOGIN-UI-handoff-2026-10-09.md` @ `bb5d6c97ab2f1b2853765d218ad76cc9816c9952` (nhánh `design/m01-complete-roadmap`, PR #30). Nguồn visual là `M01-D-auth-UI-v1.md` cùng SHA.
- **Base:** nhánh `feat/m01-d-login-backend` (PR #34, chưa merge) @ `4d20660eb3b0656b626a084df6e55d4385ee405a`. PR UI là PR riêng, base là nhánh đó (stacked).
- **Giai đoạn:** Draft PR, chờ review.

Tài liệu này ghi trạng thái, KHÔNG phải nghiệm thu. Kết quả CI theo head cuối nằm trong mô tả PR.

## Quyết định preflight (cần ChatGPT/Owner review)
1. **Stack frontend:** TypeScript thuần, không framework, không thêm gói npm.
   - Môi trường làm việc bị chặn npm registry (403), và CI bắt `package-lock.json` không đổi sau `npm ci`, nên không thêm được React/Vite.
   - `tsc` có sẵn trong repo biên dịch ra ES module cho trình duyệt. Backend không đổi công nghệ.
   - Nếu sau này cần framework thì làm thành task riêng, có lockfile sinh ở máy có registry.
2. **Vị trí:** `apps/admin-web` (src/core không phụ thuộc DOM nên test được trong Node; src/dom là phần giao diện).
   - Không phải npm workspace, nên lockfile giữ nguyên.
   - Build bằng `npm run build:admin-web`. `npm run build` vẫn chỉ build backend, để lệnh build của Render không đổi.
   - `npm run typecheck`, `lint` và unit test có bao gồm web quản trị.
3. **QR:** vendored `qrcodegen.ts` của Project Nayuki (MIT, commit ghi trong `src/vendor/README.md`).
   - QR được vẽ ngay trong trang dưới dạng SVG từ `otpauth_uri`. Không gửi URI ra dịch vụ ngoài.
4. **Font:** Plus Jakarta Sans tự host (bản variable woff2 từ repo gốc, OFL). Không tải từ CDN.
5. **HTTPS local cùng origin:** `scripts/admin-web-dev.mjs`.
   - Chỉ chuyển tiếp `/v1/admin-auth/*`. Bỏ header forwarding do client gửi.
   - Backend giữ `ADMIN_AUTH_TRUSTED_PROXY_IPS=[]`. Không hạ Secure/SameSite, không tắt Origin/CSRF.
   - Hướng dẫn: [M01-D-LOGIN-UI-local-run](M01-D-LOGIN-UI-local-run.md).
6. **device_id:** chuỗi ngẫu nhiên `web-<32 hex>` lưu ở localStorage để cùng một trình duyệt gửi cùng nhãn. Nhãn này không mang quyền.
   - Không có credential, secret hay CSRF nào trong localStorage/sessionStorage. Test browser kiểm điều này.

## Xung đột / thiếu trong thiết kế (trả về ChatGPT/Owner)
- **Logo:** handoff yêu cầu "logo 11 từ asset thương hiệu repo", nhưng repo chưa có asset. Brand guideline mục 12 còn ghi "asset logo SVG/PNG chính thức" là việc mở.
  - Tôi không tự vẽ logo. Vị trí logo đang hiện chữ "11" làm chỗ giữ. Khi có asset chỉ cần thay `brand()` trong `src/dom/view.ts`.
- **Câu chữ chưa có trong thiết kế:** gom trong `src/core/messages.ts`, nhóm "Pending approval":
  - "Bước xác thực đã thay đổi. Vui lòng kiểm tra và tiếp tục." (CSRF đổi hoặc tab khác).
  - "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau mm:ss." và "Bạn có thể thử lại." (429).
  - Màn kiểm tra "Đang kiểm tra phiên đăng nhập…".
  - Màn lỗi kết nối với nút "Thử lại".
  - Nút "Tải lại mã QR".
  - Các bước hướng dẫn thiết lập.
  - Chữ "Vai trò:" trong shell.
- Ảnh UI v1 đã duyệt không có trong repo, nên tôi bám mô tả chữ của UI v1 và token thương hiệu. Bố cục cụ thể cần ChatGPT/Owner đối chiếu với ảnh đã chốt.

## Hành vi đã làm (theo handoff)
- **Reload:** GET /state.
  - SESSION: gọi GET /me rồi mới vào shell. Trong lúc chờ là màn trung tính, không nháy shell.
  - PREAUTH: vào đúng bước ENROLL_TOTP hoặc VERIFY_TOTP. Secret thiết lập được tải lại qua endpoint được bảo vệ.
  - 401: về màn login.
- **Login:** phone, password và device gửi đúng parser backend; SĐT kiểm như backend. Mật khẩu xóa khỏi ô ngay khi request đã gửi. CSRF chỉ giữ trong memory.
- **Enrollment:** QR SVG vẽ local. Khóa thiết lập ẩn mặc định, chỉ đưa vào DOM khi người dùng bấm hiện. Secret và CSRF của bước bị xóa khỏi memory ngay sau MFA thành công.
- **Ô mã:** một ô, chỉ giữ chữ số ASCII, tối đa 6 số, giữ số 0 đầu. Dán "123 456" vẫn được. Không tự gửi khi đủ 6 số.
- **Shell:** "Đăng nhập thành công" và vai trò lấy từ GET /me, kèm nút Đăng xuất. Không có dữ liệu hay CTA nghiệp vụ.
- **Logout:** chỉ chấp nhận 204. Mất request hoặc lỗi thì vẫn ở shell và báo lỗi.
- **Lỗi:** mapping đúng bảng trong handoff.
  - 429: đếm ngược theo Retry-After, nút bị khóa trong lúc đếm. Hết giờ chỉ mở lại nút, không tự gửi.
  - CSRF: không lặp lại mutation, đọc lại state rồi báo bước đã thay đổi.
- **Mất response sau MFA:** chỉ đọc GET /state, không gửi lại mã.
  - SESSION: vào shell.
  - Bước còn sống: ở lại, báo "Chưa thể kết nối".
  - 401: về login với câu "Đăng nhập lại và dùng mã mới trong Authenticator."
- **Hai tab:** khi tab hiện lại, trang đọc GET /state và đi theo đó; bước đổi thì báo cho người dùng. Bước preauth hoặc phiên hết hạn thì đọc lại state đúng lúc hết hạn.

## Kiểm thử
| Nhóm | File | Loại |
|---|---|---|
| Unit: API client, mapping lỗi, Retry-After, ô mã/SĐT, QR, controller (reload, chống bấm lặp, 429, mất response, dọn secret, không có quyền trước MFA, hai tab) | `apps/admin-web/src/core/*.spec.ts` | Server giả lập theo kịch bản. KHÔNG phải integration |
| Browser integration: trang đã build, Chrome headless thật, HTTPS front thật, backend Nest + PostgreSQL thật | `tests/integration/admin-web-browser.int.spec.ts` | Integration thật, chạy trong CI ở cả local mode và CI mode |

Browser integration kiểm:
- Login sai/đúng.
- Enrollment có QR; khóa thiết lập ẩn/hiện.
- F5 ở bước enrollment trả lại đúng secret.
- Mã sai, rồi mã đúng.
- Cookie `__Host-` có Secure, HttpOnly, SameSite=Strict, Path=/; phiên sống 8 giờ.
- Không có gì trong storage; `document.cookie` rỗng.
- F5 giữ shell; logout trả 204, cookie bị xóa, phiên bị thu hồi.
- Mobile:
  - SĐT sai bị chặn ngay trên trang, không có request.
  - Mã dán có dấu cách.
  - Hai tab dùng chung cookie: CSRF cũ bị từ chối, trang báo bước đã đổi, người dùng nhập lại thì thành công.
  - Phiên bị thu hồi thì F5 về login.
  - 429 hiện đếm ngược và khóa nút.

Ảnh desktop/mobile lấy từ chính test này. Chưa kiểm: Google Authenticator thật trên điện thoại, trình duyệt thật của Owner, mất response ở mức browser (đã kiểm ở mức unit và backend).

## Checklist
- [x] Kiểm kê nguồn, backend thực tế và repo; ghi phần thiếu (logo, câu chữ chưa duyệt).
- [ ] Owner duyệt câu chữ bổ sung và vị trí logo tạm.
- [x] Code, unit test, browser integration test; CI tại head cuối: xem mô tả PR.
- [ ] ChatGPT review đúng SHA.
- [ ] Owner chạy local và test Authenticator thật (sau khi tiếp tục M00).
- [ ] Bản test điện thoại: chưa làm (ngoài phạm vi).
- [ ] Owner quyết định nghiệm thu/merge. PR #34 phải merge trước.

## Ma trận từng ứng dụng
| Ứng dụng | Phạm vi | Nghiệp vụ/UI duyệt | Code/CI/review | Local | Thiết bị thật | Owner nghiệm thu |
|---|---|---|---|---|---|---|
| Web quản trị | Login, Authenticator, F5, shell, logout | UI v1 đã chốt màn login; câu chữ bổ sung và logo tạm chờ duyệt | Code xong; CI xem PR; chờ review | Chưa kiểm chứng (chờ M00) | Chưa kiểm chứng | Chưa |
| Khách / Quán / Xế / App quản lý | N/A: task này không đổi các app | — | — | — | — | Quyết định Owner |
| Liên thông | Web quản trị ↔ backend PR #34 | — | Browser integration trong CI | Chưa kiểm chứng | Chưa kiểm chứng | Chưa |
