# -*- coding: utf-8 -*-
"""Kiểm tra tính toàn vẹn của bộ tài liệu ĐÃ SINH (đọc lại từ file, không dùng dữ liệu nguồn).
Chạy: python3 verify.py   (thoát mã 1 nếu có lỗi)"""
import csv, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
errors = []


def err(msg):
    errors.append(msg)


def read(p):
    return open(os.path.join(ROOT, p), encoding='utf-8').read()


rows = list(csv.reader(open(os.path.join(ROOT, 'TESTCASE_11SHIP.csv'), encoding='utf-8-sig', newline='')))
head, data = rows[0], rows[1:]
col = {h: i for i, h in enumerate(head)}
need_cols = ['Mã test', 'Mức độ', 'Các bước thực hiện', 'Kết quả mong đợi (theo từng bước)', 'Cách kết luận PASS/FAIL', 'Cách khôi phục để chạy lại',
             'Phụ thuộc (test phải làm trước)', 'Trạng thái', 'Ngày kiểm thử', 'Người kiểm thử', 'Phiên bản APK hoặc bản triển khai', 'Mã lỗi liên quan',
             'Đường dẫn ảnh/video bằng chứng', 'Loại kiểm thử', 'Tình trạng sẵn sàng', 'Smoke test người mới (STT)', 'Điểm có thể chặn thử nghiệm bên ngoài (pilot)']
for h in need_cols:
    if h not in col:
        err('CSV thiếu cột: ' + h)
if any(len(r) != len(head) for r in data):
    err('CSV có dòng sai số cột')
raw = open(os.path.join(ROOT, 'TESTCASE_11SHIP.csv'), 'rb').read()
if not raw.startswith(b'\xef\xbb\xbf'):
    err('CSV thiếu BOM UTF-8')

ids = [r[col['Mã test']] for r in data]
if len(ids) != len(set(ids)):
    err('Mã test trùng')
pos = {i: n for n, i in enumerate(ids)}
for r in data:
    i = r[col['Mã test']]
    if not re.fullmatch(r'TC-[A-Z]+-\d{3}', i):
        err('Mã sai định dạng: ' + i)
    if r[col['Mức độ']] not in ('P0', 'P1', 'P2'):
        err('Mức độ lạ: ' + i)
    steps = re.findall(r'^Bước (\d+): ', r[col['Các bước thực hiện']], re.M)
    exp = re.findall(r'^Bước (\d+): ', r[col['Kết quả mong đợi (theo từng bước)']], re.M)
    if len(steps) < 2 or steps != exp:
        err('Số bước và số kết quả mong đợi không khớp / <2 bước: ' + i)
    for dep in re.findall(r'TC-[A-Z]+-\d+', r[col['Phụ thuộc (test phải làm trước)']]):
        if dep not in pos:
            err('Phụ thuộc không tồn tại: %s -> %s' % (i, dep))
        elif pos[dep] > pos[i]:
            err('Phụ thuộc chạy sau: %s -> %s' % (i, dep))
    if not r[col['Cách khôi phục để chạy lại']].strip():
        err('Thiếu cách khôi phục: ' + i)
    if 'BAO_CAO_LOI_MAU' not in r[col['Cách kết luận PASS/FAIL']]:
        err('Cách kết luận thiếu chỉ dẫn báo lỗi: ' + i)
    if r[col['Trạng thái']] not in ('NOT RUN', 'NOT READY'):
        err('Trạng thái ban đầu lạ: %s %s' % (i, r[col['Trạng thái']]))
    for k in ('Ngày kiểm thử', 'Người kiểm thử', 'Phiên bản APK hoặc bản triển khai', 'Mã lỗi liên quan', 'Đường dẫn ảnh/video bằng chứng'):
        if r[col[k]].strip():
            err('Ô kết quả phải để trống khi phát hành: %s / %s' % (i, k))
    lo = r[col['Loại kiểm thử']]
    if lo in ('Chuẩn bị trước, người mới tự làm', 'Cần kỹ thuật viên cùng làm'):
        for k in ('Việc cần chuẩn bị trước (ai chuẩn bị)', 'Phân công khi đang test', 'Nếu thiếu điều kiện / kỹ thuật viên chưa sẵn sàng'):
            if not r[col[k]].strip():
                err('Thiếu "%s": %s' % (k, i))
    if lo == 'Cần kỹ thuật viên cùng làm' and r[col['Tình trạng sẵn sàng']] == 'SẴN SÀNG':
        err('Loại "cùng làm" mà ghi SẴN SÀNG: ' + i)

p0 = [r[col['Mã test']] for r in data if r[col['Mức độ']] == 'P0']
smoke = {r[col['Mã test']]: r[col['Smoke test người mới (STT)']] for r in data if r[col['Smoke test người mới (STT)']]}

# --- DANH_SACH_P0.md phải có đúng các P0
t = read('DANH_SACH_P0.md')
listed = re.findall(r'^\| \d+ \| (TC-[A-Z]+-\d+) \|', t, re.M)
if listed != p0:
    err('DANH_SACH_P0.md không khớp danh sách P0 của CSV (%d vs %d)' % (len(listed), len(p0)))

