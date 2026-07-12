import { and, desc, eq, gte, isNull, isNotNull, lt } from 'drizzle-orm';
import { getDb } from './db';
import { clients, projects, tasks, timeEntries, type Client, type Project, type Task, type TimeEntry } from './db/schema';
import { getSettings } from './settings';
import { billableHours, hoursOf, dayKey, monthRange } from './time';
import { round2 } from './util';

/** Resolve the effective hourly rate for a case. */
export function effectiveRate(project: Pick<Project, 'hourlyRate'>, client: Pick<Client, 'hourlyRate'>, defaultRate: number): number {
  if (project.hourlyRate != null && project.hourlyRate > 0) return project.hourlyRate;
  if (client.hourlyRate > 0) return client.hourlyRate;
  return defaultRate;
}

export interface RunningTimer {
  entry: TimeEntry;
  clientName: string;
  projectName: string;
  taskName: string | null;
}

/** The single currently-running timer (endMs IS NULL), with its labels. */
export async function getRunningTimer(): Promise<RunningTimer | null> {
  const db = getDb();
  const [row] = await db
    .select({
      entry: timeEntries,
      clientName: clients.name,
      projectName: projects.name,
      taskName: tasks.name,
    })
    .from(timeEntries)
    .innerJoin(clients, eq(clients.id, timeEntries.clientId))
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .where(isNull(timeEntries.endMs))
    .orderBy(desc(timeEntries.startMs))
    .limit(1);
  if (!row) return null;
  return { entry: row.entry, clientName: row.clientName, projectName: row.projectName, taskName: row.taskName };
}

export interface EntryRow {
  entry: TimeEntry;
  clientName: string;
  projectName: string;
  taskName: string | null;
}

/** Recent completed entries with labels. */
export async function recentEntries(limit = 15): Promise<EntryRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      entry: timeEntries,
      clientName: clients.name,
      projectName: projects.name,
      taskName: tasks.name,
    })
    .from(timeEntries)
    .innerJoin(clients, eq(clients.id, timeEntries.clientId))
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .where(isNotNull(timeEntries.endMs))
    .orderBy(desc(timeEntries.startMs))
    .limit(limit);
  return rows.map((r) => ({ entry: r.entry, clientName: r.clientName, projectName: r.projectName, taskName: r.taskName }));
}

/** Sum of completed-entry hours whose startMs falls in [fromMs, toMs). */
export async function hoursInWindow(fromMs: number, toMs: number): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ durationMs: timeEntries.durationMs })
    .from(timeEntries)
    .where(and(isNotNull(timeEntries.durationMs), gte(timeEntries.startMs, fromMs), lt(timeEntries.startMs, toMs)));
  const ms = rows.reduce((s, r) => s + (r.durationMs ?? 0), 0);
  return hoursOf(ms);
}

export interface CaseSummary {
  project: Project;
  clientName: string;
  hours: number;
}

/** Open cases with their total logged hours (for threshold progress). */
export async function activeCasesWithHours(): Promise<CaseSummary[]> {
  const db = getDb();
  const rows = await db
    .select({ project: projects, clientName: clients.name })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.status, 'open'), eq(projects.archived, 0)))
    .orderBy(desc(projects.createdAt));

  const out: CaseSummary[] = [];
  for (const r of rows) {
    out.push({ project: r.project, clientName: r.clientName, hours: await caseHours(r.project.id) });
  }
  return out;
}

/** Total logged (completed) hours for a case. */
export async function caseHours(projectId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ durationMs: timeEntries.durationMs })
    .from(timeEntries)
    .where(and(eq(timeEntries.projectId, projectId), isNotNull(timeEntries.durationMs)));
  return hoursOf(rows.reduce((s, r) => s + (r.durationMs ?? 0), 0));
}

export interface ClientWithTotals {
  client: Client;
  openCases: number;
  hours: number;
}

