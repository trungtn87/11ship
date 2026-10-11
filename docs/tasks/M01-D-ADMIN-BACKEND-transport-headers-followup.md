# Việc backend riêng: no-store cho lỗi của body parser ở `/v1/admin-auth` và `/v1/admin`

Ghi theo mục 6 của handoff web quản trị. Đây là việc backend riêng, **không sửa trong PR web quản trị**.

## Hiện trạng (đọc từ code ở head #45)
- `AdminAuthModule.configure()` gắn `noStoreMiddleware` bằng `consumer.apply(...).forRoutes(AdminAuthController, AdminProvisioningController)`.
- Middleware của module chạy SAU body parser của Nest.
- Hệ quả: body JSON sai cú pháp hoặc quá lớn bị chính body parser trả lời trước khi tới route. Câu trả lời đó có thể thiếu `Cache-Control: no-store` (và các header truyền tải đi kèm) trên `/v1/admin-auth/*` và `/v1/admin/*`.
- `/v1/admin-activation` đã tránh lỗi này: `configureApp` (`app.setup.ts`) dùng `app.use('/v1/admin-activation', activationTransportMiddleware)` trước body parser, và có test `admin-activation-transport.spec.ts`.

## Đề xuất
1. Áp cùng cách cho `/v1/admin-auth` và `/v1/admin` trong `configureApp`: `app.use` đặt trước body parser, và giữ phần middleware trong module nếu còn cần.
2. Thêm test transport tương tự activation: JSON hỏng và body quá lớn trên từng prefix đều có `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.
3. Kiểm lại rằng lỗi parser vẫn đi qua envelope `{error:{code,message,request_id}}` hiện có.

## Ảnh hưởng tới web quản trị
- Web không phụ thuộc vào header này để đúng chức năng: nó không lưu token/secret ở storage, không dùng cache của trình duyệt cho dữ liệu nhạy cảm.
- Front local `scripts/admin-web-dev.mjs` chuyển tiếp nguyên header của backend; nên khi backend sửa, web hưởng ngay.

## Phạm vi
Chỉ backend. Cần ChatGPT/Owner giao thành task; không nằm trong M01-D-ADMIN-WEB. LOCK_PROTOCOL vẫn NOT_FINAL.
