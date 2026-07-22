import Link from 'next/link';
import { getSettings, localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';
import { listInvoices } from '@/lib/invoice-service';
import { money, formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  const s = await getSettings();
  const locale = localeOf(s);
  const invoices = await listInvoices();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t(locale, 'invoices')}</h1>
        <Link href="/invoices/new" className="btn-primary">
          ＋ {t(locale, 'newInvoice')}
        </Link>
      </div>

      {invoices.length === 0 ? (
        <p className="text-slate-500">{t(locale, 'noInvoices')}</p>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/50 text-slate-400 text-xs">
              <tr>
                <th className="text-start p-3">{t(locale, 'invoiceNo')}</th>
                <th className="text-start p-3">{t(locale, 'client')}</th>
                <th className="text-start p-3">{t(locale, 'issued')}</th>
                <th className="text-end p-3">{t(locale, 'amount')}</th>
                <th className="text-end p-3">{t(locale, 'status')}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="p-3">
                    <Link href={`/invoices/${inv.id}`} className="hover:text-sky-300 font-medium">
                      {inv.number}
                    </Link>
                    {inv.caseNumber ? <div className="text-xs text-slate-500">{inv.caseNumber}</div> : null}
                  </td>
                  <td className="p-3">{inv.clientName}</td>
                  <td className="p-3 text-slate-400">{formatDate(inv.issuedAt, s.timezone, locale)}</td>
                  <td className="p-3 text-end num">{money(inv.subtotal, inv.currency, locale)}</td>
                  <td className="p-3 text-end">
                    <span className={`pill ${inv.status === 'paid' ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}>
                      {t(locale, inv.status === 'paid' ? 'paid' : 'unpaid')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
