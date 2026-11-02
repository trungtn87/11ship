import re, os, sys, json, csv, subprocess, collections
sys.path.insert(0, os.path.dirname(__file__)); from hints import H
ROOT, NEST, OUT = sys.argv[1:4]; nest = json.load(open(NEST))
files = subprocess.check_output(['git', '-C', ROOT, 'ls-files']).decode().split('\n')[:-1]
def rd(f):
    try: return open(os.path.join(ROOT, f), encoding='utf-8').read()
    except Exception: return ''
istest = lambda f: bool(re.search(r'(\.spec\.|\.test\.|_test\.dart|^tests/|/test/|\.fixture\.)', f))
prod = [f for f in files if f.endswith(('.ts','.dart','.mjs','.js','.sql')) and not istest(f) and re.match(r'(apps|mobile|database|ops|scripts)/', f) and 'node_modules' not in f and '/dist/' not in f]
tst = [f for f in files if istest(f) and f.endswith(('.ts','.mjs','.dart','.js'))]
T = {f: rd(f) for f in prod + tst}
req = []
for line in rd('docs/baseline/requirements.md').split('\n'):
    if re.match(r'^\| M\d\d-R-\d\d ', line):
        c = [x.strip() for x in line.strip().strip('|').split('|')]; req.append((c[0], c[1], c[2]))
IMP = json.load(open(os.path.join(os.path.dirname(os.path.abspath(NEST)), 'imports.json')))
IMPT = [(e[0], e[1]) for e in IMP['edges'] if istest(e[0])]
ctrl_by_file = collections.defaultdict(list)
for c in nest['controllers']:
    for r in c['routes']: ctrl_by_file[c['file']].append((c['name'], r))
AREA = {
 'M00': ['transaction','idempotency','outbox','audit','config','database','logging','http','common'],
 'M01': ['auth','client-auth','client-device','account-recovery','account-lifecycle','admin-auth','admin-activation','admin-invitations','onboarding','sms-gateway','mobile/packages/n11_shared/lib/src/account','mobile/packages/n11_shared/lib/src/flows'],
 'M02': ['shop','shop-management','shop-setup','menu','discovery-route','admin-menu-categories','admin-shops','admin-service-areas','mobile/packages/n11_shared/lib/src/m02'],
 'M03': ['shipper-self','driver','admin-shippers','mobile/packages/n11_shared/lib/src/flows/driver'],
 'M04': ['wallet','driver-wallet','wallet-topup','admin-topups','admin-finance','finance-access','shipper-settlement','business-dashboard','shop-entitlements','mobile/packages/n11_shared/lib/src/wallet','mobile/packages/n11_shared/lib/src/finance'],
 'M05': ['customers','customer-profile','address-change','mobile/packages/n11_shared/lib/src/addresses','mobile/packages/n11_shared/lib/src/address_change'],
 'M06': ['shipping-policy','delivery','mobile/packages/n11_shared/lib/src/m06'],
 'M07': ['delivery','order-timeouts','admin-deliveries','mobile/packages/n11_shared/lib/src/m07'],
 'M08': ['notifications','mobile/packages/n11_shared/lib/src/m08'],
 'M10': ['orders','admin-orders','order-chat','order-timeouts','address-change','mobile/packages/n11_shared/lib/src/m10'],
 'M11': ['feedback','admin-feedback','mobile/packages/n11_shared/lib/src/m11'],
 'M12': ['admin-','ops','business-dashboard','system-settings','apps/admin-web'],
 'M13': ['ops','sms-gateway','mobile/gateway','mobile/packages/n11_shared/lib/src/m13'],
 'M14': ['delivery','discovery-route','shipping-policy','mobile/packages/n11_m14','mobile/packages/n11_m14_map','mobile/ship'],
}
def in_area(f, mod): return any(('/' + a) in f or f.startswith(a) or ('src/' + a) in f for a in AREA.get(mod, []))
rows = []
for rid, mod, title in req:
    hs = H.get(rid, [])
    comp = []; ev = []; kind = set()
    for h in hs:
        if '/' in h or h.endswith(('.ts', '.dart')):
            m = [f for f in prod if h in f]
            if m: comp += m[:12]; ev.append('path:' + h + '(%d)' % len(m)); kind.add('PATH')
        else:
            m = [f for f in prod if re.search(r'\b' + re.escape(h) + r'\b', T[f]) and not f.endswith('.sql')]
            if 1 <= len(m) <= 10: comp += m; ev.append('ident:' + h + '(%d)' % len(m)); kind.add('IDENT')
            else:
                ma = [f for f in m if in_area(f, mod)]
                ma.sort(key=lambda f: -len(re.findall(r'\b' + re.escape(h) + r'\b', T[f])))
                if 1 <= len(ma) and len(m) > 10: comp += ma[:5]; ev.append('area-ident:' + h + '(%d of %d)' % (min(5, len(ma)), len(m))); kind.add('AREAIDENT')
                elif not ma and len(m) > 10: ev.append('ident:' + h + ' generic(%d), none in module area' % len(m))
    comp = list(dict.fromkeys(comp))
    eps = []
    for f in comp:
        for cn, r in ctrl_by_file.get(f, []):
            cp = [c['path'] for c in nest['controllers'] if c['name'] == cn][0]
            eps.append('%s /%s %s -> %s.%s @%s:%d' % (r['method'], cp.strip('/'), r['path'], cn, r['handler'], f.split('src/')[-1], r['line']))
    cs = set(comp)
    tests = sorted({src for src, dst in IMPT if dst in cs})
    comp_s = [f for f in comp if not f.endswith('.sql')]
    if not comp: conf, nf = 'NOT-FOUND-BY-HINT', 'x'
    elif 'PATH' in kind and eps and tests: conf, nf = 'CANDIDATE-STRONG', ''
    elif 'PATH' in kind and (eps or tests): conf, nf = 'CANDIDATE-MEDIUM', ''
    elif 'PATH' in kind: conf, nf = 'CANDIDATE-WEAK', ''
    else: conf, nf = 'CANDIDATE-WEAK(ident only)', ''
    if not comp:
        conf, nf = 'NOT-FOUND-BY-HINT', 'Hints matched no production file in module area. NOT proof of absence: the hint may be wrong (Phase 3 must check).'
    rows.append(dict(req_id=rid, module=mod, title=title, locate_confidence=conf, components=';'.join(comp_s[:6]), entry_points=' || '.join(eps[:12]),
                     tests=';'.join(tests[:4]), n_tests=len(tests), hints_used='; '.join(ev[:6]), not_found=nf,
                     note='Locates candidate code only; says nothing about whether the requirement is met (Phase 3).'))
w = csv.DictWriter(open(OUT, 'w', newline='', encoding='utf-8'), fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
print(len(rows), collections.Counter(r['locate_confidence'] for r in rows)); print([r['req_id'] for r in rows if r['locate_confidence'] == 'NOT-FOUND'])
