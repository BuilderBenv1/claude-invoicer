import { and, eq, isNull, sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import {
  applyFolderCutoffs,
  intervalsForClient,
  buildInvoiceLines,
  adjustmentLine,
  round2,
  weekRange,
  weekStartKey,
  computeTotals,
  dueDateFrom,
  resolvePaymentAccount,
  renderPaymentBlock,
  formatDocNumber,
  canBePaid,
  type ActivityInterval as CoreInterval,
  type FolderMapping as CoreMapping,
  type RoundMode,
  type DocType,
} from '@claude-invoicer/core';
import { getDb, schema } from './db';
import {
  activityIntervals,
  clients,
  folderMappings,
  invoiceLines,
  invoices,
  oneOffCharges,
  paymentAccounts,
  receipts,
  settings,
  weekAdjustments,
  type Client,
  type Invoice,
  type Settings,
} from './db/schema';
import { getSettings } from './settings';
import { getInvoiceDetail } from './queries';
import { sendInvoiceEmail, sendReceiptEmail } from './email';
import { newId, newToken } from './format';

type Db = NeonDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

interface NewLine {
  label: string;
  hours: number;
  ratePerHour: number;
  amount: number;
}
interface InsertInvoiceArgs {
  client: Client;
  settings: Settings;
  lines: NewLine[];
  subtotal: number;
  prevBilledThroughMs: number;
  cutoffMs: number;
  notes: string;
  /** Custom number override; when absent, the next auto sequence is used. */
  number?: string;
  issuedAt?: Date;
  /** Defaults to 'invoice'. Quotes and pro formas use their own sequences. */
  docType?: DocType;
  /** Set when this invoice was converted from a quote or pro forma. */
  convertedFromId?: string;
  /**
   * Defaults to `client.currency`. Pass explicitly on a conversion so the
   * new invoice honours the currency the source was quoted in, even if the
   * client's own currency has since changed.
   */
  currency?: string;
}

/** Insert an invoice + its lines, assign number & public token, snapshot identity. */
export async function insertInvoice(
  tx: Tx,
  a: InsertInvoiceArgs,
): Promise<{ id: string; number: string; token: string }> {
  const docType: DocType = a.docType ?? 'invoice';
  const id = newId();
  const token = newToken();
  let number = a.number ?? '';
  if (!number) {
    // Each type has its own sequence, so a quote never consumes an invoice
    // number and the invoice run stays unbroken for the accounts. The three
    // branches are written out rather than computed, so Drizzle can type the
    // column reference in both the `set` and the `returning`.
    let seq: number;
    let prefix: string;
    if (docType === 'quote') {
      const [row] = await tx
        .update(settings)
        .set({ quoteSeq: sql`${settings.quoteSeq} + 1` })
        .where(eq(settings.id, 1))
        .returning({ seq: settings.quoteSeq });
      if (!row) throw new Error('Settings not initialized');
      seq = row.seq;
      prefix = a.settings.quotePrefix;
    } else if (docType === 'proforma') {
      const [row] = await tx
        .update(settings)
        .set({ proformaSeq: sql`${settings.proformaSeq} + 1` })
        .where(eq(settings.id, 1))
        .returning({ seq: settings.proformaSeq });
      if (!row) throw new Error('Settings not initialized');
      seq = row.seq;
      prefix = a.settings.proformaPrefix;
    } else {
      const [row] = await tx
        .update(settings)
        .set({ invoiceSeq: sql`${settings.invoiceSeq} + 1` })
        .where(eq(settings.id, 1))
        .returning({ seq: settings.invoiceSeq });
      if (!row) throw new Error('Settings not initialized');
      seq = row.seq;
      prefix = a.settings.invoicePrefix;
    }
    number = formatDocNumber(prefix, seq);
  }

  const totals = computeTotals(a.subtotal, a.settings.vatRate);
  const issuedAt = a.issuedAt ?? new Date();
  const termsDays = a.settings.paymentTermsDays;
  // Spec B4: a quote is not a request for payment and stores no due date —
  // storing one would plant a landmine for an overdue-totals query that
  // filters on `dueAt < now`.
  const dueAt = docType === 'quote' ? null : dueDateFrom(issuedAt, termsDays, a.settings.timezone);
  // Defaults to the client's own currency; a conversion passes the source's
  // currency instead, since the source is the record of what was quoted.
  const currency = a.currency ?? a.client.currency;

  const accounts = await tx.select().from(paymentAccounts);
  const paymentDetails = renderPaymentBlock(
    resolvePaymentAccount(accounts, currency),
    number,
  );

  await tx.insert(invoices).values({
    id,
    number,
    clientId: a.client.id,
    status: 'unpaid',
    currency,
    subtotal: totals.subtotal,
    taxRate: totals.taxRate,
    taxAmount: totals.taxAmount,
    total: totals.total,
    paymentTermsDays: termsDays,
    dueAt,
    paymentDetails: paymentDetails || null,
    prevBilledThroughMs: a.prevBilledThroughMs,
    cutoffMs: a.cutoffMs,
    notes: a.notes,
    publicToken: token,
    businessName: a.settings.businessName,
    businessEmail: a.settings.businessEmail,
    businessAddress: a.settings.businessAddress,
    taxId: a.settings.taxId,
    vatNumber: a.settings.vatNumber,
    clientName: a.client.name,
    clientEmail: a.client.email,
    clientAddress: a.client.address,
    issuedAt,
    docType,
    convertedFromId: a.convertedFromId ?? null,
  });
  await tx.insert(invoiceLines).values(a.lines.map((l) => ({ invoiceId: id, ...l })));
  return { id, number, token };
}

export type IssueResult =
  | { ok: true; id: string; number: string }
  | { ok: false; reason: 'already-invoiced' | 'nothing' | 'week-not-finished' | 'client-archived'; number?: string };

type PgUniqueError = {
  code?: string;
  constraint?: string;
  constraint_name?: string;
  message?: string;
  cause?: { code?: string; constraint?: string; constraint_name?: string; message?: string };
};

/**
 * True only for the unique-violation that actually means "this week is
 * already invoiced" — `invoices_client_week_unique`. A bare `code === '23505'`
 * check used to be safe here because that was the only unique constraint on
 * the table; now `invoices_number_unique` and `invoices_converted_from_unique`
 * share the same Postgres error code, and neither means "already invoiced".
 * Falls back to matching the constraint name in the error message when the
 * driver doesn't surface a structured `constraint`/`constraint_name` field.
 */
function isDuplicateWeekError(e: unknown): boolean {
  const err = e as PgUniqueError;
  const code = err?.code ?? err?.cause?.code;
  if (code !== '23505') return false;
  const constraint = err?.constraint ?? err?.constraint_name ?? err?.cause?.constraint ?? err?.cause?.constraint_name;
  if (constraint) return constraint === 'invoices_client_week_unique';
  const message = err?.message ?? err?.cause?.message ?? '';
  return message.includes('invoices_client_week_unique');
}

/** Issue one client's week invoice (respecting the saved adjustment + one-offs). */
export async function issueWeekInvoice(
  clientId: string,
  weekStart: string,
  opts: { includeOneOffs: boolean },
): Promise<IssueResult> {
  const db = getDb();
  try {
    return await db.transaction(async (tx): Promise<IssueResult> => {
    const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
    if (!s) throw new Error('Settings not initialized');
    const [client] = await tx.select().from(clients).where(eq(clients.id, clientId));
    if (!client) throw new Error('Client not found');
    if (client.archived) return { ok: false, reason: 'client-archived' };

    const { startMs, endMs } = weekRange(weekStart, s.timezone);

    if (endMs > Date.now()) return { ok: false, reason: 'week-not-finished' };

    const existing = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.clientId, clientId),
          eq(invoices.prevBilledThroughMs, startMs),
          eq(invoices.docType, 'invoice'),
        ),
      );
    if (existing[0]) return { ok: false, reason: 'already-invoiced', number: existing[0].number };

    const rawMappings = await tx.select().from(folderMappings);
    const coreMappings: CoreMapping[] = rawMappings.map((m) => ({
      clientId: m.clientId,
      path: m.path,
      label: m.label ?? undefined,
      ratePerHour: m.hourlyRate ?? undefined,
      billFromMs: m.billFromMs || undefined,
    }));
    const rawIntervals = await tx.select().from(activityIntervals);
    const intervals: CoreInterval[] = rawIntervals.map((r) => ({
      sessionId: r.sessionId,
      cwd: r.cwd,
      startMs: r.startMs,
      endMs: r.endMs,
      activeMs: r.activeMs,
    }));

    const ci = applyFolderCutoffs(intervalsForClient(intervals, clientId, coreMappings), coreMappings);
    const roundIncrementMin = client.roundIncrementMin ?? s.defaultRoundIncrementMin;
    const timeLines = buildInvoiceLines(ci, {
      ratePerHour: client.hourlyRate,
      roundIncrementMin,
      roundMode: s.roundMode as RoundMode,
      billedThroughMs: startMs,
      cutoffMs: endMs,
      groupBy: 'project',
      mappings: coreMappings,
      timeZone: s.timezone,
    });

    const [adj] = await tx
      .select()
      .from(weekAdjustments)
      .where(and(eq(weekAdjustments.clientId, clientId), eq(weekAdjustments.weekStartMs, startMs)));
    const adjLine = adjustmentLine(adj?.adjustHours ?? 0, client.hourlyRate);

    const charges = opts.includeOneOffs
      ? await tx
          .select()
          .from(oneOffCharges)
          .where(and(eq(oneOffCharges.clientId, clientId), isNull(oneOffCharges.billedInvoiceId)))
      : [];

    if (timeLines.length === 0 && charges.length === 0 && !adjLine) return { ok: false, reason: 'nothing' };

    const lines: NewLine[] = [
      ...timeLines.map((l) => ({ label: l.label, hours: l.hours, ratePerHour: l.ratePerHour, amount: l.amount })),
      ...(adjLine ? [{ label: adjLine.label, hours: adjLine.hours, ratePerHour: adjLine.ratePerHour, amount: adjLine.amount }] : []),
      ...charges.map((c) => ({ label: c.description, hours: 0, ratePerHour: 0, amount: c.amount })),
    ];
    const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
    if (subtotal < 0) throw new Error('Adjustment makes the invoice total negative — reduce the adjustment.');

    const { id, number } = await insertInvoice(tx, {
      client,
      settings: s,
      lines,
      subtotal,
      prevBilledThroughMs: startMs,
      cutoffMs: endMs,
      notes: `Week of ${weekStart}`,
    });
    for (const c of charges) {
      await tx.update(oneOffCharges).set({ billedInvoiceId: id }).where(eq(oneOffCharges.id, c.id));
    }
    return { ok: true, id, number };
    });
  } catch (e) {
    if (isDuplicateWeekError(e)) return { ok: false, reason: 'already-invoiced' };
    throw e;
  }
}