export async function listClientsWithTotals(): Promise<ClientWithTotals[]> {
  const db = getDb();
  const cs = await db.select().from(clients).where(eq(clients.archived, 0)).orderBy(clients.name);
  const out: ClientWithTotals[] = [];
  for (const c of cs) {
    const ps = await db
      .select({ id: projects.id, status: projects.status })
      .from(projects)
      .where(and(eq(projects.clientId, c.id), eq(projects.archived, 0)));
    const entries = await db
      .select({ durationMs: timeEntries.durationMs })
      .from(timeEntries)
      .where(and(eq(timeEntries.clientId, c.id), isNotNull(timeEntries.durationMs)));
    out.push({
      client: c,
      openCases: ps.filter((p) => p.status === 'open').length,
      hours: hoursOf(entries.reduce((s, r) => s + (r.durationMs ?? 0), 0)),
    });
  }
  return out;
}

export interface ClientDetail {
  client: Client;
  cases: { project: Project; hours: number; taskCount: number }[];
}

export async function getClientDetail(clientId: string): Promise<ClientDetail | null> {
  const db = getDb();
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) return null;
  const ps = await db
    .select()
    .from(projects)
    .where(and(eq(projects.clientId, clientId), eq(projects.archived, 0)))
    .orderBy(desc(projects.createdAt));
  const cases: ClientDetail['cases'] = [];
  for (const p of ps) {
    const ts = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.archived, 0)));
    cases.push({ project: p, hours: await caseHours(p.id), taskCount: ts.length });
  }
  return { client, cases };
}

export interface ProjectDetail {
  project: Project;
  client: Client;
  tasks: Task[];
  entries: EntryRow[];
  hours: number;
  billable: number;
  rate: number;
  currency: string;
  amount: number;
}

export async function getProjectDetail(projectId: string): Promise<ProjectDetail | null> {
  const db = getDb();
  const s = await getSettings();
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const [client] = await db.select().from(clients).where(eq(clients.id, project.clientId));
  if (!client) return null;

  const ts = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.archived, 0)))
    .orderBy(desc(tasks.createdAt));

  const rawEntries = await db
    .select({ entry: timeEntries, taskName: tasks.name })
    .from(timeEntries)
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .where(and(eq(timeEntries.projectId, projectId), isNotNull(timeEntries.durationMs)))
    .orderBy(desc(timeEntries.startMs));

  const entries: EntryRow[] = rawEntries.map((r) => ({
    entry: r.entry,
    clientName: client.name,
    projectName: project.name,
    taskName: r.taskName,
  }));

  const totalMs = entries.reduce((sum, r) => sum + (r.entry.durationMs ?? 0), 0);
  const billable = entries.reduce((sum, r) => sum + billableHours(r.entry.durationMs ?? 0, s.roundIncrementMin), 0);
  const rate = effectiveRate(project, client, s.defaultHourlyRate);
  return {
    project,
    client,
    tasks: ts,
    entries,
    hours: hoursOf(totalMs),
    billable: round2(billable),
    rate,
    currency: client.currency,
    amount: round2(billable * rate),
  };
}

// ----------------------- Reports -----------------------

export interface ReportRowEntry {
  startMs: number;
  taskName: string | null;
  description: string | null;
  hours: number;
  billable: number;
}
export interface ReportBucket {
  label: string;
  hours: number;
  billable: number;
}
export interface ReportData {
  client: Client;
  project: Project | null; // null = all cases for the client
  fromMs: number;
  toMs: number;
  entries: ReportRowEntry[];
  byTask: ReportBucket[];
  byDay: ReportBucket[];
  totalHours: number;
  totalBillable: number;
  rate: number;
  amount: number;
  currency: string;
}

/**
 * Build the numbers behind a report: every completed entry for a client (and
 * optionally one case) whose start falls in [fromMs, toMs), plus per-task and
 * per-day rollups. Used by the on-screen report, the CSV export, and the
 * monthly email.
 */
