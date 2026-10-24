# -*- coding: utf-8 -*-
"""Phân loại lại các test case từng ghi "Cần hỗ trợ kỹ thuật" thành 3 loại rõ ràng cho người mới.

 PREP  = "Chuẩn bị trước, người mới tự làm": kỹ thuật viên/Owner làm xong phần chuẩn bị TRƯỚC giờ test,
         sau đó người mới làm từ đầu đến cuối một mình (không cần ai ngồi cạnh).
 JOINT = "Cần kỹ thuật viên cùng làm": có bước chỉ kỹ thuật viên/SYSTEM làm được (ví dụ dùng tài khoản SYSTEM,
         tắt/bật SMS Gateway). Người mới quan sát, so kết quả, chụp ảnh.
 AUTO  = "Chỉ kỹ thuật viên": đối chiếu kết quả kiểm thử tự động; người mới không làm.
"""
LOAI_PREP = 'Chuẩn bị trước, người mới tự làm'
LOAI_JOINT = 'Cần kỹ thuật viên cùng làm'
LOAI_AUTO = 'Tự động đã có (đối chiếu)'
READY_PREP = 'CẦN CHUẨN BỊ TRƯỚC'
READY_JOINT = 'CẦN KỸ THUẬT VIÊN LÀM CÙNG'
READY_AUTO = 'CHỈ KỸ THUẬT VIÊN'
TECH_TAG = '[KỸ THUẬT VIÊN/SYSTEM làm, bạn quan sát và chụp màn hình] '

# Mô tả việc chuẩn bị theo khóa (dùng lại cho nhiều test)
PREP = {
    'APK2': 'Kỹ thuật viên gửi sẵn HAI file APK của cùng một ứng dụng: bản cũ (A) và bản mới (B). Hai bản cùng chữ ký, B có số hiệu bản dựng lớn hơn A. Cài sẵn bản A lên máy bạn.',
    'RELEASE': 'Kỹ thuật viên (tài khoản SYSTEM) đã đăng ký bản phát hành mới trong Web Admin (và đánh dấu "Bắt buộc" nếu test yêu cầu), đúng lúc điện thoại của bạn đang chạy bản cũ hơn.',
    'SMS': 'Kỹ thuật viên đã bật máy SMS Gateway, gửi thử SMS tới số điện thoại của bạn thành công trước giờ test, và bảo đảm số của bạn được phép nhận SMS. Bạn có SIM thật của số đó trong tay.',
    'SIM': 'Số điện thoại dùng cho test này chưa từng đăng ký 11Food/11Ship (Người phụ trách ghi sẵn trong bảng thông tin riêng).',
    'ADMIN1': 'SYSTEM đã tạo và kích hoạt sẵn tài khoản ADMIN-1 (và ADMIN-2 nếu test cần) với đúng các quyền test yêu cầu, rồi đưa bạn số điện thoại/mật khẩu qua kênh riêng. Ứng dụng Authenticator đã cài trên điện thoại của bạn.',
    'MONEY': 'Owner đã duyệt bằng văn bản "Quy tắc tiền thử nghiệm" (HUONG_DAN mục 7) và SYSTEM đã bật sẵn một "Tài khoản nhận tiền" thử nghiệm. Nếu CHƯA có duyệt: ghi BLOCKED, KHÔNG chuyển tiền thật.',
    'FEE': 'SYSTEM đã áp dụng bảng "Phí & điều kiện giao" và dịch vụ tính đường đi đang hoạt động (nếu không, phí sẽ hiện "Chưa xác định phí").',
    'LOC': 'Người phụ trách xác nhận khu vực phục vụ (bán kính khoảng 10 km quanh TP Cao Bằng) và bạn hoặc người được nhờ đứng đúng vị trí mà test yêu cầu. KHÔNG dùng ứng dụng giả vị trí.',
    'PUSH': 'Kỹ thuật viên đã cấu hình thông báo đẩy (Firebase) và xác nhận APK đang thử có hỗ trợ; điện thoại đã cho phép thông báo.',
    'DATA': 'Bạn đã làm xong các test ghi ở cột "Phụ thuộc" (dữ liệu từ test trước còn đó).',
    'SMSCOST': 'Người phụ trách đồng ý cho chạy vì mỗi lần xin mã tốn một tin nhắn SMS thật; dùng số điện thoại thử riêng.',
    'PHONES': 'Có đủ số điện thoại/máy theo cột "Số điện thoại tối thiểu"; mỗi tài khoản dùng đúng một số.',
    'DEVICES': 'Có ít nhất một điện thoại Android 8.0 trở lên; nếu có nhiều đời máy thì mỗi máy ghi một dòng kết quả.',
}

