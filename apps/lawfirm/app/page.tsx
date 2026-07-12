import Link from 'next/link';
import { TimerWidget } from '@/components/timer-widget';
import { getSettings, localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';
import {
  getClientsTree,
  getRunningTimer,
  hoursInWindow,
  activeCasesWithHours,
  recentEntries,
} from '@/lib/queries';
import { startOfDayMs, startOfWeekMs, startOfMonthMs, formatHm } from '@/lib/time';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const s = await getSettings();
  const locale = localeOf(s);
  const now = Date.now();

  const [tree, running, todayH, weekH, monthH, cases, recent] = await Promise.all([
    getClientsTree(),
    getRunningTimer(),
    hoursInWindow(startOfDayMs(now, s.timezone), now + 1),
    hoursInWindow(startOfWeekMs(now, s.timezone), now + 1),
    hoursInWindow(startOfMonthMs(now, s.timezone), now + 1),
    activeCasesWithHours(),
    recentEntries(12),
  ]);

  const runningProps = running
    ? {
        entryId: running.entry.id,
        startMs: running.entry.startMs,
        clientName: running.clientName,
        projectName: running.projectName,
        taskName: running.taskName,
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t(locale, 'dashboard')}</h1>
        <Link href="/reports" className="btn-ghost">
          {t(locale, 'reports')}
        </Link>
      </div>

      <TimerWidget tree={tree} running={runningProps} locale={locale} />

      <div className="grid grid-cols-3 gap-4">
        <Stat label={t(locale, 'today')} value={todayH} />
        <Stat label={t(locale, 'thisWeek')} value={weekH} />
        <Stat label={t(locale, 'thisMonth')} value={monthH} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card">
          <h2 className="font-semibold mb-3">{t(locale, 'activeCases')}</h2>
          {cases.length === 0 ? (
            <p className="text-sm text-slate-500">{t(locale, 'noCases')}</p>
          ) : (
            <ul className="space-y-3">
              {cases.slice(0, 8).map((c) => {
                const thr = c.project.alertThresholdHours;
                const pct = thr && thr > 0 ? Math.min(100, (c.hours / thr) * 100) : null;
                const over = thr != null && thr > 0 && c.hours >= thr;
                return (
                  <li key={c.project.id}>
                    <Link href={`/cases/${c.project.id}`} className="flex items-center justify-between text-sm hover:text-sky-300">
                      <span className="truncate">
                        <span className="text-slate-400">{c.clientName} · </span>
                        {c.project.name}
                      </span>
                      <span className={`num ${over ? 'text-amber-400' : 'text-slate-300'}`}>
                        {c.hours.toFixed(2)}
                        {thr ? <span className="text-slate-500"> / {thr.toFixed(0)}</span> : null}
                      </span>
                    </Link>
                    {pct != null && (
                      <div className="mt-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div className={`h-full ${over ? 'bg-amber-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 className="font-semibold mb-3">{t(locale, 'recentEntries')}</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">{t(locale, 'noEntries')}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recent.map((r) => (
                <li key={r.entry.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    <span className="text-slate-500">{formatDate(r.entry.startMs, s.timezone, locale)} · </span>
                    {r.clientName} · {r.projectName}
                    {r.taskName ? <span className="text-slate-500"> · {r.taskName}</span> : null}
                  </span>
                  <span className="num text-slate-300 shrink-0">{formatHm(r.entry.durationMs ?? 0)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="num text-3xl font-bold mt-1">{value.toFixed(2)}</div>
      <div className="text-xs text-slate-500">שעות · hours</div>
    </div>
  );
}
