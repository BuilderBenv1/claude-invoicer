import { and, eq, isNull, max, sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import {
  applyFolderCutoffs,
  excludeBriefBilledFolders,
  intervalsForClient,
  matchMapping,
  apportionHours,
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
import { getDb, schema, type DbOrTx } from './db';
import {
  activityIntervals,
  briefs,
  clients,
  folderMappings,
  milestones,
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
import { getInvoiceDetail, loadCoreMappings } from './queries';
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

    const coreMappings = await loadCoreMappings(tx);
    const rawIntervals = await tx.select().from(activityIntervals);
    const intervals: CoreInterval[] = rawIntervals.map((r) => ({
      sessionId: r.sessionId,
      cwd: r.cwd,
      startMs: r.startMs,
      endMs: r.endMs,
      activeMs: r.activeMs,
    }));

    const ci = excludeBriefBilledFolders(
      applyFolderCutoffs(intervalsForClient(intervals, clientId, coreMappings), coreMappings),
      coreMappings,
    );
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

type MilestoneRow = typeof milestones.$inferSelect;
type LineBuild =
  | { ok: true; lines: NewLine[] }
  | { ok: false; reason: 'no-amount' | 'nothing-to-bill' };

/**
 * Work out the invoice lines for a set of delivered milestones.
 *
 * Shared verbatim by the real issue path and by the preview, so what the
 * preview shows is what actually fires. A preview computed by a second,
 * lookalike code path is worse than no preview: it agrees right up until the
 * day it quietly doesn't.
 *
 * Read-only — the caller decides what to write.
 */
async function buildMilestoneLines(
  exec: DbOrTx,
  brief: typeof briefs.$inferSelect,
  client: Client,
  s: Settings,
  due: MilestoneRow[],
  cutoffMs: number,
): Promise<LineBuild> {
  if (brief.billingMode === 'fixed') {
    const priced = due.filter((m) => m.amount > 0);
    if (priced.length === 0) return { ok: false, reason: 'no-amount' };
    return {
      ok: true,
      lines: priced.map((m) => ({
        label: m.title,
        hours: 0,
        ratePerHour: 0,
        amount: round2(m.amount),
      })),
    };
  }

  const [prevRow] = await exec
    .select({ prev: max(milestones.billedThroughMs) })
    .from(milestones)
    .where(eq(milestones.briefId, brief.id));
  const windowStart = Number(prevRow?.prev ?? 0);

  const folderPath = brief.folderMappingId
    ? (await exec.select().from(folderMappings).where(eq(folderMappings.id, brief.folderMappingId)))[0]?.path
    : undefined;
  if (!folderPath) return { ok: false, reason: 'nothing-to-bill' };

  const coreMappings = await loadCoreMappings(exec);
  const rawIntervals = await exec.select().from(activityIntervals);
  const all: CoreInterval[] = rawIntervals.map((r) => ({
    sessionId: r.sessionId,
    cwd: r.cwd,
    startMs: r.startMs,
    endMs: r.endMs,
    activeMs: r.activeMs,
  }));
  // Scope to this brief's folder. Cutoffs still apply; the brief-billed
  // exclusion deliberately does NOT — that filter exists to keep these hours
  // off the weekly invoice, and this is the invoice they were kept for.
  const scoped = applyFolderCutoffs(
    all.filter((it) => matchMapping(it.cwd, coreMappings)?.path === folderPath),
    coreMappings,
  );
  const rate = brief.ratePerHour || client.hourlyRate;
  const timeLines = buildInvoiceLines(scoped, {
    ratePerHour: rate,
    roundIncrementMin: client.roundIncrementMin ?? s.defaultRoundIncrementMin,
    roundMode: s.roundMode as RoundMode,
    billedThroughMs: windowStart,
    cutoffMs,
    groupBy: 'total',
    mappings: coreMappings,
    timeZone: s.timezone,
  });
  const totalHours = round2(timeLines.reduce((sum, l) => sum + l.hours, 0));
  if (totalHours <= 0) return { ok: false, reason: 'nothing-to-bill' };

  // The tracked hours are one pool for the folder — nothing records which hour
  // went to which milestone. Split them across the delivered milestones in
  // proportion to their estimates so the invoice reads as the work delivered,
  // while the total stays exactly the time worked.
  const weights = due.map((m) => (m.estimateHoursLow + m.estimateHoursHigh) / 2);
  const split = apportionHours(totalHours, weights);
  const lines: NewLine[] = due.map((m, i) => ({
    label: m.title,
    hours: split[i]!,
    ratePerHour: rate,
    amount: round2(split[i]! * rate),
  }));

  // Apportioning hours then pricing each line can drift a penny from pricing
  // the total once. The client is billed the total, so the difference is
  // absorbed on the largest line rather than left to make the invoice not add up.
  const target = round2(totalHours * rate);
  const drift = round2(target - lines.reduce((sum, l) => sum + l.amount, 0));
  if (drift !== 0 && lines.length > 0) {
    let biggest = 0;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]!.amount > lines[biggest]!.amount) biggest = i;
    }
    lines[biggest]!.amount = round2(lines[biggest]!.amount + drift);
  }
  return { ok: true, lines };
}

