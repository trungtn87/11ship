# -*- coding: utf-8 -*-
import csv, io, os, re, sys, json
from collections import Counter, OrderedDict, defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
for m in ['cases_a', 'cases_b', 'cases_c', 'cases_d', 'cases_e', 'cases_f']:
    __import__(m)
from plan import OVERRIDE
import support
support.apply(lib)
from smoke import SMOKE, REQUIRED_AREAS

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
# --out <thư mục> : sinh ra thư mục khác (dùng cho --check); mặc định ghi đè docs/qa/manual-uat
OUT = os.path.abspath(os.path.join(HERE, '..'))
CHECK = '--check' in sys.argv
if '--out' in sys.argv:
    OUT = os.path.abspath(sys.argv[sys.argv.index('--out') + 1])
if CHECK:
    import tempfile
    COMMITTED = OUT
    OUT = tempfile.mkdtemp(prefix='uat-check-')
STATE = os.path.join(HERE, '.out')
os.makedirs(OUT + '/chi-tiet', exist_ok=True)
os.makedirs(STATE, exist_ok=True)

COMMIT = '00d83cc565a2709543f06a351802cd0fb28ecfa7'

DAY_NAMES = {
    1: 'Ngày 1 - Cài ứng dụng, làm quen, tạo tài khoản và chuẩn bị Web Admin',
    2: 'Ngày 2 - Khách đặt hàng và chủ quán nhận đơn',
    3: 'Ngày 3 - Shipper nhận, lấy và giao hàng (kèm nạp ví thử nghiệm)',
    4: 'Ngày 4 - Hủy đơn, đổi phí, các tình huống bất thường',
    5: 'Ngày 5 - Ví, quản trị, đối chiếu kết quả và nghiệm thu',
}
DAY_FILES = {
    1: 'NGAY_1_CAI_DAT_VA_TAI_KHOAN.md',
    2: 'NGAY_2_KHACH_DAT_HANG_VA_QUAN_NHAN_DON.md',
    3: 'NGAY_3_SHIPPER_NHAN_LAY_GIAO.md',
    4: 'NGAY_4_HUY_DOI_PHI_BAT_THUONG.md',
    5: 'NGAY_5_VI_QUAN_TRI_NGHIEM_THU.md',
}

# áp dụng thứ tự theo ngày
for c in lib.CASES:
    if c['id'] in OVERRIDE:
        c['ngay'], c['seq'] = OVERRIDE[c['id']]
    c['status'] = 'NOT READY' if c['ready'] == 'NOT READY' else 'NOT RUN'
    if c['verdict'] is None:
        c['verdict'] = lib.DEFAULT_VERDICT
    if 'BAO_CAO_LOI_MAU' not in c['verdict']:
        c['verdict'] += ' Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.'

_SN = {s[0]: n for n, s in enumerate(SMOKE, 1)}
for c in lib.CASES:
    c['smoke'] = ('Smoke #%d' % _SN[c['id']]) if c['id'] in _SN else ''

ORDERED = sorted(lib.CASES, key=lambda c: (c['ngay'], c['seq'], c['idx']))
day_counter = Counter()
for n, c in enumerate(ORDERED, 1):
    day_counter[c['ngay']] += 1
    c['stt'] = n
    c['stt_ngay'] = day_counter[c['ngay']]

# ---------------------------------------------------------------- điều kiện hệ thống cần có
def needs(c):
    txt = ' '.join([c['ten'], c['pre'], c['data'], c['note'], c['deps']] + [a + ' ' + e for a, e in c['steps']])
    out = []
    if re.search(r'OTP|SMS|Gửi mã xác minh|Gửi mã OTP', txt):
        out.append('SMS (máy SMS Gateway đang chạy)')
    if 'PC' in c['devkeys'] or 'Web Admin' in txt:
        out.append('Web Admin + tài khoản quản trị')
    if re.search(r'bảng giá|Theo bảng|phí giao theo|Phí giao \(dự tính\)|mốc phí|Phí & điều kiện giao', txt) or c['group'] == 'FLOW':
        out.append('Bảng phí giao đã được SYSTEM áp dụng')
    if re.search(r'TC-WAL-005|ví ĐỦ TIỀN|ví đủ điều kiện|đủ tiền', txt):
        out.append('Tiền thử nghiệm trong ví shipper (Owner duyệt)')
    if re.search(r'push|Firebase|màn hình khóa', txt):
        out.append('Thông báo đẩy (Firebase) nếu muốn kiểm push')
    if re.search(r'bản đồ|ghim|Vị trí hiện tại|GPS', txt) and c['group'] in ('FLOW', 'DRV', 'CUS', 'SHOP'):
        out.append('GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có)')
    if 'SYSTEM' in c['actor'] or 'SYSTEM' in txt:
        out.append('Tài khoản SYSTEM (kỹ thuật viên cấp)')
    return '; '.join(out) if out else 'Không có điều kiện đặc biệt ngoài tài khoản và Internet'


for c in lib.CASES:
    c['needs'] = needs(c)

