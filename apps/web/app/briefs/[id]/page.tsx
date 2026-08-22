import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBriefDetail } from '@/lib/queries';
import { formatMoney } from '@/lib/format';
import { deleteBrief, completeMilestone, cancelMilestone, issueMilestoneNow } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getBriefDetail(id);
  if (!detail) notFound();
  const { brief, milestones, trackedHours } = detail;

  const sum = (pick: (m: (typeof milestones)[number]) => number) =>
    Math.round(milestones.reduce((s, m) => s + pick(m), 0) * 100) / 100;
  const isFixed = brief.billingMode === 'fixed';

  return (
    <div className="space-y-8">
      <header>
        <Link href={`/clients/${brief.clientId}`} className="text-xs text-slate-500 hover:underline">
          ← Client
        </Link>
        <h1 className="text-2xl font-semibold">{brief.title}</h1>
        <p className="text-sm text-slate-400">
          {brief.billingMode === 'fixed' ? 'Fixed price' : 'Time & materials'} ·{' '}
          {formatMoney(brief.ratePerHour, brief.currency)}/hr · {milestones.length} milestones
        </p>
      </header>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-slate-400">
            <tr className="text-left">
              <th className="pb-2">#</th>
              <th className="pb-2">Work</th>
              <th className="pb-2 text-right">Estimated hours</th>
              <th className="pb-2 text-right">Estimated cost</th>
              {isFixed && <th className="pb-2 text-right">Agreed amount</th>}
              <th className="pb-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {milestones.map((m) => (
              <tr key={m.id} className="border-t border-slate-800">
                <td className="py-2 font-mono text-xs text-slate-500">{m.key}</td>
                <td className="py-2">
                  {m.title}
                  {m.section && <div className="text-xs text-slate-500">{m.section}</div>}
                </td>
                <td className="py-2 text-right">
                  {m.estimateHoursLow === m.estimateHoursHigh
                    ? m.estimateHoursLow
                    : `${m.estimateHoursLow}–${m.estimateHoursHigh}`}
                </td>
                <td className="py-2 text-right">
                  {formatMoney(m.estimateAmountLow, brief.currency)}
                  {m.estimateAmountLow !== m.estimateAmountHigh &&
                    `–${formatMoney(m.estimateAmountHigh, brief.currency)}`}
                </td>
                {isFixed && (
                  <td className="py-2 text-right">{formatMoney(m.amount, brief.currency)}</td>
                )}
                <td className="py-2 text-right">
                  {m.status === 'pending' && (
                    <form action={completeMilestone} className="inline">
                      <input type="hidden" name="id" value={m.id} />
                      <button className="btn-secondary text-xs" type="submit">
                        Mark delivered
                      </button>
                    </form>
                  )}
                  {m.status === 'ready' && (
                    <div className="flex justify-end gap-2">
                      <form action={issueMilestoneNow} className="inline">
                        <input type="hidden" name="id" value={m.id} />
                        <button className="btn-primary text-xs" type="submit">
                          Invoice now
                        </button>
                      </form>
                      <form action={cancelMilestone} className="inline">
                        <input type="hidden" name="id" value={m.id} />
                        <button className="btn-secondary text-xs" type="submit">
                          Cancel
                        </button>
                      </form>
                    </div>
                  )}
                  {m.status === 'invoiced' &&
                    (m.invoiceId ? (
                      <Link
                        href={`/invoices/${m.invoiceId}`}
                        className="text-xs text-emerald-400 hover:underline"
                      >
                        Invoiced
                      </Link>
                    ) : (
                      <span className="text-xs text-emerald-400">Invoiced</span>
                    ))}
                  {m.status === 'complete' && (
                    <span className="text-xs text-slate-500">Done · nothing to bill</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700 font-semibold">
              <td />
              <td className="pt-2">Total</td>
              <td className="pt-2 text-right">
                {sum((m) => m.estimateHoursLow)}–{sum((m) => m.estimateHoursHigh)}
              </td>
              <td className="pt-2 text-right">
                {formatMoney(
                  sum((m) => m.estimateAmountLow),
                  brief.currency,
                )}
                –
                {formatMoney(
                  sum((m) => m.estimateAmountHigh),
                  brief.currency,
                )}
              </td>
              {isFixed && (
                <td className="pt-2 text-right">{formatMoney(sum((m) => m.amount), brief.currency)}</td>
              )}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {(() => {
        const lowTotal = sum((m) => m.estimateHoursLow);
        const highTotal = sum((m) => m.estimateHoursHigh);
        const tone =
          trackedHours > highTotal
            ? 'text-rose-400'
            : trackedHours > lowTotal
              ? 'text-amber-400'
              : 'text-emerald-400';
        const earned = sum((m) => (m.status === 'invoiced' ? m.amount : 0));
        return (
          <div className="card space-y-1 text-sm">
            <p>
              <span className="text-slate-400">Tracked against this folder: </span>
              <span className={tone}>{trackedHours} hrs</span>
              {highTotal > 0 && (
                <span className="text-slate-500">
                  {' '}
                  of {lowTotal}–{highTotal} estimated
                </span>
              )}
            </p>
            {isFixed && earned > 0 && trackedHours > 0 && (
              <p className="text-slate-400">
                Invoiced {formatMoney(earned, brief.currency)} — effective{' '}
                {formatMoney(Math.round((earned / trackedHours) * 100) / 100, brief.currency)}/hr.{' '}
                <span className="text-slate-500">Internal only; never shown to the client.</span>
              </p>
            )}
            {highTotal > 0 && trackedHours > highTotal && (
              <p className="text-rose-400">
                Past the top of the estimate — flag this with the client before it becomes an issue.
              </p>
            )}
            {!brief.folderMappingId && (
              <p className="text-amber-400">
                No folder is attached to this brief, so no time is tracked against it and time &amp;
                materials milestones have nothing to bill. Attach one on the client page.
              </p>
            )}
          </div>
        );
      })()}

      <form action={deleteBrief}>
        <input type="hidden" name="id" value={brief.id} />
        <button className="btn-danger" type="submit">
          Delete brief
        </button>
      </form>
    </div>
  );
}