export type MilestoneIssueResult =
  | { ok: true; id: string; number: string }
  | {
      ok: false;
      reason:
        | 'already-invoiced'
        | 'nothing-to-bill'
        | 'no-amount'
        | 'not-ready'
        | 'brief-missing'
        | 'client-archived';
    };

/** True only for a duplicate on invoices_milestone_unique. */
function isDuplicateMilestoneError(e: unknown): boolean {
  const err = e as PgUniqueError;
  const code = err?.code ?? err?.cause?.code;
  if (code !== '23505') return false;
  const constraint =
    err?.constraint ?? err?.constraint_name ?? err?.cause?.constraint ?? err?.cause?.constraint_name;
  if (constraint) return constraint === 'invoices_milestone_unique';
  const message = err?.message ?? err?.cause?.message ?? '';
  return message.includes('invoices_milestone_unique');
}

/**
 * Bill one milestone. Fixed-price briefs invoice the agreed amount as a single
 * line. Time & materials briefs invoice the hours actually tracked against the
 * brief's folder since the brief last billed — NOT the estimate.
 *
 * The window opens at the greatest billed_through_ms across the brief's
 * milestones, which is the cutoff of the most recent milestone invoice. Reading
 * this milestone's own row instead would reopen the window at 0 for every
 * milestone after the first and re-bill everything already billed.
 */
export async function issueMilestoneInvoice(milestoneId: string): Promise<MilestoneIssueResult> {
  const db = getDb();
  const [m] = await db.select({ briefId: milestones.briefId }).from(milestones).where(eq(milestones.id, milestoneId));
  if (!m) return { ok: false, reason: 'brief-missing' };
  return issueBriefMilestones(m.briefId, [milestoneId]);
}

/**
 * Bill a brief's delivered milestones as ONE invoice with a line each.
 *
 * Batching is not presentation — on a time & materials brief it is the only
 * correct behaviour. The billing window runs from when the brief last billed to
 * now, so issuing milestones one at a time gives the whole window to whichever
 * went first and leaves the rest with nothing to bill. Delivering four
 * milestones in an afternoon has to produce one invoice for the afternoon's
 * work, not four invoices of which three are empty.
 *
 * Pass `only` to bill a subset; omit it to bill every milestone currently
 * 'ready' on the brief. Milestones already invoiced are skipped, so the next
 * run naturally picks up just the newly delivered ones.
 */
