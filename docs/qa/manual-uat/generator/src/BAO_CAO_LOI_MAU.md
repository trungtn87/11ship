# Mẫu báo lỗi và cách điền

Mỗi lỗi một báo cáo. Copy phần "MẪU" bên dưới, điền, đặt tên file `LOI-<ngày>-<số thứ tự>.md` (ví dụ `LOI-20261026-003.md`) hoặc dán vào hệ thống theo dõi lỗi mà Người phụ trách chỉ định. **Mã lỗi** (ví dụ `LOI-20261026-003`) được ghi vào cột "Mã lỗi liên quan" của `TESTCASE_11SHIP.csv`.

> Không ghi mật khẩu, mã OTP, mã Authenticator, số tài khoản ngân hàng đầy đủ. Che thông tin nhạy cảm trên ảnh chụp.

## 1. Mức nghiêm trọng – chọn đúng một mức

| Mức | Khi nào chọn | Ví dụ |
|---|---|---|
| **NGHIÊM TRỌNG** (chặn nghiệm thu) | **Mất tiền, sai số dư, tiền tự tăng/giảm sai, giao dịch lặp, giao nhầm đơn, mất đơn, sai quyền người dùng** (người này thấy/làm được việc của người khác), lộ thông tin riêng tư, đơn trùng | Ví bị trừ hoa hồng hai lần; shipper thấy số điện thoại khách trước khi nhận; hai shipper cùng nhận một đơn; ADMIN vào được trang chỉ dành cho SYSTEM; quán B thấy đơn của quán A |
| **CAO** | Không hoàn thành được chức năng chính của hành trình, nhưng không mất tiền/dữ liệu | Không gọi được shipper; thông báo đến sai người nhưng không lộ thông tin; đơn kẹt trạng thái phải nhờ Admin |
| **TRUNG BÌNH** | Chức năng phụ lỗi hoặc có cách đi vòng | Lọc danh sách sai; hộp thoại thiếu dòng giải thích |
| **THẤP** | Chữ sai, căn lề, câu hướng dẫn gây hiểu nhầm nhẹ | Trang chủ Admin còn câu "sẽ có ở bước sau" |
| **CÂU HỎI / ĐỀ XUẤT** | Không phải lỗi, cần Owner quyết định | Màn hình "Chỉ bán hàng sau khi được duyệt" nhưng không có bước duyệt |

**Luôn chọn NGHIÊM TRỌNG** nếu lỗi dính tới: mất tiền · sai số dư · giao nhầm đơn · mất đơn · sai quyền · giao dịch lặp.

## 2. MẪU (copy từ đây)

```markdown
# [LOI-YYYYMMDD-NNN] Tiêu đề ngắn: việc gì sai ở đâu

**Mức nghiêm trọng:** NGHIÊM TRỌNG / CAO / TRUNG BÌNH / THẤP / CÂU HỎI
**Ngày giờ phát hiện (giờ Việt Nam):** 2026-10-26 14:35
**Người kiểm thử:** (tên)
**Mã test case + số bước:** TC-FLOW-001, bước 13
**Nhóm chức năng:** (A–H trong TESTCASE_11SHIP.csv)

## Môi trường
- Phiên bản APK 11Food: (ví dụ v1.0.12, theo Cài đặt Android > Ứng dụng > 11Food)
- Phiên bản APK 11Ship: (…)
- Bản máy chủ/Web Admin do Người phụ trách cung cấp: (…)
- Điện thoại: hãng / model / Android (ví dụ Samsung A15 / Android 14)
- Máy tính (nếu Web Admin): trình duyệt + phiên bản
- Mạng: Wi-Fi / 4G
- Tài khoản dùng: KH-A / CQ-A / SP-A / ADMIN-1 … (KHÔNG ghi mật khẩu)
- Có dùng 1/2/3 điện thoại không: …

## Dữ liệu liên quan
- Mã đơn: Đơn …    Mã giao hàng: G-…
- Quán: Quán Test A    Shipper: SP-A    Người nhận: …
- Số tiền liên quan: tiền món …đ, phí giao …đ, số dư ví trước …đ / sau …đ

## Các bước tái hiện (ghi như đang chỉ cho người chưa biết gì)
1. Trên Điện thoại 3 mở 11Ship, đăng nhập SP-A.
2. …
3. Chạm "Nhận đơn".

## Kết quả mong đợi (lấy từ test case)
"Đơn sang 'Đang thực hiện'; số dư khả dụng giảm đúng 1.000đ…"

## Kết quả thực tế
"Số dư khả dụng giảm 2.000đ / ứng dụng hiện chữ … / ứng dụng đóng đột ngột."

## Mức độ lặp lại
Lặp lại 3/3 lần · thỉnh thoảng (1/3) · chỉ xảy ra 1 lần

## Bằng chứng
- Ảnh: (đường dẫn)
- Video: (đường dẫn) – quay từ bước 1 đến lúc lỗi, thấy đồng hồ

## Ảnh hưởng và ghi chú thêm
- Có ảnh hưởng tiền/đơn của người khác không?
- Đã thử cách nào để khắc phục (đăng xuất, mở lại…)?
- Có làm hỏng dữ liệu cho test tiếp theo không (đơn nào cần dọn)?
```

