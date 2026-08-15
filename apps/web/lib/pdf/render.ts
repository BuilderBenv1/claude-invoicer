import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { InvoiceDetail } from '../queries';
import type { Invoice, InvoiceLine } from '../db/schema';
import { formatMoney, toWinAnsi, type WeekProjectDayGrid } from '@claude-invoicer/core';

// A4 in points.
const W = 595.28;
const H = 841.89;
const M = 50; // margin
const RIGHT = W - M;

const INK = rgb(0.105, 0.137, 0.2);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.886, 0.91, 0.945);
const GREEN = rgb(0.086, 0.64, 0.29);

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
  const safe = toWinAnsi(text);
  let drawX = x;
  if (rightAlignTo !== undefined) drawX = rightAlignTo - font.widthOfTextAtSize(safe, size);
  page.drawText(safe, { x: drawX, y, size, font, color });
}

/** Truncate a string to fit a max width at the given font/size, adding an ellipsis. */
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  let s = toWinAnsi(text);
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + '…', size) > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

/** Draw text horizontally centred on the page. Sanitises once, so the measured string is the drawn one. */
function drawCentered(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color = INK) {
  const safe = toWinAnsi(text);
  const x = (W - font.widthOfTextAtSize(safe, size)) / 2;
  page.drawText(safe, { x, y, size, font, color });
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

/** Bank details block, drawn from the invoice's snapshotted newline-separated text. */
function payToBlock(page: PDFPage, f: Fonts, details: string, y: number): number {
  draw(page, 'PAY TO', M, y, f.reg, 8, MUTED);
  let yy = y - 14;
  for (const line of details.split('\n')) {
    if (!line.trim()) continue;
    draw(page, line, M, yy, f.reg, 9, INK);
    yy -= 12;
  }
  return yy;
}

// 9-column hours grid: Project label + 7 day columns + Total, right-aligned numerics.
function drawDayGrid(page: PDFPage, f: Fonts, grid: WeekProjectDayGrid, startY: number): number {
  let y = startY;
  draw(page, 'HOURS BY DAY', M, y, f.bold, 9, INK);
  y -= 16;
  const LABELX = 175;
  const colW = (RIGHT - LABELX) / 8;
  const colRight = (c: number) => LABELX + (c + 1) * colW;
  const num = (n: number) => (n === 0 ? '' : n.toFixed(2));

  // header: weekday on top, date under it, right-aligned per column
  draw(page, 'Project', M + 2, y, f.bold, 8, MUTED);
  grid.columns.forEach((c, i) => draw(page, c.weekday, M, y, f.bold, 8, MUTED, colRight(i)));
  draw(page, 'Total', M, y, f.bold, 8, MUTED, colRight(7));
  y -= 9;
  grid.columns.forEach((c, i) => draw(page, c.dayKey.slice(5), M, y, f.reg, 6.5, MUTED, colRight(i)));
  y -= 6;
  hr(page, y);
  y -= 12;

  for (const r of grid.rows) {
    draw(page, fit(r.label, f.reg, 8, LABELX - (M + 2) - 4), M + 2, y, f.reg, 8, INK);
    r.hoursByDay.forEach((h, i) => draw(page, num(h), M, y, f.reg, 8, INK, colRight(i)));
    draw(page, r.total.toFixed(2), M, y, f.bold, 8, INK, colRight(7));
    y -= 12;
  }

  hr(page, y + 3);
  draw(page, 'Total', M + 2, y - 9, f.bold, 8, INK);
  grid.dayTotals.forEach((h, i) => draw(page, num(h), M, y - 9, f.bold, 8, INK, colRight(i)));
  draw(page, grid.grandTotal.toFixed(2), M, y - 9, f.bold, 8, INK, colRight(7));
  return y - 22;
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
  let metaY = y - 32;
  if (invoice.dueAt) {
    draw(page, 'DUE', M, metaY, f.reg, 8, MUTED, RIGHT);
    draw(page, day(invoice.dueAt, tz), M, metaY - 14, f.reg, 10, INK, RIGHT);
    metaY -= 32;
  }
  draw(page, 'STATUS', M, metaY, f.reg, 8, MUTED, RIGHT);
  draw(page, invoice.status.toUpperCase(), M, metaY - 14, f.bold, 11, invoice.status === 'paid' ? GREEN : MUTED, RIGHT);
  const metaBottom = metaY - 14;

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
    draw(page, flat ? '—' : formatMoney(l.ratePerHour, invoice.currency), M, y, f.reg, 10, INK, COL_RATE);
    draw(page, formatMoney(l.amount, invoice.currency), M, y, f.reg, 10, INK, COL_AMT);
    page.drawLine({ start: { x: M, y: y - 9 }, end: { x: RIGHT, y: y - 9 }, thickness: 0.5, color: LINE });
    y -= 24;
  }

  // Total
  y -= 10;
  if (invoice.taxAmount !== 0) {
    draw(page, 'Subtotal', M, y, f.reg, 10, MUTED, COL_RATE);
    draw(page, formatMoney(invoice.subtotal, invoice.currency), M, y, f.reg, 10, INK, COL_AMT);
    y -= 16;
    draw(page, `VAT ${invoice.taxRate}%`, M, y, f.reg, 10, MUTED, COL_RATE);
    draw(page, formatMoney(invoice.taxAmount, invoice.currency), M, y, f.reg, 10, INK, COL_AMT);
    y -= 18;
  }
  draw(page, 'Total due', M, y, f.bold, 13, INK, COL_RATE);
  draw(page, formatMoney(invoice.total, invoice.currency), M, y, f.bold, 13, INK, COL_AMT);

  if (invoice.paymentDetails) {
    y -= 34;
    y = payToBlock(page, f, invoice.paymentDetails, y);
  }

  // Hours-by-day breakdown (week invoices only; skipped for manual/one-off)
  if (detail.dayGrid && detail.dayGrid.rows.length > 0) {
    y -= 30;
    y = drawDayGrid(page, f, detail.dayGrid, y);
  }

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
  drawCentered(page, lbl, cy + 44, f.reg, 8, MUTED);
  const amt = formatMoney(invoice.total, invoice.currency);
  drawCentered(page, amt, cy + 14, f.bold, 30);
  const paid = 'PAID IN FULL';
  drawCentered(page, paid, cy - 8, f.bold, 13, GREEN);

  draw(page, 'Generated by Claude Invoicer', M, M, f.reg, 8, MUTED);

  return doc.save();
}