/** Mark an invoice paid + issue a receipt inside a transaction. Returns receipt number (null if already paid). */
export async function markPaidTx(tx: Tx, invoiceId: string, paidAt: Date = new Date()): Promise<string | null> {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw new Error('Invoice not found');
  if (!canBePaid(inv.docType)) {
    throw new Error('Only an invoice can be marked paid. Convert this document to an invoice first.');
  }
  if (inv.status === 'paid') return null;
  const [row] = await tx
    .update(settings)
    .set({ receiptSeq: sql`${settings.receiptSeq} + 1` })
    .where(eq(settings.id, 1))
    .returning({ seq: settings.receiptSeq });
  const number = formatDocNumber('RCPT', row?.seq ?? 1);
  await tx.update(invoices).set({ status: 'paid', paidAt }).where(eq(invoices.id, invoiceId));
  await tx.insert(receipts).values({ id: newId(), invoiceId, number });
  return number;
}

/** Mark paid + issue receipt in its own transaction, tolerant of a concurrent
 *  duplicate (a unique-violation on receipts → returns null, no second receipt). */
export async function markPaidAndReceipt(invoiceId: string, paidAt?: Date): Promise<string | null> {
  const db = getDb();
  try {
    return await db.transaction((tx) => markPaidTx(tx, invoiceId, paidAt));
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } })?.code
      ?? (e as { cause?: { code?: string } })?.cause?.code;
    if (code === '23505') return null;
    throw e;
  }
}

