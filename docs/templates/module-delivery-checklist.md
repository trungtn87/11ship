# Checklist task nhỏ và nghiệm thu module

Áp dụng quy trình [12/10/2026](../process/11ship-delivery-workflow.md). Đây là mẫu trống, không phải bằng chứng hoàn thành. Chỉ điền phần phù hợp; không lặp ma trận module ở mỗi task.

## A. Task nhỏ / sửa lỗi / gói tích hợp

Task: …; nguồn thiết kế đã duyệt: …; base/code SHA: ….
Phạm vi và app/luồng bị ảnh hưởng: ….
ChatGPT thiết kế/giao việc/review; Claude code/test/build; Owner duyệt thay đổi nghiệp vụ/UI và nghiệm thu khi tới giai đoạn.

- [ ] Phạm vi rõ, dùng lại thiết kế đã duyệt; ghi quyết định còn thiếu nếu có.
- [ ] Claude triển khai đúng phạm vi.
- [ ] Kiểm tra phù hợp phần ảnh hưởng đạt; dẫn link kết quả và code SHA.
- [ ] ChatGPT review; blocker được sửa, góp ý không chặn ghi riêng.
- [ ] Checks bắt buộc áp dụng đạt, dependency tương thích, merge sạch; merge theo ủy quyền thường trực.
- [ ] Bản chạy/hướng dẫn khi cần bàn giao Owner test; nếu chưa tới giai đoạn thì ghi rõ.

Test dự kiến: …; kết quả/link: …; lỗi mở: ….
Test thêm/test lại (chỉ nếu cần): thay đổi/rủi ro chưa được giải quyết …; kiểm tra sẽ chạy ….
Đổi tài liệu sau test: ghi SHA code đã test và SHA tài liệu cuối; không chạy lại test sản phẩm chỉ vì SHA tài liệu đổi.
N/A: ghi lý do, không cần xin duyệt riêng. Tài liệu thuần túy chỉ cần review nội dung/link/nhất quán.

## B. Nghiệm thu module / phát hành — tổng hợp một lần

Module/phiên bản/code SHA: …; phạm vi phát hành: ….

- [ ] Thiết kế/nghiệp vụ/UI liên quan được Owner duyệt.
- [ ] Các task cần thiết đã code, kiểm tra, review và tích hợp.
- [ ] Bản local ổn định, hướng dẫn chạy; Owner xác nhận local đạt.
- [ ] Bản thiết bị thật phù hợp có version/SHA; Owner thử các app liên quan.
- [ ] Liên thông và hồi quy phạm vi phát hành đạt.
- [ ] Lỗi còn mở và giới hạn ghi rõ; Owner quyết định nghiệm thu/đóng module.

Chỉ thêm hàng cho app/luồng thực sự liên quan; không mặc định liệt kê toàn bộ app.

| App/luồng liên quan | Phạm vi | Thiết kế duyệt | Code/CI/review | Local | Thiết bị thật | Owner nghiệm thu |
|---|---|---|---|---|---|---|
| … | … | Link/kết quả | Link/kết quả | Link/kết quả | Link/kết quả hoặc N/A có lý do | Quyết định |

Bằng chứng: version/code SHA, môi trường, ca/luồng, kết quả, người test/ngày và link quyết định Owner. Dùng lại link bằng chứng hiện có, không chép lặp. Phần chưa chạy ghi CHƯA KIỂM CHỨNG; merge/CI không tự chứng minh nghiệm thu. Sau thay đổi chỉ xác định và kiểm tra lại phần chịu ảnh hưởng.
