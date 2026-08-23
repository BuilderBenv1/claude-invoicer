import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBriefDetail } from '@/lib/queries';
import { formatMoney } from '@/lib/format';
import { CurrencySelect } from '@/components/currency-select';
import {
  deleteBrief,
  completeMilestone,
  cancelMilestone,
  issueMilestoneNow,
  setBriefFolder,
  updateBrief,
  updateMilestone,
} from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getBriefDetail(id);
  if (!detail) notFound();
  const { brief, milestones, trackedHours, folders } = detail;

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
              <th className="pb-2 text-right" />
              <th className="pb-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {milestones.map((m) => {
              // Once billed, the invoice is the record of what was charged, so
              // the row goes read-only rather than being allowed to drift from it.
              const locked = m.status === 'invoiced' || !!m.invoiceId;
              const fid = `ms-${m.id}`;
              return (
              <tr key={m.id} className="border-t border-slate-800 align-top">
                <td className="py-2 font-mono text-xs text-slate-500">{m.key}</td>
                <td className="py-2">
                  {locked ? (
                    m.title
                  ) : (
                    <>
                      {/* A <form> cannot wrap <td>s, so it lives outside the row
                          and each input joins it by id via the form attribute. */}
                      <form id={fid} action={updateMilestone} />
                      <input type="hidden" name="id" value={m.id} form={fid} />
                      <input
                        name="title"
                        defaultValue={m.title}
                        form={fid}
                        className="input w-full text-sm"
                        aria-label={`${m.key} scope`}
                      />
                    </>
                  )}
                  {m.section && <div className="mt-1 text-xs text-slate-500">{m.section}</div>}
                </td>
                <td className="py-2 text-right">
                  {locked ? (
                    m.estimateHoursLow === m.estimateHoursHigh
                      ? m.estimateHoursLow
                      : `${m.estimateHoursLow}–${m.estimateHoursHigh}`
                  ) : (
                    <div className="flex items-center justify-end gap-1">
                      <input
                        name="hoursLow"
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={m.estimateHoursLow}
                        form={fid}
                        className="input w-16 text-right text-sm"
                        aria-label={`${m.key} hours low`}
                      />
                      <span className="text-slate-600">–</span>
                      <input
                        name="hoursHigh"
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={m.estimateHoursHigh}
                        form={fid}
                        className="input w-16 text-right text-sm"
                        aria-label={`${m.key} hours high`}
                      />
                    </div>
                  )}
                </td>
                <td className="py-2 text-right">
                  {formatMoney(m.estimateAmountLow, brief.currency)}
                  {m.estimateAmountLow !== m.estimateAmountHigh &&
                    `–${formatMoney(m.estimateAmountHigh, brief.currency)}`}
                </td>
                {isFixed && (
                  <td className="py-2 text-right">
                    {locked ? (
                      formatMoney(m.amount, brief.currency)
                    ) : (
                      <input
                        name="amount"
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={m.amount}
                        form={fid}
                        className="input w-24 text-right text-sm"
                        aria-label={`${m.key} agreed amount`}
                      />
                    )}
                  </td>
                )}
                <td className="py-2 text-right">
                  {!locked && (
                    <button className="btn-secondary mb-1 text-xs" type="submit" form={fid}>
                      Save
                    </button>
                  )}
                </td>
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
              );
            })}
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
          </div>
        );
      })()}

      <div className="card space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Brief settings
        </h2>
        <form action={updateBrief} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={brief.id} />
          <div className="sm:col-span-2">
            <label className="label">Title</label>
            <input name="title" defaultValue={brief.title} className="input" />
          </div>
          <div>
            <label className="label">Billing</label>
            <select name="billingMode" defaultValue={brief.billingMode} className="input">
              <option value="time">Time &amp; materials — bill the hours tracked</option>
              <option value="fixed">Fixed price — bill each agreed amount</option>
            </select>
          </div>
          <div>
            <label className="label">Currency</label>
            <CurrencySelect name="currency" defaultValue={brief.currency} />
          </div>
          <div>
            <label className="label">Rate per hour</label>
            <input
              name="ratePerHour"
              type="number"
              step="0.01"
              min="0"
              defaultValue={brief.ratePerHour}
              className="input"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" name="recompute" defaultChecked className="h-4 w-4" />
              Recompute estimates as hours × rate
            </label>
          </div>
          <div className="sm:col-span-2">
            <button className="btn-primary" type="submit">
              Save brief
            </button>
            <p className="mt-1 text-xs text-slate-500">
              Changing currency does not convert figures at an exchange rate — on a time &amp;
              materials brief the estimate is hours × rate, so it is recomputed from the rate you
              set. Milestones already invoiced keep their original figures.
            </p>
          </div>
        </form>
      </div>

      {/* The folder is what makes the brief real: MILESTONES.md is written into
          it, and it is where T&M milestones read their hours from. */}
      <div className="card space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Folder</h2>
        {!brief.folderMappingId && (
          <p className="text-sm text-amber-400">
            No folder attached yet — so no <code>MILESTONES.md</code> is written, nothing is tracked
            against this brief, and time &amp; materials milestones have nothing to bill.
          </p>
        )}
        {folders.length === 0 ? (
          <p className="text-sm text-slate-400">
            This client has no folders yet. Add one on the{' '}
            <Link href={`/clients/${brief.clientId}`} className="underline">
              client page
            </Link>{' '}
            first, then come back and pick it here.
          </p>
        ) : (
          <form action={setBriefFolder} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={brief.id} />
            <div className="min-w-64 flex-1">
              <label className="label">Bill this brief against</label>
              <select
                name="folderMappingId"
                defaultValue={brief.folderMappingId ?? ''}
                className="input"
              >
                <option value="">Not linked to a folder</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn-primary" type="submit">
              Save folder
            </button>
          </form>
        )}
      </div>

      {/* The estimate exactly as it arrived. Kept because the brief can be
          re-priced or re-scoped afterwards, and this is the record of what was
          actually quoted to the client. */}
      {brief.sourceText && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-400">
            Original estimate as quoted
          </summary>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-slate-400">
            {brief.sourceText}
          </pre>
        </details>
      )}

      <form action={deleteBrief}>
        <input type="hidden" name="id" value={brief.id} />
        <button className="btn-danger" type="submit">
          Delete brief
        </button>
      </form>
    </div>
  );
}
