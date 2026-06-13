import { getSettings } from '@/lib/settings';
import { updateSettings } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const s = await getSettings();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <form action={updateSettings} className="card grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2 text-sm font-semibold text-slate-300">Business identity (shown on invoices)</div>
        <div>
          <label className="label">Business name</label>
          <input name="businessName" defaultValue={s.businessName} className="input" />
        </div>
        <div>
          <label className="label">Business email</label>
          <input name="businessEmail" defaultValue={s.businessEmail ?? ''} className="input" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Business address</label>
          <input name="businessAddress" defaultValue={s.businessAddress ?? ''} className="input" />
        </div>
        <div>
          <label className="label">Tax ID</label>
          <input name="taxId" defaultValue={s.taxId ?? ''} className="input" />
        </div>

        <div className="sm:col-span-2 mt-2 text-sm font-semibold text-slate-300">Defaults</div>
        <div>
          <label className="label">Default currency</label>
          <input name="defaultCurrency" defaultValue={s.defaultCurrency} className="input" />
        </div>
        <div>
          <label className="label">Timezone (IANA, e.g. Asia/Jerusalem)</label>
          <input name="timezone" defaultValue={s.timezone} className="input" />
        </div>
        <div>
          <label className="label">Default rounding (min)</label>
          <input name="defaultRoundIncrementMin" type="number" defaultValue={s.defaultRoundIncrementMin} className="input" />
        </div>
        <div>
          <label className="label">Idle cap (min) — informational</label>
          <input name="defaultIdleCapMin" type="number" defaultValue={s.defaultIdleCapMin} className="input" />
          <p className="mt-1 text-xs text-slate-500">
            The idle cap is applied by the local agent when it computes time. Change it in the agent
            config and re-run with <code>--resync</code> to recompute. This field is a label only.
          </p>
        </div>

        <div className="sm:col-span-2">
          <button className="btn-primary" type="submit">
            Save settings
          </button>
        </div>
      </form>
    </div>
  );
}
