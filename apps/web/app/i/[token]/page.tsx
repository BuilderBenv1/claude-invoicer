import { notFound } from 'next/navigation';
import { getInvoiceByToken } from '@/lib/queries';
import { formatMoney, formatDate } from '@/lib/format';
import { markPaidPublic } from '@/lib/actions';
import { WeekHoursGrid } from '@/components/week-hours-grid';

export const dynamic = 'force-dynamic';

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const detail = await getInvoiceByToken(token);
  if (!detail) notFound();
  const { invoice, lines, receiptNumber, settings, dayGrid } = detail;
  const paid = invoice.status === 'paid';

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <header className="flex items-start justify-between">
        <div>
          <div className="text-lg font-semibold">{invoice.businessName || 'Invoice'}</div>
          <div className="text-sm text-slate-400">
            {invoice.number} · issued {formatDate(invoice.issuedAt, settings.timezone)}
            {invoice.notes ? ` · ${invoice.notes}` : ''}
          </div>
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

      <div className="text-sm text-slate-400">
        Billed to <span className="text-slate-200">{invoice.clientName}</span>
      </div>

      <div className="card">
        <table className="w-full text-sm">
          <thead className="text-slate-400">
            <tr className="text-left">
              <th className="pb-2">Description</th>
              <th className="pb-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-800">
                <td className="py-2">{l.label}</td>
                <td className="py-2 text-right">{formatMoney(l.amount, invoice.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700">
              <td className="pt-3 font-semibold">Total due</td>
              <td className="pt-3 text-right text-lg font-semibold">
                {formatMoney(invoice.subtotal, invoice.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {dayGrid && <WeekHoursGrid grid={dayGrid} />}

      <div className="flex flex-wrap items-center gap-3">
        <a className="btn-ghost" href={`/i/${token}/pdf`} target="_blank" rel="noreferrer">
          Download invoice PDF
        </a>
        {!paid ? (
          <form action={markPaidPublic}>
            <input type="hidden" name="token" value={token} />
            <button className="btn-primary" type="submit">
              Mark as paid
            </button>
          </form>
        ) : (
          <a className="btn-ghost" href={`/i/${token}/receipt`} target="_blank" rel="noreferrer">
            Download receipt {receiptNumber ? `(${receiptNumber})` : ''}
          </a>
        )}
      </div>

      {paid && invoice.paidAt && (
        <p className="text-sm text-green-300">Paid on {formatDate(invoice.paidAt, settings.timezone)}. Thank you!</p>
      )}
    </div>
  );
}
