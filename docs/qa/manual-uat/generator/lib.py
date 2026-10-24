# -*- coding: utf-8 -*-
"""Thư viện dùng chung để khai báo test case nghiệm thu thủ công 11Ship."""

CASES = []          # theo thứ tự khai báo
BY_ID = {}

GROUPS = {
    'SET':  ('A. Cài đặt, thiết bị và phiên bản', 'A'),
    'ACC':  ('A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên', 'A'),
    'CUS':  ('B. Khách hàng 11Food', 'B'),
    'SHOP': ('C. Chủ quán 11Food', 'C'),
    'DRV':  ('D. Shipper 11Ship', 'D'),
    'FLOW': ('E. Luồng giao hàng liên thông', 'E'),
    'WAL':  ('F. Ví và tài chính', 'F'),
    'ADM':  ('G. Web Admin', 'G'),
    'ABN':  ('H. Trường hợp bất thường', 'H'),
    'NOTI': ('Bổ sung: Thông báo', 'X'),
    'FEED': ('Bổ sung: Đánh giá và phản ánh', 'X'),
    'SEC':  ('Bổ sung: Quyền, riêng tư và an toàn dữ liệu', 'X'),
    'AUTO': ('Bổ sung: Rủi ro chỉ kiểm được bằng kỹ thuật (đối chiếu kiểm thử tự động)', 'X'),
}

DEVICES = {
    'P1': 'Điện thoại 1 (máy KHÁCH)',
    'P2': 'Điện thoại 2 (máy QUÁN)',
    'P3': 'Điện thoại 3 (máy SHIPPER)',
    'PC': 'Máy tính có trình duyệt (Web Admin)',
}

SEV_DEFAULT = {'P0': 'Cao', 'P1': 'Trung bình', 'P2': 'Thấp'}

DEFAULT_VERDICT = ('PASS: mọi bước đều đúng như cột "Kết quả mong đợi". '
                   'FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. '
                   'BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. '
                   'NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.')


def step(a, e):
    return (a, e)


def T(id, nhom=None, ngay=1, ten='', muc_dich='', prio='P1', actor='', dev=('P1',), phones=1,
      loai='Thủ công', ready='SẴN SÀNG', deps='Không (làm độc lập)', pre='', data='Không cần nhập dữ liệu riêng.',
      steps=(), verdict=None, restore='', ref='', auto='', sev=None, seq=50, note=''):
    assert id not in BY_ID, 'trùng mã ' + id
    prefix = id.split('-')[1]
    assert prefix in GROUPS, prefix
    assert prio in ('P0', 'P1', 'P2')
    assert steps, id
    assert muc_dich and ten and restore and ref, id
    c = dict(id=id, group=prefix, ngay=ngay, ten=ten, muc_dich=muc_dich, prio=prio, actor=actor,
             dev=[DEVICES.get(d, d) for d in dev], devkeys=list(dev), phones=phones, loai=loai, ready=ready, deps=deps,
             pre=pre, data=data, steps=list(steps), verdict=verdict, restore=restore, ref=ref, auto=auto,
             sev=sev or SEV_DEFAULT[prio], seq=seq, idx=len(CASES), note=note)
    CASES.append(c)
    BY_ID[id] = c
    return c


# ---------------------------------------------------------------------------------------------------------
# Các bước dùng lại (mỗi test case vẫn đầy đủ vì các bước được "bung" ra từng dòng)
# ---------------------------------------------------------------------------------------------------------

def food_login(dev, acct, role_text='Khách hàng'):
    return [
        ('Trên %s, mở ứng dụng 11Food rồi chạm tab "Tài khoản" ở thanh dưới cùng.' % DEVICES.get(dev, dev),
         'Màn hình "Tài khoản" mở ra, có hai nút "Tạo tài khoản" và "Đăng nhập".'),
        ('Chạm nút "Đăng nhập". Ở ô "Số điện thoại" gõ số điện thoại của tài khoản %s. Ở ô "Mật khẩu" gõ mật khẩu của tài khoản %s (lấy từ bảng thông tin riêng của Người phụ trách).' % (acct, acct),
         'Màn hình "Đăng nhập" hiện dòng "Chào mừng trở lại"; hai ô đã có chữ, nút "Đăng nhập" bấm được.'),
        ('Chạm nút "Đăng nhập".',
         'Đăng nhập thành công, trở về tab "Tài khoản"; thấy tên của %s, số điện thoại đã che bớt và nhãn vai trò "%s".' % (acct, role_text)),
    ]


def ship_login(dev, acct):
    return [
        ('Trên %s, mở ứng dụng 11Ship rồi chạm tab "Tài khoản" ở thanh dưới cùng.' % DEVICES.get(dev, dev),
         'Màn hình "Tài khoản" của 11Ship mở ra, có nút "Đăng nhập".'),
        ('Chạm nút "Đăng nhập". Ở ô "Số điện thoại" gõ số của %s, ở ô "Mật khẩu" gõ mật khẩu của %s.' % (acct, acct),
         'Màn hình "Đăng nhập" hiện dòng "Đăng nhập tài khoản shipper."; hai ô đã có chữ.'),
        ('Chạm nút "Đăng nhập".',
         'Đăng nhập thành công; tab "Tài khoản" hiện tên %s và nhãn "Shipper".' % acct),
    ]


