# Thử 11Ship GPS Test trên điện thoại

1. Tải APK, cho phép cài từ nguồn tải nếu Android hỏi, rồi cài. Bản sau chọn **Cập nhật**, không gỡ app.
2. Bật **chế độ máy bay**, mở app: phải xem được bản đồ Cao Bằng, tên địa danh và đường. Vào **Gói bản đồ** để xem vùng phủ/phiên bản. Không cần tải thêm dữ liệu.
3. Ra ngoài trời, bật **Vị trí**, bấm **Bắt đầu ghi**; cho phép vị trí **chính xác khi dùng app** và thông báo. Lần đầu offline có thể cần hai phút để bắt tín hiệu. Xem tọa độ, sai số và thời điểm; không coi vị trí cũ là mẫu mới.
4. Khóa màn hình khoảng 5–10 phút rồi mở **Lịch sử → Tùy chọn → Xem thời điểm các điểm ghi**. Chu kỳ mục tiêu 60 giây; không có tín hiệu thì không tạo điểm giả. Có xuất GPX, xóa toàn bộ lịch sử và tắt hẳn lưu lịch sử.
5. Chạm bản đồ chọn A/Điểm đầu và B/Điểm cuối; hoặc bấm ô điểm để dùng vị trí GPS mới. Có ghi chú, đổi chiều, xóa và di chuyển ghim bằng lần chạm tiếp theo. Bật mạng rồi bấm **Tính tuyến**: đường xanh dương và km là tuyến xe máy dự tính. Đường xanh lá trong lịch sử là các mẫu đã ghi, có chia đoạn khi mất GPS lâu hoặc nhảy bất thường.
6. Tắt mạng, đóng/mở lại app: vẫn thấy tuyến đã lưu. Bấm tính mới phải báo **Cần mạng để tính tuyến mới**. Render miễn phí có thể ngủ; yêu cầu đầu có thể chậm, nếu thất bại hãy thử lại.
7. Bấm **Dừng ghi** trong app hoặc thông báo; đợi hơn một phút để kiểm tra không có điểm mới. Thử từ chối quyền và tắt GPS để đối chiếu thông báo.

Lịch sử chỉ ở điện thoại, mặc định giữ 24 giờ; không upload lên server. Khi tính tuyến, app gửi hai điểm đã chọn tới Valhalla trên Render. App test có ID riêng, không thay thế 11Food/11Ship.

GPS ngoài trời, tín hiệu vệ tinh thực tế, độ chính xác và ghi mẫu khi khóa màn hình trên từng hãng điện thoại cần bạn thử. Không dùng vị trí giả để báo đạt GPS. Nếu hệ điều hành hủy tiến trình, mở app và bấm Bắt đầu lại; app không tự bật ghi sau khi khởi động máy.
