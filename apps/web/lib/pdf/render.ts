import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { InvoiceDetail } from '../queries';
import type { Invoice, InvoiceLine } from '../db/schema';

// A4 in points.
const W = 595.28;
const H = 841.89;
const M = 50; // margin
const RIGHT = W - M;

const INK = rgb(0.105, 0.137, 0.2);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.886, 0.91, 0.945);
const GREEN = rgb(0.086, 0.64, 0.29);

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
function day(d: Date | string | number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'short', day: '2-digit' }).format(
    new Date(d),
  );
}

interface Fonts {
  reg: PDFFont;
  bold: PDFFont;
}

/** Draw text, optionally right-aligned to `x`. Returns nothing. */
function draw(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = INK,
  rightAlignTo?: number,
) {
  let drawX = x;
  if (rightAlignTo !== undefined) drawX = rightAlignTo - font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: drawX, y, size, font, color });
}

/** Truncate a string to fit a max width at the given font/size, adding an ellipsis. */
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(s + '…', size) > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

function hr(page: PDFPage, y: number) {
  page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 1, color: LINE });
}

function header(page: PDFPage, f: Fonts, invoice: Invoice, title: string, subtitle: string[]) {
  let y = H - M;
  draw(page, title, M, y - 18, f.bold, 26);
  let sy = y - 34;
  for (const line of subtitle) {
    draw(page, line, M, sy, f.reg, 10, MUTED);
    sy -= 13;
  }
  // Business identity (right column)
  let by = y - 4;
  draw(page, invoice.businessName || 'My Business', M, by, f.bold, 11, INK, RIGHT);
  by -= 13;
  for (const v of [invoice.businessEmail, invoice.businessAddress, invoice.taxId ? `Tax ID: ${invoice.taxId}` : null]) {
    if (!v) continue;
    draw(page, v, M, by, f.reg, 9, MUTED, RIGHT);
    by -= 12;
  }
  const lineY = Math.min(sy, by) - 6;
  hr(page, lineY);
  return lineY - 22;
}

function partyBlock(page: PDFPage, f: Fonts, label: string, name: string, extra: (string | null)[], y: number) {
  draw(page, label.toUpperCase(), M, y, f.reg, 8, MUTED);
  draw(page, name, M, y - 14, f.bold, 11);
  let yy = y - 27;
  for (const v of extra) {
    if (!v) continue;
    draw(page, v, M, yy, f.reg, 9, MUTED);
    yy -= 12;
  }
  return yy;
}

// Column right edges for the line-items table.
const COL_HOURS = RIGHT - 165;
const COL_RATE = RIGHT - 85;
const COL_AMT = RIGHT;
const DESC_MAX = COL_HOURS - (M + 8) - 40;

export async function renderInvoicePdf(detail: InvoiceDetail): Promise<Uint8Array> {
  const { invoice, lines, settings } = detail;
  const tz = settings.timezone;
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const f: Fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  let y = header(page, f, invoice, 'INVOICE', [invoice.number, invoice.notes ?? ''].filter(Boolean));

  // Bill-to (left) + meta (right). The table starts below whichever block is lower
  // so the status never collides with the table.
  const leftBottom = partyBlock(page, f, 'Bill to', invoice.clientName, [invoice.clientEmail, invoice.clientAddress], y);
  draw(page, 'ISSUED', M, y, f.reg, 8, MUTED, RIGHT);
  draw(page, day(invoice.issuedAt, tz), M, y - 14, f.reg, 10, INK, RIGHT);
  draw(page, 'STATUS', M, y - 32, f.reg, 8, MUTED, RIGHT);
  draw(page, invoice.status.toUpperCase(), M, y - 46, f.bold, 11, invoice.status === 'paid' ? GREEN : MUTED, RIGHT);
  const metaBottom = y - 46;

  // Table
  y = Math.min(leftBottom, metaBottom) - 34;
  page.drawRectangle({ x: M, y: y - 7, width: RIGHT - M, height: 24, color: rgb(0.945, 0.96, 0.98) });
  draw(page, 'Description', M + 8, y, f.bold, 9);
  draw(page, 'Hours', M, y, f.bold, 9, INK, COL_HOURS);
  draw(page, 'Rate', M, y, f.bold, 9, INK, COL_RATE);
  draw(page, 'Amount', M, y, f.bold, 9, INK, COL_AMT);
  y -= 26;

  for (const l of lines as InvoiceLine[]) {
    const flat = l.hours === 0 && l.ratePerHour === 0;
    draw(page, fit(l.label, f.reg, 10, DESC_MAX), M + 8, y, f.reg, 10);
    draw(page, flat ? '—' : l.hours.toFixed(2), M, y, f.reg, 10, INK, COL_HOURS);
    draw(page, flat ? '—' : money(l.ratePerHour, invoice.currency), M, y, f.reg, 10, INK, COL_RATE);
    draw(page, money(l.amount, invoice.currency), M, y, f.reg, 10, INK, COL_AMT);
    page.drawLine({ start: { x: M, y: y - 9 }, end: { x: RIGHT, y: y - 9 }, thickness: 0.5, color: LINE });
    y -= 24;
  }

  // Total
  y -= 10;
  draw(page, 'Total due', M, y, f.bold, 13, INK, COL_RATE);
  draw(page, money(invoice.subtotal, invoice.currency), M, y, f.bold, 13, INK, COL_AMT);

  draw(
    page,
    'Generated by Claude Invoicer · time billed from tracked Claude session activity',
    M,
    M,
    f.reg,
    8,
    MUTED,
  );

  return doc.save();
}

export async function renderReceiptPdf(detail: InvoiceDetail): Promise<Uint8Array> {
  const { invoice, receiptNumber, settings } = detail;
  const tz = settings.timezone;
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const f: Fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  let y = header(page, f, invoice, 'RECEIPT', [
    receiptNumber ?? 'Receipt',
    `for invoice ${invoice.number}`,
  ]);

  partyBlock(page, f, 'Received from', invoice.clientName, [invoice.clientEmail, invoice.clientAddress], y);
  draw(page, 'PAID ON', M, y, f.reg, 8, MUTED, RIGHT);
  draw(page, invoice.paidAt ? day(invoice.paidAt, tz) : '—', M, y - 14, f.reg, 10, INK, RIGHT);

  // Centered amount block
  const cy = y - 120;
  const lbl = 'AMOUNT PAID';
  draw(page, lbl, (W - f.reg.widthOfTextAtSize(lbl, 8)) / 2, cy + 44, f.reg, 8, MUTED);
  const amt = money(invoice.subtotal, invoice.currency);
  draw(page, amt, (W - f.bold.widthOfTextAtSize(amt, 30)) / 2, cy + 14, f.bold, 30);
  const paid = 'PAID IN FULL';
  draw(page, paid, (W - f.bold.widthOfTextAtSize(paid, 13)) / 2, cy - 8, f.bold, 13, GREEN);

  draw(page, 'Generated by Claude Invoicer', M, M, f.reg, 8, MUTED);

  return doc.save();
}
