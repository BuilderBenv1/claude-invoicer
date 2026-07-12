import Link from 'next/link';
import { getSettings, localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';
import { listClientsWithTotals } from '@/lib/queries';
import { createClientAndRedirect } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const s = await getSettings();
  const locale = localeOf(s);
  const clients = await listClientsWithTotals();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t(locale, 'clients')}</h1>
      </div>

      <details className="card">
        <summary className="cursor-pointer font-medium">＋ {t(locale, 'addClient')}</summary>
        <form action={createClientAndRedirect} className="grid gap-3 md:grid-cols-2 mt-4">
          <div>
            <label className="label">{t(locale, 'name')}</label>
            <input name="name" className="input" required />
          </div>
          <div>
            <label className="label">{t(locale, 'email')}</label>
            <input name="email" type="email" className="input" />
          </div>
          <div>
            <label className="label">{t(locale, 'phone')}</label>
            <input name="phone" className="input" />
          </div>
          <div>
            <label className="label">
              {t(locale, 'hourlyRate')} ({s.defaultCurrency})
            </label>
            <input name="hourlyRate" type="number" step="0.01" min="0" className="input" defaultValue={s.defaultHourlyRate || ''} />
          </div>
          <div className="md:col-span-2">
            <label className="label">{t(locale, 'address')}</label>
            <input name="address" className="input" />
          </div>
          <input type="hidden" name="currency" value={s.defaultCurrency} />
          <div className="md:col-span-2">
            <button className="btn-primary" type="submit">
              {t(locale, 'save')}
            </button>
          </div>
        </form>
      </details>

      {clients.length === 0 ? (
        <p className="text-slate-500">{t(locale, 'noClients')}</p>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/50 text-slate-400 text-xs">
              <tr>
                <th className="text-start p-3">{t(locale, 'name')}</th>
                <th className="text-start p-3">{t(locale, 'cases')}</th>
                <th className="text-end p-3">{t(locale, 'totalHours')}</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.client.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="p-3">
                    <Link href={`/clients/${c.client.id}`} className="hover:text-sky-300 font-medium">
                      {c.client.name}
                    </Link>
                    {c.client.email ? <div className="text-xs text-slate-500">{c.client.email}</div> : null}
                  </td>
                  <td className="p-3 text-slate-400">{c.openCases}</td>
                  <td className="p-3 text-end num">{c.hours.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
