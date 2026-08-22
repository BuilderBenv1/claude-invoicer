import JSZip from 'jszip';

/**
 * Plain text from a .docx, with table structure preserved as tabs.
 *
 * A .docx is a zip; the body lives in word/document.xml. Paragraphs (`w:p`)
 * become newlines and table cells (`w:tc`) become tabs, which is the shape
 * `parseBriefText` reads — so an uploaded estimate and a pasted one follow the
 * same path from here.
 */
export async function extractDocxText(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('That file does not look like a Word document.');
  const xml = await doc.async('string');

  return xml
    .replace(/<w:tab\b[^>]*\/>/g, ' ')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.replace(/\t+$/, '').trimEnd())
    .filter((l) => l.trim() !== '')
    .join('\n');
}