# id -> (loại, [khóa chuẩn bị], [số bước kỹ thuật viên làm], ghi chú phân công)
S = {}
def prep(ids, keys, note=''):
    for i in ids.split():
        S['TC-' + i] = ('PREP', keys.split(), [], note)

prep('SET-007 SET-008', 'APK2')
prep('SET-009 SET-010', 'RELEASE')
prep('ACC-001 ACC-002 ACC-003 ACC-004 ACC-005 ACC-009 ACC-010 ACC-013 ACC-020 ACC-021 ACC-022 SHOP-002 SHOP-011', 'SMS SIM')
prep('ACC-008', 'DATA')
prep('ACC-011', 'SMS SMSCOST')
prep('ACC-027 ADM-013 ADM-016 ADM-018 ADM-020 ADM-022 ADM-028 ADM-029 ADM-036 ADM-003 ADM-007 ADM-008 DRV-021 FEED-005 FEED-006 FEED-007 NOTI-006 SEC-005', 'ADMIN1 DATA')
prep('ADM-005 ADM-011', 'SMS ADMIN1')
prep('ADM-024', 'ADMIN1 FEE', 'Bạn dùng tài khoản ADMIN-1 ở mọi bước: ADMIN chỉ xem và thử tính phí; việc áp dụng bảng phí do SYSTEM làm TRƯỚC test này (không phải việc của bạn).')
prep('WAL-003 WAL-024 WAL-017', 'MONEY DATA')
prep('WAL-004 WAL-005 WAL-006 WAL-008 WAL-009 WAL-015 WAL-016 WAL-019 WAL-023 WAL-025', 'ADMIN1 MONEY DATA')
prep('WAL-012', 'DATA')
prep('CUS-021', 'FEE DATA')
prep('SHOP-004 CUS-003 DRV-008', 'LOC DATA')
prep('NOTI-001', 'PUSH DATA')
prep('SEC-001', 'DATA')
prep('ABN-018', 'DEVICES')


def joint(i, tech, note, keys='DATA'):
    S['TC-' + i] = ('JOINT', keys.split(), tech, note)

