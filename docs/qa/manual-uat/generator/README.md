# Bộ sinh tài liệu nghiệm thu thủ công (dành cho người bảo trì)

**Người kiểm thử KHÔNG cần đọc hay chạy phần này.** Đây là công cụ để các file trong `docs/qa/manual-uat/` luôn khớp nhau.

## Vì sao có bộ sinh
`TESTCASE_11SHIP.csv`, `DANH_SACH_P0.md`, `CHECKLIST_NGHIEM_THU.md`, `SMOKE_TEST_NGUOI_MOI.md`, `chi-tiet/NGAY_*.md` và các con số trong `HUONG_DAN`/`DOI_CHIEU` đều **sinh ra từ cùng một nguồn dữ liệu** (các file `cases_*.py`). Sửa tay từng file sẽ làm chúng lệch nhau.

## Các file
| File | Vai trò |
|---|---|
| `cases_a.py` … `cases_f.py` | Toàn bộ test case (mã, bước, kết quả mong đợi, phụ thuộc, khôi phục…) |
| `lib.py` | Khung `T(...)`, nhóm chức năng, các đoạn thao tác dùng lại (đăng nhập, đặt đơn, nhận đơn…) |
| `plan.py` | Thứ tự chạy theo ngày (ghi đè ngày/số thứ tự) |
| `support.py` | Phân loại hỗ trợ kỹ thuật (chuẩn bị trước / kỹ thuật viên cùng làm / chỉ kỹ thuật viên) và "cổng chặn thử nghiệm bên ngoài" |
| `smoke.py` | Danh sách smoke test cho người mới |
| `mapping.py` | Bảng đối chiếu chức năng-trong-code ↔ test case, và danh sách điểm chưa đủ bằng chứng |
| `src/*.md` | Mẫu của các tài liệu viết tay có chỗ điền số liệu (`{{TÊN}}`) |
| `build.py` | Chương trình sinh và kiểm tra |

## Cách dùng (cần Python 3.9+, không cần thư viện ngoài)
```bash
cd docs/qa/manual-uat/generator
python3 build.py          # sinh lại toàn bộ file trong docs/qa/manual-uat
python3 build.py --check  # KHÔNG ghi đè; chỉ báo file nào đã commit bị lệch nguồn (thoát mã 1 nếu lệch hoặc có lỗi)
python3 verify.py         # đọc lại các file ĐÃ SINH và kiểm tra độc lập: mã không trùng, phụ thuộc hợp lệ, số bước = số kết quả mong đợi,
                          # P0/checklist/chi tiết/smoke khớp CSV, mã TC nhắc trong tài liệu có thật, liên kết không gãy, không lộ mật khẩu/OTP/số điện thoại
```

`build.py` dừng với mã lỗi 1 và in danh sách `PROBLEMS` nếu phát hiện, ví dụ: mã test trùng; tham chiếu tới test không tồn tại; test phụ thuộc chạy sau test dùng nó; thiếu điều kiện ban đầu/dữ liệu nhập/cách khôi phục; ít hơn 2 bước; kết quả mong đợi quá ngắn; bước chỉ dẫn kiểu "làm như TC-…"; từ kỹ thuật (SQL, API…) trong bước người mới làm; test chưa có dòng đối chiếu; smoke thiếu vùng bắt buộc hoặc sai thứ tự phụ thuộc; ô CSV quá dài; mẫu còn sót `{{…}}`.

## Quy trình cập nhật một test case
1. Sửa test trong `cases_*.py` (hoặc `plan.py`/`support.py`/`smoke.py`/`mapping.py`/`src/*.md`).
2. `python3 build.py` — phải in `PROBLEMS:` rỗng.
3. Xem lại `git diff docs/qa/manual-uat` rồi commit **cả nguồn lẫn file sinh ra**.
4. `python3 build.py --check` phải in `KHỚP`.

Hằng số `COMMIT` trong `build.py` là commit `main` mà tài liệu đã đối chiếu code; cập nhật nó khi rà lại tài liệu theo bản `main` mới hơn.