# ---------------------------------------------------------------- kiểm tra chất lượng
problems = []
ids = set(lib.BY_ID)
seen_titles = {}
for c in ORDERED:
    if c['ten'] in seen_titles:
        problems.append('Trùng tên: %s / %s' % (c['id'], seen_titles[c['ten']]))
    seen_titles[c['ten']] = c['id']
    txt = ' '.join([c['deps'], c['pre'], c['note'], c['restore'], c['muc_dich']] + [a + e for a, e in c['steps']])
    for d in re.findall(r'TC-[A-Z]+-\d+', txt):
        if d not in ids:
            problems.append('Tham chiếu không tồn tại: %s -> %s' % (c['id'], d))
    # phụ thuộc phải chạy trước (trừ những ghi "mô tả/tham chiếu")
    for d in re.findall(r'TC-[A-Z]+-\d+', c['deps']):
        if d in lib.BY_ID:
            dc = lib.BY_ID[d]
            if dc['stt'] > c['stt']:
                problems.append('Thứ tự: %s (#%d) phụ thuộc %s (#%d) chạy sau' % (c['id'], c['stt'], d, dc['stt']))
    for k in ('pre', 'data', 'restore', 'ref'):
        if not c[k].strip():
            problems.append('Thiếu %s: %s' % (k, c['id']))
    if len(c['steps']) < 2:
        problems.append('Quá ít bước: %s' % c['id'])

    # --- kiểm tra dễ hiểu cho người mới
    TECHWORD = re.compile(r'\b(terminal|SQL|psql|curl|ssh|docker|npm|python|logcat|stack ?trace|endpoint|API|UUID|JSON|payload|truy vấn|dòng lệnh)\b', re.I)
    for n, (a, e) in enumerate(c['steps'], 1):
        tech_step = a.startswith(support.TECH_TAG) or a.startswith('[CHỈ KỸ THUẬT VIÊN')
        if len(a) < 8:
            problems.append('Bước quá ngắn: %s bước %d' % (c['id'], n))
        if len(e) < 15:
            problems.append('Kết quả mong đợi quá ngắn: %s bước %d: "%s"' % (c['id'], n, e))
        if re.search(r'(như|theo|giống|lặp lại|làm lại)[^.;]{0,30}TC-[A-Z]+-\d+', a, re.I) and c['support'] == 'MANUAL':
            problems.append('Bước chỉ dẫn "như TC-…" (người mới sẽ hỏi bấm đâu): %s bước %d' % (c['id'], n))
        if not tech_step and TECHWORD.search(a + ' ' + e):
            problems.append('Từ kỹ thuật trong bước người mới làm: %s bước %d (%s)' % (c['id'], n, TECHWORD.search(a + ' ' + e).group(0)))
    if TECHWORD.search(c['pre'] + ' ' + c['data']) and c['support'] != 'AUTO':
        problems.append('Từ kỹ thuật trong điều kiện/dữ liệu: ' + c['id'])
    if c['ready'] not in ('SẴN SÀNG', 'CẦN XÁC MINH', 'NOT READY', support.READY_PREP, support.READY_JOINT, support.READY_AUTO):
        problems.append('Giá trị "sẵn sàng" lạ: %s %s' % (c['id'], c['ready']))
    if c['support'] in ('PREP', 'JOINT') and not (c['prep_text'] and c['assign'] and c['fallback']):
        problems.append('Thiếu mô tả hỗ trợ kỹ thuật: ' + c['id'])
    if 'FAIL' not in c['verdict'] or 'PASS' not in c['verdict']:
        problems.append('Cách kết luận thiếu PASS/FAIL: ' + c['id'])
    vague = re.search(r'Kiểm tra (tạo đơn|API|luồng giao hàng) (hoạt động )?đúng', ' '.join(a for a, e in c['steps']))
    if vague:
        problems.append('Bước chung chung: ' + c['id'])

for gid in support.G:
    if gid not in ids:
        problems.append('GATE: test không tồn tại ' + gid)

# ---------------------------------------------------------------- CSV
HEAD = ['STT chạy (toàn bộ)', 'Mã test', 'Nhóm chức năng', 'Ngày thực hiện', 'STT trong ngày', 'Tên test case', 'Mục đích (giải thích đời thường)', 'Mức độ', 'Smoke test người mới (STT)',
        'Người thực hiện', 'Thiết bị cần có', 'Số điện thoại tối thiểu', 'Loại kiểm thử', 'Tình trạng sẵn sàng', 'Phụ thuộc (test phải làm trước)',
        'Điều kiện ban đầu', 'Dữ liệu nhập', 'Các bước thực hiện', 'Kết quả mong đợi (theo từng bước)', 'Cách kết luận PASS/FAIL',
        'Điểm có thể chặn thử nghiệm bên ngoài (pilot)', 'Việc cần chuẩn bị trước (ai chuẩn bị)', 'Phân công khi đang test', 'Nếu thiếu điều kiện / kỹ thuật viên chưa sẵn sàng', 'Điều kiện hệ thống cần có (mục 4 hướng dẫn)', 'Cách khôi phục để chạy lại', 'Ghi chú đặc biệt / CẦN XÁC MINH', 'Mức nghiêm trọng nếu FAIL', 'Căn cứ trong mã nguồn/tài liệu',
        'Kiểm thử tự động liên quan (chỉ để đối chiếu, KHÔNG thay thế thử tay)',
        'Trạng thái', 'Ngày kiểm thử', 'Người kiểm thử', 'Phiên bản APK hoặc bản triển khai', 'Mã lỗi liên quan', 'Đường dẫn ảnh/video bằng chứng', 'Ghi chú kết quả']


