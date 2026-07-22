import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getInvoiceDetail } from '@/lib/invoice-service';
import { renderInvoiceHtml } from '@/lib/invoice-doc';
import { localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import { markInvoicePaidAction, markInvoiceUnpaidAction, deleteInvoiceAction, emailInvoiceAction } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getInvoiceDetail(id);
  if (!detail) notFound();
  const locale = localeOf(detail.settings);
  const inv = detail.invoice;
  const preview = renderInvoiceHtml(detail, locale);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href="/invoices" className="text-xs text-slate-500 hover:underline">
            ← {t(locale, 'invoices')}
          </Link>
          <h1 className="text-2xl font-semibold">
            {t(locale, 'invoice')} {inv.number}
          </h1>
          {inv.emailedAt ? (
            <div className="text-xs text-emerald-400">
              {t(locale, 'sentTo')} {inv.emailedTo} · {formatDate(inv.emailedAt, detail.settings.timezone, locale)}
            </div>
          ) : null}
        </div>
        <div className="flex gap-2 flex-wrap">
          <a href={`/invoices/${inv.id}/print`} target="_blank" className="btn-ghost">
            🖶 {t(locale, 'downloadPdf')}
          </a>
          {inv.status === 'paid' ? (
            <form action={markInvoiceUnpaidAction}>
              <input type="hidden" name="invoiceId" value={inv.id} />
              <button className="btn-ghost" type="submit">
                {t(locale, 'markUnpaid')}
              </button>
            </form>
          ) : (
            <form action={markInvoicePaidAction}>
              <input type="hidden" name="invoiceId" value={inv.id} />
              <button className="btn-green" type="submit">
                {t(locale, 'markPaid')}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Email */}
      <form action={emailInvoiceAction} className="card flex items-end gap-2 flex-wrap">
        <input type="hidden" name="invoiceId" value={inv.id} />
        <div className="flex-1 min-w-[220px]">
          <label className="label">{t(locale, 'emailInvoice')}</label>
          <input name="to" type="email" className="input" defaultValue={inv.clientEmail ?? ''} placeholder="client@example.com" />
        </div>
        <button className="btn-primary" type="submit">
          {t(locale, 'emailInvoice')}
        </button>
      </form>

      {/* Preview */}
      <div className="rounded-xl overflow-hidden border border-slate-800 bg-white text-black">
        <div dangerouslySetInnerHTML={{ __html: preview }} />
      </div>

      <form action={deleteInvoiceAction}>
        <input type="hidden" name="invoiceId" value={inv.id} />
        <button className="btn-danger" type="submit">
          {t(locale, 'delete')}
        </button>
      </form>
    </div>
  );
}