joint('ACC-012', [3], 'Kỹ thuật viên tắt máy SMS Gateway (hoặc tạm dừng gửi) TRƯỚC khi bạn làm bước 1 và bật lại ở bước 3 theo hướng dẫn ops/runbooks/sms-gateway.md. Bạn KHÔNG tự tắt/bật.', 'SMS SIM')
joint('ACC-031', [1], 'Kỹ thuật viên (SYSTEM) làm bước 1 trên Web Admin. Bạn làm bước 2-5 trên điện thoại.', 'SMS DATA')
joint('ACC-032', [1, 2, 4, 5], 'SYSTEM tắt/bật công tắc OTP; bạn chỉ làm bước 3 (mở màn đăng ký) và kiểm tra. Chỉ chạy khi Owner cho phép bằng văn bản; phải bật lại ngay (bước 4).', 'SMS')
joint('WAL-020', [1, 2, 3, 4], 'SYSTEM làm bước 1-4 (cấu hình tài khoản nhận tiền thử nghiệm). Bạn làm bước 5 bằng tài khoản ADMIN-1.', 'ADMIN1 MONEY')
joint('WAL-021', [1, 2, 5], 'SYSTEM đổi và đặt lại mức hoa hồng (bước 1, 2, 5). Bạn/shipper SP-A làm bước 3-4. Chỉ làm khi Owner cho phép.', 'MONEY DATA')
joint('ADM-002', [2, 3], 'Mật khẩu SYSTEM và mã Authenticator của SYSTEM do kỹ thuật viên nhập, bạn KHÔNG được biết. Bạn đọc kết quả mong đợi, chụp ảnh và kiểm tra menu ở bước 4.', '')
joint('ADM-004', [1, 2, 3, 4, 5, 6, 7], 'Toàn bộ thao tác do kỹ thuật viên/SYSTEM làm trên máy của họ (hoặc chia sẻ màn hình). Bạn đối chiếu từng bước với cột Kết quả mong đợi.', '')
joint('ADM-006', [1, 2], 'SYSTEM tạo lời mời và kích hoạt ADMIN-2; bạn quan sát, rồi đăng nhập ADMIN-2 ở bước 3.', 'SMS')
joint('ADM-009', [1, 2, 4, 5], 'SYSTEM cấp/thu hồi quyền (bước 1, 2, 4, 5); bạn đóng vai ADMIN-2 ở bước 3 (tải lại trang và kiểm tra menu).', 'ADMIN1')
joint('ADM-010', [1, 4], 'SYSTEM khóa/mở khóa ADMIN-2 (bước 1, 4); bạn đóng vai ADMIN-2 ở bước 2-3.', 'ADMIN1')
joint('ADM-025', [1, 3, 5], 'SYSTEM sửa và áp dụng bảng phí (bước 1, 3, 5, đặt lại về giá cũ); bạn làm bước 2 và 4 (kiểm tra giỏ khách). Chỉ làm khi Owner cho phép.', 'FEE DATA')
joint('ADM-026', [1, 3, 4, 5, 6], 'SYSTEM nhập các thời hạn (và đặt lại về giá trị ban đầu ở bước 6); bạn đọc kết quả mong đợi và chụp màn hình lỗi nhập sai.', '')
joint('ADM-027', [1, 2, 3, 4], 'SYSTEM xem/sửa cấu hình tập trung; bạn làm bước 5 bằng ADMIN-1.', 'ADMIN1')
joint('ADM-030', [1, 2, 3, 4, 5, 6], 'Các mục "Vận hành hệ thống" chỉ SYSTEM xem được: kỹ thuật viên mở, bạn đối chiếu và chụp ảnh.', '')
joint('ADM-031', [1, 2, 3, 4], 'Kỹ thuật viên/SYSTEM thao tác; TUYỆT ĐỐI không gửi "Yêu cầu khôi phục dữ liệu". Bạn chỉ đối chiếu.', '')
joint('ADM-032', [1, 2], 'Kỹ thuật viên/SYSTEM mở "Nhật ký lỗi"; bạn đối chiếu.', '')
joint('ADM-035', [1, 2, 3], 'SYSTEM thực hiện việc xóa (không hoàn tác được). Bạn chuẩn bị 2 tài khoản rác theo "Điều kiện ban đầu" và đối chiếu kết quả.', 'SMS')
joint('FLOW-029', [5], 'SYSTEM đặt thời hạn ngắn TRƯỚC bước 1 (ví dụ 6 phút) và đặt lại về mặc định ở bước 5. Bạn và chủ quán làm bước 1-4.', 'DATA')
joint('ABN-008', [1, 2], 'Kỹ thuật viên bật "Tùy chọn nhà phát triển" và ứng dụng giả vị trí trên MÁY THỬ riêng; bạn không tự cài. Không bắt buộc với người mới.', '')
joint('ABN-009', [2], 'Kỹ thuật viên làm chậm/dừng máy chủ thử một lúc ngắn TRƯỚC bước 2 theo quy trình vps-safe-update và khôi phục trước bước 4. Không dừng máy chủ khi đang có người dùng thật.', '')
joint('ABN-012', [1], 'Kỹ thuật viên (SYSTEM) dùng trình duyệt 1 ở bước 1; bạn dùng ADMIN-1 ở trình duyệt 2 (bước 2-3).', 'ADMIN1 DATA')
joint('SHOP-018', [], 'Kỹ thuật viên/SYSTEM tạm "Ngừng dùng" TẤT CẢ nhóm món TRƯỚC khi bạn làm bước 1, và "Kích hoạt" lại ngay sau bước 2 (TC-ADM-020). Không làm khi đã có món thật đang bán.', '')

FALLBACK_PREP = 'Nếu phần chuẩn bị ở trên CHƯA xong: đánh dấu BLOCKED, ghi điều kiện còn thiếu vào Ghi chú kết quả, báo Người phụ trách và chuyển sang test kế tiếp. Không tự làm thay phần của kỹ thuật viên.'
FALLBACK_JOINT = 'Nếu kỹ thuật viên/SYSTEM chưa có mặt: đánh dấu BLOCKED, ghi "chờ kỹ thuật viên", hẹn giờ rồi chuyển sang test kế tiếp (hầu hết test sau không phụ thuộc test này trừ khi cột "Phụ thuộc" ghi tên nó).'
FALLBACK_AUTO = 'Người mới không làm test này. Kỹ thuật viên dán đường dẫn kết quả CI của đúng commit vào "Đường dẫn bằng chứng" (CI xanh KHÔNG thay cho thử tay).'