export async function buildReport(opts: {
  clientId: string;
  projectId?: string | null;
  fromMs: number;
  toMs: number;
}): Promise<ReportData | null> {
  const db = getDb();
  const s = await getSettings();
  const [client] = await db.select().from(clients).where(eq(clients.id, opts.clientId));
  if (!client) return null;

  let project: Project | null = null;
  if (opts.projectId) {
    const [p] = await db.select().from(projects).where(eq(projects.id, opts.projectId));
    project = p ?? null;
  }

  const where = [
    eq(timeEntries.clientId, opts.clientId),
    isNotNull(timeEntries.durationMs),
    gte(timeEntries.startMs, opts.fromMs),
    lt(timeEntries.startMs, opts.toMs),
  ];
  if (opts.projectId) where.push(eq(timeEntries.projectId, opts.projectId));

  const rows = await db
    .select({ entry: timeEntries, taskName: tasks.name })
    .from(timeEntries)
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .where(and(...where))
    .orderBy(timeEntries.startMs);

  const inc = s.roundIncrementMin;
  const entries: ReportRowEntry[] = rows.map((r) => ({
    startMs: r.entry.startMs,
    taskName: r.taskName,
    description: r.entry.description,
    hours: hoursOf(r.entry.durationMs ?? 0),
    billable: billableHours(r.entry.durationMs ?? 0, inc),
  }));

  const taskMap = new Map<string, ReportBucket>();
  const dayMap = new Map<string, ReportBucket>();
  for (const e of entries) {
    const tk = e.taskName ?? '—';
    const tb = taskMap.get(tk) ?? { label: tk, hours: 0, billable: 0 };
    tb.hours = round2(tb.hours + e.hours);
    tb.billable = round2(tb.billable + e.billable);
    taskMap.set(tk, tb);

    const dk = dayKey(e.startMs, s.timezone);
    const dbk = dayMap.get(dk) ?? { label: dk, hours: 0, billable: 0 };
    dbk.hours = round2(dbk.hours + e.hours);
    dbk.billable = round2(dbk.billable + e.billable);
    dayMap.set(dk, dbk);
  }

  const totalHours = round2(entries.reduce((s2, e) => s2 + e.hours, 0));
  const totalBillable = round2(entries.reduce((s2, e) => s2 + e.billable, 0));
  const rate = project
    ? effectiveRate(project, client, s.defaultHourlyRate)
    : client.hourlyRate > 0
      ? client.hourlyRate
      : s.defaultHourlyRate;

  return {
    client,
    project,
    fromMs: opts.fromMs,
    toMs: opts.toMs,
    entries,
    byTask: [...taskMap.values()].sort((a, b) => b.hours - a.hours),
    byDay: [...dayMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
    totalHours,
    totalBillable,
    rate,
    amount: round2(totalBillable * rate),
    currency: client.currency,
  };
}

/** Convenience: month-based report window from a "YYYY-MM" key. */
export async function buildMonthlyReport(clientId: string, monthKeyStr: string, timezone: string) {
  const { startMs, endMs } = monthRange(monthKeyStr, timezone);
  return buildReport({ clientId, fromMs: startMs, toMs: endMs });
}

export async function listClientsPlain(): Promise<Client[]> {
  const db = getDb();
  return db.select().from(clients).where(eq(clients.archived, 0)).orderBy(clients.name);
}

export async function listProjectsForClient(clientId: string): Promise<Project[]> {
  const db = getDb();
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.clientId, clientId), eq(projects.archived, 0)))
    .orderBy(desc(projects.createdAt));
}

export interface ClientTreeNode {
  id: string;
  name: string;
  projects: { id: string; name: string; tasks: { id: string; name: string }[] }[];
}

/** Client → open cases → tasks, for the timer's cascading selects. */
export async function getClientsTree(): Promise<ClientTreeNode[]> {
  const db = getDb();
  const cs = await db.select().from(clients).where(eq(clients.archived, 0)).orderBy(clients.name);
  const tree: ClientTreeNode[] = [];
  for (const c of cs) {
    const ps = await db
      .select()
      .from(projects)
      .where(and(eq(projects.clientId, c.id), eq(projects.archived, 0), eq(projects.status, 'open')))
      .orderBy(desc(projects.createdAt));
    const node: ClientTreeNode = { id: c.id, name: c.name, projects: [] };
    for (const p of ps) {
      const ts = await db
        .select({ id: tasks.id, name: tasks.name })
        .from(tasks)
        .where(and(eq(tasks.projectId, p.id), eq(tasks.archived, 0)))
        .orderBy(desc(tasks.createdAt));
      node.projects.push({ id: p.id, name: p.name, tasks: ts });
    }
    tree.push(node);
  }
  return tree;
}
