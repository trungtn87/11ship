# -*- coding: utf-8 -*-
"""Danh sách smoke test cho người mới (chạy lần đầu). Thứ tự = thứ tự chạy.
Mỗi mục: (mã test, vai trò trong smoke, vùng được phủ)"""
SMOKE = [
    ('TC-SET-001', 'Cài 11Food', 'cài đặt'),
    ('TC-SET-002', 'Cài 11Ship', 'cài đặt'),
    ('TC-SET-006', 'Ghi số phiên bản APK để điền vào mọi báo cáo', 'cài đặt'),
    ('TC-ACC-001', 'Đăng ký khách KH-A (OTP qua SMS)', 'đăng ký'),
    ('TC-ACC-003', 'Đăng ký chủ quán CQ-A', 'đăng ký'),
    ('TC-ACC-004', 'Đăng ký shipper SP-A', 'đăng ký'),
    ('TC-ACC-014', 'Đăng nhập khách', 'đăng nhập'),
    ('TC-ACC-015', 'Đăng nhập sai mật khẩu bị từ chối', 'đăng nhập'),
    ('TC-ACC-016', 'Đăng nhập shipper', 'đăng nhập'),
    ('TC-ADM-020', 'Admin tạo nhóm món để quán thêm được món', 'chuẩn bị dữ liệu'),
    ('TC-ADM-024', 'Kiểm tra bảng phí giao đã được áp dụng', 'chuẩn bị dữ liệu'),
    ('TC-SHOP-001', 'Chủ quán tạo hồ sơ Quán Test A', 'quán'),
    ('TC-SHOP-009', 'Đặt giờ mở cửa để quán luôn mở khi thử', 'quán'),
    ('TC-SHOP-012', 'Thêm món có giá vào thực đơn', 'quán'),
    ('TC-CUS-022', 'Khách lưu địa chỉ giao hàng', 'khách đặt đơn'),
    ('TC-CUS-015', 'Khách thêm món vào giỏ', 'khách đặt đơn'),
    ('TC-CUS-021', 'Giỏ hiển thị phí giao và tổng tiền', 'khách đặt đơn'),
    ('TC-WAL-001', 'Ví shipper mới có số dư 0đ', 'ví'),
    ('TC-WAL-002', 'Nạp dưới mức tối thiểu bị từ chối', 'ví'),
    ('TC-WAL-003', 'Shipper tạo yêu cầu nạp tiền thử nghiệm', 'ví'),
    ('TC-WAL-004', 'Admin thấy yêu cầu nạp', 'ví'),
    ('TC-WAL-005', 'Admin ghi nhận tiền: ví shipper tăng đúng một lần', 'ví'),
    ('TC-FLOW-001', 'ĐƠN TỪ ĐẦU ĐẾN CUỐI: khách đặt, quán xác nhận, quán gọi shipper, shipper nhận, lấy hàng, giao thành công, kiểm tra số dư', 'khách đặt đơn; quán xác nhận; gọi shipper; nhận hàng; giao thành công; số dư ví'),
    ('TC-SHOP-031', 'Quán tạo yêu cầu giao trực tiếp (không qua khách)', 'gọi shipper'),
    ('TC-FLOW-003', 'Yêu cầu giao trực tiếp từ đầu đến cuối: shipper nhận và giao thành công', 'gọi shipper; nhận hàng; giao thành công; số dư ví'),
    ('TC-WAL-011', 'Lịch sử giao dịch ví sau hai đơn', 'số dư ví'),
    ('TC-NOTI-002', 'Hộp thông báo của khách, quán và shipper sau hai đơn', 'thông báo'),
]
REQUIRED_AREAS = ['đăng ký', 'đăng nhập', 'khách đặt đơn', 'quán xác nhận', 'gọi shipper', 'nhận hàng', 'giao thành công', 'số dư ví', 'thông báo']
