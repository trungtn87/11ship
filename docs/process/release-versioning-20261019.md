# 11Ship — Quy ước phiên bản và tên bản phát hành

**Owner chốt ngày 19/10/2026 (Asia/Ho_Chi_Minh). Áp dụng ngay cho Codex, Claude và mọi module, bao gồm M13 đang triển khai.**

Nguồn: Owner yêu cầu mỗi lần merge đặt tên phiên bản để đối chiếu main, VPS và APK; yêu cầu lưu trong dự án cho Codex/Claude sử dụng. Đây là quy ước đã duyệt, không phải xác nhận CI/M13 đã tự động hóa.

## 1. Một phiên bản — một commit

- Mỗi lần merge vào `main` cấp một phiên bản tăng dần dạng `vMAJOR.MINOR.PATCH`; mặc định tăng PATCH: `v1.0.1`, `v1.0.2`, `v1.0.3`…
- Lần merge tiếp theo bắt đầu `v1.0.1` nếu chưa có chuỗi phát hành cao hơn. Trước khi cấp số, kiểm tra tag/release và cơ chế đánh phiên bản hiện có; nếu đã có số cao hơn thì tăng tiếp, không lùi hoặc dùng trùng.
- Tag trỏ tới commit thực tế sau merge trên main (kể cả squash), không lấy SHA nhánh PR làm SHA phát hành.
- Một phiên bản gắn cố định với một SHA đầy đủ; không di chuyển tag, thay nội dung artifact đã phát hành hoặc đổi code rồi dùng lại số cũ.
- Tuần tự hóa bước cấp số để hai merge gần nhau không trùng phiên bản. Chỉ tăng MAJOR/MINOR khi có quyết định phát hành phù hợp; không dùng số module M02/M13 làm số phiên bản.
- Merge chỉ đổi tài liệu vẫn có phiên bản nguồn mới nhưng không buộc build lại mọi app hoặc deploy. Thành phần chưa cập nhật giữ nguyên phiên bản thật.

## 2. Tên chuẩn

| Thành phần | Tên/hiển thị mẫu |
|---|---|
| GitHub tag và release | `v1.0.1` |
| APK khách/chủ quán | `11Food-v1.0.1.apk` |
| APK shipper | `11Ship-v1.0.1.apk` |
| APK SMS Gateway | `11Ship-Gateway-v1.0.1.apk` |
| Gói VPS | `11Ship-VPS-v1.0.1.tar.gz` |
| Phiên bản trong app/Web Admin | `v1.0.1 · abc1234` |

Giữ prefix `v` trong nhãn phát hành và tên file. Trường versionName/toolchain yêu cầu số thuần dùng `1.0.1`; chúng cùng chỉ một phiên bản. Nếu pipeline VPS đang dùng định dạng khác thì giữ định dạng hoạt động hiện tại đến khi cập nhật đồng bộ build/deploy/checksum; không chỉ đổi đuôi file.

## 3. Đồng bộ và truy xuất

- Các gói cùng mã phiên bản phải build từ cùng commit đã gắn tag. Lưu SHA đầy đủ, mã phiên bản, thành phần, thời điểm build, nguồn tải và checksum cùng thông tin phát hành.
- Phân biệt rõ: phiên bản mới nhất trên main; bản đã build/phát hành cho từng thành phần; bản VPS đang chạy; phiên bản gần nhất từng thiết bị báo.
- Không đổi tên APK/gói cũ thành phiên bản mới để tạo cảm giác đồng bộ. Thành phần không build lại tiếp tục báo phiên bản và SHA cũ.
- Merge không đồng nghĩa đã deploy; build thành công không đồng nghĩa thiết bị đã cài. Thiếu báo cáo thiết bị ghi chưa xác định hoặc thời điểm báo gần nhất.
- Mỗi lần bàn giao ghi ngắn: phiên bản/SHA main, VPS thực tế, từng APK đã có và link tải; ghi rõ thành phần còn ở bản cũ hoặc chưa kiểm chứng.
- Trước khi tự động hóa hoàn tất, áp dụng quy ước trong bước phát hành và báo cáo hiện tại; không đợi M13 hoàn thành mới dùng, cũng không tuyên bố tính năng hiển thị/tự động đã có.

## 4. Android cập nhật cài đè

Giữ nguyên applicationId và khóa ký của từng app, giữ dữ liệu. `versionCode` là số build Android tăng dần so với mọi bản đã phân phối của app đó, kể cả trước quy ước này; không suy đơn giản từ PATCH rồi làm giảm/reset mã build. Không phân phối bản ký bằng khóa tạm. Mã build và phiên bản phát hành là hai trường riêng.

## 5. Tích hợp M13

Đây là phần cụ thể hóa mục 12 “Phiên bản & cập nhật” của thiết kế M13 đã duyệt 16/10/2026:
- **M13.07:** dùng cùng mã phiên bản, SHA, danh mục artifact/APK, ghi chú phát hành và lịch sử deploy; hiển thị chính xác bản có sẵn/bản đang chạy/bản thiết bị báo.
- **M13.08:** luồng điều khiển deploy dùng release đã chuẩn bị, kiểm điều kiện, health check và báo kết quả Discord theo thiết kế hiện có; không tạo hệ thống phiên bản thứ hai.
- Gói map, routing engine/dataset có phiên bản độc lập theo thiết kế M14; ghi tương thích với release ứng dụng, không ép đổi nhãn dữ liệu cũ.
- Tiếp tục nhánh/PR M13 đang làm, chỉ tích hợp phần thiếu vào đó; không tạo triển khai chồng chéo.

## 6. Phạm vi của quyết định này

Quy ước có hiệu lực ngay. Việc lưu tài liệu không tự sửa code, CI, tạo tag phát hành, build APK, deploy VPS, chạy migration hay gửi Discord. Thực hiện các bước đó theo nhiệm vụ và thẩm quyền đã được giao; giữ các kiểm tra bắt buộc hiện hữu. Không yêu cầu test sản phẩm cho thay đổi tài liệu thuần túy.