/** Lazily assign a public token to an invoice that predates the feature. */
export async function ensurePublicToken(inv: Invoice): Promise<string> {
  if (inv.publicToken) return inv.publicToken;
  const token = newToken();
  await getDb().update(invoices).set({ publicToken: token }).where(eq(invoices.id, inv.id));
  return token;
}

/** Best-effort: email an invoice. Returns {sent:false} when no recipient is known. */
export async function emailInvoiceById(
  invoiceId: string,
  toOverride?: string,
): Promise<{ sent: boolean; to?: string }> {
  const detail = await getInvoiceDetail(invoiceId);
  if (!detail) return { sent: false };
  const token = await ensurePublicToken(detail.invoice);
  detail.invoice.publicToken = token;
  const to = (toOverride || detail.invoice.clientEmail || '').trim();
  if (!to) return { sent: false };
  await sendInvoiceEmail(detail, to);
  await getDb().update(invoices).set({ emailedAt: new Date(), emailedTo: to }).where(eq(invoices.id, invoiceId));
  return { sent: true, to };
}

/** Best-effort: email a receipt for an already-paid invoice. */
export async function emailReceiptById(invoiceId: string): Promise<boolean> {
  const detail = await getInvoiceDetail(invoiceId);
  if (!detail || detail.invoice.status !== 'paid') return false;
  const to = (detail.invoice.emailedTo || detail.invoice.clientEmail || '').trim();
  if (!to) return false;
  await sendReceiptEmail(detail, to);
  return true;
}

export interface CronSummary {
  enabled: boolean;
  week?: string;
  issued: { client: string; number: string }[];
  skipped: { client: string; reason: string }[];
  errors: { client: string; error: string }[];
}

/** Cron entrypoint: auto-issue + email the previous completed week for every eligible client. */
export async function runWeeklyAutoSend(): Promise<CronSummary> {
  const s = await getSettings();
  if (!s.autoSendWeekly) return { enabled: false, issued: [], skipped: [], errors: [] };
  const db = getDb();
  const currentStart = weekRange(weekStartKey(Date.now(), s.timezone), s.timezone).startMs;
  const prevWeekKey = weekStartKey(currentStart - 1, s.timezone);
  const activeClients = await db.select().from(clients).where(eq(clients.archived, 0));

  const out: CronSummary = { enabled: true, week: prevWeekKey, issued: [], skipped: [], errors: [] };
  for (const c of activeClients) {
    try {
      if (!c.email) {
        out.skipped.push({ client: c.name, reason: 'no email on file' });
        continue;
      }
      const res = await issueWeekInvoice(c.id, prevWeekKey, { includeOneOffs: true });
      if (!res.ok) {
        out.skipped.push({ client: c.name, reason: res.reason });
        continue;
      }
      await emailInvoiceById(res.id);
      out.issued.push({ client: c.name, number: res.number });
    } catch (e) {
      out.errors.push({ client: c.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
