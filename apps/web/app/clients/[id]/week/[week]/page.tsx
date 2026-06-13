import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getWeekDetail } from '@/lib/queries';
import { formatDuration, formatMoney, formatDayLabel, formatTimeRange } from '@/lib/format';
import { issueInvoice } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function WeekDetailPage({
  params,
}: {
  params: Promise<{ id: string; week: string }>;
}) {
  const { id, week } = await params;
  const detail = await getWeekDetail(id, week);
  if (!detail) notFound();

  const { client, settings, weekKey, lines, subtotal, groups, sessionCount, billed, invoiceId, invoiceNumber, roundIncrementMin } = detail;
  const tz = settings.timezone;

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <Link href={`/clients/${client.id}`} className="text-xs text-slate-500 hover:underline">
            ← {client.name}
          </Link>
          <h1 className="text-2xl font-semibold">Week of {weekKey}</h1>
          <div className="text-xs text-slate-500">
            {sessionCount} session{sessionCount === 1 ? '' : 's'} · Mon–Sun ({tz})
          </div>
        </div>
        {billed ? (
          <Link href={`/invoices/${invoiceId}`} className="rounded bg-green-900/40 px-3 py-2 text-sm text-green-300 hover:underline">
            Invoiced · {invoiceNumber}
          </Link>
        ) : subtotal > 0 ? (
          <form action={issueInvoice}>
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="weekStart" value={weekKey} />
            <input type="hidden" name="includeOneOffs" value="0" />
            <button className="btn-primary" type="submit">
              Invoice this week · {formatMoney(subtotal, client.currency)}
            </button>
          </form>
        ) : null}
      </header>

      {/* Billed summary (what the invoice charges) */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">What you'd bill</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400">
              <tr className="text-left">
                <th className="pb-2">Project</th>
                <th className="pb-2 text-right">Hours (billed)</th>
                <th className="pb-2 text-right">Rate</th>
                <th className="pb-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.label} className="border-t border-slate-800">
                  <td className="py-2">{l.label}</td>
                  <td className="py-2 text-right">
                    {l.hours.toFixed(2)}
                    <span className="ml-1 text-xs text-slate-500">({formatDuration(l.rawMs)} actual)</span>
                  </td>
                  <td className="py-2 text-right">{formatMoney(l.ratePerHour, client.currency)}</td>
                  <td className="py-2 text-right">{formatMoney(l.amount, client.currency)}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-700">
                <td className="pt-2 font-semibold" colSpan={3}>Total</td>
                <td className="pt-2 text-right font-semibold">{formatMoney(subtotal, client.currency)}</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-2 text-xs text-slate-500">
            Billed hours are rounded up to {roundIncrementMin} min per project; "actual" is the raw
            idle-capped time.
          </div>
        </div>
      </section>

      {/* Where the time went — sessions per folder */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Where the time went</h2>
        {groups.length === 0 ? (
          <div className="card text-sm text-slate-400">No sessions in this week.</div>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="card">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="font-medium">{g.label}</div>
                  <div className="truncate font-mono text-xs text-slate-500">{g.cwd}</div>
                </div>
                <div className="font-semibold">{formatDuration(g.activeMs)}</div>
              </div>
              <div className="divide-y divide-slate-800/60 text-sm">
                {g.sessions.map((sn, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5">
                    <span className="text-slate-400">{formatDayLabel(sn.startMs, tz)}</span>
                    <span className="font-mono text-xs text-slate-500">{formatTimeRange(sn.startMs, sn.endMs, tz)}</span>
                    <span className="w-16 text-right">{formatDuration(sn.activeMs)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
