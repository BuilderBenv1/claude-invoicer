import { and, desc, eq } from 'drizzle-orm';
import {
  aggregateIntervals,
  adjustmentLine,
  buildInvoiceLines,
  intervalsForClient,
  invoiceSubtotal,
  normalizePath,
  round2,
  unassignedFolders,
  weekStartKey,
  weekRange,
  activeWithin,
  applyFolderCutoffs,
  matchMapping,
  basename,
  weekProjectDayGrid,
  type ActivityInterval as CoreInterval,
  type FolderMapping as CoreMapping,
  type WeekProjectDayGrid,
  type RoundMode,
} from '@claude-invoicer/core';
import { getDb } from './db';
import {
  activityIntervals,
  clients,
  folderMappings,
  invoiceLines,
  invoices,
  oneOffCharges,
  receipts,
  weekAdjustments,
  type Client,
  type Invoice,
  type InvoiceLine,
  type OneOffCharge,
  type Settings,
  type WeekAdjustment,
} from './db/schema';
import { getSettings } from './settings';

function toCoreInterval(r: typeof activityIntervals.$inferSelect): CoreInterval {
  return { sessionId: r.sessionId, cwd: r.cwd, startMs: r.startMs, endMs: r.endMs, activeMs: r.activeMs };
}
function toCoreMapping(m: typeof folderMappings.$inferSelect): CoreMapping {
  return {
    clientId: m.clientId,
    path: m.path,
    label: m.label ?? undefined,
    ratePerHour: m.hourlyRate ?? undefined,
    billFromMs: m.billFromMs || undefined,
  };
}

/** Recompute a per-project/per-day hours grid for a WEEK invoice; null for manual/one-off (window = -1). */
async function invoiceDayGrid(inv: Invoice, s: Settings): Promise<WeekProjectDayGrid | null> {
  if (inv.prevBilledThroughMs < 0) return null;
  const db = getDb();
  const [rawIntervals, rawMappings] = await Promise.all([
    db.select().from(activityIntervals),
    db.select().from(folderMappings),
  ]);
  const coreMappings = rawMappings.map(toCoreMapping);
  const ci = applyFolderCutoffs(
    intervalsForClient(rawIntervals.map(toCoreInterval), inv.clientId, coreMappings),
    coreMappings,
  );
  const weekKey = weekStartKey(inv.prevBilledThroughMs, s.timezone);
  return weekProjectDayGrid(ci, weekKey, s.timezone, coreMappings);
}

async function loadAll() {
  const db = getDb();
  const [rawIntervals, rawMappings, clientRows, oneOffs, invoiceRows, adjRows, s] = await Promise.all([
    db.select().from(activityIntervals),
    db.select().from(folderMappings),
    db.select().from(clients).where(eq(clients.archived, 0)),
    db.select().from(oneOffCharges),
    db.select().from(invoices),
    db.select().from(weekAdjustments),
    getSettings(),
  ]);
  return {
    intervals: rawIntervals.map(toCoreInterval),
    mappings: rawMappings,
    coreMappings: rawMappings.map(toCoreMapping),
    clientRows,
    oneOffs,
    invoiceRows,
    adjRows,
    settings: s,
  };
}

/**
 * Set of already-invoiced week-start ms for a client. A week invoice records its
 * window start in `prevBilledThroughMs`, so a week is "billed" if any invoice for
 * that client starts at that week's start.
 */
function billedWeekStarts(invoiceRows: Invoice[], clientId: string): Set<number> {
  const set = new Set<number>();
  for (const inv of invoiceRows) {
    if (inv.clientId === clientId) set.add(inv.prevBilledThroughMs);
  }
  return set;
}

/** Per-week signed hours adjustment for a client, keyed by week-start ms. */
function adjustmentsFor(rows: WeekAdjustment[], clientId: string): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of rows) if (r.clientId === clientId) m.set(r.weekStartMs, r.adjustHours);
  return m;
}