def numbered(items, which):
    return '\n'.join('Bước %d: %s' % (i, it[which]) for i, it in enumerate(items, 1))


def phones_text(n):
    return 'Chỉ cần máy tính' if n == 0 else str(n)


rows = []
for c in ORDERED:
    rows.append([
        c['stt'], c['id'], lib.GROUPS[c['group']][0], DAY_NAMES[c['ngay']].split(' - ')[0], c['stt_ngay'], c['ten'], c['muc_dich'], c['prio'], c['smoke'],
        c['actor'], '; '.join(c['dev']), phones_text(c['phones']), c['loai'], c['ready'], c['deps'],
        c['pre'], c['data'], numbered(c['steps'], 0), numbered(c['steps'], 1), c['verdict'],
        support.gate_text(c['id']), c['prep_text'], c['assign'], c['fallback'], c['needs'], c['restore'], c['note'], c['sev'], c['ref'], c['auto'],
        c['status'], '', '', '', '', '', '',
    ])

with open(OUT + '/TESTCASE_11SHIP.csv', 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f, quoting=csv.QUOTE_ALL, lineterminator='\r\n')
    w.writerow(HEAD)
    w.writerows(rows)
maxcell = max(len(x) for r in rows for x in map(str, r))
if maxcell > 32000:
    problems.append('Ô CSV quá dài: %d' % maxcell)


# ---------------------------------------------------------------- Markdown chi tiết
def esc(t):
    return str(t).replace('|', '\\|').replace('\n', '<br>')


def render_case(c):
    L = []
    L.append('### %s · %s' % (c['id'], c['ten']))
    L.append('')
    L.append('**Mức độ:** %s · **Nhóm:** %s · **Số thứ tự chạy:** #%d (trong ngày: %d) · **Mức nghiêm trọng nếu FAIL:** %s' % (c['prio'], lib.GROUPS[c['group']][0], c['stt'], c['stt_ngay'], c['sev']) + ((' · **%s**' % c['smoke']) if c['smoke'] else ''))
    L.append('')
    L.append('| Mục | Nội dung |')
    L.append('|---|---|')
    L.append('| Mục đích | %s |' % esc(c['muc_dich']))
    L.append('| Người thực hiện | %s |' % esc(c['actor']))
    L.append('| Thiết bị cần có | %s (tối thiểu %s điện thoại) |' % (esc('; '.join(c['dev'])), phones_text(c['phones']).lower() if c['phones'] == 0 else c['phones']))
    L.append('| Loại kiểm thử | %s |' % esc(c['loai']))
    L.append('| Tình trạng sẵn sàng | **%s** |' % esc(c['ready']))
    L.append('| Phụ thuộc | %s |' % esc(c['deps']))
    L.append('| Điều kiện hệ thống cần có | %s |' % esc(c['needs']))
    if support.gate_text(c['id']):
        L.append('| **Có thể chặn thử nghiệm bên ngoài** | %s |' % esc(support.gate_text(c['id'])))
    if c['support'] != 'MANUAL':
        L.append('| Việc cần chuẩn bị trước | %s |' % esc(c['prep_text']))
        L.append('| Phân công khi đang test | %s |' % esc(c['assign']))
        L.append('| Nếu thiếu điều kiện | %s |' % esc(c['fallback']))
    L.append('| Điều kiện ban đầu | %s |' % esc(c['pre']))
    L.append('| Dữ liệu nhập | %s |' % esc(c['data']))
    if c['note']:
        L.append('| Ghi chú đặc biệt | %s |' % esc(c['note']))
    L.append('')
    L.append('| Bước | Việc cần làm | Kết quả mong đợi |')
    L.append('|---|---|---|')
    for i, (a, e) in enumerate(c['steps'], 1):
        L.append('| %d | %s | %s |' % (i, esc(a), esc(e)))
    L.append('')
    L.append('**Cách kết luận:** ' + c['verdict'])
    L.append('')
    L.append('**Cách khôi phục để chạy lại:** ' + c['restore'])
    L.append('')
    L.append('**Căn cứ:** `%s`' % c['ref'].replace('`', ''))
    if c['auto']:
        L.append('')
        L.append('**Kiểm thử tự động liên quan (chỉ đối chiếu):** %s' % c['auto'])
    L.append('')
    L.append('**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):')
    L.append('')
    L.append('| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |')
    L.append('|---|---|---|---|---|---|')
    L.append('| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |')
    L.append('')
    L.append('Ghi chú: ')
    L.append('')
    L.append('---')
    L.append('')
    return '\n'.join(L)



