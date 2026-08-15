import Link from 'next/link';
import { listInvoices } from '@/lib/queries';
import { formatMoney, formatDate } from '@/lib/format';
import { getSettings } from '@/lib/settings';
import { isOverdue } from '@claude-invoicer/core';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  const [invoices, settings] = await Promise.all([listInvoices(), getSettings()]);
  const now = Date.now();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <Link href="/invoices/new" className="btn-primary">
          + New invoice
        </Link>
      </div>

      {invoices.length === 0 ? (
        <div className="card text-sm text-slate-400">
          No invoices yet. Issue one per week from a client, or create one by hand with “New invoice”.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400">
              <tr className="text-left">
                <th className="pb-2">Number</th>
                <th className="pb-2">Client</th>
                <th className="pb-2">Issued</th>
                <th className="pb-2 text-right">Amount</th>
                <th className="pb-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-slate-800">
                  <td className="py-2">
                    <Link href={`/invoices/${inv.id}`} className="font-medium hover:underline">
                      {inv.number}
                    </Link>
                  </td>
                  <td className="py-2">{inv.clientName}</td>
                  <td className="py-2 text-slate-400">{formatDate(inv.issuedAt, settings.timezone)}</td>
                  <td className="py-2 text-right">{formatMoney(inv.total, inv.currency)}</td>
                  <td className="py-2 text-right">
                    {inv.status === 'paid' ? (
                      <span className="rounded bg-green-900/40 px-2 py-0.5 text-xs text-green-300">paid</span>
                    ) : isOverdue(inv.status, inv.dueAt, now) ? (
                      <span className="rounded bg-red-900/40 px-2 py-0.5 text-xs text-red-300">overdue</span>
                    ) : (
                      <span className="rounded bg-amber-900/40 px-2 py-0.5 text-xs text-amber-300">unpaid</span>
                    )}
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
