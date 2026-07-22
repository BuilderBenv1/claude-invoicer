import type { InvoiceDetail } from './invoice-service';
import type { Locale } from './i18n';
import { t } from './i18n';
import { money, formatDate } from './format';

function esc(x: string | null | undefined): string {
  return String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/**
 * A clean, printable RTL invoice document. Embeds the firm logo (URL or data:
 * URI), the case number + name, line items, and a total. "Save as PDF" from the
 * browser produces the Hebrew invoice; the same markup (inline) is the email body.
 */
export function renderInvoiceHtml(detail: InvoiceDetail, locale: Locale, opts: { standalone?: boolean } = {}): string {
  const { invoice: inv, lines, settings: s } = detail;
  const rtl = locale === 'he';
  const dirAttr = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const numAlign = rtl ? 'left' : 'right';
  const paid = inv.status === 'paid';

  const caseLine = [inv.caseNumber, inv.caseName].filter(Boolean).map(esc).join(' · ');

  const lineRows = lines
    .map((l) => {
      const flat = l.hours === 0 && l.ratePerHour === 0;
      return `<tr>
        <td>${esc(l.label)}</td>
        <td class="num">${flat ? '—' : l.hours.toFixed(2)}</td>
        <td class="num">${flat ? '—' : esc(money(l.ratePerHour, inv.currency, locale))}</td>
        <td class="num">${esc(money(l.amount, inv.currency, locale))}</td>
      </tr>`;
    })
    .join('');

  const logo = inv.logoUrl
    ? `<img src="${esc(inv.logoUrl)}" alt="logo" style="max-height:64px;max-width:220px;object-fit:contain" />`
    : `<div class="firm-name">${esc(inv.firmName || t(locale, 'firmName'))}</div>`;

  const body = `
  <div class="doc" dir="${dirAttr}" style="text-align:${align}">
    <div class="head">
      <div class="brand">
        ${logo}
        <div class="muted small">${[inv.firmAddress, inv.firmPhone, inv.firmEmail, inv.taxId ? `${t(locale, 'taxId')}: ${inv.taxId}` : '']
          .filter(Boolean)
          .map(esc)
          .join(' · ')}</div>
      </div>
      <div class="meta" style="text-align:${numAlign}">
        <div class="title">${esc(t(locale, 'invoice'))}</div>
        <div class="muted">${esc(t(locale, 'invoiceNo'))} ${esc(inv.number)}</div>
        <div class="muted small">${esc(t(locale, 'issued'))}: ${esc(formatDate(inv.issuedAt, s.timezone, locale))}</div>
        <div class="status ${paid ? 'paid' : 'unpaid'}">${esc(t(locale, paid ? 'paid' : 'unpaid'))}</div>
      </div>
    </div>

    <div class="parties">
      <div>
        <div class="label">${esc(t(locale, 'billTo'))}</div>
        <div class="strong">${esc(inv.clientName)}</div>
        <div class="muted small">${[inv.clientEmail, inv.clientAddress].filter(Boolean).map(esc).join(' · ')}</div>
      </div>
      ${caseLine ? `<div style="text-align:${numAlign}"><div class="label">${esc(t(locale, 'case'))}</div><div class="strong">${caseLine}</div></div>` : ''}
    </div>

    <table class="lines">
      <thead><tr>
        <th style="text-align:${align}">${esc(t(locale, 'description'))}</th>
        <th class="num">${esc(t(locale, 'hours'))}</th>
        <th class="num">${esc(t(locale, 'hourlyRate'))}</th>
        <th class="num">${esc(t(locale, 'amount'))}</th>
      </tr></thead>
      <tbody>${lineRows || `<tr><td colspan="4" class="muted">—</td></tr>`}</tbody>
    </table>

    <div class="total-row">
      <span>${esc(t(locale, 'totalDue'))}</span>
      <strong>${esc(money(inv.subtotal, inv.currency, locale))}</strong>
    </div>

    ${inv.notes ? `<div class="notes"><div class="label">${esc(t(locale, 'notes'))}</div>${esc(inv.notes)}</div>` : ''}
    ${paid && inv.paidAt ? `<div class="paid-stamp">${esc(t(locale, 'paid'))} · ${esc(formatDate(inv.paidAt, s.timezone, locale))}</div>` : ''}
  </div>`;

  const css = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif; color:#1a2233; margin:0; background:#f4f6fb; }
    .doc { max-width: 820px; margin: 24px auto; background:#fff; padding: 36px; border-radius: 12px; }
    .head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; border-bottom:2px solid #eef1f6; padding-bottom:16px; }
    .firm-name { font-size:20px; font-weight:700; }
    .title { font-size:26px; font-weight:800; letter-spacing:0.5px; }
    .muted { color:#6b7688; }
    .small { font-size:12px; margin-top:4px; }
    .label { font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#8a94a6; margin-bottom:2px; }
    .strong { font-weight:700; font-size:15px; }
    .parties { display:flex; justify-content:space-between; gap:16px; margin:22px 0; }
    .status { display:inline-block; margin-top:6px; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:700; }
    .status.paid { background:#e7f7ee; color:#188a4b; }
    .status.unpaid { background:#fff3e6; color:#b5741a; }
    table.lines { width:100%; border-collapse:collapse; font-size:13px; margin-top:8px; }
    table.lines th { color:#6b7688; font-weight:600; font-size:12px; padding:8px; border-bottom:2px solid #e4ebf7; }
    table.lines td { padding:9px 8px; border-bottom:1px solid #eef1f6; }
    .num { text-align:${numAlign}; font-variant-numeric: tabular-nums; }
    .total-row { display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding-top:14px; border-top:2px solid #eef1f6; font-size:18px; }
    .total-row strong { font-size:22px; }
    .notes { margin-top:22px; font-size:13px; color:#33415c; }
    .paid-stamp { margin-top:24px; color:#188a4b; font-weight:700; }
    @media print { body { background:#fff; } .doc { box-shadow:none; margin:0; max-width:none; border-radius:0; } .noprint { display:none; } }
  `;

  if (!opts.standalone) return `<style>${css}</style>${body}`;

  return `<!doctype html><html lang="${locale}" dir="${dirAttr}"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(t(locale, 'invoice'))} ${esc(inv.number)}</title>
    <style>${css}
      .bar { max-width:820px; margin:14px auto 0; display:flex; gap:8px; justify-content:flex-end; }
      .btn { font:inherit; background:#2563eb; color:#fff; border:0; border-radius:8px; padding:8px 16px; cursor:pointer; }
    </style></head><body>
    <div class="bar noprint"><button class="btn" onclick="window.print()">${esc(t(locale, 'print'))}</button></div>
    ${body}
  </body></html>`;
}