# ---------------------------------------------------------------- bảng thuật ngữ đầu mỗi file ngày
GLOSSARY = [
    (r'P0|P1|P2', '**P0 / P1 / P2**', 'Mức quan trọng: P0 = bắt buộc, lỗi là chặn nghiệm thu; P1 = quan trọng; P2 = nên có.'),
    (r'PASS|FAIL|BLOCKED|NOT READY', '**PASS / FAIL / BLOCKED / NOT READY**', 'Kết quả bạn ghi: PASS = đúng hết; FAIL = có bước sai; BLOCKED = không làm tiếp được vì thiếu điều kiện; NOT READY = chức năng chưa có trong ứng dụng.'),
    (r'KH-[A-Z]|CQ-[A-Z]|SP-[A-Z]|ADMIN-\d|SYSTEM', '**KH-A, CQ-A, SP-A, ADMIN-1, SYSTEM…**', 'Tên viết tắt tài khoản thử: KH = khách hàng, CQ = chủ quán, SP = shipper (người giao hàng), ADMIN = quản trị viên (quyền được cấp), SYSTEM = quản trị cao nhất (do kỹ thuật viên giữ). Mật khẩu nằm trong "bảng thông tin riêng" của Người phụ trách, không có trong tài liệu.'),
    (r'Điện thoại [123]', '**Điện thoại 1 / 2 / 3**', 'Điện thoại 1 = máy của khách; 2 = máy của quán; 3 = máy của shipper (xem HUONG_DAN mục 5.3 nếu bạn chỉ có 1-2 máy).'),
    (r'OTP|mã xác minh|SMS', '**OTP / SMS Gateway**', 'OTP = mã 6 số gửi bằng tin nhắn để chứng minh số điện thoại là của bạn. SMS Gateway = điện thoại của hệ thống chuyên gửi tin nhắn này; nếu nó tắt thì không có mã.'),
    (r'APK', '**APK**', 'File cài ứng dụng Android (11Food, 11Ship).'),
    (r'Web Admin', '**Web Admin**', 'Trang web quản trị mở bằng trình duyệt trên máy tính (không phải ứng dụng điện thoại).'),
    (r'Authenticator', '**Authenticator**', 'Ứng dụng trên điện thoại tạo mã 6 số đổi liên tục để đăng nhập Web Admin.'),
    (r'ORDER|DIRECT|Yêu cầu giao|G-', '**Đơn món / Yêu cầu giao (ORDER, DIRECT)**', 'Đơn món = khách đặt món trong 11Food. Yêu cầu giao = việc nhờ shipper giao (mã dạng G-…). ORDER = giao cho đơn món của khách; DIRECT = quán tự gọi shipper, không qua khách.'),
    (r'tạm giữ|hoa hồng|số dư|khả dụng', '**Số dư, tạm giữ, hoa hồng, khả dụng**', 'Ví của shipper: Số dư = tổng tiền trong ví; Tạm giữ = phần bị giữ khi nhận đơn (hoa hồng); Khả dụng = số dư trừ tạm giữ; hoa hồng được thu một lần khi giao thành công, trả lại khi đơn hủy. Chỉ dùng TIỀN THỬ NGHIỆM đã được Owner duyệt.'),
    (r'Idempotency|bấm lặp|bấm nhiều lần', '**Bấm lặp**', 'Bấm một nút nhiều lần chỉ được tác dụng một lần (không tạo đơn/giao dịch trùng).'),
    (r'Khu vực phục vụ|khu vực phục vụ', '**Khu vực phục vụ**', 'Vòng tròn khoảng 10 km quanh trung tâm TP Cao Bằng; ngoài vòng này không đặt/giao được.'),
    (r'phiên đăng nhập|Phiên đăng nhập|đăng xuất', '**Phiên đăng nhập**', 'Khoảng thời gian bạn đang đăng nhập. Mỗi tài khoản chỉ có một phiên: đăng nhập nơi khác thì nơi cũ bị đăng xuất.'),
    (r'kỹ thuật viên|Kỹ thuật viên|KỸ THUẬT VIÊN', '**Kỹ thuật viên / Người phụ trách / Owner**', 'Kỹ thuật viên = người chuẩn bị hệ thống và giữ tài khoản SYSTEM; Người phụ trách = người điều phối buổi test và giữ bảng thông tin riêng; Owner = chủ dự án, quyết định nghiệp vụ và nghiệm thu.'),
    (r'CẦN CHUẨN BỊ TRƯỚC|CẦN KỸ THUẬT VIÊN|CHỈ KỸ THUẬT VIÊN|CẦN XÁC MINH', '**Cột "Sẵn sàng"**', 'SẴN SÀNG = bạn tự làm được; CẦN CHUẨN BỊ TRƯỚC = kỹ thuật viên chuẩn bị xong rồi bạn tự làm; CẦN KỸ THUẬT VIÊN LÀM CÙNG = có bước kỹ thuật viên làm, bạn quan sát; CHỈ KỸ THUẬT VIÊN = bạn bỏ qua; CẦN XÁC MINH = còn chờ Owner/kỹ thuật viên trả lời.'),
]


def glossary_for(text):
    rows = ['| Từ | Nghĩa đơn giản |', '|---|---|']
    for pat, term, meaning in GLOSSARY:
        if re.search(pat, text):
            rows.append('| %s | %s |' % (term, meaning))
    return '\n'.join(rows)

