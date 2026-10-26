# PR #224 — phạm vi thực thi

Owner giao Codex triển khai ngày 26/10/2026. Tiếp tục nhánh handoff/g02-shop-hours-dish-description; đã merge main có #208. Các PR #225–234 hiện là tài liệu giao việc; #226 sở hữu shell/router nên không sửa shell/router trong PR này.

File dự kiến: backend menu validation/repository/service/constants, discovery-service và ShopDiscoveryReader (metadata thời điểm refresh); migration additive menu description; order-customer-service (metadata refresh cart/preview); mobile m02 models/http/controllers/views, m10 cart/models/customer views (đọc mô tả và cập nhật availability); helper timer + tests tập trung. Không sửa quota/finance, lifecycle đơn, giờ đã lưu hay migration đã phát hành.

Kiểm chứng: mô tả rỗng/omitted/Unicode 300–301, lưu/đọc/xóa và guard chủ quán; đóng/mở đúng ranh giới, hẹn refresh/lifecycle, offline không quảng cáo ONLINE cũ. Giữ backend là nguồn quyền đặt đơn.
