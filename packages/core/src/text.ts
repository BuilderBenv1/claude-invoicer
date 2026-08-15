/** Characters cp1252 adds above ASCII that WinAnsiEncoding can represent. */
const CP1252_EXTRAS =
  '€‚ƒ„…†‡ˆ‰Š‹ŒŽ' +
  '‘’“”•–—˜™š›œžŸ';

/** Symbols with no cp1252 representation, spelled out rather than lost. */
const FALLBACKS: [string, string][] = [
  ['₹', 'INR '], // ₹
  ['₪', 'ILS '], // ₪
  ['₩', 'KRW '], // ₩
  ['₺', 'TRY '], // ₺
  ['₴', 'UAH '], // ₴
  ['₦', 'NGN '], // ₦
  ['د.إ', 'AED '], // د.إ
];

/** No-break / thin spaces that Intl money formatting inserts. */
const SPACE_LIKE = /[    ⁠]/g;

/**
 * Make text safe for pdf-lib's StandardFonts, which encode WinAnsi (cp1252)
 * only and THROW on anything else. Applied at the drawing layer so it covers
 * money strings, client names and addresses alike.
 */
export function toWinAnsi(text: string): string {
  let s = text.replace(SPACE_LIKE, ' ');
  for (const [from, to] of FALLBACKS) s = s.split(from).join(to);
  return s.replace(/[^\x20-\x7E\xA1-\xFF]/g, (ch) => (CP1252_EXTRAS.includes(ch) ? ch : '?'));
}