for d in range(1, 6):
    cs = [c for c in ORDERED if c['ngay'] == d]
    p0 = sum(1 for c in cs if c['prio'] == 'P0')
    head = ['# %s' % DAY_NAMES[d], '',
            'Tài liệu này là bản ĐỌC ĐƯỢC của các test case trong file `TESTCASE_11SHIP.csv` (cùng nội dung). Làm lần lượt từ trên xuống dưới vì các test sau dùng dữ liệu của test trước.',
            'Trước khi bắt đầu: đọc `HUONG_DAN_KIEM_THU_11SHIP.md` (nhất là mục chuẩn bị tài khoản, tiền thử nghiệm và cách báo lỗi).', '',
            'Tổng số test case trong ngày: **%d** (P0: %d, P1: %d, P2: %d).' % (len(cs), p0, sum(1 for c in cs if c['prio'] == 'P1'), sum(1 for c in cs if c['prio'] == 'P2')), '',
            '| # | Mã | Tên | Mức | Cần | Sẵn sàng |', '|---|---|---|---|---|---|']
    for c in cs:
        head.append('| %d | %s | %s | %s | %s | %s |' % (c['stt_ngay'], c['id'], esc(c['ten']), c['prio'], ('%s ĐT' % c['phones']) if c['phones'] else 'PC', c['ready']))
    day_text = ' '.join(' '.join([c['ten'], c['muc_dich'], c['actor'], c['pre'], c['ready'], c['loai'], c['verdict']] + [a + ' ' + e for a, e in c['steps']]) for c in cs)
    head.append('')
    head.append('## Từ ngữ dùng trong file này (đọc trước)')
    head.append('')
    head.append(glossary_for(day_text))
    head.append('')
    head.append('---')
    head.append('')
    body = '\n'.join(render_case(c) for c in cs)
    open(OUT + '/chi-tiet/' + DAY_FILES[d], 'w', encoding='utf-8').write('\n'.join(head) + '\n' + body)

# ---------------------------------------------------------------- thống kê
tot = len(ORDERED)
by_prio = Counter(c['prio'] for c in ORDERED)
by_group = OrderedDict()
for k in lib.GROUPS:
    by_group[k] = [c for c in ORDERED if c['group'] == k]
by_letter = defaultdict(list)
for c in ORDERED:
    by_letter[lib.GROUPS[c['group']][1]].append(c)
by_ready = Counter(c['ready'] for c in ORDERED)
by_loai = Counter(c['loai'] for c in ORDERED)
by_day = {d: [c for c in ORDERED if c['ngay'] == d] for d in range(1, 6)}
stats = dict(total=tot, prio=dict(by_prio), ready=dict(by_ready), loai=dict(by_loai),
             group={k: len(v) for k, v in by_group.items()},
             day={d: len(v) for d, v in by_day.items()},
             day_prio={d: dict(Counter(c['prio'] for c in v)) for d, v in by_day.items()},
             group_prio={k: dict(Counter(c['prio'] for c in v)) for k, v in by_group.items()})
json.dump(stats, open(STATE + '/stats.json', 'w'), ensure_ascii=False, indent=1)

# ---------------------------------------------------------------- DANH SACH P0
P0 = [c for c in ORDERED if c['prio'] == 'P0']
L = ['# Danh sách kiểm thử P0 - hành trình bắt buộc chạy nhanh trước', '',
     'P0 = bắt buộc: nếu một test P0 FAIL thì chưa nên thử tiếp phần phụ thuộc vào nó và phải báo lỗi ngay. '
     'Danh sách này lấy TẤT CẢ test mức P0 từ `TESTCASE_11SHIP.csv`, giữ đúng thứ tự phụ thuộc.', '',
     'Tổng số: **%d** test P0 (trên tổng %d test).' % (len(P0), tot), '',
     'Cách chạy nhanh: làm đúng thứ tự dưới đây. Dòng ghi **CẦN CHUẨN BỊ TRƯỚC**: kỹ thuật viên/Owner chuẩn bị xong rồi bạn tự làm một mình. Dòng ghi **CẦN KỸ THUẬT VIÊN LÀM CÙNG**: có bước chỉ kỹ thuật viên/SYSTEM làm được (bạn quan sát và ghi kết quả). Thiếu điều kiện thì ghi BLOCKED và làm test kế tiếp, đừng đứng đợi. '
     'Những dòng **NOT READY** chỉ ghi nhận hiện trạng.', '']
for d in range(1, 6):
    cs = [c for c in P0 if c['ngay'] == d]
    L.append('## %s (%d test P0)' % (DAY_NAMES[d], len(cs)))
    L.append('')
    L.append('| STT P0 | Mã | Tên | Người thực hiện | Thiết bị | Sẵn sàng | Chặn pilot ngoài | Smoke | Kết quả (PASS / FAIL / BLOCKED) |')
    L.append('|---|---|---|---|---|---|---|---|---|')
    for c in cs:
        c['p0n'] = P0.index(c) + 1
        L.append('| %d | %s | %s | %s | %s | %s | %s | %s | ☐ ☐ ☐ |' % (c['p0n'], c['id'], esc(c['ten']), esc(c['actor']), esc('; '.join(c['dev'])), c['ready'], ('⚠ ' + ', '.join(sorted({support.GATES[k] for k, w in support.G.get(c['id'], [])}))) if support.G.get(c['id']) else '', c['smoke'].replace('Smoke ', '')))
    L.append('')
