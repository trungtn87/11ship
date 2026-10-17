# Valhalla M14 — test Render, triển khai VPS sau

Service test riêng: https://one1ship-m14-routing.onrender.com. Gói Render **free**, không DB, không disk trả phí; tự ngủ khi không dùng nên yêu cầu đầu tiên có thể chậm. Không sửa các service Render khác. Auto-deploy tắt để thay đổi nhánh không tự triển khai.

`Dockerfile` pin Valhalla 3.9.1 theo digest; build graph từ PBF Geofabrik đi kèm nhánh, một luồng build. Graph bbox `[105.85,22.25,106.70,23.08]` rộng hơn vùng map để có đường vòng. Không tải dữ liệu trong mỗi lần khởi động runtime. API chỉ có `GET /health` và `POST /route`, ép motorcycle/kilometers, đúng hai điểm trong vùng phủ; không fallback đường thẳng. Giới hạn hai request đồng thời và 20 request/phút theo IP nhìn thấy tại gateway. Không có API upload lịch sử hay ghi log tọa độ. HTTPS do Render cấp; engine chỉ nghe loopback trong container.

Kiểm tra thật đã chạy bằng `python3 ops/m14/smoke.py <origin>`: Đường Pác Bó đến Đường Tân An, tuyến 1,553 km; điểm ngoài vùng bị từ chối. Báo cáo CI `M14-Render-route-proof` và `routing-smoke.json` ghi bằng chứng. Cấu hình motorcycle là chi phí tuyến dựa trên quyền tiếp cận OSM; cần đối chiếu với đường thực tế/biển cấm và không phải dẫn đường rẽ/giọng nói.

VPS chưa được triển khai. Trước khi thêm dịch vụ: đọc `free -m`, `df -h`, tải CPU và `docker stats`, kiểm tra cổng 18014 và các service hiện tại. Chỉ build khi có đủ khoảng trống RAM/disk cho builder hoặc build image ở máy riêng rồi chuyển sang VPS. `compose.yaml` giới hạn runtime RAM 512 MB, 0,5 CPU, 96 PID, root filesystem chỉ đọc và `/tmp` 32 MB; chỉ publish loopback 127.0.0.1:18014. Phép thử container có giới hạn này dùng khoảng 55 MB sau khi tính tuyến mẫu, không phải bảo đảm tải tối đa production.

Sau kiểm tra tài nguyên và được cấp truy cập trong phạm vi: `docker compose -f ops/m14/compose.yaml up -d --build`; kiểm tra `http://127.0.0.1:18014/health` và `smoke.py`; cấu hình hostname HTTPS riêng qua reverse proxy hiện có theo quy trình cập nhật VPS. Chưa chạy các lệnh này trên VPS. Cần địa chỉ SSH/cổng/tài khoản/phương thức xác thực an toàn và hostname HTTPS dành cho routing. Không nâng gói VPS, sửa DB hoặc mở cổng engine ra Internet.

Giới hạn bảo vệ này là bản test; trước vận hành chính thức cần chốt tải thực tế và chính sách xác thực giữa app/server. Không đưa endpoint routing vào luồng nhận đơn production của bản test này.
