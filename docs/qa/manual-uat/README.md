# Bộ nghiệm thu thủ công 11Ship (docs/qa/manual-uat)

Bộ tài liệu để một người **hoàn toàn mới** làm theo từng bước và ghi nhận phần mềm 11Ship (11Food, 11Ship, Web Admin) hoạt động đúng hay sai.

- Mã nguồn đối chiếu: `main` @ `00d83cc` (24/10/2026). Chỉ thêm tài liệu; **không thay đổi code, cơ sở dữ liệu hay workflow**.
- Tổng **289** test case (P0 132 · P1 122 · P2 35).

| File | Nội dung |
|---|---|
| [HUONG_DAN_KIEM_THU_11SHIP.md](HUONG_DAN_KIEM_THU_11SHIP.md) | **Bắt đầu từ đây.** Giải thích hệ thống, cách chuẩn bị, tài khoản, tiền thử nghiệm, cách ghi kết quả |
| [KICH_BAN_TEST_LIEN_THONG.md](KICH_BAN_TEST_LIEN_THONG.md) | Kịch bản ba người phối hợp (khách – quán – shipper) |
| [DANH_SACH_P0.md](DANH_SACH_P0.md) | 132 test bắt buộc, chạy nhanh trước |
| [TESTCASE_11SHIP.csv](TESTCASE_11SHIP.csv) | **Toàn bộ test case**, mở bằng Excel (UTF-8 BOM); nơi ghi trạng thái, ngày, người, phiên bản, mã lỗi, bằng chứng |
| [chi-tiet/](chi-tiet/) | Bản đọc dễ của từng test case, chia 5 ngày |
| [BAO_CAO_LOI_MAU.md](BAO_CAO_LOI_MAU.md) | Mẫu báo lỗi và hướng dẫn điền |
| [CHECKLIST_NGHIEM_THU.md](CHECKLIST_NGHIEM_THU.md) | Điều kiện kết luận 3 mức + bảng đánh dấu |
| [DOI_CHIEU_CODE_TESTCASE.md](DOI_CHIEU_CODE_TESTCASE.md) | Chức năng thật trong code ↔ test case; phần chưa xác minh; lệch tài liệu |

Cách mở CSV trong Excel: **Dữ liệu > Từ văn bản/CSV > UTF-8** (file có BOM nên mở thẳng bằng Excel cũng đúng tiếng Việt). Bật "Wrap text" cho các cột dài (Các bước, Kết quả mong đợi).