def apply(lib):
    missing = []
    for c in lib.CASES:
        if c['loai'] == 'Tự động đã có (đối chiếu)':
            c.update(loai=LOAI_AUTO, support='AUTO', prep_text='Không có (chỉ kỹ thuật viên đối chiếu CI).', assign='Kỹ thuật viên làm toàn bộ; người mới không tham gia.', fallback=FALLBACK_AUTO)
            if c['ready'] == 'CẦN HỖ TRỢ KỸ THUẬT':
                c['ready'] = READY_AUTO
            continue
        if c['loai'] == 'Thủ công':
            c.update(support='MANUAL', prep_text='Không cần kỹ thuật viên; chỉ cần các điều kiện ở mục "Điều kiện ban đầu".', assign='Người mới tự làm toàn bộ.', fallback='')
            continue
        if c['id'] not in S:
            missing.append(c['id'])
            continue
        kind, keys, tech, note = S[c['id']]
        for k in keys:
            assert k in PREP, (c['id'], k)
        steps = c['steps']
        for n in tech:
            assert 1 <= n <= len(steps), (c['id'], n)
        if kind == 'PREP':
            c['loai'] = LOAI_PREP
            if c['ready'] == 'CẦN HỖ TRỢ KỸ THUẬT':
                c['ready'] = READY_PREP
            c['assign'] = 'Sau khi chuẩn bị xong, người mới tự làm toàn bộ các bước.' + (' ' + note if note else '')
            c['fallback'] = FALLBACK_PREP
        else:
            c['loai'] = LOAI_JOINT
            if c['ready'] == 'CẦN HỖ TRỢ KỸ THUẬT':
                c['ready'] = READY_JOINT
            who = ('Kỹ thuật viên/SYSTEM làm bước ' + ', '.join(map(str, tech)) + '. ') if tech else ''
            c['assign'] = who + note
            c['fallback'] = FALLBACK_JOINT
            c['steps'] = [((TECH_TAG + a) if (i + 1) in tech else a, e) for i, (a, e) in enumerate(steps)]
        c['support'] = kind
        c['prep_text'] = ' '.join(PREP[k] for k in keys) or 'Không có việc chuẩn bị thêm ngoài mục "Điều kiện ban đầu".'
    assert not missing, 'Chưa phân loại hỗ trợ: %s' % missing


# ---------------------------------------------------------------------------------------------------------
# Điểm có thể CHẶN việc đưa cho người dùng/quán/shipper bên ngoài thử nghiệm (pilot).
# id -> [(nhóm cổng, lý do ngắn)]
# ---------------------------------------------------------------------------------------------------------
GATES = {
    'TERMS': 'Điều khoản sử dụng',
    'PRIVACY': 'Chính sách quyền riêng tư',
    'BGLOC': 'Thông báo/đồng ý về vị trí nền',
    'PERM': 'Sai quyền (xem/làm việc không được phép)',
    'MONEY': 'Giao dịch tài chính (ví, nạp, rút, hoa hồng)',
}
G = {}
def gate(ids, key, why):
    for i in ids.split():
        G.setdefault('TC-' + i, []).append((key, why))

gate('ACC-029', 'TERMS', 'Nội dung Điều khoản còn nói "đặt món, giao hàng, ví chưa hoạt động" trong khi các chức năng này đã chạy. Người dùng bên ngoài không nên đồng ý một văn bản sai.')
gate('ACC-029 SEC-007', 'PRIVACY', 'Chính sách nói "không theo dõi vị trí nền" nhưng 11Ship chia sẻ vị trí khi shipper online.')
gate('SEC-007 ABN-014 SET-005 DRV-002', 'BGLOC', 'Shipper online chia sẻ vị trí cả khi tắt màn hình; phải có thông báo/đồng ý rõ ràng trước khi để shipper ngoài dùng.')
gate('SEC-001 SEC-002 SEC-006 ADM-007 ADM-008 ADM-009 WAL-019 WAL-020 WAL-022 ACC-027 ADM-013 AUTO-004', 'PERM', 'Một lỗi phân quyền cho phép người này thấy/sửa dữ liệu hoặc tiền của người khác - lỗi NGHIÊM TRỌNG, dừng pilot.')
gate('WAL-003 WAL-005 WAL-006 WAL-008 WAL-009 WAL-012 WAL-013 WAL-015 WAL-016 WAL-017 WAL-021 WAL-023 WAL-024 WAL-025 DRV-003 DRV-014 FLOW-026 ABN-013 AUTO-003', 'MONEY', 'Sai số dư, tạm giữ, cộng/trừ trùng hoặc rút nhầm là lỗi NGHIÊM TRỌNG. Chỉ chạy bằng tiền thử nghiệm đã được Owner duyệt (HUONG_DAN mục 7).')


def gate_text(cid):
    items = G.get(cid, [])
    return '; '.join('%s: %s' % (GATES[k], w) for k, w in items)
