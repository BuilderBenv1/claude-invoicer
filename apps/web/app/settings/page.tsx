import { getSettings } from '@/lib/settings';
import { updateSettings } from '@/lib/actions';
import { listPaymentAccounts } from '@/lib/queries';
import { CurrencySelect } from '@/components/currency-select';
import { PaymentAccountsForm } from '@/components/payment-accounts-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [s, accounts] = await Promise.all([getSettings(), listPaymentAccounts()]);

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
        <div>
          <label className="label">VAT number</label>
          <input name="vatNumber" defaultValue={s.vatNumber ?? ''} className="input" />
        </div>
        <div>
          <label className="label">VAT rate (%)</label>
          <input name="vatRate" type="number" step="0.1" min="0" defaultValue={s.vatRate} className="input" />
          <p className="mt-1 text-xs text-slate-500">
            0 turns VAT off entirely — no VAT line, no VAT number printed. Set 20 once you are
            registered. Invoices already issued keep the rate they were issued with.
          </p>
        </div>
        <div>
          <label className="label">Payment terms (days)</label>
          <input
            name="paymentTermsDays"
            type="number"
            min="0"
            defaultValue={s.paymentTermsDays}
            className="input"
          />
          <p className="mt-1 text-xs text-slate-500">
            Sets the due date printed on new invoices. 0 means due on receipt.
          </p>
        </div>

        <div className="sm:col-span-2 mt-2 text-sm font-semibold text-slate-300">Defaults</div>
        <div>
          <label className="label">Default currency</label>
          <CurrencySelect name="defaultCurrency" defaultValue={s.defaultCurrency} />
          <p className="mt-1 text-xs text-slate-500">Used for new clients. Existing clients keep their own.</p>
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
          <label className="label">Rounding mode</label>
          <select name="roundMode" defaultValue={s.roundMode} className="input">
            <option value="up">Round up to increment</option>
            <option value="nearest">Round to nearest</option>
            <option value="down">Round down</option>
            <option value="none">No rounding (exact)</option>
          </select>
          <p className="mt-1 text-xs text-slate-500">
            How tracked time is rounded per project line, using the increment above. “Nearest” bills the
            closest increment (e.g. 9h32m → 9.5h at 30 min).
          </p>
        </div>
        <div>
          <label className="label">Idle cap (min) — informational</label>
          <input name="defaultIdleCapMin" type="number" defaultValue={s.defaultIdleCapMin} className="input" />
          <p className="mt-1 text-xs text-slate-500">
            The idle cap is applied by the local agent when it computes time. Change it in the agent
            config and re-run with <code>--resync</code> to recompute. This field is a label only.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="autoSendWeekly" value="1" defaultChecked={s.autoSendWeekly === 1} />
          Enable weekly auto-send — each day the cron issues + emails every client's previous completed
          week (clients without an email are skipped).
        </label>

        <div className="sm:col-span-2">
          <button className="btn-primary" type="submit">
            Save settings
          </button>
        </div>
      </form>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Payment details (printed on invoices)
        </h2>
        <p className="text-xs text-slate-500">
          An invoice shows the details matching its currency, falling back to the default. Only the
          fields you fill in are printed, and the details are copied onto each invoice as it is
          issued — changing them later never alters an invoice you have already sent.
        </p>
        <PaymentAccountsForm accounts={accounts} />
      </section>
    </div>
  );
}
