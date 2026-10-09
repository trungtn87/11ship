# Mẫu triển khai module / task — bắt buộc
Quy trình: [quyền hạn và gate](../process/11ship-delivery-workflow.md).
Module/task: …; base SHA: …; nguồn nghiệp vụ: …; giai đoạn hiện tại: ….
Đây là mẫu trống, không phải bằng chứng đã hoàn thành.

## Phân công
ChatGPT: thiết kế nghiệp vụ/UI chi tiết, giao task, review.
Claude: code/build/test/sửa finding, chuẩn bị bản local và điện thoại.
Owner: duyệt nghiệp vụ/UI, test local, test thiết bị thật, quyết định merge/nghiệm thu/đóng.
Ghi task con, người thực hiện, đầu ra, dependency và gate chuyển cho mỗi giai đoạn.

## Checklist
- [ ] Kiểm kê nguồn và backend thực tế; ghi phần thiếu.
- [ ] Owner duyệt nghiệp vụ/API/dữ liệu và ca lỗi.
- [ ] ChatGPT gửi ảnh UI chi tiết; Owner duyệt các màn hình và trạng thái liên quan.
- [ ] Gói giao Claude xác định base, scope, giới hạn, hợp đồng, test và đầu ra.
- [ ] Claude code, test, build; CI trên final head đạt.
- [ ] ChatGPT review đúng SHA; Claude sửa hết finding bắt buộc.
- [ ] Owner chạy local; phản hồi được sửa và test lại; Owner xác nhận đạt.
- [ ] Bản điện thoại/web test có version/SHA và hướng dẫn.
- [ ] Owner kiểm tra thiết bị thật từng app liên quan.
- [ ] Kiểm tra liên thông và hồi quy đạt.
- [ ] Owner quyết định nghiệm thu/merge và đóng module; không suy từ CI.

## Ma trận từng ứng dụng
| Ứng dụng | Phạm vi/task con | Nghiệp vụ/UI duyệt | Code/CI/review | Local | Thiết bị thật | Owner nghiệm thu |
|---|---|---|---|---|---|---|
| Web quản trị | Chưa xác định | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng |
| Khách | Chưa xác định | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng |
| Quán | Chưa xác định | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng |
| Xế | Chưa xác định | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng |
| App quản lý | Chưa xác định | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng |
| Liên thông | Chưa xác định | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng |

N/A: lý do + quyết định Owner. Mỗi kết quả dẫn tới evidence: SHA/version, môi trường, ca test, người test/ngày, link bằng chứng và quyết định. Ghi lỗi mở và phạm vi kiểm tra lại sau mỗi thay đổi.
