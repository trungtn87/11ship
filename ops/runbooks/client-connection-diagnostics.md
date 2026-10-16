# Trạng thái kết nối và chẩn đoán của 11Food / 11Ship (M00.04)

Áp dụng cho hai ứng dụng điện thoại 11Food (khách, quán) và 11Ship (shipper), qua bản web PC dùng làm runtime thử. Không áp dụng cho Web quản trị. Đây là hướng dẫn kỹ thuật; **chưa phải kết quả Owner test**.

## Người dùng thấy gì

| Chỗ | Nội dung |
|---|---|
| Dưới thanh tiêu đề của mọi màn hình | **Banner kết nối**. Máy chủ sẵn sàng thì **không hiện gì**. Khi đang kiểm tra lần đầu hoặc sau một sự cố, hiện "Đang kiểm tra kết nối…". Khi có sự cố hiện thông báo tiếng Việt, giờ kiểm tra gần nhất và nút **Thử lại**. |
| Tài khoản (khách) → **Chẩn đoán kết nối** (`/diagnostics`) | Màn F05 (11Food) / S06 (11Ship): ứng dụng, địa chỉ, bản dựng, mã nguồn, dấu vân tay bản dựng; kết quả `live` và `ready`; giờ kiểm tra gần nhất; nút **Kiểm tra lại** và **Sao chép thông tin lỗi**. |

## Các trạng thái

| Trạng thái | Nghĩa | Thường do |
|---|---|---|
| Đang kiểm tra | Một lần kiểm tra đang chạy; kết quả cũ đã bị gỡ | Mở ứng dụng, bấm Thử lại, mạng trở lại |
| Máy chủ sẵn sàng | `/v1/health/live` = 200 `{"data":{"status":"ok"}}` **và** `/v1/health/ready` = 200 `{"data":{"status":"ready"}}` | Bình thường |
| Máy chủ chưa sẵn sàng | `live` đạt nhưng `ready` trả HTTP 503 | Backend chạy, cơ sở dữ liệu chưa kết nối được |
| Không có kết nối mạng | Yêu cầu không tới được máy chủ | Mất mạng, backend/proxy tắt, cổng sai |
| Máy chủ phản hồi quá lâu | Không có phản hồi đầy đủ sau **5 giây** | Backend treo, mạng rất chậm |
| Máy chủ phản hồi chưa đúng | HTTP khác 200 (ở `ready`: khác 200 và 503) hoặc nội dung không đúng thoả thuận | Địa chỉ không phải backend 11Ship, proxy trả lỗi, bản backend khác |

Quy tắc: mỗi yêu cầu có giới hạn 5 giây; không dùng cache (`no-store`, kể cả khi máy chủ cho phép cache); không gửi cookie, `Authorization` hay token; nội dung phản hồi phải đúng từng chữ; kết quả của lần kiểm tra cũ không bao giờ ghi đè kết quả của lần kiểm tra mới hơn. Ứng dụng hỏi lại mỗi 30 giây khi trang đang hiện, khi mạng trở lại và khi trang hiện lại; nút **Thử lại** hỏi ngay. Khi trình duyệt báo mất mạng, banner hiện "Không có kết nối mạng" ngay, không chờ hết 5 giây.

## Mở ứng dụng thật cần máy chủ `/v1`

Ứng dụng gọi **cùng địa chỉ** với trang (`/v1/health/live`, `/v1/health/ready`) và đọc `/build-manifest.json`. Trình tự mở có proxy tới backend là gói **M00.05** (chưa có). Trước đó, nếu mở bản build bằng máy chủ tĩnh không chuyển tiếp `/v1`, màn hình sẽ hiện "Máy chủ phản hồi chưa đúng" kèm HTTP 404 trong chẩn đoán. Đó là hành vi đúng, không phải lỗi hiển thị.

Môi trường DEV/TEST **không** được ứng dụng hiển thị (ứng dụng không biết cơ sở dữ liệu nào đứng sau máy chủ); màn chẩn đoán hiện địa chỉ ứng dụng thay cho tên môi trường.

## Xem các trạng thái mà không cần gây lỗi thật

`npm run ui:preview` (hoặc `Xem-Giao-Dien.cmd`) → 11Food hoặc 11Ship:

- **Tài khoản › Chẩn đoán kết nối** (F05/S06), sáu trạng thái: Sẵn sàng, Đang kiểm tra, Backend chưa ready, Offline, Quá thời gian chờ, Phản hồi sai nội dung;
- **Trạng thái chung › Banner kết nối** (F06), cùng các trạng thái.

Bản xem thiết kế dùng ví dụ cố định, nhãn "Dữ liệu minh họa", **không gọi máy chủ** (CSP `connect-src 'none'`), nút Kiểm tra lại không làm gì.

## Gửi thông tin cho người hỗ trợ

**Sao chép thông tin lỗi** đưa vào clipboard: tên ứng dụng, địa chỉ, bản dựng, mã nguồn, dấu vân tay, trạng thái, kết quả từng yêu cầu (mã HTTP, thời gian) và giờ kiểm tra. Nội dung chỉ dùng từ vựng cố định và dữ kiện bản dựng; không có cookie, token, thông báo lỗi thô hay chuỗi kết nối. Nếu trình duyệt không cho ghi clipboard, màn hình hiện văn bản để chọn và sao chép tay.

## Chạy kiểm thử

| Việc | Lệnh | Cần |
|---|---|---|
| Logic: timeout, body sai, ready 503, offline, retry, generation, sanitize | `node --test tests/client-shell/health.test.mjs` | Node |
| Trình duyệt thật 360/390/430/1366, bàn phím/focus, vùng chạm 44px, cache, cookie, CSP | `node --test tests/client-shell/connection-browser.test.mjs` | Chrome/Chromium (`CHROME_BIN` hoặc đường dẫn phổ biến; **không bỏ qua** khi thiếu) |
| Cả bộ client-shell | `npm run client-shell:test` | như trên |
| Backend thật (Nest + PostgreSQL) | `npm run test:integration` (spec `client-health.int.spec.ts`) | PostgreSQL TEST :5433 theo hướng dẫn hiện có |

Đặt `SHOT_DIR=<thư mục>` khi chạy test trình duyệt để lưu ảnh JPEG từng trạng thái. Trong test trình duyệt, máy chủ health là **giả có kiểm soát** (để gây từng lỗi theo ý muốn); bằng chứng với backend thật nằm ở spec tích hợp. Test trình duyệt trên PC **không thay thế** kiểm tra runtime Android và không phải test nghiệp vụ.

## Việc chưa có trong gói này

- Logo gốc: `apps/client-shared/public/brand/` vẫn chờ file của Owner; giao diện hiện tên ứng dụng dạng chữ (`data-logo-placeholder`).
- Runtime Android/native, đăng nhập, ví, đơn hàng, GPS nghiệp vụ.
- Test của Owner trên máy tính và điện thoại: **CHƯA CHẠY**.
