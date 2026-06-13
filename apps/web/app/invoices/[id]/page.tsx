import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getInvoiceDetail } from '@/lib/queries';
import { formatMoney, formatDate } from '@/lib/format';
import { markInvoicePaid, deleteInvoice } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getInvoiceDetail(id);
  if (!detail) notFound();
  const { invoice, lines, receiptNumber, settings } = detail;
  const paid = invoice.status === 'paid';

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/invoices" className="text-xs text-slate-500 hover:underline">
            ← Invoices
          </Link>
          <h1 className="text-2xl font-semibold">{invoice.number}</h1>
          <p className="text-sm text-slate-400">
            {invoice.clientName} · issued {formatDate(invoice.issuedAt, settings.timezone)}
          </p>
        </div>
        <span
          className={
            paid
              ? 'rounded bg-green-900/40 px-3 py-1 text-sm text-green-300'
              : 'rounded bg-amber-900/40 px-3 py-1 text-sm text-amber-300'
          }
        >
          {invoice.status}
        </span>
      </header>

      <div className="card">
        <table className="w-full text-sm">
          <thead className="text-slate-400">
            <tr className="text-left">
              <th className="pb-2">Description</th>
              <th className="pb-2 text-right">Hours</th>
              <th className="pb-2 text-right">Rate</th>
              <th className="pb-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const flat = l.hours === 0 && l.ratePerHour === 0;
              return (
                <tr key={l.id} className="border-t border-slate-800">
                  <td className="py-2">{l.label}</td>
                  <td className="py-2 text-right">{flat ? '—' : l.hours.toFixed(2)}</td>
                  <td className="py-2 text-right">{flat ? '—' : formatMoney(l.ratePerHour, invoice.currency)}</td>
                  <td className="py-2 text-right">{formatMoney(l.amount, invoice.currency)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700">
              <td className="pt-3 font-semibold" colSpan={3}>
                Total due
              </td>
              <td className="pt-3 text-right text-lg font-semibold">
                {formatMoney(invoice.subtotal, invoice.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a className="btn-ghost" href={`/api/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">
          Download invoice PDF
        </a>

        {!paid ? (
          <form action={markInvoicePaid}>
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <button className="btn-primary" type="submit">
              Mark paid &amp; issue receipt
            </button>
          </form>
        ) : (
          <a className="btn-ghost" href={`/api/invoices/${invoice.id}/receipt`} target="_blank" rel="noreferrer">
            Download receipt {receiptNumber ? `(${receiptNumber})` : ''}
          </a>
        )}

        <form action={deleteInvoice} className="ml-auto">
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <button className="btn-danger" type="submit">
            Delete
          </button>
        </form>
      </div>

      {paid && invoice.paidAt && (
        <p className="text-sm text-green-300">Paid on {formatDate(invoice.paidAt, settings.timezone)}.</p>
      )}
      <p className="text-xs text-slate-500">
        Deleting the most recent invoice for a client restores their clock to before it was issued.
      </p>
    </div>
  );
}
