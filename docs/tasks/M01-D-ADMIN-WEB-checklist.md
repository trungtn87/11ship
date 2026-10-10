# M01-D-ADMIN-WEB — checklist giao (điền theo mẫu)
Mẫu: [module-delivery-checklist](../templates/module-delivery-checklist.md). Quy trình: [11ship-delivery-workflow](../process/11ship-delivery-workflow.md).

- **Module/task:** M01-D-ADMIN-WEB (web quản trị: SYSTEM quản lý lời mời ADMIN, ADMIN kích hoạt, khôi phục).
- **Handoff:** `11Ship-Claude-Web-Admin-Implementation.md` (10/10/2026).
- **Backend nền:** PR #45 (nhánh `feat/m01-d-admin-1c-activation`) head `f37c1ad6ad5a5b2e7a6cadabe12f13c02f0ace10`, base `2e63da58ffb946ae0af5eced178a32bcc93a82d9`. Chuỗi: main ← #34 ← #37 ← #38 ← #41 ← #44 ← #45.
- **UI đăng nhập:** PR #35 được merge vào nhánh này (commit `3e35586`). PR web này là PR riêng, base là nhánh #45 (stacked).
- **Giai đoạn:** Draft PR. Chưa nghiệm thu local và điện thoại. Không merge, không deploy, không mark Ready, không đóng M01. LOCK_PROTOCOL vẫn NOT_FINAL.

Tài liệu này ghi trạng thái, KHÔNG phải nghiệm thu. Kết quả CI theo head cuối nằm trong mô tả PR.

## Màn hình → API → test
| Màn | API (prefix) | Test |
|---|---|---|
| A. Đăng nhập + mã Authenticator (ADMIN và SYSTEM) | `/v1/admin-auth/*` | `admin-web-browser.int.spec.ts` (#35), `admin-web-admin.int.spec.ts` (đăng nhập ADMIN/SYSTEM) |
| B. Danh sách/chi tiết lời mời, lọc | `GET /v1/admin/invitations[/:id]` | `provisioning-api.spec.ts`, `provisioning-controller.spec.ts`, spec browser (tạo, danh sách, lọc, chi tiết) |
| B. Tạo lời mời + step-up | `POST /v1/admin/operations`, `/:id/verify`, `POST /v1/admin/invitations` | như trên; mã sai/đúng; mất response → "Kiểm tra lại" cùng Idempotency-Key |
| B. Cấp lại / thu hồi (cả PENDING quá hạn) | `POST /v1/admin/invitations/:id/reissue`, `/revoke` | spec browser |
| B. Không đủ quyền (ADMIN) | `ADMIN_FORBIDDEN` (403) | spec browser; `provisioning-controller.spec.ts` |
| C. Kích hoạt: mở liên kết → OTP → mật khẩu → QR/Authenticator → xong → về login | `/v1/admin-activation/*` | `activation-api.spec.ts`, `activation-controller.spec.ts`, spec browser (F5 mọi bước, QR được giải mã độc lập bằng `support/qr-decode.ts`) |
| D. Khôi phục: liên kết sai, phiên hết hạn, bị thay thế, trùng SĐT, hết lượt, giới hạn tốc độ | mã lỗi thật của 1C | spec browser + unit |
| Bố cục điện thoại/bàn phím/nhãn | — | spec browser (390 px không cuộn ngang, nhãn, aria-invalid) |

## Nguyên tắc đã giữ
- Server quyết bước; trang không tự chọn bước.
- Không gửi lại gì một cách tự động. Mất response thì chỉ ĐỌC (`GET /state`, `GET /operations/:id`). Việc nghiệp vụ lặp lại dùng cùng Idempotency-Key và operation_id, và chỉ khi người dùng bấm.
- Liên kết, token, mật khẩu, mã, secret, nguồn QR không vào storage/log, bị bỏ khi không còn cần. Token đọc từ `#t=` và xóa bằng `history.replaceState` trước mọi request.
- Kích hoạt xong không tự đăng nhập.

## Câu chữ không có trong thiết kế đã duyệt (cần Owner duyệt)
Gom trong `ADMIN_COPY` của `apps/admin-web/src/core/messages.ts`: màn step-up, xung đột nghiệp vụ, kết quả/sao chép liên kết, các màn khôi phục kích hoạt, dòng TEST_DISPLAY, hạn đặt mật khẩu. Menu bên trái và bố cục shell mới theo mô tả "nền sáng, sidebar xám đậm, nhấn vàng"; chưa có ảnh UI chốt để đối chiếu.

## API còn thiếu cho web (không tự bịa)
- Không có khóa/mở khóa ADMIN, khôi phục 2FA, nhật ký, quản lý người dùng app, danh sách ADMIN đã kích hoạt.
- `GET /v1/admin/invitations/:id` luôn trả `activation.state = "NONE"`, nên chi tiết không hiện tiến độ kích hoạt.
- Chi tiết: [M01-D-ADMIN-WEB-api-inventory](M01-D-ADMIN-WEB-api-inventory.md).
- Việc backend riêng về no-store của body parser: [M01-D-ADMIN-BACKEND-transport-headers-followup](M01-D-ADMIN-BACKEND-transport-headers-followup.md).

## Chạy thử local
[M01-D-ADMIN-WEB-local-run](M01-D-ADMIN-WEB-local-run.md).