# --- các file ngày
from_days = []
for f in sorted(os.listdir(os.path.join(ROOT, 'chi-tiet'))):
    if f.endswith('.md'):
        d = read('chi-tiet/' + f)
        from_days += re.findall(r'^### (TC-[A-Z]+-\d+) · ', d, re.M)
        if '## Từ ngữ dùng trong file này' not in d:
            err('Thiếu bảng thuật ngữ: ' + f)
if from_days != ids:
    err('Các file chi-tiet không khớp thứ tự/danh sách CSV (%d vs %d)' % (len(from_days), len(ids)))

# --- checklist có đủ mọi test
c = read('CHECKLIST_NGHIEM_THU.md')
in_check = set(re.findall(r'^\| \d+ \| (TC-[A-Z]+-\d+) \|', c, re.M))
if in_check != set(ids):
    err('CHECKLIST_NGHIEM_THU.md thiếu/thừa test so với CSV: ' + ', '.join(sorted(set(ids) ^ in_check)[:10]))
if 'OQ-01' not in c or 'Điểm có thể CHẶN' not in c:
    err('CHECKLIST thiếu mục cổng chặn hoặc câu hỏi Owner')

# --- smoke
s = read('SMOKE_TEST_NGUOI_MOI.md')
s_ids = re.findall(r'^\| \d+ \| (TC-[A-Z]+-\d+) \|', s, re.M)
if sorted(s_ids) != sorted(smoke):
    err('SMOKE_TEST_NGUOI_MOI.md không khớp cột Smoke của CSV')
if not 20 <= len(s_ids) <= 30:
    err('Smoke phải 20-30 test, hiện %d' % len(s_ids))

# --- số liệu trong tài liệu khớp CSV
tot = len(ids)
h = read('HUONG_DAN_KIEM_THU_11SHIP.md')
if '%d test **bắt buộc**' % len(p0) not in h or '**Toàn bộ %d test case**' % tot not in h:
    err('HUONG_DAN ghi sai tổng số test/P0')
if '{{' in h + c + s + t:
    err('Còn placeholder {{…}}')

# --- không có bí mật / khẳng định lỗi thời
allmd = {}
for dp, _, fs in os.walk(ROOT):
    if os.sep + 'generator' in dp:
        continue
    for f in fs:
        if f.endswith(('.md', '.csv')):
            p = os.path.join(dp, f)
            allmd[os.path.relpath(p, ROOT)] = open(p, encoding='utf-8-sig').read()
for n, txt in allmd.items():
    if re.search(r'(?i)(mật khẩu|password)\s*[:=]\s*[^\s|,;]{6,}', txt):
        err('Nghi có mật khẩu thật trong ' + n)
    if re.search(r'(?<!\d)\d{6}(?!\d)\s*\(?\s*(là )?(mã )?OTP|OTP\s*[:=]\s*\d{6}', txt):
        err('Nghi có mã OTP thật trong ' + n)
    if [x for x in re.findall(r'(?<!\d)0\d{9}(?!\d)', txt) if x != '0912345678']:  # 0912345678 là số minh họa
        err('Nghi có số điện thoại thật trong ' + n)
    if re.search(r'(root|bootloader)[^.\n]{0,80}(bị chặn|sẽ báo|DEVICE_PROOF_UNSUPPORTED)', txt, re.I) and 'LỖI THỜI' not in txt and 'lỗi thời' not in txt:
        err('Còn khẳng định máy root/bootloader bị chặn (đã lỗi thời sau PR #170): ' + n)

# --- mọi mã TC nhắc tới trong tài liệu phải tồn tại
idset = set(ids)
for n, txt in allmd.items():
    for m in set(re.findall(r'TC-[A-Z]+-\d{3}', txt)):
        if m not in idset:
            err('Tham chiếu mã test không tồn tại trong %s: %s' % (n, m))
    # dạng rút gọn "TC-WAL-003/005/008"
    for m in re.finditer(r'TC-([A-Z]+)-(\d{3})((?:/\d{3})+)', txt):
        for num in m.group(3).split('/')[1:]:
            if 'TC-%s-%s' % (m.group(1), num) not in idset:
                err('Tham chiếu rút gọn không tồn tại trong %s: TC-%s-%s' % (n, m.group(1), num))

# --- liên kết tương đối trong markdown
for n, txt in allmd.items():
    if not n.endswith('.md'):
        continue
    base = os.path.dirname(os.path.join(ROOT, n))
    for m in re.finditer(r'\]\(([^)#]+)\)', txt):
        tgt = m.group(1)
        if tgt.startswith(('http', 'mailto')):
            continue
        if not os.path.exists(os.path.normpath(os.path.join(base, tgt))):
            err('Liên kết gãy trong %s: %s' % (n, tgt))

print('Kiểm tra: %d test case, %d P0, %d smoke, %d file markdown' % (tot, len(p0), len(s_ids), sum(1 for n in allmd if n.endswith('.md'))))
if errors:
    print('LỖI (%d):' % len(errors))
    for e in errors:
        print(' -', e)
    sys.exit(1)
print('TOÀN VẸN: đạt')
