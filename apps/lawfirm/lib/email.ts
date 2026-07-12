import { Resend } from 'resend';
import type { Client, Project, Settings } from './db/schema';
import type { ReportData } from './queries';
import type { Locale } from './i18n';
import { t, monthLabel } from './i18n';
import { money, formatDate } from './format';
function resend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  return new Resend(key);
}
function fromAddress(): string {
  return process.env.EMAIL_FROM || 'onboarding@resend.dev';
}
function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
function shell(locale: Locale, inner: string): string {
  const dir = locale === 'he' ? 'rtl' : 'ltr';
  const align = locale === 'he' ? 'right' : 'left';
  return `<div dir="${dir}" style="font-family:'Segoe UI',Arial,sans-serif;color:#1a2233;max-width:600px;margin:0 auto;padding:24px;text-align:${align}">${inner}</div>`;
}

/**
 * Notify the client (falling back to the firm) that a case has crossed its
 * logged-hours threshold. Returns the address it was sent to, or null if there
 * was nowhere to send.
 */
export async function sendThresholdAlert(
  client: Client,
  project: Project,
  hours: number,
  threshold: number,
  s: Settings,
  locale: Locale,
): Promise<string | null> {
  const to = client.email || s.reportEmail || s.firmEmail;
  if (!to) return null;

  const heBody = `
    <h2 style="margin:0 0 12px">עדכון שעות בתיק</h2>
    <p>שלום ${esc(client.name)},</p>
    <p>ברצוננו לעדכן כי מספר השעות שנצברו בתיק <strong>${esc(project.name)}</strong> הגיע ל־<strong>${hours.toFixed(
      2,
    )}</strong> שעות (סף ההתראה הוגדר ל־${threshold.toFixed(2)} שעות).</p>
    <p>נשמח לעמוד לרשותך לכל שאלה או הבהרה.</p>
    <p style="margin-top:20px">בברכה,<br>${esc(s.firmName)}</p>`;
  const enBody = `
    <h2 style="margin:0 0 12px">Case hours update</h2>
    <p>Hello ${esc(client.name)},</p>
    <p>This is to let you know that the hours logged on case <strong>${esc(project.name)}</strong> have reached
      <strong>${hours.toFixed(2)}</strong> hours (the alert threshold was set at ${threshold.toFixed(2)} hours).</p>
    <p>Please don't hesitate to reach out with any questions.</p>
    <p style="margin-top:20px">Best regards,<br>${esc(s.firmName)}</p>`;

  const { error } = await resend().emails.send({
    from: fromAddress(),
    to,
    subject:
      locale === 'he'
        ? `עדכון שעות — תיק ${project.name} (${hours.toFixed(1)} ש')`
        : `Case hours update — ${project.name} (${hours.toFixed(1)}h)`,
    html: shell(locale, locale === 'he' ? heBody : enBody),
  });
  if (error) throw new Error(`Resend send failed: ${error.message ?? 'unknown error'}`);
  return to;
}

export interface MonthlyClientReport {
  client: Client;
  report: ReportData;
}

