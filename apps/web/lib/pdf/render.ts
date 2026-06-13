import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import type { InvoiceDetail } from '../queries';
import { InvoiceDoc, ReceiptDoc } from './documents';

type PdfElement = Parameters<typeof renderToBuffer>[0];

export async function renderInvoicePdf(detail: InvoiceDetail): Promise<Buffer> {
  const el = createElement(InvoiceDoc, {
    invoice: detail.invoice,
    lines: detail.lines,
    timezone: detail.settings.timezone,
  }) as unknown as PdfElement;
  return renderToBuffer(el);
}

export async function renderReceiptPdf(detail: InvoiceDetail): Promise<Buffer> {
  const el = createElement(ReceiptDoc, {
    invoice: detail.invoice,
    lines: detail.lines,
    receiptNumber: detail.receiptNumber ?? 'RECEIPT',
    timezone: detail.settings.timezone,
  }) as unknown as PdfElement;
  return renderToBuffer(el);
}
