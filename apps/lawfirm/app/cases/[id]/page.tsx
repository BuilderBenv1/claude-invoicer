import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProjectDetail } from '@/lib/queries';
import { getSettings, localeOf } from '@/lib/settings';
import { t, monthLabel } from '@/lib/i18n';
import { money, formatDate } from '@/lib/format';
import { formatHm, monthKey, monthRange } from '@/lib/time';
import {
  createTask,
  archiveTask,
  addManualEntry,
  deleteEntry,
  updateProject,
  setProjectStatus,
  archiveProject,
} from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSettings();
  const locale = localeOf(s);
  const d = await getProjectDetail(id);
  if (!d) notFound();
  const { project, client, tasks, entries, hours, billable, rate, currency, amount } = d;

  const thr = project.alertThresholdHours;
  const over = thr != null && thr > 0 && hours >= thr;

  const mk = monthKey(new Date(), s.timezone);
  const { startMs, endMs } = monthRange(mk, s.timezone);
  const csvHref = `/api/reports/csv?clientId=${client.id}&projectId=${project.id}&from=${startMs}&to=${endMs}`;
  const printHref = `/reports/print?clientId=${client.id}&projectId=${project.id}&from=${startMs}&to=${endMs}`;
  const isoToday = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-8">
      <header>
        <Link href={`/clients/${client.id}`} className="text-xs text-slate-500 hover:underline">
          ← {client.name}
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {project.caseNumber ? <span className="text-slate-500">{project.caseNumber} · </span> : null}
            {project.name}
          </h1>
          <span className={`pill ${project.status === 'open' ? 'bg-sky-950 text-sky-300' : 'bg-slate-800 text-slate-400'}`}>
            {t(locale, project.status === 'open' ? 'open' : 'closed')}
          </span>
        </div>
        {project.description ? <p className="text-sm text-slate-400 mt-1">{project.description}</p> : null}
      </header>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label={t(locale, 'totalHours')} value={hours.toFixed(2)} />
        <Stat label={t(locale, 'billableHours')} value={billable.toFixed(2)} />
        <Stat label={t(locale, 'hourlyRate')} value={money(rate, currency, locale)} />
        <Stat label={t(locale, 'amount')} value={money(amount, currency, locale)} highlight />
      </div>

      {thr != null && thr > 0 && (
        <div className={`card ${over ? 'border-amber-700/60 bg-amber-950/20' : ''}`}>
          <div className="flex items-center justify-between text-sm">
            <span>
              {t(locale, 'alertThreshold')}: <strong>{thr.toFixed(1)}</strong> {t(locale, 'hours')}
              {over ? <span className="text-amber-400"> · {t(locale, 'reached')} ({hours.toFixed(2)})</span> : null}
            </span>
            <span className="num text-slate-400">
              {hours.toFixed(2)} / {thr.toFixed(1)}
            </span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className={`h-full ${over ? 'bg-amber-500' : 'bg-sky-500'}`} style={{ width: `${Math.min(100, (hours / thr) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* Report export */}
      <section className="card">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-semibold">{t(locale, 'report')}</h2>
            <div className="text-xs text-slate-500">{monthLabel(mk, locale)}</div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <a href={csvHref} className="btn-ghost">
              ⭳ {t(locale, 'exportCsv')}
            </a>
            <a href={printHref} target="_blank" className="btn-ghost">
              🖶 {t(locale, 'print')}
            </a>
            <Link href={`/invoices/new?clientId=${client.id}&projectId=${project.id}`} className="btn-green">
              ＋ {t(locale, 'newInvoice')}
            </Link>
            <Link href={`/reports?clientId=${client.id}&projectId=${project.id}`} className="btn-primary">
              {t(locale, 'reportFor')} →
            </Link>
          </div>
        </div>
      </section>

      {/* Tasks */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t(locale, 'tasks')}</h2>
        <div className="flex flex-wrap gap-2">
          {tasks.map((tk) => (
            <span key={tk.id} className="pill bg-slate-800 text-slate-300 gap-2">
              {tk.name}
              <form action={archiveTask} className="inline">
                <input type="hidden" name="id" value={tk.id} />
                <input type="hidden" name="projectId" value={project.id} />
                <button type="submit" className="text-slate-500 hover:text-red-400" title={t(locale, 'delete')}>
                  ✕
                </button>
              </form>
            </span>
          ))}
          {tasks.length === 0 ? <span className="text-sm text-slate-500">{t(locale, 'noEntries')}</span> : null}
        </div>
        <form action={createTask} className="flex gap-2 max-w-md">
          <input type="hidden" name="projectId" value={project.id} />
          <input name="name" className="input" placeholder={t(locale, 'addTask')} required />
          <button className="btn-ghost shrink-0" type="submit">
            ＋
          </button>
        </form>
      </section>

      {/* Manual entry */}
      <details className="card">
        <summary className="cursor-pointer font-medium">＋ {t(locale, 'manualEntry')}</summary>
        <form action={addManualEntry} className="grid gap-3 md:grid-cols-4 mt-4">
          <input type="hidden" name="clientId" value={client.id} />
          <input type="hidden" name="projectId" value={project.id} />
          <div>
            <label className="label">{t(locale, 'task')}</label>
            <select name="taskId" className="input">
              <option value="">—</option>
              {tasks.map((tk) => (
                <option key={tk.id} value={tk.id}>
                  {tk.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t(locale, 'manualHours')}</label>
            <input name="hours" type="number" step="0.1" min="0" className="input" required />
          </div>
          <div>
            <label className="label">{t(locale, 'manualDate')}</label>
            <input name="date" type="date" className="input" defaultValue={isoToday} />
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full" type="submit">
              {t(locale, 'add')}
            </button>
          </div>
          <div className="md:col-span-4">
            <input name="description" className="input" placeholder={t(locale, 'description')} />
          </div>
        </form>
      </details>

      {/* Entries */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t(locale, 'entries')}</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500">{t(locale, 'noEntries')}</p>
        ) : (
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/50 text-slate-400 text-xs">
                <tr>
                  <th className="text-start p-3">{t(locale, 'date')}</th>
                  <th className="text-start p-3">{t(locale, 'task')}</th>
                  <th className="text-start p-3">{t(locale, 'description')}</th>
                  <th className="text-end p-3">{t(locale, 'duration')}</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((r) => (
                  <tr key={r.entry.id} className="border-t border-slate-800">
                    <td className="p-3 whitespace-nowrap">{formatDate(r.entry.startMs, s.timezone, locale)}</td>
                    <td className="p-3 text-slate-400">{r.taskName ?? '—'}</td>
                    <td className="p-3 text-slate-300">{r.entry.description ?? ''}</td>
                    <td className="p-3 text-end num">{formatHm(r.entry.durationMs ?? 0)}</td>
                    <td className="p-3 text-end">
                      <form action={deleteEntry} className="inline">
                        <input type="hidden" name="entryId" value={r.entry.id} />
                        <input type="hidden" name="projectId" value={project.id} />
                        <button type="submit" className="text-slate-500 hover:text-red-400" title={t(locale, 'delete')}>
                          ✕
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Edit case */}
      <details className="card">
        <summary className="cursor-pointer font-medium text-slate-300">{t(locale, 'edit')} · {t(locale, 'case')}</summary>
        <form action={updateProject} className="grid gap-3 md:grid-cols-2 mt-4">
          <input type="hidden" name="id" value={project.id} />
          <input type="hidden" name="clientId" value={client.id} />
          <div>
            <label className="label">{t(locale, 'name')}</label>
            <input name="name" className="input" defaultValue={project.name} required />
          </div>
          <div>
            <label className="label">{t(locale, 'caseNumber')}</label>
            <input name="caseNumber" className="input" defaultValue={project.caseNumber ?? ''} placeholder="2026-0143" />
          </div>
          <div className="md:col-span-2">
            <label className="label">{t(locale, 'description')}</label>
            <input name="description" className="input" defaultValue={project.description ?? ''} />
          </div>
          <div>
            <label className="label">{t(locale, 'hourlyRate')} ({currency})</label>
            <input name="hourlyRate" type="number" step="0.01" min="0" className="input" defaultValue={project.hourlyRate ?? ''} placeholder={String(client.hourlyRate || '')} />
          </div>
          <div>
            <label className="label">{t(locale, 'alertThreshold')} ({t(locale, 'hours')})</label>
            <input name="alertThresholdHours" type="number" step="0.5" min="0" className="input" defaultValue={project.alertThresholdHours ?? ''} placeholder={t(locale, 'noAlert')} />
          </div>
          <div className="md:col-span-2">
            <button className="btn-primary" type="submit">
              {t(locale, 'save')}
            </button>
          </div>
        </form>
        <div className="mt-3 flex gap-2">
          <form action={setProjectStatus}>
            <input type="hidden" name="id" value={project.id} />
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="status" value={project.status === 'open' ? 'closed' : 'open'} />
            <button className="btn-ghost" type="submit">
              {t(locale, project.status === 'open' ? 'close' : 'reopen')}
            </button>
          </form>
          <form action={archiveProject}>
            <input type="hidden" name="id" value={project.id} />
            <input type="hidden" name="clientId" value={client.id} />
            <button className="btn-danger" type="submit">
              {t(locale, 'archive')}
            </button>
          </form>
        </div>
      </details>
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