/** Unbilled one-off charges for a client. */
function unbilledOneOffs(oneOffs: OneOffCharge[], clientId: string): OneOffCharge[] {
  return oneOffs.filter((o) => o.clientId === clientId && !o.billedInvoiceId);
}
function sumAmounts(items: { amount: number }[]): number {
  return Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
}

export interface BillableWeek {
  /** Monday key "YYYY-MM-DD". */
  weekKey: string;
  startMs: number;
  endMs: number;
  activeMs: number;
  amount: number;
  adjustHours: number;
  billed: boolean;
  isCurrent: boolean;
}

/**
 * Build the per-week billable breakdown for one client (newest first).
 * `ci` must already have per-folder cutoffs applied (via applyFolderCutoffs).
 */
function clientWeeks(
  ci: CoreInterval[],
  client: Client,
  coreMappings: CoreMapping[],
  billed: Set<number>,
  adj: Map<number, number>,
  s: Settings,
): BillableWeek[] {
  const roundIncrementMin = client.roundIncrementMin ?? s.defaultRoundIncrementMin;
  const currentKey = weekStartKey(Date.now(), s.timezone);
  const agg = aggregateIntervals(ci, { billedThroughMs: 0, timeZone: s.timezone });

  return Object.entries(agg.byWeek)
    .map(([weekKey, activeMs]) => {
      const { startMs, endMs } = weekRange(weekKey, s.timezone);
      const lines = buildInvoiceLines(ci, {
        ratePerHour: client.hourlyRate,
        roundIncrementMin,
        roundMode: s.roundMode as RoundMode,
        billedThroughMs: startMs,
        cutoffMs: endMs,
        groupBy: 'project',
        mappings: coreMappings,
        timeZone: s.timezone,
      });
      const adjustHours = adj.get(startMs) ?? 0;
      const adjLine = adjustmentLine(adjustHours, client.hourlyRate);
      return {
        weekKey,
        startMs,
        endMs,
        activeMs,
        amount: round2(invoiceSubtotal(lines) + (adjLine?.amount ?? 0)),
        adjustHours,
        billed: billed.has(startMs),
        isCurrent: weekKey === currentKey,
      };
    })
    .sort((a, b) => b.startMs - a.startMs);
}

export interface ClientStat {
  client: Client;
  thisWeekMs: number;
  thisWeekAmount: number;
  thisWeekBilled: boolean;
  unbilledWeeks: number;
  oneOffTotal: number;
  roundIncrementMin: number;
  invoiceCount: number;
}

export interface OverviewData {
  settings: Settings;
  stats: ClientStat[];
  unassigned: { cwd: string; activeMs: number; lastSeenMs: number }[];
  clients: Client[];
  currentWeekKey: string;
}

export async function getOverview(): Promise<OverviewData> {
  const { intervals, coreMappings, clientRows, oneOffs, invoiceRows, adjRows, settings: s } = await loadAll();
  const currentKey = weekStartKey(Date.now(), s.timezone);

  const stats: ClientStat[] = clientRows.map((client) => {
    const ci = applyFolderCutoffs(intervalsForClient(intervals, client.id, coreMappings), coreMappings);
    const billed = billedWeekStarts(invoiceRows, client.id);
    const adj = adjustmentsFor(adjRows, client.id);
    const weeks = clientWeeks(ci, client, coreMappings, billed, adj, s);
    const current = weeks.find((w) => w.isCurrent);
    const invoiceCount = invoiceRows.filter((inv) => inv.clientId === client.id).length;
    return {
      client,
      thisWeekMs: current?.activeMs ?? 0,
      thisWeekAmount: current?.amount ?? 0,
      thisWeekBilled: current?.billed ?? false,
      unbilledWeeks: weeks.filter((w) => !w.billed && (w.activeMs > 0 || w.adjustHours !== 0)).length,
      oneOffTotal: sumAmounts(unbilledOneOffs(oneOffs, client.id)),
      roundIncrementMin: client.roundIncrementMin ?? s.defaultRoundIncrementMin,
      invoiceCount,
    };
  });

  return {
    settings: s,
    stats: stats.sort((a, b) => b.thisWeekMs - a.thisWeekMs),
    unassigned: unassignedFolders(intervals, coreMappings),
    clients: clientRows,
    currentWeekKey: currentKey,
  };
}

