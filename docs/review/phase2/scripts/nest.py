"""Source-parsed NestJS wiring for apps/backend/src at the checked-out SHA (regex + bracket matching, no execution)."""
import re, os, json, sys
ROOT = sys.argv[1]; SRC = os.path.join(ROOT, 'apps/backend/src')
def files():
    for d, _, fs in os.walk(SRC):
        for f in fs:
            if f.endswith('.ts') and not f.endswith('.spec.ts'):
                yield os.path.join(d, f)
def rel(p): return os.path.relpath(p, ROOT)
def arr_after(text, key):
    out = []
    for m in re.finditer(r'\b' + key + r'\s*:\s*\[', text):
        i = m.end(); depth = 1; j = i
        while j < len(text) and depth:
            depth += {'[': 1, ']': -1}.get(text[j], 0); j += 1
        out.append(text[i:j-1])
    return out
IDENT = re.compile(r'\b([A-Z][A-Za-z0-9_]*)\b')
modules, controllers, timers, hooks = {}, [], [], []
class_file = {}
for p in files():
    t = open(p, encoding='utf-8').read()
    t = re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), t, flags=re.S)
    t = re.sub(r'(?m)^(\s*)//.*$', lambda m: m.group(1), t)
    for m in re.finditer(r'export\s+(?:abstract\s+)?class\s+(\w+)', t): class_file[m.group(1)] = rel(p)
    if p.endswith('.module.ts'):
        cls = re.findall(r'export\s+class\s+(\w+Module)\b', t)
        imp = sorted({x for a in arr_after(t, 'imports') for x in IDENT.findall(a) if x.endswith('Module') and x not in ('DynamicModule',)})
        ctl = sorted({x for a in arr_after(t, 'controllers') for x in IDENT.findall(a)})
        prv = sorted({x for a in arr_after(t, 'providers') for x in IDENT.findall(a) if not x.isupper()})
        exp = sorted({x for a in arr_after(t, 'exports') for x in IDENT.findall(a)})
        for c in cls:
            modules[c] = dict(file=rel(p), imports=[i for i in imp if i != c], controllers=ctl, providers=prv, exports=exp,
                              forwardRef='forwardRef' in t, dynamic=bool(re.search(r'static\s+(register|forRoot|forFeature)', t)),
                              global_='@Global' in t, middleware=re.findall(r'apply\(([^)]*)\)\s*\.forRoutes', t))
    for m in re.finditer(r'@Controller\(\s*([^)]*)\)\s*(?:@\w+\([^)]*\)\s*)*export\s+class\s+(\w+)', t):
        path = m.group(1).strip().strip("'\"`") ; name = m.group(2)
        start = m.end(); nxt = re.search(r'\n@Controller\(|\nexport\s+class\s', t[start:]); body = t[start: start + nxt.start()] if nxt else t[start:]
        head = t[max(0, m.start()-400):m.end()]
        pre = t[:m.start()]
        blk = re.search(r'((?:@\w+\((?:[^()]|\([^()]*\))*\)\s*)*)$', pre)
        cls_guard = re.findall(r'@UseGuards\(([^)]*)\)', (blk.group(1) if blk else '') + t[m.start():m.end()])
        routes = []
        for r in re.finditer(r'((?:\s*@\w+\((?:[^()]|\([^()]*\))*\))+)\s*(?:public\s+)?(?:async\s+)?(\w+)\s*\(', body):
            decs = r.group(1); h = r.group(2)
            vm = re.search(r'@(Get|Post|Put|Patch|Delete|All)\(\s*([^)]*)\)', decs)
            if not vm: continue
            # handler body snippet for in-handler auth detection
            hb = body[r.end(): r.end() + 1500]
            hb = hb[: (re.search(r'\n  @\w+\(', hb).start() if re.search(r'\n  @\w+\(', hb) else len(hb))]
            mg = re.findall(r'@UseGuards\(([^)]*)\)', decs)
            auth = []
            if cls_guard or mg: auth.append('UseGuards(' + ','.join(cls_guard + mg) + ')')
            if re.search(r'transport\.(read|write)\(|#transport|Transport\(', hb): auth.append('AdminTransport-in-handler')
            for k in re.findall(r'this\.(#?\w*(?:auth|session|access|admin|boundary|guard|principal|transport)\w*)(?:\.(\w+))?\(', hb, re.I): auth.append('call:%s%s' % (k[0], '.'+k[1] if k[1] else ''))
            for k in re.findall(r'this\.(#?\w+)\((?:await\s+)?(?:request|r|req)\b', hb): auth.append('reqcall:' + k)
            if re.search(r"@Headers\('x-csrf-token'\)", hb[:600] + decs): auth.append('csrf-header')
            for k in re.findall(r'\b(readCookieToken|requireAdmin\w*|authorize\w*|verify\w*Token|authenticate\w*)\(', hb): auth.append('fn:' + k)
            line = t[:start].count('\n') + body[:r.start()].count('\n') + 2
            routes.append(dict(method=vm.group(1).upper(), path=vm.group(2).strip().strip("'\"`"), handler=h, auth=sorted(set(auth)), line=line))
        controllers.append(dict(name=name, file=rel(p), path=path, class_guards=cls_guard, routes=routes))
    for m in re.finditer(r'\b(setInterval|setTimeout)\(', t):
        timers.append(dict(file=rel(p), kind=m.group(1), line=t[:m.start()].count('\n') + 1))
    for m in re.finditer(r'\b(onModuleInit|onApplicationBootstrap|onModuleDestroy|onApplicationShutdown)\s*\(', t):
        hooks.append(dict(file=rel(p), hook=m.group(1), line=t[:m.start()].count('\n') + 1))
reg = {}
for mn, md in modules.items():
    for c in md['controllers']: reg.setdefault(c, []).append(mn)
for c in controllers: c['registered_in'] = reg.get(c['name'], [])
json.dump(dict(modules=modules, controllers=controllers, timers=timers, hooks=hooks, class_file=class_file), open(sys.argv[2], 'w'), indent=1)
print(len(modules), 'modules', len(controllers), 'controllers', sum(len(c['routes']) for c in controllers), 'routes', len(timers), 'timers', len(hooks), 'hooks')
print('unregistered controllers', [c['name'] for c in controllers if not c['registered_in']])
