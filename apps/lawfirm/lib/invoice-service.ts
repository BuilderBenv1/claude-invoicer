import { desc, eq, sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { getDb, schema } from './db';
import { clients, invoiceLines, invoices, projects, settings, type Client, type Invoice, type InvoiceLine, type Project, type Settings } from './db/schema';
import { getSettings } from './settings';
import { buildReport, effectiveRate } from './queries';
import { newId, round2 } from './util';

type Tx = NeonDatabase<typeof schema>;

export interface NewLine {
  label: string;
  hours: number;
  ratePerHour: number;
  amount: number;
}

/** Atomically bump and format the next invoice number, e.g. "2026-0007". */
export async function nextInvoiceNumber(tx: Tx): Promise<string> {
  const [row] = await tx
    .update(settings)
    .set({ invoiceSeq: sql`${settings.invoiceSeq} + 1` })
    .where(eq(settings.id, 1))
    .returning({ seq: settings.invoiceSeq });
  const seq = row?.seq ?? 1;
  const year = new Date().getFullYear();
  return `${year}-${String(seq).padStart(4, '0')}`;
}

/** Insert an invoice (with its lines), snapshotting firm/client/case identity. */
export async function insertInvoice(
  tx: Tx,
  args: { client: Client; project?: Project | null; settings: Settings; lines: NewLine[]; subtotal: number; notes?: string | null },
): Promise<{ id: string; number: string }> {
  const id = newId();
  const number = await nextInvoiceNumber(tx);
  const s = args.settings;
  const p = args.project ?? null;
  await tx.insert(invoices).values({
    id,
    number,
    clientId: args.client.id,
    projectId: p?.id ?? null,
    status: 'unpaid',
    currency: args.client.currency,
    subtotal: args.subtotal,
    notes: args.notes ?? null,
    firmName: s.firmName,
    firmEmail: s.firmEmail,
    firmAddress: s.firmAddress,
    firmPhone: s.firmPhone,
    taxId: s.taxId,
    logoUrl: s.logoUrl,
    clientName: args.client.name,
    clientEmail: args.client.email,
    clientAddress: args.client.address,
    caseNumber: p?.caseNumber ?? null,
    caseName: p?.name ?? null,
  });
  if (args.lines.length > 0) {
    await tx.insert(invoiceLines).values(args.lines.map((l) => ({ invoiceId: id, ...l })));
  }
  return { id, number };
}

export interface InvoiceDetail {
  invoice: Invoice;
  lines: InvoiceLine[];
  settings: Settings;
}

export async function getInvoiceDetail(id: string): Promise<InvoiceDetail | null> {
  const db = getDb();
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!invoice) return null;
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(invoiceLines.id);
  const s = await getSettings();
  return { invoice, lines, settings: s };
}

/**
 * Turn tracked billable hours for a client (optionally one case) in a window
 * into invoice lines — one line per task, at the case/client rate.
 */
export async function buildHoursLines(opts: {
  clientId: string;
  projectId?: string | null;
  fromMs: number;
  toMs: number;
}): Promise<NewLine[]> {
  const report = await buildReport(opts);
  if (!report) return [];
  return report.byTask
    .filter((b) => b.billable > 0)
    .map((b) => ({
      label: b.label === '—' ? (report.project?.name ?? 'שעות עבודה') : b.label,
      hours: b.billable,
      ratePerHour: report.rate,
      amount: round2(b.billable * report.rate),
    }));
}

export async function markInvoicePaid(id: string, paidAt: Date = new Date()): Promise<void> {
  const db = getDb();
  await db.update(invoices).set({ status: 'paid', paidAt }).where(eq(invoices.id, id));
}

export async function markInvoiceUnpaid(id: string): Promise<void> {
  const db = getDb();
  await db.update(invoices).set({ status: 'unpaid', paidAt: null }).where(eq(invoices.id, id));
}

export async function deleteInvoice(id: string): Promise<void> {
  const db = getDb();
  await db.delete(invoices).where(eq(invoices.id, id));
}

export async function listInvoices(limit = 100): Promise<Invoice[]> {
  const db = getDb();
  return db.select().from(invoices).orderBy(desc(invoices.issuedAt)).limit(limit);
}

export { effectiveRate };