export interface ClientDetail {
  client: Client;
  settings: Settings;
  mappings: (typeof folderMappings.$inferSelect)[];
  weeks: BillableWeek[];
  recentIntervals: CoreInterval[];
  oneOffs: OneOffCharge[];
  oneOffTotal: number;
  roundIncrementMin: number;
  currentWeekKey: string;
  invoiceCount: number;
}

export async function getClientDetail(clientId: string): Promise<ClientDetail | null> {
  const { intervals, mappings, coreMappings, oneOffs, invoiceRows, adjRows, settings: s } = await loadAll();
  const db = getDb();
  const found = await db.select().from(clients).where(eq(clients.id, clientId));
  const client = found[0];
  if (!client) return null;

  const ci = applyFolderCutoffs(intervalsForClient(intervals, clientId, coreMappings), coreMappings);
  const billed = billedWeekStarts(invoiceRows, clientId);
  const adj = adjustmentsFor(adjRows, clientId);
  const weeks = clientWeeks(ci, client, coreMappings, billed, adj, s);
  const clientOneOffs = unbilledOneOffs(oneOffs, clientId);
  const invoiceCount = invoiceRows.filter((inv) => inv.clientId === clientId).length;

  return {
    client,
    settings: s,
    mappings: mappings.filter((m) => m.clientId === clientId),
    weeks,
    recentIntervals: ci.filter((i) => i.activeMs > 0).sort((a, b) => b.endMs - a.endMs).slice(0, 25),
    oneOffs: clientOneOffs,
    oneOffTotal: sumAmounts(clientOneOffs),
    roundIncrementMin: client.roundIncrementMin ?? s.defaultRoundIncrementMin,
    currentWeekKey: weekStartKey(Date.now(), s.timezone),
    invoiceCount,
  };
}

export interface WeekSession {
  cwd: string;
  folderLabel: string;
  startMs: number;
  endMs: number;
  activeMs: number;
}

export interface WeekFolderGroup {
  label: string;
  cwd: string;
  activeMs: number;
  sessions: WeekSession[];
}

export interface WeekDetail {
  client: Client;
  settings: Settings;
  weekKey: string;
  startMs: number;
  endMs: number;
  lines: ReturnType<typeof buildInvoiceLines>;
  subtotal: number;
  groups: WeekFolderGroup[];
  sessionCount: number;
  billed: boolean;
  invoiceId: string | null;
  invoiceNumber: string | null;
  roundIncrementMin: number;
  dayGrid: WeekProjectDayGrid;
}