L.append('## Hành trình quan trọng nhất (7 bước, làm đầu tiên nếu thời gian ít)')
L.append('')
L.append('1. TC-SET-001, TC-SET-002: cài hai ứng dụng.')
L.append('2. TC-ACC-001, TC-ACC-003, TC-ACC-004: đăng ký khách, chủ quán, shipper.')
L.append('3. TC-ADM-020, TC-ADM-024: Admin chuẩn bị nhóm món và bảng phí giao.')
L.append('4. TC-SHOP-001, TC-SHOP-009, TC-SHOP-012: dựng Quán Test A (hồ sơ, giờ mở, món).')
L.append('5. TC-WAL-003, TC-WAL-004, TC-WAL-005: nạp tiền thử nghiệm cho shipper (cần Owner duyệt tiền thử nghiệm).')
L.append('6. TC-FLOW-001 và TC-FLOW-003: hai luồng giao hàng chính (khách đặt qua 11Food; quán tự gọi shipper).')
L.append('7. TC-WAL-012: đối chiếu số dư ví sau các đơn.')
L.append('')
open(OUT + '/DANH_SACH_P0.md', 'w', encoding='utf-8').write('\n'.join(L))


# ---------------------------------------------------------------- tài liệu viết tay có chỗ điền số liệu
import glob
from mapping import ROWS, GAPS

SRC = HERE + '/src'


def count(pattern):
    return len(glob.glob(REPO + '/' + pattern, recursive=True))


facts = dict(
    COMMIT=COMMIT, COMMIT_SHORT=COMMIT[:7], TOTAL=tot, P0=by_prio['P0'], P1=by_prio['P1'], P2=by_prio['P2'],
    N_DAY1=len(by_day[1]), N_DAY2=len(by_day[2]), N_DAY3=len(by_day[3]), N_DAY4=len(by_day[4]), N_DAY5=len(by_day[5]),
    DART_LIB_FILES=sum(count(p) for p in ['mobile/food/lib/**/*.dart', 'mobile/ship/lib/**/*.dart', 'mobile/packages/*/lib/**/*.dart']),
    ADMIN_VIEWS=count('apps/admin-web/src/dom/*-view.ts') + count('apps/admin-web/src/dom/*-page.ts'),
    BACKEND_MODULES=len([d for d in glob.glob(REPO + '/apps/backend/src/*') if os.path.isdir(d)]),
    CONTROLLERS=count('apps/backend/src/**/*.controller.ts'),
    MIGRATIONS=count('database/migrations/*.sql'),
    DOCS_CURRENT=count('docs/current/*.md'),
    INT_SPECS=count('tests/integration/*.spec.ts'),
    UNIT_SPECS=count('apps/backend/src/**/*.spec.ts'),
    ADMIN_SPECS=count('apps/admin-web/src/**/*.spec.ts'),
    FLUTTER_TESTS=count('mobile/**/test/*_test.dart'),
)

# --- bảng đối chiếu
cov = ['| Nhóm | Chức năng thật trong code | Bằng chứng (file/tài liệu) | Mức | Test case | Ghi chú |', '|---|---|---|---|---|---|']
mapped = Counter()
for grp, func, ev, tcs, lvl, note in ROWS:
    for t in tcs:
        if t not in ids:
            problems.append('mapping: %s không tồn tại' % t)
        mapped[t] += 1
    cov.append('| %s | %s | `%s` | %s | %s | %s |' % (esc(grp), esc(func), ev.replace('`', '').replace('|', '/'), lvl, ', '.join(tcs), esc(note)))
unmapped = [c['id'] for c in ORDERED if mapped[c['id']] == 0]
if unmapped:
    problems.append('Test chưa có dòng đối chiếu: ' + ', '.join(unmapped))
gaps = ['| Chức năng / điểm | Bằng chứng trong mã nguồn | Tình trạng | Test case ghi nhận |', '|---|---|---|---|']
for name, ev, st, tcs in GAPS:
    for t in tcs:
        if t not in ids:
            problems.append('gaps: %s không tồn tại' % t)
    gaps.append('| %s | %s | **%s** | %s |' % (esc(name), esc(ev), st, ', '.join(tcs) if tcs else '(không cần test: theo thiết kế)'))

loai_desc = {'Thủ công': 'Người kiểm thử mới tự làm toàn bộ bằng điện thoại và trình duyệt (khi đã có điều kiện mục 3.1)',
             support.LOAI_PREP: 'Kỹ thuật viên/Owner chuẩn bị TRƯỚC giờ test (SMS Gateway, tài khoản ADMIN-1, bảng phí, tiền thử nghiệm, hai file APK…). Sau đó người mới tự làm từ đầu đến cuối; cột "Việc cần chuẩn bị trước" nói rõ cần gì',
             support.LOAI_JOINT: 'Có bước chỉ kỹ thuật viên/SYSTEM làm được (dùng tài khoản SYSTEM, tắt/bật SMS Gateway, đổi cấu hình). Bước đó được đánh dấu [KỸ THUẬT VIÊN/SYSTEM làm…]; người mới quan sát, chụp ảnh, so kết quả',
             support.LOAI_AUTO: 'Chỉ đối chiếu kết quả kiểm thử tự động của CI; dành cho kỹ thuật viên, người mới bỏ qua'}
