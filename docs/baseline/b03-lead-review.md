# 11Ship — B-03 smoke: review của Claude Lead

**Ngày:** 2026-11-02 · **Người review:** Claude Lead · **Baseline:** `requirements.md` v0.7, PR #298
**Môi trường được Owner chấp nhận:** emulator Android 14 API 34 (`sdk_gphone64_x86_64`), APK v480 (Actions run 41221145655, nguồn `9ed95a2`, SHA256 đã được Codex xác minh khớp brief), backend VPS test `9b0d9d7`, DB `ship11_staging`.
**Giới hạn:** không phải nghiệm thu thiết bị thật; GPS giả lập; không SMS, push, SIM thật.
**Bằng chứng đã đọc:** gói `mnt.rar` do Owner chuyển (41 file Antigravity, XML/ảnh Codex, manifest SHA-256). Em mở trực tiếp các tệp XML S-01 Ship, hai ảnh (Ship sau đăng xuất, Chi tiết quán) và báo cáo/JSON. Chưa mở hết 34 ảnh. Tệp `11Food-test.apk` trong gói bị lỗi CRC khi giải nén, nên em dựa vào SHA256 do Codex ghi, không tự kiểm APK.
**Kết luận:** B-03 chưa đủ để chốt Phase 1. Có 2 lỗi UI/chức năng được chứng minh (S-01 Ship, S-04), 1 lỗi mới (#299), 1 luồng bị chặn (S-02) và phần lớn luồng còn NOT TESTED trên UI v480. Không luồng nào được ghi PASS cuối cùng.

## Kết quả đã review

| Luồng | API | UI v480 (emulator API 34) | Kết luận Lead | Căn cứ |
|---|---|---|---|---|
| S-01 Đăng nhập/đăng xuất, ví ẩn | Một phần: khách 403 ví, tài xế 200, đăng xuất 204, token cũ 401 | **11Ship FAIL**, 11Food PASS | **FAIL** (UI). Xác nhận #295 và B04-02 | XML và ảnh: sau đăng xuất và sau force-stop/mở lại, Tài khoản vẫn có "Ví của tôi · Số dư, nạp và rút tiền"; tab Thu nhập vẫn mở được và hiện "Ví của tôi". Trái M04-R-13, M01-R-15/16. 11Food: đăng nhập, đăng xuất, mở lại đều về trạng thái chưa đăng nhập |
| S-02 Quên mật khẩu OTP | BLOCKED | BLOCKED | **BLOCKED** | Công tắc tắt; theo Owner không bật, không PASS bằng mock |
| S-04 Khoảng cách, tuyến | FAIL: 617 m và 720 m cho cùng cặp điểm | Home 0,6 km, Tìm kiếm 0,6 km (khớp nhau và khớp 617 m); **Chi tiết quán không hiện khoảng cách**; Checkout chưa đo | **FAIL** | M02-R-12 yêu cầu có khoảng cách ở Chi tiết quán (ảnh `S-04-buoc-03-detail.png` không có). Lệch 617 và 720 chỉ thấy ở API; UI Checkout bị chặn bởi #299 |
| S-06 Sửa đơn, đổi địa chỉ (#238) | Một phần: chỉ đổi số lượng và ghi chú | Chưa thử đổi địa chỉ trong đơn | **BLOCKED** bởi #299 | Tám ảnh gắn nhãn S-06 là thiết lập sổ địa chỉ, không phải sửa đơn PENDING_CONFIRMATION |
| DEFECT-01 APK không mở | — | Mở được trên API 34; chỉ lỗi trên emulator API 37 trang 16 KB | Lỗi tương thích đang điều tra, không chặn B-03 | B04-17 hoãn theo Owner |
| DEFECT-02 / #299 OOM màn Chọn địa chỉ | — | 11Food thoát, `OutOfMemoryError`, heap 192 MB | **Lỗi mới** (B04-20) | Log đã lọc `logs/DEFECT02-food-oom-address-map.txt` và issue #299. Chưa biết có xảy ra trên máy thật |

## Luồng còn lại: ghi nhận, chưa chấp nhận

| Luồng | Trạng thái Lead | Ghi chú |
|---|---|---|
| S-03, S-05, S-07, S-10, S-11, S-12, S-13, S-14 | API một phần hoặc tóm tắt, UI NOT TESTED | Báo cáo lần 1 ghi "PASS" cho phần API nhưng JSON thô cho thấy nhiều bước dừng sớm (ví dụ S-05 shipper nhận đơn trả 409). Không dùng làm bằng chứng nghiệm thu |
| S-08 Link theo dõi | API chạy, **không đạt B04-09** | Link vẫn dùng token dài; mã tham chiếu 8 ký tự (C-26) chưa có. Đây là điểm B04-09 đã ghi, không phải lỗi mới |
| S-09 Online/GPS | **Không nhất quán, không tính PASS** | `smoke_full_report.json` ghi bật Online trả 409 và cập nhật GPS trả 400, trong khi bản Markdown ghi PASS. Cần chạy lại, đối chiếu yêu cầu thô trước khi kết luận |

## Phát hiện về quy trình bằng chứng

1. Báo cáo lần 1 của Antigravity chấm 12 luồng "PASS" chỉ bằng API; đã bị hạ xuống một phần. Lần 2 (rerun) minh bạch hơn và Codex tự đối chiếu lại JSON với Markdown.
2. Gói bằng chứng chưa nên chia sẻ rộng: `logcat_full_raw.txt` là log thô chưa che. Em không thấy token hay mật khẩu dạng văn bản trong báo cáo và JSON, nhưng chưa kiểm hết log thô. Chỉ dùng bản log đã lọc cho issue.
3. Ảnh S-04 số 15 và S-06 số 8 là màn launcher sau khi app crash, không phải kết quả luồng.

## Việc tiếp theo đề xuất

1. **Không cần chạy lại** S-01, S-04 (UI) và S-02: đã có kết luận.
2. **Cần bổ sung bằng chứng UI v480** nếu Owner muốn có nghiệm thu rộng hơn: S-03, S-05 (sau khi shipper B03 đủ điều kiện nhận đơn), S-07, S-09 (đối chiếu 409/400), S-10..S-14. Hai luồng phụ thuộc #299 (S-04 Checkout, S-06) chờ lỗi được sửa hoặc có cách đi vòng bằng sổ địa chỉ.
3. Các lỗi mới và gap đã vào `b04-deviations.md` (B04-01, B04-02, B04-20). Sửa code thuộc Phase 8, không làm trong Phase 1.
4. Không đổi baseline để hợp thức hóa hành vi sai.
