import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBriefDetail } from '@/lib/queries';
import { formatMoney } from '@/lib/format';
import { deleteBrief } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getBriefDetail(id);
  if (!detail) notFound();
  const { brief, milestones } = detail;

  const sum = (pick: (m: (typeof milestones)[number]) => number) =>
    Math.round(milestones.reduce((s, m) => s + pick(m), 0) * 100) / 100;

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
                <td className="py-2 text-right">
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{m.status}</span>
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
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        Ticking milestones off and billing against them arrives in the next phase. For now this is the
        record of what was quoted.
      </p>

      <form action={deleteBrief}>
        <input type="hidden" name="id" value={brief.id} />
        <button className="btn-danger" type="submit">
          Delete brief
        </button>
      </form>
    </div>
  );
}
