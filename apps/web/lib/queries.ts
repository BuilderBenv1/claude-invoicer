import { desc, eq } from 'drizzle-orm';
import {
  aggregateIntervals,
  buildInvoiceLines,
  intervalsForClient,
  invoiceSubtotal,
  normalizePath,
  unassignedFolders,
  weekStartKey,
  type ActivityInterval as CoreInterval,
  type FolderMapping as CoreMapping,
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
  type Client,
  type Invoice,
  type InvoiceLine,
  type OneOffCharge,
  type Settings,
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
  };
}

async function loadAll() {
  const db = getDb();
  const [rawIntervals, rawMappings, clientRows, oneOffs, s] = await Promise.all([
    db.select().from(activityIntervals),
    db.select().from(folderMappings),
    db.select().from(clients).where(eq(clients.archived, 0)),
    db.select().from(oneOffCharges),
    getSettings(),
  ]);
  return {
    intervals: rawIntervals.map(toCoreInterval),
    mappings: rawMappings,
    coreMappings: rawMappings.map(toCoreMapping),
    clientRows,
    oneOffs,
    settings: s,
  };
}

/** Unbilled one-off charges for a client. */
function unbilledOneOffs(oneOffs: OneOffCharge[], clientId: string): OneOffCharge[] {
  return oneOffs.filter((o) => o.clientId === clientId && !o.billedInvoiceId);
}
function sumAmounts(items: { amount: number }[]): number {
  return Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
}

export interface ClientStat {
  client: Client;
  thisWeekMs: number;
  unbilledMs: number;
  estimatedAmount: number;
  roundIncrementMin: number;
}

export interface OverviewData {
  settings: Settings;
  stats: ClientStat[];
  unassigned: { cwd: string; activeMs: number; lastSeenMs: number }[];
  clients: Client[];
  totalUnbilledByCurrency: Record<string, number>;
}

export async function getOverview(): Promise<OverviewData> {
  const { intervals, coreMappings, clientRows, oneOffs, settings: s } = await loadAll();
  const weekKey = weekStartKey(Date.now(), s.timezone);
  const cutoffMs = Date.now();

  const stats: ClientStat[] = clientRows.map((client) => {
    const ci = intervalsForClient(intervals, client.id, coreMappings);
    const agg = aggregateIntervals(ci, { billedThroughMs: client.billedThroughMs, timeZone: s.timezone });
    const roundIncrementMin = client.roundIncrementMin ?? s.defaultRoundIncrementMin;
    const lines = buildInvoiceLines(ci, {
      ratePerHour: client.hourlyRate,
      roundIncrementMin,
      billedThroughMs: client.billedThroughMs,
      cutoffMs,
      groupBy: 'project',
      mappings: coreMappings,
      timeZone: s.timezone,
    });
    const oneOffTotal = sumAmounts(unbilledOneOffs(oneOffs, client.id));
    return {
      client,
      thisWeekMs: agg.byWeek[weekKey] ?? 0,
      unbilledMs: agg.unbilledMs,
      estimatedAmount: invoiceSubtotal(lines) + oneOffTotal,
      roundIncrementMin,
    };
  });

  const totalUnbilledByCurrency: Record<string, number> = {};
  for (const st of stats) {
    totalUnbilledByCurrency[st.client.currency] =
      (totalUnbilledByCurrency[st.client.currency] ?? 0) + st.estimatedAmount;
  }

  return {
    settings: s,
    stats: stats.sort((a, b) => b.unbilledMs - a.unbilledMs),
    unassigned: unassignedFolders(intervals, coreMappings),
    clients: clientRows,
    totalUnbilledByCurrency,
  };
}

export interface ClientDetail {
  client: Client;
  settings: Settings;
  mappings: (typeof folderMappings.$inferSelect)[];
  byWeek: { week: string; ms: number }[];
  unbilledMs: number;
  thisWeekMs: number;
  recentIntervals: CoreInterval[];
  previewLines: ReturnType<typeof buildInvoiceLines>;
  oneOffs: OneOffCharge[];
  previewSubtotal: number;
  roundIncrementMin: number;
}

export async function getClientDetail(clientId: string): Promise<ClientDetail | null> {
  const { intervals, mappings, coreMappings, oneOffs, settings: s } = await loadAll();
  const db = getDb();
  const found = await db.select().from(clients).where(eq(clients.id, clientId));
  const client = found[0];
  if (!client) return null;

  const ci = intervalsForClient(intervals, clientId, coreMappings);
  const agg = aggregateIntervals(ci, { billedThroughMs: client.billedThroughMs, timeZone: s.timezone });
  const weekKey = weekStartKey(Date.now(), s.timezone);
  const roundIncrementMin = client.roundIncrementMin ?? s.defaultRoundIncrementMin;
  const cutoffMs = Date.now();
  const previewLines = buildInvoiceLines(ci, {
    ratePerHour: client.hourlyRate,
    roundIncrementMin,
    billedThroughMs: client.billedThroughMs,
    cutoffMs,
    groupBy: 'project',
    mappings: coreMappings,
    timeZone: s.timezone,
  });

  const byWeek = Object.entries(agg.byWeek)
    .map(([week, ms]) => ({ week, ms }))
    .sort((a, b) => (a.week < b.week ? 1 : -1))
    .slice(0, 12);

  const clientOneOffs = unbilledOneOffs(oneOffs, clientId);

  return {
    client,
    settings: s,
    mappings: mappings.filter((m) => m.clientId === clientId),
    byWeek,
    unbilledMs: agg.unbilledMs,
    thisWeekMs: agg.byWeek[weekKey] ?? 0,
    recentIntervals: ci.filter((i) => i.activeMs > 0).sort((a, b) => b.endMs - a.endMs).slice(0, 25),
    previewLines,
    oneOffs: clientOneOffs,
    previewSubtotal: invoiceSubtotal(previewLines) + sumAmounts(clientOneOffs),
    roundIncrementMin,
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
  return { invoice: inv, lines, receiptNumber: rcpt[0]?.number ?? null, settings: s };
}

export { normalizePath };