def admin_login(acct, code_note='mã 6 số hiện trong ứng dụng Authenticator trên điện thoại của bạn'):
    return [
        ('Trên máy tính, mở trình duyệt, gõ địa chỉ Web Admin (xem mục "Thông tin do Người phụ trách cung cấp").',
         'Trang "Đăng nhập quản trị" hiện ra với ô "Số điện thoại" và "Mật khẩu".'),
        ('Gõ số điện thoại và mật khẩu của %s rồi bấm "Tiếp tục".' % acct,
         'Trang "Xác thực hai bước" hiện ra, yêu cầu mã 6 số.'),
        ('Mở ứng dụng Authenticator trên điện thoại, đọc %s, gõ vào ô mã rồi bấm nút xác nhận đăng nhập.' % code_note,
         'Vào được trang chủ Web Admin: tiêu đề "Đăng nhập thành công" và dòng "Vai trò: %s".' % ('SYSTEM' if acct.startswith('SYSTEM') else 'ADMIN')),
    ]


def menu_go(path_text):
    return ('Ở menu bên trái của Web Admin, chọn: %s.' % path_text,
            'Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ.')


def logout_food(dev):
    return [
        ('Trên %s, mở 11Food, tab "Tài khoản", kéo xuống cuối và chạm "Đăng xuất".' % DEVICES.get(dev, dev),
         'Hộp thoại "Đăng xuất?" hiện ra với nút "Huỷ" và "Đăng xuất".'),
        ('Chạm "Đăng xuất" trong hộp thoại.', 'Quay về màn hình khách chưa đăng nhập, lại thấy nút "Đăng nhập".'),
    ]


def logout_ship(dev):
    return [
        ('Trên %s, mở 11Ship, tab "Tài khoản", kéo xuống cuối và chạm "Đăng xuất".' % DEVICES.get(dev, dev),
         'Hộp thoại "Đăng xuất?" hiện ra.'),
        ('Chạm "Đăng xuất" trong hộp thoại.', 'Quay về màn hình chưa đăng nhập của 11Ship.'),
    ]


# Chuỗi khôi phục dùng chung
R_NONE = 'Không cần khôi phục: test này không làm thay đổi dữ liệu.'
R_LOGOUT = 'Đăng xuất khỏi các tài khoản đã dùng trong test này (tab "Tài khoản" > "Đăng xuất").'
R_ORDER = ('Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) '
           'rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.')


# ---------------------------------------------------------------------------------------------------------
# Macros nghiệp vụ dùng nhiều lần
# ---------------------------------------------------------------------------------------------------------

def shop_mode(dev, acct, shop):
    """Đăng nhập chủ quán và vào chế độ quản lý quán (11Food)."""
    return food_login(dev, acct, role_text='Khách hàng, Chủ quán') + [
        ('Chạm tab "Quán" ở thanh dưới cùng. Nếu thấy "Quản lý quán của bạn" thì chạm "Vào chế độ quản lý quán".',
         'Màn hình chuyển sang chế độ quản lý %s; có nút "Về chế độ khách hàng" ở cuối trang (nghĩa là đang ở chế độ quán).' % shop),
    ]


def customer_place_order(dev='P1', shop='Quán Test A', lines='2 phần "Bún chả Test" (45.000đ/phần) và 1 phần "Trà đá Test" (5.000đ)', total_items='95.000đ',
                         name='Khách Test A', recipient_phone='SĐT-KH-A', address='địa chỉ nhà KH-A đã lưu ở TC-CUS-022'):
    return [
        ('Trên %s, mở 11Food (đang đăng nhập khách), tab "Trang chủ". Gõ "%s" vào ô "Tìm quán hoặc món" hoặc chọn quán trong "Quán gần bạn", chạm vào quán.' % (DEVICES.get(dev, dev), shop),
         'Trang quán hiện tên quán, giờ hoạt động và danh sách món có giá.'),
        ('Chạm vào món "Bún chả Test", đặt Số lượng = 2, (có thể ghi chú "ít cay"), rồi chạm "Thêm vào giỏ · 90.000đ". Chạm món "Trà đá Test", số lượng 1, "Thêm vào giỏ · 5.000đ".',
         'Thanh dưới cùng hiện "Xem giỏ · … món · %s" với tiền món đúng %s.' % (total_items, total_items)),
        ('Chạm "Xem giỏ · …".', 'Màn "Giỏ hàng" liệt kê đúng: %s; có dòng "Phí giao (dự tính)" và "Tổng dự kiến". Tiền món = %s.' % (lines, total_items)),
        ('Chạm nút "Tiếp tục · …" ở cuối màn hình giỏ.', 'Mở màn "Xác nhận đơn" gồm ô "Tên người nhận", "Số điện thoại người nhận", phần "Địa chỉ giao", "Giao sớm nhất"/"Hẹn giờ nhận món", "Ghi chú cho đơn", dòng "Thanh toán trực tiếp".'),
        ('Điền "Tên người nhận" = %s, "Số điện thoại người nhận" = %s. Chạm "Chọn từ sổ địa chỉ" và chọn "%s" (nếu chưa có: "Địa chỉ khác" rồi nhập địa chỉ và "Dùng vị trí hiện tại" nếu có).' % (name, recipient_phone, address),
         'Các ô đã điền; địa chỉ đã chọn hiện đúng.'),
        ('Chạm nút "Gửi đơn · …".', 'Hiện thông báo xanh "Đã gửi đơn" (nội dung "Đơn đang chờ quán xác nhận. Bạn hủy được cho đến khi quán xác nhận."), mở chi tiết đơn có mã đơn (dạng "Đơn …") và trạng thái "Chờ quán xác nhận". Ghi lại mã đơn.'),
    ]


