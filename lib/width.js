// Terminal columns, not JavaScript characters. The two disagree in both
// directions: '🟢' is two code units and two columns, but '⚪' is one code unit
// and still two columns. Padding on .length alone makes any column containing
// emoji drift.
const WIDE_RANGES = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x231a, 0x231b], // watch, hourglass
  [0x23e9, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], // white and black circle: emoji presentation by default
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e], // CJK radicals, Kangxi, punctuation
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  // One span rather than the per-block list: the coloured circles this plugin
  // uses (U+1F7E0–EB) sit in a gap between the obvious emoji blocks, so an
  // enumerated list measured exactly our own glyphs wrong.
  [0x1f300, 0x1faff],
];

function isWide(cp) {
  for (const [lo, hi] of WIDE_RANGES) {
    if (cp < lo) return false; // ranges are ordered
    if (cp <= hi) return true;
  }
  return false;
}

export function charWidth(cp) {
  if (cp === 0xfe0f) return 0; // variation selector: styles the previous glyph
  if (cp >= 0x0300 && cp <= 0x036f) return 0; // combining marks
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0; // control
  return isWide(cp) ? 2 : 1;
}

export function displayWidth(text) {
  let total = 0;
  for (const ch of String(text ?? '')) total += charWidth(ch.codePointAt(0));
  return total;
}

// Truncate to a column budget, never splitting a surrogate pair.
export function truncateTo(text, columns) {
  if (columns <= 0) return '';
  let out = '';
  let used = 0;
  for (const ch of String(text ?? '')) {
    const w = charWidth(ch.codePointAt(0));
    if (used + w > columns) return out;
    out += ch;
    used += w;
  }
  return out;
}

// Pad or ellipsise to exactly `columns` terminal columns.
export function padTo(text, columns) {
  const s = String(text ?? '');
  const w = displayWidth(s);
  if (w === columns) return s;
  if (w < columns) return s + ' '.repeat(columns - w);
  const cut = truncateTo(s, Math.max(0, columns - 1));
  return cut + '…' + ' '.repeat(Math.max(0, columns - displayWidth(cut) - 1));
}
