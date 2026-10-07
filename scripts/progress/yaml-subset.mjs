// Minimal, strict YAML-subset parser for docs/progress/plan.yml.
//
// Why not a YAML library: the workflow that holds a write token should not run `npm ci`, so the
// generator has zero runtime dependencies. The subset is small on purpose and anything outside it
// throws with a line number instead of being guessed at.
//
// Supported: 2-space indentation, `key: value`, nested maps, `- item` lists (of scalars or of
// maps written as `- key: value` + 2 more spaces), scalars (null/~, true/false, integers, plain and
// quoted strings), `[]`, `{}` and flow lists of scalars like `[a, b]`, and `#` comments.
// Not supported: tabs, anchors/aliases, tags, multi-line scalars, flow maps with content,
// duplicate keys, a list at the same indent as its parent key.

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_.-]*):(?:\s+(.*))?$/;

function fail(line, message) {
  return new Error(`plan YAML line ${line}: ${message}`);
}

function stripComment(raw) {
  let quote = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      // A quote only opens a string at the start of a value token.
      const prev = raw[i - 1];
      if (prev === undefined || prev === ' ' || prev === '[' || prev === ',') quote = ch;
    } else if (ch === '#' && (i === 0 || raw[i - 1] === ' ')) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

function splitFlow(inner, line) {
  const parts = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"') {
        current += inner[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (quote) throw fail(line, 'unterminated quote in flow list');
  if (current.trim() !== '' || parts.length > 0) parts.push(current);
  return parts.map((p) => parseScalar(p.trim(), line));
}

function parseScalar(text, line) {
  if (text === '' || text === 'null' || text === '~') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (text.startsWith('"')) {
    if (text.length < 2 || !text.endsWith('"')) throw fail(line, `bad double-quoted string: ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      throw fail(line, `bad escape in string: ${text}`);
    }
  }
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) throw fail(line, `bad single-quoted string: ${text}`);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) throw fail(line, `unterminated flow list: ${text}`);
    return splitFlow(text.slice(1, -1), line);
  }
  if (text === '{}') return {};
  if (text.startsWith('{')) throw fail(line, 'flow maps with content are not supported');
  if (/^[&*!|>]/.test(text)) throw fail(line, `unsupported YAML syntax: ${text}`);
  return text;
}

export function parseYaml(source) {
  const lines = [];
  source.split(/\r?\n/).forEach((raw, index) => {
    const n = index + 1;
    const leading = raw.match(/^[ \t]*/)[0];
    if (leading.includes('\t')) throw fail(n, 'tab indentation is not allowed');
    const text = stripComment(raw).replace(/\s+$/, '');
    if (text.trim() === '') return;
    lines.push({ n, indent: leading.length, text: text.trim() });
  });

  let pos = 0;
  const isItem = (l) => l.text === '-' || l.text.startsWith('- ');

  function parseNode(indent) {
    const line = lines[pos];
    if (line.indent !== indent) throw fail(line.n, `unexpected indentation (expected ${indent})`);
    return isItem(line) ? parseList(indent) : parseMap(indent);
  }

  function parseMap(indent) {
    const map = {};
    while (pos < lines.length && lines[pos].indent === indent && !isItem(lines[pos])) {
      const line = lines[pos];
      const m = KEY_RE.exec(line.text);
      if (!m) throw fail(line.n, `expected "key: value", got: ${line.text}`);
      const key = m[1];
      if (Object.prototype.hasOwnProperty.call(map, key)) throw fail(line.n, `duplicate key: ${key}`);
      pos += 1;
      if (m[2] !== undefined && m[2].trim() !== '') {
        map[key] = parseScalar(m[2].trim(), line.n);
      } else if (pos < lines.length && lines[pos].indent > indent) {
        map[key] = parseNode(lines[pos].indent);
      } else {
        map[key] = null;
      }
    }
    if (pos < lines.length && lines[pos].indent > indent) {
      throw fail(lines[pos].n, 'unexpected indentation');
    }
    return map;
  }

  function parseList(indent) {
    const list = [];
    while (pos < lines.length && lines[pos].indent === indent && isItem(lines[pos])) {
      const line = lines[pos];
      const rest = line.text === '-' ? '' : line.text.slice(2).trim();
      if (rest === '') {
        pos += 1;
        if (pos < lines.length && lines[pos].indent > indent) list.push(parseNode(lines[pos].indent));
        else list.push(null);
      } else if (KEY_RE.test(rest)) {
        // "- key: value": re-read the remainder as the first line of a map two columns deeper.
        lines[pos] = { n: line.n, indent: indent + 2, text: rest };
        list.push(parseMap(indent + 2));
      } else {
        pos += 1;
        list.push(parseScalar(rest, line.n));
      }
    }
    if (pos < lines.length && lines[pos].indent > indent) {
      throw fail(lines[pos].n, 'unexpected indentation');
    }
    return list;
  }

  if (lines.length === 0) return null;
  const result = parseNode(lines[0].indent);
  if (pos < lines.length) throw fail(lines[pos].n, 'unexpected content after document end');
  return result;
}
