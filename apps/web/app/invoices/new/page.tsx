import Link from 'next/link';
import { listClients } from '@/lib/queries';
import { ManualInvoiceForm } from '@/components/manual-invoice-form';

export const dynamic = 'force-dynamic';

export default async function NewInvoicePage() {
  const clients = await listClients();
  const options = clients.map((c) => ({
    id: c.id,
    name: c.name,
    currency: c.currency,
    hourlyRate: c.hourlyRate,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/invoices" className="text-xs text-slate-500 hover:underline">
          ← Invoices
        </Link>
        <h1 className="text-2xl font-semibold">New invoice</h1>
        <p className="text-sm text-slate-400">
          Enter line items by hand — for older work or anything not tracked from a Claude session.
        </p>
      </div>

      {options.length === 0 ? (
        <div className="card text-sm text-slate-400">
          You need a client first. Add one on the{' '}
          <Link href="/" className="underline">
            Overview
          </Link>{' '}
          page, then come back.
        </div>
      ) : (
        <ManualInvoiceForm clients={options} />
      )}
    </div>
  );
}