loai_rows = '\n'.join('| %s | %s | %d |' % (k, loai_desc.get(k, ''), by_loai.get(k, 0)) for k in ['Thủ công', support.LOAI_PREP, support.LOAI_JOINT, support.LOAI_AUTO])
loai_rows += '\n| *Tình trạng sẵn sàng* | SẴN SÀNG %d · CẦN CHUẨN BỊ TRƯỚC %d · CẦN KỸ THUẬT VIÊN LÀM CÙNG %d · CHỈ KỸ THUẬT VIÊN %d · CẦN XÁC MINH %d · NOT READY %d | %d |' % (by_ready.get('SẴN SÀNG', 0), by_ready.get(support.READY_PREP, 0), by_ready.get(support.READY_JOINT, 0), by_ready.get(support.READY_AUTO, 0), by_ready.get('CẦN XÁC MINH', 0), by_ready.get('NOT READY', 0), tot)

# --- bảng nhóm cho checklist
gs = ['| Nhóm | Tổng | P0 | P1 | P2 | PASS | FAIL | BLOCKED | NOT READY | NOT RUN |', '|---|---|---|---|---|---|---|---|---|---|']
letters = OrderedDict()
for k, (name, letter) in lib.GROUPS.items():
    letters.setdefault(name if letter == 'X' else name, []).append(k)
for k, v in by_group.items():
    pc = Counter(c['prio'] for c in v)
    gs.append('| %s | %d | %d | %d | %d | | | | | |' % (lib.GROUPS[k][0], len(v), pc['P0'], pc['P1'], pc['P2']))
gs.append('| **Tổng** | **%d** | **%d** | **%d** | **%d** | | | | | |' % (tot, by_prio['P0'], by_prio['P1'], by_prio['P2']))

chk = []
for d in range(1, 6):
    chk.append('### %s' % DAY_NAMES[d])
    chk.append('')
    chk.append('| # | Mã | Tên | Mức | Kết quả |')
    chk.append('|---|---|---|---|---|')
    for c in by_day[d]:
        chk.append('| %d | %s | %s | %s | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |' % (c['stt_ngay'], c['id'], esc(c['ten']), c['prio']))
    chk.append('')

gt = ['| Cổng | Test case | Mức | Vì sao có thể chặn | Kết quả (☐ đạt ☐ chưa đạt) |', '|---|---|---|---|---|']
for key, label in support.GATES.items():
    for c in ORDERED:
        for k, why in support.G.get(c['id'], []):
            if k == key:
                gt.append('| %s | %s · %s | %s | %s | ☐ ☐ |' % (label, c['id'], esc(c['ten']), c['prio'], esc(why)))
gate_table = '\n'.join(gt)


# ---------------------------------------------------------------- smoke test cho người mới
SMOKE_IDS = [s[0] for s in SMOKE]
SMOKE_N = {cid: n for n, cid in enumerate(SMOKE_IDS, 1)}
for cid in SMOKE_IDS:
    if cid not in ids:
        problems.append('SMOKE: test không tồn tại ' + cid)
if not 20 <= len(SMOKE_IDS) <= 30:
    problems.append('SMOKE: cần 20-30 test, hiện %d' % len(SMOKE_IDS))
if len(set(SMOKE_IDS)) != len(SMOKE_IDS):
    problems.append('SMOKE: có mã trùng')
for cid in SMOKE_IDS:
    for d in re.findall(r'TC-[A-Z]+-\d+', lib.BY_ID[cid]['deps']):
        if d not in SMOKE_N:
            problems.append('SMOKE: %s phụ thuộc %s nhưng %s không có trong smoke' % (cid, d, d))
        elif SMOKE_N[d] > SMOKE_N[cid]:
            problems.append('SMOKE: %s đứng trước %s mà phụ thuộc vào nó' % (cid, d))
covered = set()
for cid, role, areas in SMOKE:
    covered.update(a.strip() for a in areas.split(';'))
for a in REQUIRED_AREAS:
    if a not in covered:
        problems.append('SMOKE: thiếu vùng bắt buộc: ' + a)
day_of = {c['id']: c['ngay'] for c in ORDERED}
st = ['| # | Mã | Việc cần kiểm | Ai làm / thiết bị | Ở đâu (file chi tiết) | Sẵn sàng | Phần cần kỹ thuật viên | Kết quả |', '|---|---|---|---|---|---|---|---|']
for n, (cid, role, areas) in enumerate(SMOKE, 1):
    c = lib.BY_ID[cid]
    who = '%s · %s' % (c['actor'], '; '.join(c['dev']))
    KEYROW = {'SMS': 2, 'SIM': 2, 'ADMIN1': 3, 'FEE': 4, 'MONEY': 5, 'LOC': 7}
    ktv = '-'
    if c['support'] == 'PREP':
        rows_needed = sorted({KEYROW[k] for k in support.S[cid][1] if k in KEYROW})
        ktv = ('Cần xong mục 1, hàng ' + ', '.join('#%d' % r for r in rows_needed)) if rows_needed else '-'
    elif c['support'] == 'JOINT':
        ktv = 'KTV: ' + c['assign']
    st.append('| %d | %s | %s | %s | `chi-tiet/%s` | %s | %s | ☐ PASS ☐ FAIL ☐ BLOCKED |' % (n, cid, esc(role), esc(who), DAY_FILES[c['ngay']], c['ready'], esc(ktv)))
smoke_table = '\n'.join(st)
sc2 = ['| Vùng cần phủ | Test smoke |', '|---|---|']
for a in REQUIRED_AREAS:
    sc2.append('| %s | %s |' % (a, ', '.join('#%d %s' % (n, cid) for n, (cid, role, areas) in enumerate(SMOKE, 1) if a in [x.strip() for x in areas.split(';')])))