/** Combined CSV across every client's entries for the month (Excel-friendly). */
export function monthlyCombinedCsv(reports: MonthlyClientReport[], s: Settings, locale: Locale): string {
  const header = [
    t(locale, 'client'),
    t(locale, 'case'),
    t(locale, 'date'),
    t(locale, 'task'),
    t(locale, 'description'),
    t(locale, 'hours'),
    t(locale, 'billableHours'),
  ];
  const cell = (v: string | number) => {
    const str = String(v ?? '');
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const rows = [header.map(cell).join(',')];
  for (const { client, report } of reports) {
    for (const e of report.entries) {
      rows.push(
        [client.name, report.project?.name ?? '', formatDate(e.startMs, s.timezone, locale), e.taskName ?? '', e.description ?? '', e.hours.toFixed(2), e.billable.toFixed(2)]
          .map(cell)
          .join(','),
      );
    }
  }
  return '﻿' + rows.join('\r\n');
}

/**
 * Send the automatic monthly report to the configured address: a summary table
 * (hours + amount per client) with a combined CSV of all entries attached.
 */
export async function sendMonthlyReport(
  to: string,
  monthKeyStr: string,
  reports: MonthlyClientReport[],
  s: Settings,
  locale: Locale,
): Promise<void> {
  const label = monthLabel(monthKeyStr, locale);
  const totalHours = reports.reduce((a, r) => a + r.report.totalHours, 0);
  const totalAmount = reports.reduce((a, r) => a + r.report.amount, 0);

  const rows = reports
    .map(
      (r) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eef1f6">${esc(r.client.name)}</td>
         <td style="padding:6px 8px;border-bottom:1px solid #eef1f6;text-align:center">${r.report.totalHours.toFixed(2)}</td>
         <td style="padding:6px 8px;border-bottom:1px solid #eef1f6;text-align:center">${r.report.totalBillable.toFixed(2)}</td>
         <td style="padding:6px 8px;border-bottom:1px solid #eef1f6;text-align:center">${esc(money(r.report.amount, r.report.currency, locale))}</td></tr>`,
    )
    .join('');

  const heInner = `
    <h2 style="margin:0 0 6px">דוח שעות חודשי — ${esc(label)}</h2>
    <p class="muted" style="color:#6b7688">${esc(s.firmName)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">
      <thead><tr>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e4ebf7">לקוח</th>
        <th style="padding:6px 8px;border-bottom:2px solid #e4ebf7">שעות</th>
        <th style="padding:6px 8px;border-bottom:2px solid #e4ebf7">לחיוב</th>
        <th style="padding:6px 8px;border-bottom:2px solid #e4ebf7">סכום</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="4" style="padding:10px;color:#6b7688">אין נתונים לחודש זה</td></tr>`}</tbody>
      <tfoot><tr>
        <td style="padding:8px;font-weight:700">סה״כ</td>
        <td style="padding:8px;text-align:center;font-weight:700">${totalHours.toFixed(2)}</td>
        <td></td>
        <td style="padding:8px;text-align:center;font-weight:700">${esc(money(totalAmount, s.defaultCurrency, locale))}</td>
      </tr></tfoot>
    </table>
    <p style="color:#6b7688;font-size:13px;margin-top:16px">קובץ CSV מפורט מצורף להודעה זו.</p>`;

  const enInner = `
    <h2 style="margin:0 0 6px">Monthly hours report — ${esc(label)}</h2>
    <p style="color:#6b7688">${esc(s.firmName)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e4ebf7">Client</th>
        <th style="padding:6px 8px;border-bottom:2px solid #e4ebf7">Hours</th>
        <th style="padding:6px 8px;border-bottom:2px solid #e4ebf7">Billable</th>
        <th style="padding:6px 8px;border-bottom:2px solid #e4ebf7">Amount</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="4" style="padding:10px;color:#6b7688">No data for this month</td></tr>`}</tbody>
      <tfoot><tr>
        <td style="padding:8px;font-weight:700">Total</td>
        <td style="padding:8px;text-align:center;font-weight:700">${totalHours.toFixed(2)}</td>
        <td></td>
        <td style="padding:8px;text-align:center;font-weight:700">${esc(money(totalAmount, s.defaultCurrency, locale))}</td>
      </tr></tfoot>
    </table>
    <p style="color:#6b7688;font-size:13px;margin-top:16px">A detailed CSV file is attached.</p>`;

  const csv = monthlyCombinedCsv(reports, s, locale);
  const { error } = await resend().emails.send({
    from: fromAddress(),
    to,
    subject: locale === 'he' ? `דוח שעות חודשי — ${label}` : `Monthly hours report — ${label}`,
    html: shell(locale, locale === 'he' ? heInner : enInner),
    attachments: [{ filename: `report-${monthKeyStr}.csv`, content: Buffer.from(csv, 'utf-8') }],
  });
  if (error) throw new Error(`Resend send failed: ${error.message ?? 'unknown error'}`);
}
