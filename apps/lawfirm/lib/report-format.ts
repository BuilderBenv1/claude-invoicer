import type { ReportData } from './queries';
import type { Locale } from './i18n';
import { t } from './i18n';
import { formatDate, money } from './format';
import type { Settings } from './db/schema';

/** CSV-escape a cell (quote when it contains a comma, quote, or newline). */
function csvCell(v: string | number): string {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build a UTF-8 CSV (with BOM, so Excel opens Hebrew correctly) of every entry
 * in the report plus a totals row.
 */
export function reportToCsv(report: ReportData, s: Settings, locale: Locale): string {
  const header = [
    t(locale, 'date'),
    t(locale, 'case'),
    t(locale, 'task'),
    t(locale, 'description'),
    t(locale, 'hours'),
    t(locale, 'billableHours'),
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const e of report.entries) {
    lines.push(
      [
        formatDate(e.startMs, s.timezone, locale),
        report.project?.name ?? '',
        e.taskName ?? '',
        e.description ?? '',
        e.hours.toFixed(2),
        e.billable.toFixed(2),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  lines.push('');
  lines.push([t(locale, 'total'), '', '', '', report.totalHours.toFixed(2), report.totalBillable.toFixed(2)].map(csvCell).join(','));
  lines.push([t(locale, 'amount'), '', '', '', '', money(report.amount, report.currency, locale)].map(csvCell).join(','));
  return '﻿' + lines.join('\r\n');
}

function esc(x: string): string {
  return String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/**
 * A clean, self-contained printable report page. Rendered RTL for Hebrew so
 * "Save as PDF" from the browser produces a proper Hebrew document — no font
 * embedding needed. Also reused (inline styles) as the monthly email body.
 */
export function reportToHtml(report: ReportData, s: Settings, locale: Locale, opts: { standalone?: boolean } = {}): string {
  const rtl = locale === 'he';
  const dirAttr = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const period = `${formatDate(report.fromMs, s.timezone, locale)} – ${formatDate(report.toMs - 1, s.timezone, locale)}`;
  const scope = report.project ? report.project.name : t(locale, 'allCases');

  const summaryRows = report.byTask
    .map(
      (b) =>
        `<tr><td>${esc(b.label)}</td><td class="num">${b.hours.toFixed(2)}</td><td class="num">${b.billable.toFixed(2)}</td></tr>`,
    )
    .join('');

  const detailRows = report.entries
    .map(
      (e) =>
        `<tr><td>${esc(formatDate(e.startMs, s.timezone, locale))}</td><td>${esc(e.taskName ?? '—')}</td><td>${esc(
          e.description ?? '',
        )}</td><td class="num">${e.hours.toFixed(2)}</td><td class="num">${e.billable.toFixed(2)}</td></tr>`,
    )
    .join('');

  const body = `
  <div class="report" dir="${dirAttr}" style="text-align:${align}">
    <div class="head">
      <div>
        ${s.logoUrl ? `<img src="${esc(s.logoUrl)}" alt="logo" style="max-height:56px;max-width:200px;object-fit:contain;margin-bottom:6px" />` : ''}
        <h1>${esc(s.firmName)}</h1>
        <div class="muted">${[s.firmAddress, s.firmPhone, s.firmEmail].filter((x): x is string => !!x).map(esc).join(' · ')}</div>
      </div>
      <div class="muted small">${esc(t(locale, 'generatedOn'))} ${esc(formatDate(Date.now(), s.timezone, locale))}</div>
    </div>
    <h2>${esc(t(locale, 'reportFor'))} — ${esc(report.client.name)}</h2>
    <div class="muted">${esc(t(locale, 'case'))}: ${esc(scope)} · ${esc(period)}</div>

    <div class="totals">
      <div class="tile"><span>${esc(t(locale, 'totalHours'))}</span><strong>${report.totalHours.toFixed(2)}</strong></div>
      <div class="tile"><span>${esc(t(locale, 'billableHours'))}</span><strong>${report.totalBillable.toFixed(2)}</strong></div>
      <div class="tile"><span>${esc(t(locale, 'amount'))}</span><strong>${esc(money(report.amount, report.currency, locale))}</strong></div>
    </div>

    ${
      report.entries.length === 0
        ? `<p class="muted">${esc(t(locale, 'noData'))}</p>`
        : `
    <h3>${esc(t(locale, 'byTask'))}</h3>
    <table>
      <thead><tr><th>${esc(t(locale, 'task'))}</th><th class="num">${esc(t(locale, 'hours'))}</th><th class="num">${esc(
        t(locale, 'billableHours'),
      )}</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>

    <h3>${esc(t(locale, 'detailed'))}</h3>
    <table>
      <thead><tr><th>${esc(t(locale, 'date'))}</th><th>${esc(t(locale, 'task'))}</th><th>${esc(
        t(locale, 'description'),
      )}</th><th class="num">${esc(t(locale, 'hours'))}</th><th class="num">${esc(t(locale, 'billableHours'))}</th></tr></thead>
      <tbody>${detailRows}</tbody>
    </table>`
    }
  </div>`;

  const css = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif; color: #1a2233; margin: 0; background:#f4f6fb; }
    .report { max-width: 820px; margin: 24px auto; background:#fff; padding: 32px; border-radius: 12px; }
    .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #eef1f6; padding-bottom:14px; margin-bottom:14px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 17px; margin: 18px 0 4px; }
    h3 { font-size: 14px; margin: 22px 0 8px; color:#33415c; }
    .muted { color:#6b7688; font-size: 13px; }
    .small { font-size: 12px; }
    .totals { display:flex; gap:12px; margin:18px 0; flex-wrap:wrap; }
    .tile { background:#f4f7ff; border:1px solid #e4ebf7; border-radius:10px; padding:12px 16px; min-width:150px; }
    .tile span { display:block; font-size:12px; color:#6b7688; margin-bottom:4px; }
    .tile strong { font-size:20px; }
    table { width:100%; border-collapse:collapse; font-size:13px; margin-bottom:8px; }
    th, td { padding:7px 8px; border-bottom:1px solid #eef1f6; }
    th { color:#6b7688; font-weight:600; font-size:12px; }
    .num { text-align:${rtl ? 'left' : 'right'}; font-variant-numeric: tabular-nums; }
    @media print { body { background:#fff; } .report { box-shadow:none; margin:0; max-width:none; } .noprint { display:none; } }
  `;

  if (!opts.standalone) return `<style>${css}</style>${body}`;

  return `<!doctype html><html lang="${locale}" dir="${dirAttr}"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(t(locale, 'reportFor'))} — ${esc(report.client.name)}</title>
    <style>${css}
      .bar { max-width:820px; margin: 14px auto 0; display:flex; gap:8px; justify-content:flex-end; }
      .btn { font: inherit; background:#2563eb; color:#fff; border:0; border-radius:8px; padding:8px 16px; cursor:pointer; text-decoration:none; }
      .btn.ghost { background:#e8edf7; color:#33415c; }
    </style></head><body>
    <div class="bar noprint">
      <button class="btn" onclick="window.print()">${esc(t(locale, 'print'))}</button>
    </div>
    ${body}
  </body></html>`;
}
