import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getInvoiceDetail } from '@/lib/queries';
import { formatMoney, formatDate } from '@/lib/format';
import { markInvoicePaid, deleteInvoice, emailInvoice, convertDocument } from '@/lib/actions';
import { WeekHoursGrid } from '@/components/week-hours-grid';
import { isOverdue, isBillingEvidence, docLabel, docLegalLine } from '@claude-invoicer/core';

export const dynamic = 'force-dynamic';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getInvoiceDetail(id);
  if (!detail) notFound();
  const { invoice, lines, receiptNumber, settings, dayGrid } = detail;
  const paid = invoice.status === 'paid';
  const overdue = isOverdue(invoice.status, invoice.dueAt, Date.now());
  const billable = isBillingEvidence(invoice.docType);
  const legalLine = docLegalLine(invoice.docType);
  const isQuote = invoice.docType === 'quote';

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/invoices" className="text-xs text-slate-500 hover:underline">
            ← Invoices
          </Link>
          <h1 className="text-2xl font-semibold">
            {invoice.number}{' '}
            <span className="text-base font-normal text-slate-400">{docLabel(invoice.docType)}</span>
          </h1>
          <p className="text-sm text-slate-400">
            {invoice.clientName} · issued {formatDate(invoice.issuedAt, settings.timezone)}
            {invoice.notes ? ` · ${invoice.notes}` : ''}
          </p>
          {invoice.vatNumber && <p className="text-xs text-slate-500">VAT No: {invoice.vatNumber}</p>}
          {invoice.convertedToId && (
            <p className="text-xs text-slate-500">
              Converted to{' '}
              <Link href={`/invoices/${invoice.convertedToId}`} className="underline">
                the resulting invoice
              </Link>
            </p>
          )}
          {invoice.convertedFromId && (
            <p className="text-xs text-slate-500">
              Converted from{' '}
              <Link href={`/invoices/${invoice.convertedFromId}`} className="underline">
                its source document
              </Link>
            </p>
          )}
        </div>
        {billable ? (
          paid ? (
            <span className="rounded bg-green-900/40 px-3 py-1 text-sm text-green-300">paid</span>
          ) : overdue ? (
            <span className="rounded bg-red-900/40 px-3 py-1 text-sm text-red-300">overdue</span>
          ) : (
            <span className="rounded bg-amber-900/40 px-3 py-1 text-sm text-amber-300">unpaid</span>
          )
        ) : invoice.convertedToId ? (
          <span className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-400">converted</span>
        ) : null}
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
                {formatMoney(invoice.total, invoice.currency)}
                {invoice.taxAmount !== 0 && (
                  <div className="text-xs font-normal text-slate-500">
                    Net {formatMoney(invoice.subtotal, invoice.currency)} · VAT {invoice.taxRate}%{' '}
                    {formatMoney(invoice.taxAmount, invoice.currency)}
                  </div>
                )}
                {invoice.dueAt && !isQuote && (
                  <div className={`text-xs font-normal ${billable && overdue ? 'text-red-300' : 'text-slate-500'}`}>
                    Due {formatDate(invoice.dueAt, settings.timezone)}
                    {billable && overdue ? ' — overdue' : ''}
                  </div>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {legalLine && <p className="text-xs text-slate-500">{legalLine}</p>}

      {invoice.paymentDetails && (
        <section className="card space-y-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Pay to</h2>
          {invoice.paymentDetails.split('\n').map((line, i) => (
            <div key={i} className="text-sm text-slate-300">{line}</div>
          ))}
        </section>
      )}

      {dayGrid && <WeekHoursGrid grid={dayGrid} />}

      <div className="card space-y-2">
        <form action={emailInvoice} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <div className="flex-1 min-w-[16rem]">
            <label className="label">Client email</label>
            <input
              name="to"
              type="email"
              defaultValue={invoice.emailedTo ?? invoice.clientEmail ?? ''}
              placeholder="client@example.com"
              className="input"
            />
          </div>
          <button className="btn-primary" type="submit">
            {invoice.emailedAt ? 'Re-send email' : 'Email to client'}
          </button>
        </form>
        {invoice.emailedAt && (
          <p className="text-xs text-slate-500">
            Emailed {formatDate(invoice.emailedAt, settings.timezone)}
            {invoice.emailedTo ? ` to ${invoice.emailedTo}` : ''}. Public link:{' '}
            <code className="text-slate-400">/i/{invoice.publicToken}</code>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a className="btn-ghost" href={`/api/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">
          Download invoice PDF
        </a>

        {billable ? (
          !paid ? (
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
          )
        ) : (
          !invoice.convertedToId && (
            <form action={convertDocument}>
              <input type="hidden" name="id" value={invoice.id} />
              <button className="btn-primary" type="submit">
                Convert to invoice
              </button>
            </form>
          )
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
        Deleting an invoice frees its week to be invoiced again and returns any one-off charges to unbilled.
      </p>
    </div>
  );
}