def shop_confirm_order(dev='P2'):
    return [
        ('Trên %s (chủ quán, đang ở chế độ quản lý quán), mở tab "Đơn hàng", chọn "Đơn món". Chạm vào đơn có trạng thái "Chờ xác nhận" đúng mã đơn vừa ghi.' % DEVICES.get(dev, dev),
         'Đơn mới hiện ở đầu danh sách; chi tiết đơn có đủ món, số lượng, tiền món, tên và số điện thoại người nhận.'),
        ('Chạm "Xác nhận đơn".', 'Đơn chuyển sang "Đang chuẩn bị". Không còn nút "Xác nhận đơn". Có nút "Gọi shipper".'),
    ]


def shop_call_shipper(dev='P2', payer_button='Quán trả phí'):
    return [
        ('Trên %s, trong chi tiết đơn đang "Đang chuẩn bị", chạm "Gọi shipper".' % DEVICES.get(dev, dev),
         'Hộp thoại "Gọi shipper" hỏi "Ai trả phí giao? ..." với hai nút "Khách trả phí" và "Quán trả phí". KHÔNG có bước/nút "Món đã sẵn sàng" riêng.'),
        ('Chạm "%s".' % payer_button,
         'Đơn hiện phần giao hàng với trạng thái "Đang tìm shipper"; hiện phí giao theo bảng giá và người trả phí đúng như đã chọn; có đồng hồ/ghi chú thời gian tìm shipper.'),
    ]


def ship_go_online(dev='P3'):
    return [
        ('Trên %s mở 11Ship (đang đăng nhập shipper), tab "Trang chủ", chạm "Bật online". Cho phép quyền vị trí/thông báo nếu điện thoại hỏi; bật GPS của điện thoại; đứng trong bán kính 3 km quanh quán.' % DEVICES.get(dev, dev),
         'Trạng thái đổi sang "Bạn đang online", có dòng nhỏ "Đang chia sẻ vị trí". Nút đổi thành "Tắt online".'),
    ]


def ship_open_offers(dev='P3'):
    return [
        ('Trên %s chạm tab "Đơn hàng" rồi chạm "Có thể nhận".' % DEVICES.get(dev, dev),
         'Thấy thẻ đơn mới của quán: tên quán, khu vực lấy/giao, phí giao, người trả phí và nút "Nhận đơn". KHÔNG thấy số điện thoại người nhận và địa chỉ chi tiết.'),
    ]


def ship_accept(dev='P3'):
    return [
        ('Chạm "Nhận đơn" trên thẻ đơn.', 'Đơn chuyển sang mục "Đang thực hiện". Giờ mới thấy địa chỉ quán, số điện thoại quán, thông tin người nhận.'),
    ]


def ship_pickup(dev='P3'):
    return [
        ('Mở đơn trong "Đang thực hiện", chạm "Đã nhận hàng".', 'Hộp thoại "Xác nhận đã nhận hàng?" giải thích phí sẽ bị khóa và không hủy nhận được nữa.'),
        ('Chạm xác nhận trong hộp thoại.', 'Đơn chuyển sang trạng thái "Đã lấy hàng"/"Đang giao". Chỉ còn nút "Giao thành công" (không còn "Hủy nhận đơn" và không có nút "Giao thất bại").'),
    ]


def ship_complete(dev='P3'):
    return [
        ('Chạm "Giao thành công".', 'Hộp thoại "Giao thành công?" với nội dung "Xác nhận đã giao hàng cho người nhận. Hoa hồng sẽ được thu một lần khi hoàn tất."'),
        ('Chạm "Giao thành công" trong hộp thoại.', 'Đơn chuyển vào "Lịch sử" của shipper với trạng thái hoàn thành.'),
    ]