/** Full drill-down of one client's week: invoice lines + the sessions behind them. */
export async function getWeekDetail(clientId: string, weekKey: string): Promise<WeekDetail | null> {
  const { intervals, coreMappings, invoiceRows, settings: s } = await loadAll();
  const db = getDb();
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) return null;

  const { startMs, endMs } = weekRange(weekKey, s.timezone);
  const roundIncrementMin = client.roundIncrementMin ?? s.defaultRoundIncrementMin;
  // Per-folder cutoffs are applied up front, so the week window is just [start, end).
  const ci = applyFolderCutoffs(intervalsForClient(intervals, clientId, coreMappings), coreMappings);

  const lines = buildInvoiceLines(ci, {
    ratePerHour: client.hourlyRate,
    roundIncrementMin,
    roundMode: s.roundMode as RoundMode,
    billedThroughMs: startMs,
    cutoffMs: endMs,
    groupBy: 'project',
    mappings: coreMappings,
    timeZone: s.timezone,
  });

  // Build the session list within this week, grouped by folder.
  const groupMap = new Map<string, WeekFolderGroup>();
  for (const it of ci) {
    const ms = activeWithin(it, startMs, endMs);
    if (ms <= 0) continue;
    const m = matchMapping(it.cwd, coreMappings);
    const label = m ? m.label ?? basename(m.path) : basename(it.cwd);
    const session: WeekSession = {
      cwd: it.cwd,
      folderLabel: label,
      startMs: Math.max(it.startMs, startMs),
      endMs: Math.min(it.endMs, endMs),
      activeMs: ms,
    };
    const g = groupMap.get(label);
    if (g) {
      g.activeMs += ms;
      g.sessions.push(session);
    } else {
      groupMap.set(label, { label, cwd: it.cwd, activeMs: ms, sessions: [session] });
    }
  }
  const groups = [...groupMap.values()].sort((a, b) => b.activeMs - a.activeMs);
  for (const g of groups) g.sessions.sort((a, b) => a.startMs - b.startMs);

  const invoice = invoiceRows.find((inv) => inv.clientId === clientId && inv.prevBilledThroughMs === startMs);

  const [adjRow] = await db
    .select()
    .from(weekAdjustments)
    .where(and(eq(weekAdjustments.clientId, clientId), eq(weekAdjustments.weekStartMs, startMs)));
  const adjLine = adjustmentLine(adjRow?.adjustHours ?? 0, client.hourlyRate);
  const linesWithAdj = adjLine ? [...lines, adjLine] : lines;

  const dayGrid = weekProjectDayGrid(ci, weekKey, s.timezone, coreMappings);

  return {
    client,
    settings: s,
    weekKey,
    startMs,
    endMs,
    lines: linesWithAdj,
    subtotal: invoiceSubtotal(linesWithAdj),
    groups,
    sessionCount: groups.reduce((n, g) => n + g.sessions.length, 0),
    billed: !!invoice,
    invoiceId: invoice?.id ?? null,
    invoiceNumber: invoice?.number ?? null,
    roundIncrementMin,
    dayGrid,
  };
}

export async function listClients(): Promise<Client[]> {
  const db = getDb();
  return db.select().from(clients).where(eq(clients.archived, 0)).orderBy(clients.name);
}

export interface InvoiceListRow {
  invoice: Invoice;
  hasReceipt: boolean;
}

export async function listInvoices(): Promise<Invoice[]> {
  const db = getDb();
  return db.select().from(invoices).orderBy(desc(invoices.issuedAt));
}

export interface InvoiceDetail {
  invoice: Invoice;
  lines: InvoiceLine[];
  receiptNumber: string | null;
  settings: Settings;
  dayGrid: WeekProjectDayGrid | null;
}

export async function getInvoiceDetail(invoiceId: string): Promise<InvoiceDetail | null> {
  const db = getDb();
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return null;
  const [lines, rcpt, s] = await Promise.all([
    db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)),
    db.select().from(receipts).where(eq(receipts.invoiceId, invoiceId)),
    getSettings(),
  ]);
  const dayGrid = await invoiceDayGrid(inv, s);
  return { invoice: inv, lines, receiptNumber: rcpt[0]?.number ?? null, settings: s, dayGrid };
}

export async function getInvoiceByToken(token: string): Promise<InvoiceDetail | null> {
  const db = getDb();
  const [inv] = await db.select().from(invoices).where(eq(invoices.publicToken, token));
  if (!inv) return null;
  const [lines, rcpt, s] = await Promise.all([
    db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)),
    db.select().from(receipts).where(eq(receipts.invoiceId, inv.id)),
    getSettings(),
  ]);
  const dayGrid = await invoiceDayGrid(inv, s);
  return { invoice: inv, lines, receiptNumber: rcpt[0]?.number ?? null, settings: s, dayGrid };
}

export { normalizePath };
