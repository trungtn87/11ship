// Lexical guard for participant statements. It answers two questions without a SQL parser:
//   1. Is there exactly one top-level statement? (a `;` inside a string, identifier, dollar-quoted
//      body or comment is not a separator)
//   2. Does that statement start with transaction control?
// It understands single-quoted strings (with E'' backslash escapes), double-quoted identifiers,
// dollar quotes, `--` comments and nested block comments. Anything it cannot close is refused.
// This is a guard rail against accidents (transaction control is not part of the context API), not
// a security boundary: the database role's privileges are the boundary.

export type StatementVerdict = 'ok' | 'control' | 'invalid';

const CONTROL_WORDS: ReadonlySet<string> = new Set([
  'begin',
  'start',
  'commit',
  'rollback',
  'end',
  'abort',
  'savepoint',
  'release',
]);

const IDENTIFIER_CHAR = /[A-Za-z0-9_$\u0080-￿]/;
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/;
const WORD = /^[A-Za-z_][A-Za-z0-9_$]*/;

interface Lexed {
  /** First word of each non-empty top-level statement, lower-cased ('' when it is not a word). */
  readonly heads: string[];
  /** Second word of the first statement, used for PREPARE TRANSACTION. */
  readonly secondOfFirst: string;
}

/** Returns undefined when a quote, comment or dollar-quote is not terminated. */
function lex(text: string): Lexed | undefined {
  const heads: string[] = [];
  let secondOfFirst = '';
  let wordsInStatement = 0;
  let i = 0;

  const startedStatement = (): void => {
    if (wordsInStatement === 0) {
      heads.push('');
    }
  };

  while (i < text.length) {
    const c = text[i] as string;
    const next = text[i + 1];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
      i += 1;
    } else if (c === '-' && next === '-') {
      const eol = text.indexOf('\n', i + 2);
      i = eol === -1 ? text.length : eol + 1;
    } else if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (depth > 0) {
        if (i >= text.length) {
          return undefined;
        }
        if (text[i] === '/' && text[i + 1] === '*') {
          depth += 1;
          i += 2;
        } else if (text[i] === '*' && text[i + 1] === '/') {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
    } else if (c === ';') {
      wordsInStatement = 0;
      i += 1;
    } else if (c === "'") {
      startedStatement();
      wordsInStatement += 1;
      const previous = text[i - 1];
      const beforePrevious = text[i - 2];
      const escapes =
        (previous === 'E' || previous === 'e') &&
        (beforePrevious === undefined || !IDENTIFIER_CHAR.test(beforePrevious));
      i += 1;
      for (;;) {
        if (i >= text.length) {
          return undefined;
        }
        const q = text[i];
        if (escapes && q === '\\') {
          i += 2;
        } else if (q === "'") {
          if (text[i + 1] === "'") {
            i += 2;
          } else {
            i += 1;
            break;
          }
        } else {
          i += 1;
        }
      }
    } else if (c === '"') {
      startedStatement();
      wordsInStatement += 1;
      i += 1;
      for (;;) {
        if (i >= text.length) {
          return undefined;
        }
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            i += 2;
          } else {
            i += 1;
            break;
          }
        } else {
          i += 1;
        }
      }
    } else if (c === '$' && (i === 0 || !IDENTIFIER_CHAR.test(text[i - 1] as string))) {
      const tag = DOLLAR_TAG.exec(text.slice(i, i + 130))?.[0];
      startedStatement();
      wordsInStatement += 1;
      if (tag === undefined) {
        i += 1; // a positional parameter such as $1
      } else {
        const close = text.indexOf(tag, i + tag.length);
        if (close === -1) {
          return undefined;
        }
        i = close + tag.length;
      }
    } else {
      startedStatement();
      const word = WORD.exec(text.slice(i, i + 64))?.[0];
      if (word !== undefined && (i === 0 || !IDENTIFIER_CHAR.test(text[i - 1] as string))) {
        if (wordsInStatement === 0) {
          heads[heads.length - 1] = word.toLowerCase();
        } else if (wordsInStatement === 1 && heads.length === 1) {
          secondOfFirst = word.toLowerCase();
        }
        wordsInStatement += 1;
        i += word.length;
      } else {
        wordsInStatement += 1;
        i += 1;
      }
    }
  }
  return { heads, secondOfFirst };
}

export function classifyParticipantStatement(text: string): StatementVerdict {
  const lexed = lex(text);
  if (lexed === undefined || lexed.heads.length !== 1) {
    return 'invalid';
  }
  const head = lexed.heads[0] as string;
  if (CONTROL_WORDS.has(head)) {
    return 'control';
  }
  if (head === 'prepare' && lexed.secondOfFirst === 'transaction') {
    return 'control';
  }
  return 'ok';
}
