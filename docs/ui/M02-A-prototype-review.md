# M02-A — duyệt mẫu HTML và bước nối API

Ngày 09/10/2026 (giờ Việt Nam).
Owner: “ok tạm ổn. tiếp”.
Mẫu tham chiếu: [M02-A.html](prototypes/M02-A.html).
Contract UI: [M02-A-UI.md](../tasks/M02-A-UI.md).

## Phạm vi đã được chấp nhận tạm thời

Bố cục hồ sơ quán, sửa hồ sơ, lịch tuần có Cả tuần, áp dụng rồi sửa từng ngày, editor nhiều khoảng/qua đêm/24h; màu theo brand guideline.
Đây là duyệt tạm bố cục và thao tác, chưa phải nghiệm thu ứng dụng hoặc UI_LOCKED cuối.
Figma chưa dựng được vì MCP Starter hết hạn mức. HTML được giữ làm reference để tiếp tục hoàn thiện; không ghi frame/node Figma giả.

## Giới hạn mẫu

Dữ liệu giả trong bộ nhớ; không API, không DB, không đăng nhập. Đồng hồ trình duyệt chỉ dùng minh họa; production availability phải dùng GET backend.
Font Plus Jakarta Sans tải từ Google Fonts; nếu offline sẽ fallback. Khi implementation phải kiểm font đúng và chiến lược assets theo foundation.
Có validation client mẫu; backend vẫn là nguồn kiểm cuối.
Đã kiểm cú pháp JavaScript và overlap/wrap/24h bằng Node. Chưa visual QA browser/Android. Không ghi E2E/UAT pass.
Selector khu vực cố định dữ liệu mẫu; chưa API danh sách khu vực. GPS thật chưa nối.

## Gói tiếp theo — frontend foundation M01 trước M02 API UI

Cần thiết kế riêng, Owner duyệt trước Claude code:
1. Web responsive frontend dùng thử, framework/toolchain, same-origin/proxy/API base URL và cấu hình staging.
2. Opaque-session client: vị trí lưu token, refresh/reload, router roleless/SHOP/DRIVER, revoked/expired, thay phiên; không logout giả.
3. API client theo envelope hiện hành: request_id, safe error mapping, timeout; mutation retry giữ logical body + key, không log token.
4. UI primitives theo brand: typography, form, button, modal, loading/error, navigation.
5. Login/register/OTP/onboarding nối contract M01; OTP thử theo spec môi trường được duyệt, không tự bypass xác minh.
6. Nguồn khu vực ACTIVE: endpoint backend read-only có quyền và response contract được thiết kế/review riêng. Không truy cập DB từ browser, không hard-code UUID production.
7. Môi trường bản chạy và test theo gói M00 đã khóa; không làm lại hạ tầng trong PR UI.

Chưa giao implementation M02-A-UI khi các gate trên còn mở.
Claude không phải tự quyết kiến trúc session/frontend hoặc tự mở API khu vực.

## Điều kiện bàn giao M02-A-UI sau foundation

- Owner chốt reference HTML/copy và ghi quyết định về gate Figma; duyệt tạm không tự thay requirement FIGMA_REQUIRED.
- Frontend dùng primitives/router/API client foundation M01.
- Hồ sơ/lịch nối ba endpoint thật, availability từ DB, xử lý full replacement/version conflict/retry.
- Khu vực và GPS có nguồn thật được khóa.
- Browser visual QA desktop/mobile, E2E API/DB và Owner UAT là các bước riêng.
- PR implementation Draft; ChatGPT review; Owner duyệt merge.
