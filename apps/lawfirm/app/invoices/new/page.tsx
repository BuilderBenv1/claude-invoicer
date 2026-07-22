import Link from 'next/link';
import { InvoiceForm } from '@/components/invoice-form';
import type { ReportFormClient } from '@/components/report-form';
import { getSettings, localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';
import { getClientsTree } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const s = await getSettings();
  const locale = localeOf(s);
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

  const tree = await getClientsTree();
  const clients: ReportFormClient[] = tree.map((c) => ({
    id: c.id,
    name: c.name,
    projects: c.projects.map((p) => ({ id: p.id, name: p.name })),
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/invoices" className="text-xs text-slate-500 hover:underline">
          ← {t(locale, 'invoices')}
        </Link>
        <h1 className="text-2xl font-semibold">{t(locale, 'newInvoice')}</h1>
      </div>
      <InvoiceForm clients={clients} locale={locale} preselect={{ clientId: one(sp.clientId), projectId: one(sp.projectId) }} />
    </div>
  );
}
