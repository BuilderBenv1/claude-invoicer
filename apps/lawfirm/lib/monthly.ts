import { and, eq, gte, isNotNull, lt } from 'drizzle-orm';
import { getDb } from './db';
import { clients, settings, timeEntries } from './db/schema';
import { buildReport, type ClientWithTotals } from './queries';
import { getSettings, localeOf } from './settings';
import { sendMonthlyReport, type MonthlyClientReport } from './email';
import { monthRange, prevMonthKey } from './time';

export interface MonthlyRunSummary {
  sent: boolean;
  reason?: string;
  monthKey?: string;
  to?: string;
  clients?: number;
}

/**
 * Cron entry point. Sends the *previous* month's report to the configured
 * address exactly once — deduped via `lastMonthlySentKey`, so the daily cron
 * fires it on the first run of each new month and skips the rest. Safe to call
 * any time; it decides whether there is anything to do.
 */
export async function runMonthlyAutoSend(now: Date = new Date()): Promise<MonthlyRunSummary> {
  const db = getDb();
  const s = await getSettings();
  if (s.autoSendMonthly !== 1) return { sent: false, reason: 'disabled' };
  const to = s.reportEmail || s.firmEmail;
  if (!to) return { sent: false, reason: 'no-recipient' };

  const target = prevMonthKey(now, s.timezone);
  if (s.lastMonthlySentKey === target) return { sent: false, reason: 'already-sent', monthKey: target };

  const reports = await buildMonthReports(target, s.timezone);
  await sendMonthlyReport(to, target, reports, s, localeOf(s));
  await db.update(settings).set({ lastMonthlySentKey: target }).where(eq(settings.id, 1));
  return { sent: true, monthKey: target, to, clients: reports.length };
}

/** Force-send a given month now (used by the "send now" settings action). */
export async function sendMonthNow(monthKeyStr: string): Promise<MonthlyRunSummary> {
  const db = getDb();
  const s = await getSettings();
  const to = s.reportEmail || s.firmEmail;
  if (!to) return { sent: false, reason: 'no-recipient' };
  const reports = await buildMonthReports(monthKeyStr, s.timezone);
  await sendMonthlyReport(to, monthKeyStr, reports, s, localeOf(s));
  await db.update(settings).set({ lastMonthlySentKey: monthKeyStr }).where(eq(settings.id, 1));
  return { sent: true, monthKey: monthKeyStr, to, clients: reports.length };
}

/** One all-cases report per client that logged any time in the month. */
async function buildMonthReports(monthKeyStr: string, timezone: string): Promise<MonthlyClientReport[]> {
  const db = getDb();
  const { startMs, endMs } = monthRange(monthKeyStr, timezone);

  // Which clients have entries this month?
  const cs = await db.select().from(clients).where(eq(clients.archived, 0)).orderBy(clients.name);
  const out: MonthlyClientReport[] = [];
  for (const c of cs) {
    const [hit] = await db
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.clientId, c.id),
          isNotNull(timeEntries.durationMs),
          gte(timeEntries.startMs, startMs),
          lt(timeEntries.startMs, endMs),
        ),
      )
      .limit(1);
    if (!hit) continue;
    const report = await buildReport({ clientId: c.id, fromMs: startMs, toMs: endMs });
    if (report) out.push({ client: c, report });
  }
  return out;
}

// (re-exported type kept for callers that summarize clients)
export type { ClientWithTotals };
