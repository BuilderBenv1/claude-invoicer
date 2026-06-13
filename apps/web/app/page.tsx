import Link from 'next/link';
import { getOverview } from '@/lib/queries';
import { formatDuration, formatMoney } from '@/lib/format';
import { issueInvoice, createClient } from '@/lib/actions';
import { AssignFolderForm } from '@/components/assign-folder-form';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const { stats, unassigned, clients, settings, currentWeekKey } = await getOverview();
  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-10">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="text-sm text-slate-400">
            Idle cap {settings.defaultIdleCapMin}m · rounding {settings.defaultRoundIncrementMin}m · {settings.timezone}
          </p>
        </div>
      </header>

      {/* Clients */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Clients</h2>
        {stats.length === 0 ? (
          <div className="card text-sm text-slate-400">
            No clients yet. Assign a folder below, or add a client.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {stats.map(({ client, thisWeekMs, thisWeekAmount, thisWeekBilled, unbilledWeeks, oneOffTotal }) => (
              <div key={client.id} className="card">
                <div className="flex items-start justify-between">
                  <div>
                    <Link href={`/clients/${client.id}`} className="text-lg font-medium hover:underline">
                      {client.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {formatMoney(client.hourlyRate, client.currency)}/hr default
                    </div>
                  </div>
                  {thisWeekAmount > 0 && !thisWeekBilled ? (
                    <form action={issueInvoice}>
                      <input type="hidden" name="clientId" value={client.id} />
                      <input type="hidden" name="weekStart" value={currentWeekKey} />
                      <input type="hidden" name="includeOneOffs" value="1" />
                      <button className="btn-primary" type="submit">
                        Invoice this week
                      </button>
                    </form>
                  ) : thisWeekBilled ? (
                    <span className="rounded bg-green-900/40 px-2 py-1 text-xs text-green-300">week invoiced</span>
                  ) : null}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="label">This week</div>
                    <div className="font-semibold">{formatDuration(thisWeekMs)}</div>
                  </div>
                  <div>
                    <div className="label">This week $</div>
                    <div className="font-semibold text-sky-300">{formatMoney(thisWeekAmount, client.currency)}</div>
                  </div>
                  <div>
                    <div className="label">Unbilled weeks</div>
                    <div className="font-semibold">{unbilledWeeks}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <span>{oneOffTotal > 0 ? `+ ${formatMoney(oneOffTotal, client.currency)} one-off charges` : ''}</span>
                  <Link href={`/clients/${client.id}`} className="hover:underline">
                    All weeks →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Unassigned folders */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Unassigned folders ({unassigned.length})
        </h2>
        <p className="text-xs text-slate-500">
          These are tracked but not billed. Assign client work; leave your own projects alone.
        </p>
        {unassigned.length === 0 ? (
          <div className="card text-sm text-slate-400">Nothing unassigned. (Run the agent to pull in activity.)</div>
        ) : (
          <div className="space-y-2">
            {unassigned.slice(0, 40).map((f) => (
              <div key={f.cwd} className="card flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm">{f.cwd}</div>
                  <div className="text-xs text-slate-500">{formatDuration(f.activeMs)} active</div>
                </div>
                <AssignFolderForm path={f.cwd} clients={clientOptions} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Add client */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Add a client</h2>
        <form action={createClient} className="card grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="label">Name</label>
            <input name="name" className="input" required />
          </div>
          <div>
            <label className="label">Rate / hr</label>
            <input name="hourlyRate" type="number" step="0.01" defaultValue={0} className="input" />
          </div>
          <div>
            <label className="label">Currency</label>
            <input name="currency" defaultValue={settings.defaultCurrency} className="input" />
          </div>
          <div className="sm:col-span-4">
            <button className="btn-primary" type="submit">
              Add client
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
