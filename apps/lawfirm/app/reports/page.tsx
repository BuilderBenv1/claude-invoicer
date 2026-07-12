import { ReportForm, type ReportFormClient } from '@/components/report-form';
import { getSettings, localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';
import { buildReport, getClientsTree } from '@/lib/queries';
import { money, formatDate } from '@/lib/format';
import { startOfMonthMs } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const s = await getSettings();
  const locale = localeOf(s);
  const now = Date.now();

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const clientId = one(sp.clientId);
  const projectId = one(sp.projectId) || null;
  const fromMs = Number(one(sp.from)) || startOfMonthMs(now, s.timezone);
  const toMs = Number(one(sp.to)) || now + 1;

  const tree = await getClientsTree();
  const clients: ReportFormClient[] = tree.map((c) => ({
    id: c.id,
    name: c.name,
    projects: c.projects.map((p) => ({ id: p.id, name: p.name })),
  }));

  const report = clientId ? await buildReport({ clientId, projectId, fromMs, toMs }) : null;

  const csvHref = report
    ? `/api/reports/csv?clientId=${clientId}${projectId ? `&projectId=${projectId}` : ''}&from=${fromMs}&to=${toMs}`
    : '#';
  const printHref = report
    ? `/reports/print?clientId=${clientId}${projectId ? `&projectId=${projectId}` : ''}&from=${fromMs}&to=${toMs}`
    : '#';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t(locale, 'reports')}</h1>

      <ReportForm clients={clients} locale={locale} initial={{ clientId, projectId: projectId ?? '', fromMs, toMs }} />

      {report && (
        <div className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                {report.client.name}
                <span className="text-slate-500"> · {report.project ? report.project.name : t(locale, 'allCases')}</span>
              </h2>
              <div className="text-xs text-slate-500">
                {formatDate(report.fromMs, s.timezone, locale)} – {formatDate(report.toMs - 1, s.timezone, locale)}
              </div>
            </div>
            <div className="flex gap-2">
              <a href={csvHref} className="btn-ghost">
                ⭳ {t(locale, 'exportCsv')}
              </a>
              <a href={printHref} target="_blank" className="btn-primary">
                🖶 {t(locale, 'print')}
              </a>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Stat label={t(locale, 'totalHours')} value={report.totalHours.toFixed(2)} />
            <Stat label={t(locale, 'billableHours')} value={report.totalBillable.toFixed(2)} />
            <Stat label={t(locale, 'amount')} value={money(report.amount, report.currency, locale)} highlight />
          </div>

          {report.entries.length === 0 ? (
            <p className="text-slate-500">{t(locale, 'noData')}</p>
          ) : (
            <>
              <section>
                <h3 className="font-semibold mb-2">{t(locale, 'byTask')}</h3>
                <Table
                  head={[t(locale, 'task'), t(locale, 'hours'), t(locale, 'billableHours')]}
                  rows={report.byTask.map((b) => [b.label, b.hours.toFixed(2), b.billable.toFixed(2)])}
                  numCols={[1, 2]}
                />
              </section>

              <section>
                <h3 className="font-semibold mb-2">{t(locale, 'detailed')}</h3>
                <Table
                  head={[t(locale, 'date'), t(locale, 'task'), t(locale, 'description'), t(locale, 'hours'), t(locale, 'billableHours')]}
                  rows={report.entries.map((e) => [
                    formatDate(e.startMs, s.timezone, locale),
                    e.taskName ?? '—',
                    e.description ?? '',
                    e.hours.toFixed(2),
                    e.billable.toFixed(2),
                  ])}
                  numCols={[3, 4]}
                />
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`num text-2xl font-bold mt-1 ${highlight ? 'text-emerald-300' : ''}`}>{value}</div>
    </div>
  );
}

function Table({ head, rows, numCols }: { head: string[]; rows: string[][]; numCols: number[] }) {
  const numSet = new Set(numCols);
  return (
    <div className="card p-0 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-900/50 text-slate-400 text-xs">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={`p-3 ${numSet.has(i) ? 'text-end' : 'text-start'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-slate-800">
              {r.map((c, ci) => (
                <td key={ci} className={`p-3 ${numSet.has(ci) ? 'text-end num' : 'text-start'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
