/** Characters cp1252 adds above ASCII that WinAnsiEncoding can represent. */
const CP1252_EXTRAS =
  '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D' +
  '\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178';

/** Symbols with no cp1252 representation, spelled out rather than lost. */
const FALLBACKS: [string, string][] = [
  ['\u20B9', 'INR '], // ₹
  ['\u20AA', 'ILS '], // ₪
  ['\u20A9', 'KRW '], // ₩
  ['\u20BA', 'TRY '], // ₺
  ['\u20B4', 'UAH '], // ₴
  ['\u20A6', 'NGN '], // ₦
  ['\u062F.\u0625', 'AED '], // د.إ
];

/** No-break / thin spaces that Intl money formatting inserts. */
const SPACE_LIKE = /[\u00A0\u2007\u2009\u202F\u2060]/g;

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
