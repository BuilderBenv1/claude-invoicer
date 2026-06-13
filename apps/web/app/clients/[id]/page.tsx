import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClientDetail } from '@/lib/queries';
import { formatDuration, formatMoney, formatDate } from '@/lib/format';
import {
  updateClient,
  addMapping,
  updateMapping,
  removeMapping,
  addOneOff,
  removeOneOff,
  issueInvoice,
  archiveClient,
} from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getClientDetail(id);
  if (!detail) notFound();

  const { client, mappings, weeks, oneOffs, oneOffTotal, recentIntervals, settings, roundIncrementMin, currentWeekKey } = detail;
  const billableWeeks = weeks.filter((w) => w.amount > 0 || w.billed);

  return (
    <div className="space-y-10">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-slate-500 hover:underline">
            ← Overview
          </Link>
          <h1 className="text-2xl font-semibold">{client.name}</h1>
          <div className="text-xs text-slate-500">
            {formatMoney(client.hourlyRate, client.currency)}/hr default · weeks Mon–Sun ({settings.timezone})
          </div>
        </div>
      </header>

      {/* Per-week billing */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Bill by week (Mon–Sun)</h2>
        {oneOffTotal > 0 && (
          <p className="text-xs text-slate-500">
            {formatMoney(oneOffTotal, client.currency)} of one-off charges will be added when you invoice
            the current week.
          </p>
        )}
        <div className="card overflow-x-auto">
          {billableWeeks.length === 0 ? (
            <div className="text-sm text-slate-400">No tracked activity yet. Run the agent to pull in time.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-slate-400">
                <tr className="text-left">
                  <th className="pb-2">Week of</th>
                  <th className="pb-2 text-right">Time</th>
                  <th className="pb-2 text-right">Amount</th>
                  <th className="pb-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {billableWeeks.map((w) => {
                  const isCurrent = w.weekKey === currentWeekKey;
                  return (
                    <tr key={w.weekKey} className="border-t border-slate-800">
                      <td className="py-2">
                        <Link href={`/clients/${client.id}/week/${w.weekKey}`} className="hover:underline">
                          {w.weekKey}
                        </Link>
                        {isCurrent && <span className="ml-2 text-xs text-sky-400">this week</span>}
                      </td>
                      <td className="py-2 text-right">{formatDuration(w.activeMs)}</td>
                      <td className="py-2 text-right">{formatMoney(w.amount, client.currency)}</td>
                      <td className="py-2 text-right">
                        {w.billed ? (
                          <span className="rounded bg-green-900/40 px-2 py-0.5 text-xs text-green-300">invoiced</span>
                        ) : (
                          <form action={issueInvoice} className="inline">
                            <input type="hidden" name="clientId" value={client.id} />
                            <input type="hidden" name="weekStart" value={w.weekKey} />
                            {/* One-offs ride along only with the current week's invoice. */}
                            <input type="hidden" name="includeOneOffs" value={isCurrent ? '1' : '0'} />
                            <button className="btn-primary" type="submit">
                              Invoice{isCurrent && oneOffTotal > 0 ? ' + charges' : ''}
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-slate-500">Time rounded up to {roundIncrementMin} min per project line.</p>
      </section>

      {/* Folder mappings */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Folders for this client</h2>
        <p className="text-xs text-slate-500">
          Each folder (and its subfolders) can have its own hourly rate — leave Rate blank to use the
          client default ({formatMoney(client.hourlyRate, client.currency)}/hr).
        </p>
        <div className="space-y-2">
          {mappings.map((m) => (
            <div key={m.id} className="card flex flex-wrap items-end gap-2 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-sm">{m.path}</div>
              </div>
              <form action={updateMapping} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="clientId" value={client.id} />
                <div className="w-36">
                  <label className="label">Label</label>
                  <input name="label" defaultValue={m.label ?? ''} className="input" />
                </div>
                <div className="w-24">
                  <label className="label">Rate/hr</label>
                  <input name="hourlyRate" type="number" step="0.01" defaultValue={m.hourlyRate ?? ''} placeholder="default" className="input" />
                </div>
                <button className="btn-ghost" type="submit">Save</button>
              </form>
              <form action={removeMapping}>
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="clientId" value={client.id} />
                <button className="btn-danger" type="submit">Remove</button>
              </form>
            </div>
          ))}
          <form action={addMapping} className="card flex flex-wrap items-end gap-2">
            <input type="hidden" name="clientId" value={client.id} />
            <div className="flex-1 min-w-[14rem]">
              <label className="label">Folder path</label>
              <input name="path" placeholder="C:\Users\you\work\acme" className="input" required />
            </div>
            <div className="w-36">
              <label className="label">Label (optional)</label>
              <input name="label" className="input" />
            </div>
            <div className="w-24">
              <label className="label">Rate/hr</label>
              <input name="hourlyRate" type="number" step="0.01" placeholder="default" className="input" />
            </div>
            <button className="btn-ghost" type="submit">Add folder</button>
          </form>
        </div>
      </section>

      {/* One-off charges */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">One-off charges</h2>
        <p className="text-xs text-slate-500">
          Flat fees not based on tracked time (e.g. a fixed-price website). These are added to the
          next invoice you issue for this client.
        </p>
        <div className="space-y-2">
          {oneOffs.map((o) => (
            <div key={o.id} className="card flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="truncate">{o.description}</div>
                <div className="text-xs text-slate-500">{formatMoney(o.amount, client.currency)}</div>
              </div>
              <form action={removeOneOff}>
                <input type="hidden" name="id" value={o.id} />
                <input type="hidden" name="clientId" value={client.id} />
                <button className="btn-danger" type="submit">Remove</button>
              </form>
            </div>
          ))}
          <form action={addOneOff} className="card flex flex-wrap items-end gap-2">
            <input type="hidden" name="clientId" value={client.id} />
            <div className="flex-1 min-w-[14rem]">
              <label className="label">Description</label>
              <input name="description" placeholder="Website build (fixed fee)" className="input" required />
            </div>
            <div className="w-32">
              <label className="label">Amount ({client.currency})</label>
              <input name="amount" type="number" step="0.01" className="input" required />
            </div>
            <button className="btn-ghost" type="submit">Add charge</button>
          </form>
        </div>
      </section>

      {/* Settings */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Client settings</h2>
        <form action={updateClient} className="card grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={client.id} />
          <div>
            <label className="label">Name</label>
            <input name="name" defaultValue={client.name} className="input" required />
          </div>
          <div>
            <label className="label">Rate / hr</label>
            <input name="hourlyRate" type="number" step="0.01" defaultValue={client.hourlyRate} className="input" />
          </div>
          <div>
            <label className="label">Currency</label>
            <input name="currency" defaultValue={client.currency} className="input" />
          </div>
          <div>
            <label className="label">Rounding override (min, blank = default {settings.defaultRoundIncrementMin})</label>
            <input
              name="roundIncrementMin"
              type="number"
              defaultValue={client.roundIncrementMin ?? ''}
              className="input"
            />
          </div>
          <div>
            <label className="label">Client email</label>
            <input name="email" defaultValue={client.email ?? ''} className="input" />
          </div>
          <div>
            <label className="label">Client address</label>
            <input name="address" defaultValue={client.address ?? ''} className="input" />
          </div>
          <div className="sm:col-span-2 flex items-center justify-between">
            <button className="btn-primary" type="submit">
              Save
            </button>
          </div>
        </form>
        <form action={archiveClient}>
          <input type="hidden" name="id" value={client.id} />
          <button className="btn-danger" type="submit">
            Archive client
          </button>
        </form>
      </section>

      {/* Recent sessions */}
      {recentIntervals.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Recent sessions</h2>
          <div className="card space-y-1 text-sm">
            {recentIntervals.map((it) => (
              <div key={`${it.sessionId}-${it.startMs}`} className="flex items-center justify-between border-b border-slate-800/60 py-1 last:border-0">
                <span className="text-slate-400">{formatDate(it.endMs, settings.timezone)}</span>
                <span className="truncate px-3 font-mono text-xs text-slate-500">{it.cwd}</span>
                <span>{formatDuration(it.activeMs)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