## 3. Hướng dẫn điền từng mục

| Mục | Cách điền | Sai thường gặp |
|---|---|---|
| **Tiêu đề** | Một câu: *cái gì* sai *ở đâu*. Ví dụ: "Ví SP-A bị trừ 2 lần hoa hồng khi bấm Giao thành công" | "Lỗi ví", "Không chạy" |
| **Mã test + bước** | Chép đúng mã (TC-…) và **số bước** đầu tiên khác kết quả mong đợi | Bỏ trống |
| **Phiên bản** | Lấy từ Cài đặt Android hoặc tên file APK; **không đoán** | Ghi "bản mới nhất" |
| **Tài khoản** | Chỉ ghi tên viết tắt (KH-A…) | Ghi mật khẩu, OTP |
| **Dữ liệu liên quan** | Mã đơn, mã G-…, số tiền trước/sau | Chỉ ghi "đơn vừa đặt" |
| **Các bước tái hiện** | Đánh số, nói rõ **máy nào**, **ứng dụng nào**, **nút nào** (dùng đúng chữ trên màn hình) | "Đặt đơn rồi nhận đơn thì lỗi" |
| **Kết quả mong đợi/thực tế** | Hai dòng song song để lập trình viên thấy khác ở đâu | Chỉ ghi "sai" |
| **Mức độ lặp lại** | Thử lại ít nhất 2 lần nếu an toàn | Không ghi |
| **Bằng chứng** | Có **giờ** trên ảnh/video, tên file đúng quy ước, che thông tin nhạy cảm | Ảnh cắt mất đồng hồ, ảnh có mật khẩu |

## 4. Ví dụ hoàn chỉnh (giả định, để học cách điền)

```markdown
# [LOI-20261026-003] Ví SP-A bị thu hoa hồng hai lần khi bấm "Giao thành công" nhiều lần

**Mức nghiêm trọng:** NGHIÊM TRỌNG (sai số dư, giao dịch lặp)
**Ngày giờ phát hiện:** 2026-10-26 15:12
**Người kiểm thử:** Nguyễn Văn A
**Mã test case + số bước:** TC-ABN-013, bước 3
**Nhóm chức năng:** H. Trường hợp bất thường

## Môi trường
- 11Ship v1.0.12 · 11Food v1.0.12 · máy chủ v1.0.12 (do Người phụ trách cung cấp)
- Điện thoại: Samsung A15 / Android 14 · 4G
- Tài khoản: SP-A, CQ-A · dùng 2 điện thoại

## Dữ liệu liên quan
- Mã giao hàng: G-100234
- Số dư ví SP-A trước: Tổng 100.000đ / Khả dụng 99.000đ (đang tạm giữ 1.000đ)
- Số dư sau: Tổng 98.000đ

## Các bước tái hiện
1. Điện thoại 3, 11Ship, SP-A, mở đơn G-100234 đang "Đang giao".
2. Chạm "Giao thành công" → hộp thoại "Giao thành công?".
3. Chạm nút xác nhận 5 lần liên tiếp rất nhanh.
4. Mở "Ví của tôi" > "Lịch sử giao dịch" > lọc "Hoa hồng".

## Kết quả mong đợi
Tổng số dư 99.000đ; đúng MỘT dòng "Hoa hồng" 1.000đ.

## Kết quả thực tế
Tổng số dư 98.000đ; có HAI dòng "Hoa hồng" cùng giờ.

## Mức độ lặp lại
2/3 lần.

## Bằng chứng
- Video: .../20261026_TC-ABN-013_B3_hoa-hong-2-lan.mp4 (thấy đồng hồ 15:11)
- Ảnh: .../20261026_TC-ABN-013_B4_lich-su-vi.png
```

## 5. Sau khi báo lỗi

1. Dán **mã lỗi** vào cột "Mã lỗi liên quan" và đặt trạng thái test là **FAIL**.
2. Với lỗi **NGHIÊM TRỌNG**: báo ngay cho Người phụ trách (gọi hoặc nhắn), **dừng** các test phụ thuộc, không thử "lách" để vượt qua.
3. Khi lập trình viên báo đã sửa: chạy lại **đúng test đó** và các test cùng nhóm; chỉ đổi sang PASS khi **mọi bước** đúng. Ghi phiên bản mới.
4. Nếu bạn nghi ngờ không phải lỗi mà là **tài liệu khác với app** (ví dụ chữ khác nhau): chọn mức **CÂU HỎI / ĐỀ XUẤT**, đừng đổi kết quả mong đợi.
