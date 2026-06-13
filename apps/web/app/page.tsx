import Link from 'next/link';
import { getOverview } from '@/lib/queries';
import { formatDuration, formatMoney } from '@/lib/format';
import { issueInvoice, createClient } from '@/lib/actions';
import { AssignFolderForm } from '@/components/assign-folder-form';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const { stats, unassigned, clients, totalUnbilledByCurrency, settings } = await getOverview();
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
        <div className="text-right">
          <div className="label">Total unbilled</div>
          <div className="text-xl font-semibold">
            {Object.keys(totalUnbilledByCurrency).length === 0
              ? formatMoney(0, settings.defaultCurrency)
              : Object.entries(totalUnbilledByCurrency)
                  .map(([cur, amt]) => formatMoney(amt, cur))
                  .join(' · ')}
          </div>
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
            {stats.map(({ client, thisWeekMs, unbilledMs, estimatedAmount }) => (
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
                  {estimatedAmount > 0 && (
                    <form action={issueInvoice}>
                      <input type="hidden" name="clientId" value={client.id} />
                      <button className="btn-primary" type="submit">
                        Issue invoice
                      </button>
                    </form>
                  )}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="label">This week</div>
                    <div className="font-semibold">{formatDuration(thisWeekMs)}</div>
                  </div>
                  <div>
                    <div className="label">Unbilled</div>
                    <div className="font-semibold">{formatDuration(unbilledMs)}</div>
                  </div>
                  <div>
                    <div className="label">Est. amount</div>
                    <div className="font-semibold text-sky-300">
                      {formatMoney(estimatedAmount, client.currency)}
                    </div>
                  </div>
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
