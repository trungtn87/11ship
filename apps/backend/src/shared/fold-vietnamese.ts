// The text a search compares, folded the way database/migrations/1793059200000_create-menu.sql folds it (app.fold_vi): lower case,
// Vietnamese marks removed (precomposed letters and combining marks), đ -> d, white space collapsed and trimmed. Keep the two in step;
// an integration test compares them on real data.

const FROM = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
const TO = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';

const MAP = new Map<string, string>([...FROM].map((ch, index) => [ch, TO[index] ?? ch]));

export function foldVietnamese(input: string): string {
  let out = '';
  for (const ch of input.toLowerCase()) {
    out += MAP.get(ch) ?? ch;
  }
  return out.replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/** A folded term as a LIKE pattern body: %, _ and \ are literal characters. */
export function likeContains(folded: string): string {
  return `%${folded.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