export async function issueBriefMilestones(
  briefId: string,
  only?: string[],
): Promise<MilestoneIssueResult> {
  const db = getDb();
  try {
    return await db.transaction(async (tx): Promise<MilestoneIssueResult> => {
      // Lock every candidate row up front. A concurrent sweep blocks here, then
      // sees the rows are no longer 'ready' and bails — which is what prevents
      // a double issue now that one invoice can cover many milestones and the
      // per-milestone unique index no longer applies.
      const locked = await tx
        .select()
        .from(milestones)
        .where(eq(milestones.briefId, briefId))
        .orderBy(milestones.idx)
        .for('update');

      const due = locked.filter(
        (m) => m.status === 'ready' && (!only || only.includes(m.id)),
      );
      if (due.length === 0) {
        // Distinguish "already handled" from "never marked delivered" so the
        // caller can stay quiet about the former.
        const anyTerminal = locked.some(
          (m) => (!only || only.includes(m.id)) && (m.status === 'invoiced' || m.status === 'complete'),
        );
        return { ok: false, reason: anyTerminal ? 'already-invoiced' : 'not-ready' };
      }

      const [brief] = await tx.select().from(briefs).where(eq(briefs.id, briefId));
      if (!brief) return { ok: false, reason: 'brief-missing' };
      const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
      if (!s) throw new Error('Settings not initialized');
      const [client] = await tx.select().from(clients).where(eq(clients.id, brief.clientId));
      if (!client) return { ok: false, reason: 'brief-missing' };
      if (client.archived) return { ok: false, reason: 'client-archived' };

      const cutoffMs = Date.now();
      const built = await buildMilestoneLines(tx, brief, client, s, due, cutoffMs);
      if (!built.ok) {
        if (built.reason === 'nothing-to-bill') {
          // Nothing tracked since the brief last billed. The work is still
          // delivered — make these terminal rather than have every sweep retry
          // them forever. Only the issue path writes this; a preview must not.
          for (const m of due) {
            await tx
              .update(milestones)
              .set({ status: 'complete', invoicedAt: new Date(), billedThroughMs: cutoffMs })
              .where(eq(milestones.id, m.id));
          }
        }
        return { ok: false, reason: built.reason };
      }
      const lines = built.lines;

      /**
       * A milestone invoice is never a week invoice, so it stays out of the
       * week namespace entirely — the same -1 convention manual documents use.
       *
       * This is not cosmetic. `invoices_client_week_unique` is a PARTIAL index
       * over (client_id, prev_billed_through_ms) WHERE prev_billed_through_ms
       * >= 0, so storing a real window start would make two briefs' first
       * milestones collide on (client, 0). Worse, core's `billedWeekStarts`
       * adds prev_billed_through_ms for every billing-evidence row with no
       * >= 0 filter, so a window start that ever coincided with a week
       * boundary would mark that week billed and it would never be invoiced.
       * The real window lives on the milestone rows (billed_through_ms), which
       * is what issueMilestoneInvoice actually reads.
       */
      const prevBilledThroughMs = -1;

      const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
      const { id, number } = await insertInvoice(tx, {
        client,
        settings: s,
        lines,
        subtotal,
        prevBilledThroughMs,
        cutoffMs,
        notes:
          due.length === 1
            ? `${brief.title} · ${due[0]!.title}`
            : `${brief.title} · ${due.length} milestones delivered`,
        currency: brief.currency,
      });
      // milestone_id carries the link only when the invoice covers exactly one,
      // so the partial unique index still guards that case. A batch is linked
      // the other way round — each milestone points at the invoice — which is
      // the direction that works for any number.
      await tx
        .update(invoices)
        .set({ briefId: brief.id, milestoneId: due.length === 1 ? due[0]!.id : null })
        .where(eq(invoices.id, id));
      const invoicedAt = new Date();
      for (const m of due) {
        await tx
          .update(milestones)
          .set({ status: 'invoiced', invoicedAt, invoiceId: id, billedThroughMs: cutoffMs })
          .where(eq(milestones.id, m.id));
      }
      return { ok: true, id, number };
    });
  } catch (e) {
    if (isDuplicateMilestoneError(e)) return { ok: false, reason: 'already-invoiced' };
    throw e;
  }
}

