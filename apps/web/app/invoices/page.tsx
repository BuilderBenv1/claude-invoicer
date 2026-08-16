import Link from 'next/link';
import { listInvoices, listPaymentAccounts } from '@/lib/queries';
import { formatMoney, formatDate } from '@/lib/format';
import { getSettings } from '@/lib/settings';
import { isOverdue, isBillingEvidence, docLabel, type DocType } from '@claude-invoicer/core';

export const dynamic = 'force-dynamic';

const TYPE_FILTERS: { label: string; value?: DocType }[] = [
  { label: 'All' },
  { label: 'Invoices', value: 'invoice' },
  { label: 'Pro formas', value: 'proforma' },
  { label: 'Quotes', value: 'quote' },
];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type: typeParam } = await searchParams;
  const [invoices, settings, paymentAccounts] = await Promise.all([
    listInvoices(),
    getSettings(),
    listPaymentAccounts(),
  ]);
  const now = Date.now();

  const filtered = invoices.filter((inv) => {
    if (typeParam === 'proforma') return inv.docType === 'proforma';
    if (typeParam === 'quote') return inv.docType === 'quote';
    if (typeParam === 'invoice') return isBillingEvidence(inv.docType);
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Documents</h1>
        <Link href="/invoices/new" className="btn-primary">
          + New document
        </Link>
      </div>

      {paymentAccounts.length === 0 && (
        <div className="card border border-amber-900/40 bg-amber-950/20 text-sm text-amber-200">
          No payment details configured — invoices will not show clients how to pay you.{' '}
          <Link href="/settings" className="underline">
            Add them in Settings
          </Link>
          .
        </div>
      )}

      <div className="flex gap-4 text-sm">
        {TYPE_FILTERS.map((f) => {
          const active = typeParam === f.value || (!typeParam && !f.value);
          return (
            <Link
              key={f.label}
              href={f.value ? `/invoices?type=${f.value}` : '/invoices'}
              className={active ? 'font-semibold text-slate-100' : 'text-slate-400 hover:text-slate-200'}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="card text-sm text-slate-400">
          {invoices.length === 0
            ? 'No invoices yet. Issue one per week from a client, or create one by hand with “New document”.'
            : 'No documents match this filter.'}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400">
              <tr className="text-left">
                <th className="pb-2">Number</th>
                <th className="pb-2">Client</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Issued</th>
                <th className="pb-2 text-right">Amount</th>
                <th className="pb-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => {
                const billable = isBillingEvidence(inv.docType);
                return (
                  <tr key={inv.id} className="border-t border-slate-800">
                    <td className="py-2">
                      <Link href={`/invoices/${inv.id}`} className="font-medium hover:underline">
                        {inv.number}
                      </Link>
                    </td>
                    <td className="py-2">{inv.clientName}</td>
                    <td className={`py-2 ${billable ? '' : 'text-slate-500'}`}>
                      {docLabel(inv.docType)}
                    </td>
                    <td className="py-2 text-slate-400">{formatDate(inv.issuedAt, settings.timezone)}</td>
                    <td className="py-2 text-right">{formatMoney(inv.total, inv.currency)}</td>
                    <td className="py-2 text-right">
                      {billable ? (
                        inv.status === 'paid' ? (
                          <span className="rounded bg-green-900/40 px-2 py-0.5 text-xs text-green-300">paid</span>
                        ) : isOverdue(inv.status, inv.dueAt, now) ? (
                          <span className="rounded bg-red-900/40 px-2 py-0.5 text-xs text-red-300">overdue</span>
                        ) : (
                          <span className="rounded bg-amber-900/40 px-2 py-0.5 text-xs text-amber-300">unpaid</span>
                        )
                      ) : inv.convertedToId ? (
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">converted</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
