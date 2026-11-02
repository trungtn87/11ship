"""Source-parsed file import graph (TS/JS/MJS + Dart) at the checked-out SHA, plus SCCs. Usage: imports.py ROOT OUT.json"""
import re, os, json, sys, subprocess
ROOT = sys.argv[1]
files = subprocess.check_output(['git', '-C', ROOT, 'ls-files']).decode().split('\n')[:-1]
fset = set(files)
TS_EXT = ('.ts', '.tsx', '.js', '.mjs', '.cjs')
def strip(t):
    t = re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), t, flags=re.S)
    return re.sub(r'(?m)^\s*//.*$', '', t)
def resolve(src, spec):
    base = os.path.normpath(os.path.join(os.path.dirname(src), spec))
    cands = [base] + [base + e for e in TS_EXT + ('.dart',)] + [base + '/index' + e for e in TS_EXT]
    if base.endswith('.js'): cands.insert(1, base[:-3] + '.ts')
    if base.endswith('.mjs'): cands.insert(1, base[:-4] + '.mts')
    for c in cands:
        if c in fset: return c
    return None
# dart package roots: name -> lib dir
pkg = {}
for f in files:
    if f.endswith('pubspec.yaml'):
        m = re.search(r'(?m)^name:\s*(\S+)', open(os.path.join(ROOT, f)).read())
        if m: pkg[m.group(1)] = os.path.join(os.path.dirname(f), 'lib')
edges = []  # (src, dst, kind, typeonly, line)
unresolved = []
for f in files:
    if not (f.endswith(TS_EXT) or f.endswith('.dart')) or f.endswith('.d.ts'): continue
    try: t = strip(open(os.path.join(ROOT, f), encoding='utf-8').read())
    except Exception: continue
    if f.endswith('.dart'):
        for m in re.finditer(r"(?m)^\s*(import|export|part)\s+'([^']+)'", t):
            spec = m.group(2); line = t[:m.start()].count('\n') + 1
            if spec.startswith('dart:'): continue
            if spec.startswith('package:'):
                p, _, rest = spec[8:].partition('/')
                if p in pkg:
                    d = os.path.normpath(os.path.join(pkg[p], rest))
                    edges.append((f, d if d in fset else None, m.group(1), False, line, spec))
                continue
            d = resolve(f, spec); edges.append((f, d, m.group(1), False, line, spec))
    else:
        pat = r"(?m)^\s*(import|export)\s+(type\s+)?(?:[^'\";]*?\sfrom\s+)?['\"]([^'\"]+)['\"]|\brequire\(\s*['\"]([^'\"]+)['\"]\s*\)|\bimport\(\s*['\"]([^'\"]+)['\"]\s*\)"
        for m in re.finditer(pat, t):
            spec = m.group(3) or m.group(4) or m.group(5); line = t[:m.start()].count('\n') + 1
            if not spec.startswith('.'): continue
            kind = 'require' if m.group(4) else ('dynamic' if m.group(5) else m.group(1))
            typeonly = bool(m.group(2)) or bool(m.group(0) and re.match(r'\s*import\s*\{\s*type\s', m.group(0)) and ',' not in m.group(0).split('}')[0].replace('type ', '', 1) and False)
            d = resolve(f, spec); edges.append((f, d, kind, typeonly, line, spec))
for e in edges:
    if e[1] is None: unresolved.append(e)
E = [e for e in edges if e[1]]
# Tarjan SCC on runtime edges (exclude type-only and dynamic imports)
adj = {}
for s, d, k, to, l, sp in E:
    if not to and k != 'dynamic': adj.setdefault(s, set()).add(d)
sys.setrecursionlimit(100000)
idx, low, on, st, sccs, c = {}, {}, set(), [], [], [0]
def sc(v):
    idx[v] = low[v] = c[0]; c[0] += 1; st.append(v); on.add(v)
    for w in adj.get(v, ()):
        if w not in idx: sc(w); low[v] = min(low[v], low[w])
        elif w in on: low[v] = min(low[v], idx[w])
    if low[v] == idx[v]:
        comp = []
        while True:
            w = st.pop(); on.discard(w); comp.append(w)
            if w == v: break
        if len(comp) > 1: sccs.append(sorted(comp))
for v in list(adj):
    if v not in idx: sc(v)
json.dump(dict(edges=E, unresolved=unresolved, sccs=sccs, dart_packages=pkg), open(sys.argv[2], 'w'), indent=0)
print('edges', len(E), 'unresolved', len(unresolved), 'sccs', len(sccs), [len(s) for s in sccs])