export interface MilestoneInvoicePreview {
  lines: NewLine[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  currency: string;
  /** Total billable hours across the lines; 0 on a fixed-price brief. */
  hours: number;
  /** Set when there is nothing to bill, explaining why. */
  reason?: 'no-amount' | 'nothing-to-bill' | 'not-ready' | 'brief-missing' | 'client-archived';
}

/**
 * Exactly what the next milestone invoice for this brief would contain, without
 * issuing it. Runs the same line builder the issue path runs, so the figures
 * shown are the figures that will fire.
 *
 * Time keeps accruing, so on a T&M brief the hours shown are as-of-now and will
 * be slightly higher by the time it actually issues. That is inherent to
 * billing real tracked time, not an inaccuracy in the preview.
 */
export async function previewBriefMilestones(
  briefId: string,
): Promise<MilestoneInvoicePreview | null> {
  const db = getDb();
  const [brief] = await db.select().from(briefs).where(eq(briefs.id, briefId));
  if (!brief) return null;
  const due = (
    await db.select().from(milestones).where(eq(milestones.briefId, briefId)).orderBy(milestones.idx)
  ).filter((m) => m.status === 'ready');
  if (due.length === 0) return null;

  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!s) return null;
  const [client] = await db.select().from(clients).where(eq(clients.id, brief.clientId));
  const empty = {
    lines: [],
    subtotal: 0,
    taxRate: 0,
    taxAmount: 0,
    total: 0,
    currency: brief.currency,
    hours: 0,
  };
  if (!client) return { ...empty, reason: 'brief-missing' };
  if (client.archived) return { ...empty, reason: 'client-archived' };

  const built = await buildMilestoneLines(db, brief, client, s, due, Date.now());
  if (!built.ok) return { ...empty, reason: built.reason };

  const subtotal = round2(built.lines.reduce((sum, l) => sum + l.amount, 0));
  const totals = computeTotals(subtotal, s.vatRate);
  return {
    lines: built.lines,
    subtotal: totals.subtotal,
    taxRate: totals.taxRate,
    taxAmount: totals.taxAmount,
    total: totals.total,
    currency: brief.currency,
    hours: round2(built.lines.reduce((sum, l) => sum + l.hours, 0)),
  };
}

/**
 * Issue every milestone whose hold window has expired, on a brief with
 * auto_invoice on. Runs after each agent sync and from the daily cron, so a
 * tick still bills within a day even when the local agent is off.
 *
 * Email is best-effort by design: RESEND_API_KEY is frequently unset, and an
 * unsent email must never roll back or hide an invoice that was issued.
 */
export async function runMilestoneDueSweep(): Promise<{ issued: number; failed: number }> {
  const db = getDb();
  const now = new Date();
  const due = await db
    .select({ id: milestones.id, briefId: milestones.briefId })
    .from(milestones)
    .innerJoin(briefs, eq(milestones.briefId, briefs.id))
    .where(
      and(
        eq(milestones.status, 'ready'),
        eq(briefs.autoInvoice, 1),
        eq(briefs.status, 'active'),
        sql`${milestones.readyAt} + make_interval(mins => ${briefs.holdMinutes}) <= ${now}`,
      ),
    );

  // Group by brief so a batch of milestones delivered together becomes ONE
  // invoice with a line each. Issuing per milestone would send the client a
  // stack of invoices for a single afternoon's work — and on a T&M brief the
  // first would swallow the whole billing window and the rest would bill zero.
  const byBrief = new Map<string, string[]>();
  for (const row of due) {
    const list = byBrief.get(row.briefId);
    if (list) list.push(row.id);
    else byBrief.set(row.briefId, [row.id]);
  }

  let issued = 0;
  let failed = 0;
  for (const [briefId, ids] of byBrief) {
    try {
      const res = await issueBriefMilestones(briefId, ids);
      if (!res.ok) continue;
      issued++;
      try {
        await emailInvoiceById(res.id);
      } catch (e) {
        console.warn(`milestone invoice ${res.number} issued but not emailed:`, e);
      }
    } catch (e) {
      failed++;
      console.error(`brief ${briefId} failed to issue milestones:`, e);
    }
  }
  return { issued, failed };
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
