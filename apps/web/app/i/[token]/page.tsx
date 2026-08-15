import { notFound } from 'next/navigation';
import { getInvoiceByToken } from '@/lib/queries';
import { formatMoney, formatDate } from '@/lib/format';
import { markPaidPublic } from '@/lib/actions';
import { WeekHoursGrid } from '@/components/week-hours-grid';
import { isOverdue } from '@claude-invoicer/core';

export const dynamic = 'force-dynamic';

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const detail = await getInvoiceByToken(token);
  if (!detail) notFound();
  const { invoice, lines, receiptNumber, settings, dayGrid } = detail;
  const paid = invoice.status === 'paid';
  const overdue = isOverdue(invoice.status, invoice.dueAt, Date.now());

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <header className="flex items-start justify-between">
        <div>
          <div className="text-lg font-semibold">{invoice.businessName || 'Invoice'}</div>
          <div className="text-sm text-slate-400">
            {invoice.number} · issued {formatDate(invoice.issuedAt, settings.timezone)}
            {invoice.notes ? ` · ${invoice.notes}` : ''}
          </div>
          {invoice.vatNumber && <div className="text-xs text-slate-500">VAT No: {invoice.vatNumber}</div>}
        </div>
        {paid ? (
          <span className="rounded bg-green-900/40 px-3 py-1 text-sm text-green-300">paid</span>
        ) : overdue ? (
          <span className="rounded bg-red-900/40 px-3 py-1 text-sm text-red-300">overdue</span>
        ) : (
          <span className="rounded bg-amber-900/40 px-3 py-1 text-sm text-amber-300">unpaid</span>
        )}
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
                {formatMoney(invoice.total, invoice.currency)}
                {invoice.taxAmount !== 0 && (
                  <div className="text-xs font-normal text-slate-500">
                    Net {formatMoney(invoice.subtotal, invoice.currency)} · VAT {invoice.taxRate}%{' '}
                    {formatMoney(invoice.taxAmount, invoice.currency)}
                  </div>
                )}
                {invoice.dueAt && (
                  <div className={`text-xs font-normal ${overdue ? 'text-red-300' : 'text-slate-500'}`}>
                    Due {formatDate(invoice.dueAt, settings.timezone)}
                    {overdue ? ' — overdue' : ''}
                  </div>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {invoice.paymentDetails && (
        <section className="card space-y-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Pay to</h2>
          {invoice.paymentDetails.split('\n').map((line, i) => (
            <div key={i} className="text-sm text-slate-300">{line}</div>
          ))}
        </section>
      )}

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