smoke_cov = '\n'.join(sc2)
smoke_p0 = sum(1 for cid in SMOKE_IDS if lib.BY_ID[cid]['prio'] == 'P0')

# --- tự kiểm tra
dep_ok = not any(p.startswith('Thứ tự') for p in problems)
steps_total = sum(len(c['steps']) for c in ORDERED)
sc = []
sc.append('- **Tổng số test case: %d** (P0 %d · P1 %d · P2 %d); **tổng số bước thao tác: %d** (mỗi bước có kết quả mong đợi đối chiếu).' % (tot, by_prio['P0'], by_prio['P1'], by_prio['P2'], steps_total))
sc.append('- **Mã test không trùng**: %s. **Tên test không trùng**: %s.' % ('đạt' if len(ids) == tot else 'KHÔNG đạt', 'đạt' if not any(p.startswith('Trùng tên') for p in problems) else 'KHÔNG đạt'))
sc.append('- **Mọi tham chiếu "phụ thuộc" trỏ tới test có thật và test đó được xếp chạy TRƯỚC**: %s.' % ('đạt' if dep_ok and not any('Tham chiếu' in p for p in problems) else 'KHÔNG đạt - xem lỗi'))
sc.append('- **Mọi test đều có đủ**: điều kiện ban đầu, dữ liệu nhập, ≥2 bước kèm kết quả mong đợi, cách kết luận, cách khôi phục, căn cứ code/tài liệu: %s.' % ('đạt' if not any(p.startswith(('Thiếu', 'Quá ít')) for p in problems) else 'KHÔNG đạt'))
sc.append('- **Mọi test đều xuất hiện trong bảng đối chiếu mục 2**: %s.' % ('đạt' if not unmapped else 'KHÔNG đạt: ' + ', '.join(unmapped)))
sc.append('- **Bao phủ các nhóm đề bài (A–H)**: ' + '; '.join('%s = %d' % (k, len(v)) for k, v in sorted(by_letter.items()) if k != 'X') + '; bổ sung (thông báo, đánh giá/phản ánh, quyền/riêng tư, đối chiếu tự động) = %d.' % len(by_letter['X']))
sc.append('- **File CSV**: UTF-8 có BOM, %d dòng dữ liệu × %d cột, ô dài nhất %d ký tự (giới hạn của Excel 32.767); đã kiểm tra đọc lại được bằng bộ đọc CSV chuẩn.' % (tot, len(HEAD), maxcell))
sc.append('- **Không có mật khẩu, mã OTP thật hay thông tin nhạy cảm** trong bộ tài liệu (chỉ dùng tên viết tắt tài khoản và nhãn SĐT-…).')
sc.append('- **Không chạy ứng dụng thật**: các điểm này là nhận định từ mã nguồn; xem mục 7.')

gen = dict(facts)
gen.update(SMOKE_TABLE=smoke_table, SMOKE_COVERAGE=smoke_cov, SMOKE_COUNT=len(SMOKE_IDS), SMOKE_P0=smoke_p0, GATE_TABLE=gate_table, GATE_COUNT=len([1 for c in ORDERED if support.G.get(c['id'])]), COVERAGE_TABLE='\n'.join(cov), GAPS_TABLE='\n'.join(gaps), LOAI_ROWS=loai_rows, GROUP_SUMMARY='\n'.join(gs), CHECK_TABLES='\n'.join(chk), SELF_CHECK='\n'.join(sc))
for name in ['HUONG_DAN_KIEM_THU_11SHIP.md', 'KICH_BAN_TEST_LIEN_THONG.md', 'BAO_CAO_LOI_MAU.md', 'CHECKLIST_NGHIEM_THU.md', 'DOI_CHIEU_CODE_TESTCASE.md', 'SMOKE_TEST_NGUOI_MOI.md', 'README.md']:
    t = open(SRC + '/' + name, encoding='utf-8').read()
    for k, v in gen.items():
        t = t.replace('{{%s}}' % k, str(v))
    left = re.findall(r'\{\{[A-Z_0-9]+\}\}', t)
    if left:
        problems.append('Placeholder còn sót trong %s: %s' % (name, left))
    open(OUT + '/' + name, 'w', encoding='utf-8').write(t)

print('TOTAL', tot, dict(by_prio))
print('PROBLEMS:')
for p in problems:
    print(' -', p)
print('max cell', maxcell)
json.dump({'order': [c['id'] for c in ORDERED]}, open(STATE + '/order.json', 'w'))

# ---------------------------------------------------------------- --check: file đã commit có khớp nguồn không?
if CHECK:
    import filecmp
    drift = []
    for root, _, files in os.walk(OUT):
        for f in files:
            new = os.path.join(root, f)
            rel = os.path.relpath(new, OUT)
            old = os.path.join(COMMITTED, rel)
            if not os.path.exists(old) or not filecmp.cmp(new, old, shallow=False):
                drift.append(rel)
    if drift:
        print('LỆCH so với bản đã commit (chạy lại: python3 build.py):')
        for d in sorted(drift):
            print(' -', d)
    else:
        print('KHỚP: mọi file sinh ra giống bản đã commit.')
    sys.exit(1 if (drift or problems) else 0)
if problems:
    sys.exit(1)
