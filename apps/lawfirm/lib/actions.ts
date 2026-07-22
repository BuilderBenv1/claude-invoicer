'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from './db';
import { clients, projects, tasks, timeEntries, settings, invoices } from './db/schema';
import { getSettings, localeOf } from './settings';
import { newId, round2 } from './util';
import { checkThreshold } from './alerts';
import { sendMonthNow } from './monthly';
import {
  buildHoursLines,
  insertInvoice,
  getInvoiceDetail,
  markInvoicePaid,
  markInvoiceUnpaid,
  deleteInvoice as deleteInvoiceRow,
  type NewLine,
} from './invoice-service';
import { sendInvoiceEmail } from './email';

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim();
}
function num(fd: FormData, key: string, fallback = 0): number {
  const v = Number(fd.get(key));
  return Number.isFinite(v) ? v : fallback;
}
function numOrNull(fd: FormData, key: string): number | null {
  const raw = String(fd.get(key) ?? '').trim();
  if (raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : null;
}
/** "YYYY-MM-DD" -> epoch ms at local-noon (stable day bucketing across TZs). */
function dateToMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return Date.now();
  return Date.UTC(y, m - 1, d, 12, 0, 0);
}

// ------------------------- Timer -------------------------

/**
 * Start a timer. Enforces a single running timer: any currently-running entry
 * is stopped (and its case threshold checked) before the new one begins.
 */
export async function startTimer(fd: FormData): Promise<void> {
  const clientId = str(fd, 'clientId');
  const projectId = str(fd, 'projectId');
  if (!clientId || !projectId) throw new Error('בחר לקוח ותיק / Pick a client and a case');
  const taskId = str(fd, 'taskId') || null;
  const description = str(fd, 'description') || null;
  const db = getDb();
  const now = Date.now();

  // Stop any running timers first.
  const running = await db.select().from(timeEntries).where(isNull(timeEntries.endMs));
  for (const r of running) {
    await db.update(timeEntries).set({ endMs: now, durationMs: Math.max(0, now - r.startMs) }).where(eq(timeEntries.id, r.id));
  }
  for (const r of running) await checkThreshold(r.projectId);

  await db.insert(timeEntries).values({ id: newId(), clientId, projectId, taskId, description, startMs: now, endMs: null, durationMs: null });
  revalidatePath('/');
}

export async function stopTimer(fd: FormData): Promise<void> {
  const entryId = str(fd, 'entryId');
  if (!entryId) throw new Error('Missing entry id');
  const db = getDb();
  const now = Date.now();
  const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, entryId));
  if (!entry || entry.endMs != null) {
    revalidatePath('/');
    return;
  }
  await db.update(timeEntries).set({ endMs: now, durationMs: Math.max(0, now - entry.startMs) }).where(eq(timeEntries.id, entryId));
  await checkThreshold(entry.projectId);
  revalidatePath('/');
  revalidatePath('/clients/' + entry.clientId);
  revalidatePath('/cases/' + entry.projectId);
}

/** Discard a running timer without recording any time. */
export async function cancelTimer(fd: FormData): Promise<void> {
  const entryId = str(fd, 'entryId');
  const db = getDb();
  await db.delete(timeEntries).where(and(eq(timeEntries.id, entryId), isNull(timeEntries.endMs)));
  revalidatePath('/');
}

/** Add a completed entry by hand (past work, phone calls, etc.). */
export async function addManualEntry(fd: FormData): Promise<void> {
  const clientId = str(fd, 'clientId');
  const projectId = str(fd, 'projectId');
  if (!clientId || !projectId) throw new Error('Pick a client and a case');
  const hours = num(fd, 'hours');
  if (!(hours > 0)) throw new Error('שעות חייבות להיות גדולות מאפס / Hours must be greater than zero');
  const taskId = str(fd, 'taskId') || null;
  const description = str(fd, 'description') || null;
  const dateStr = str(fd, 'date');
  const startMs = dateStr ? dateToMs(dateStr) : Date.now();
  const durationMs = Math.round(hours * 3_600_000);
  const db = getDb();
  await db.insert(timeEntries).values({ id: newId(), clientId, projectId, taskId, description, startMs, endMs: startMs + durationMs, durationMs });
  await checkThreshold(projectId);
  revalidatePath('/');
  revalidatePath('/clients/' + clientId);
  revalidatePath('/cases/' + projectId);
}

export async function deleteEntry(fd: FormData): Promise<void> {
  const entryId = str(fd, 'entryId');
  const projectId = str(fd, 'projectId');
  const db = getDb();
  await db.delete(timeEntries).where(eq(timeEntries.id, entryId));
  revalidatePath('/');
  if (projectId) revalidatePath('/cases/' + projectId);
}

// ------------------------- Clients -------------------------

export async function createClient(fd: FormData): Promise<string> {
  const name = str(fd, 'name');
  if (!name) throw new Error('שם לקוח נדרש / Client name is required');
  const s = await getSettings();
  const id = newId();
  const db = getDb();
  await db.insert(clients).values({
    id,
    name,
    email: str(fd, 'email') || null,
    phone: str(fd, 'phone') || null,
    address: str(fd, 'address') || null,
    hourlyRate: num(fd, 'hourlyRate'),
    currency: str(fd, 'currency') || s.defaultCurrency,
    notes: str(fd, 'notes') || null,
  });
  revalidatePath('/');
  revalidatePath('/clients');
  return id;
}

export async function createClientAndRedirect(fd: FormData): Promise<void> {
  const id = await createClient(fd);
  redirect('/clients/' + id);
}

export async function updateClient(fd: FormData): Promise<void> {
  const id = str(fd, 'id');
  if (!id) throw new Error('Missing client id');
  const db = getDb();
  await db
    .update(clients)
    .set({
      name: str(fd, 'name'),
      email: str(fd, 'email') || null,
      phone: str(fd, 'phone') || null,
      address: str(fd, 'address') || null,
      hourlyRate: num(fd, 'hourlyRate'),
      currency: str(fd, 'currency') || 'ILS',
      notes: str(fd, 'notes') || null,
    })
    .where(eq(clients.id, id));
  revalidatePath('/');
  revalidatePath('/clients');
  revalidatePath('/clients/' + id);
}

export async function archiveClient(fd: FormData): Promise<void> {
  const id = str(fd, 'id');
  const db = getDb();
  await db.update(clients).set({ archived: 1 }).where(eq(clients.id, id));
  revalidatePath('/');
  revalidatePath('/clients');
  redirect('/clients');
}

// ------------------------- Cases (projects) -------------------------

export async function createProject(fd: FormData): Promise<void> {
  const clientId = str(fd, 'clientId');
  const name = str(fd, 'name');
  if (!clientId || !name) throw new Error('שם תיק נדרש / Case name is required');
  const db = getDb();
  await db.insert(projects).values({
    id: newId(),
    clientId,
    name,
    caseNumber: str(fd, 'caseNumber') || null,
    description: str(fd, 'description') || null,
    hourlyRate: numOrNull(fd, 'hourlyRate'),
    alertThresholdHours: numOrNull(fd, 'alertThresholdHours'),
  });
  revalidatePath('/');
  revalidatePath('/clients/' + clientId);
}

export async function updateProject(fd: FormData): Promise<void> {
  const id = str(fd, 'id');
  const clientId = str(fd, 'clientId');
  if (!id) throw new Error('Missing case id');
  const newThreshold = numOrNull(fd, 'alertThresholdHours');
  const db = getDb();

  // Re-arm the alert if the threshold changed, so a new threshold can fire.
  const [existing] = await db.select().from(projects).where(eq(projects.id, id));
  const rearm = existing && existing.alertThresholdHours !== newThreshold;

  await db
    .update(projects)
    .set({
      name: str(fd, 'name'),
      caseNumber: str(fd, 'caseNumber') || null,
      description: str(fd, 'description') || null,
      hourlyRate: numOrNull(fd, 'hourlyRate'),
      alertThresholdHours: newThreshold,
      ...(rearm ? { alertNotifiedHours: null, alertNotifiedAt: null } : {}),
    })
    .where(eq(projects.id, id));
  revalidatePath('/');
  if (clientId) revalidatePath('/clients/' + clientId);
  revalidatePath('/cases/' + id);
}

export async function setProjectStatus(fd: FormData): Promise<void> {
  const id = str(fd, 'id');
  const clientId = str(fd, 'clientId');
  const status = str(fd, 'status') === 'closed' ? 'closed' : 'open';
  const db = getDb();
  await db.update(projects).set({ status, closedAt: status === 'closed' ? new Date() : null }).where(eq(projects.id, id));
  revalidatePath('/');
  if (clientId) revalidatePath('/clients/' + clientId);
  revalidatePath('/cases/' + id);
}

export async function archiveProject(fd: FormData): Promise<void> {
  const id = str(fd, 'id');
  const clientId = str(fd, 'clientId');
  const db = getDb();
  await db.update(projects).set({ archived: 1 }).where(eq(projects.id, id));
  revalidatePath('/');
  if (clientId) revalidatePath('/clients/' + clientId);
  redirect('/clients/' + clientId);
}

// ------------------------- Tasks -------------------------

export async function createTask(fd: FormData): Promise<void> {
  const projectId = str(fd, 'projectId');
  const name = str(fd, 'name');
  if (!projectId || !name) throw new Error('שם משימה נדרש / Task name is required');
  const db = getDb();
  await db.insert(tasks).values({ id: newId(), projectId, name });
  revalidatePath('/cases/' + projectId);
}

export async function archiveTask(fd: FormData): Promise<void> {
  const id = str(fd, 'id');
  const projectId = str(fd, 'projectId');
  const db = getDb();
  await db.update(tasks).set({ archived: 1 }).where(eq(tasks.id, id));
  revalidatePath('/cases/' + projectId);
}

// ------------------------- Settings -------------------------

export async function updateSettings(fd: FormData): Promise<void> {
  const db = getDb();
  await getSettings();
  await db
    .update(settings)
    .set({
      firmName: str(fd, 'firmName') || 'משרד עורכי דין',
      firmEmail: str(fd, 'firmEmail') || null,
      firmAddress: str(fd, 'firmAddress') || null,
      firmPhone: str(fd, 'firmPhone') || null,
      taxId: str(fd, 'taxId') || null,
      logoUrl: str(fd, 'logoUrl') || null,
      reportEmail: str(fd, 'reportEmail') || null,
      defaultCurrency: str(fd, 'defaultCurrency') || 'ILS',
      defaultHourlyRate: num(fd, 'defaultHourlyRate'),
      roundIncrementMin: num(fd, 'roundIncrementMin', 6),
      timezone: str(fd, 'timezone') || 'Asia/Jerusalem',
      locale: str(fd, 'locale') === 'en' ? 'en' : 'he',
      autoSendMonthly: str(fd, 'autoSendMonthly') === '1' ? 1 : 0,
    })
    .where(eq(settings.id, 1));
  revalidatePath('/');
  revalidatePath('/settings');
}

/** Manually send a month's report now (from Settings). */
export async function sendMonthlyNow(fd: FormData): Promise<void> {
  const monthKeyStr = str(fd, 'monthKey');
  if (!monthKeyStr) throw new Error('Pick a month');
  const res = await sendMonthNow(monthKeyStr);
  if (!res.sent) throw new Error(res.reason === 'no-recipient' ? 'הגדר דוא״ל לקבלת דוחות בהגדרות / Set a report email in Settings' : 'Send failed');
  revalidatePath('/settings');
}

// ------------------------- Invoices -------------------------

/**
 * Create an invoice. Lines come from (optionally) tracked billable hours for a
 * period plus any one-off flat charges the user typed. At least one line is
 * required. Redirects to the new invoice.
 */
export async function createInvoice(fd: FormData): Promise<void> {
  const clientId = str(fd, 'clientId');
  if (!clientId) throw new Error('בחר לקוח / Pick a client');
  const projectId = str(fd, 'projectId') || null;
  const includeHours = str(fd, 'includeHours') === '1';
  const fromMs = Number(str(fd, 'from')) || 0;
  const toMs = Number(str(fd, 'to')) || Date.now();
  const notes = str(fd, 'notes') || null;

  const hoursLines = includeHours ? await buildHoursLines({ clientId, projectId, fromMs, toMs }) : [];

  let manualLines: NewLine[] = [];
  try {
    const parsed = JSON.parse(str(fd, 'lines') || '[]') as unknown;
    manualLines = (Array.isArray(parsed) ? parsed : [])
      .map((l) => {
        const row = l as Record<string, unknown>;
        return {
          label: String(row.label ?? '').trim(),
          hours: 0,
          ratePerHour: 0,
          amount: round2(Number(row.amount) || 0),
        };
      })
      .filter((l) => l.label && l.amount !== 0);
  } catch {
    throw new Error('לא ניתן לקרוא את השורות / Could not read the line items');
  }

  const lines = [...hoursLines, ...manualLines];
  if (lines.length === 0) throw new Error('הוסף לפחות שורה אחת / Add at least one line');
  const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));

  const db = getDb();
  const id = await db.transaction(async (tx) => {
    const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
    if (!s) throw new Error('Settings not initialized');
    const [client] = await tx.select().from(clients).where(eq(clients.id, clientId));
    if (!client) throw new Error('Client not found');
    let project = null;
    if (projectId) {
      const [p] = await tx.select().from(projects).where(eq(projects.id, projectId));
      project = p ?? null;
    }
    const { id } = await insertInvoice(tx, { client, project, settings: s, lines, subtotal, notes });
    return id;
  });

  // Best-effort auto-email if the client has an address on file.
  try {
    const detail = await getInvoiceDetail(id);
    const to = detail?.invoice.clientEmail;
    if (detail && to) {
      await sendInvoiceEmail(detail, to, localeOf(detail.settings));
      await getDb().update(invoices).set({ emailedAt: new Date(), emailedTo: to }).where(eq(invoices.id, id));
    }
  } catch (e) {
    console.error('invoice auto-email failed', e);
  }

  revalidatePath('/invoices');
  revalidatePath('/');
  redirect('/invoices/' + id);
}

export async function markInvoicePaidAction(fd: FormData): Promise<void> {
  const id = str(fd, 'invoiceId');
  if (!id) throw new Error('Missing invoice id');
  await markInvoicePaid(id);
  revalidatePath('/invoices');
  revalidatePath('/invoices/' + id);
}

export async function markInvoiceUnpaidAction(fd: FormData): Promise<void> {
  const id = str(fd, 'invoiceId');
  if (!id) throw new Error('Missing invoice id');
  await markInvoiceUnpaid(id);
  revalidatePath('/invoices');
  revalidatePath('/invoices/' + id);
}

export async function deleteInvoiceAction(fd: FormData): Promise<void> {
  const id = str(fd, 'invoiceId');
  await deleteInvoiceRow(id);
  revalidatePath('/invoices');
  redirect('/invoices');
}

export async function emailInvoiceAction(fd: FormData): Promise<void> {
  const id = str(fd, 'invoiceId');
  if (!id) throw new Error('Missing invoice id');
  const to = str(fd, 'to');
  const detail = await getInvoiceDetail(id);
  if (!detail) throw new Error('Invoice not found');
  const recipient = to || detail.invoice.clientEmail;
  if (!recipient) throw new Error('אין כתובת דוא״ל / No recipient email — enter an address');
  await sendInvoiceEmail(detail, recipient, localeOf(detail.settings));
  await getDb().update(invoices).set({ emailedAt: new Date(), emailedTo: recipient }).where(eq(invoices.id, id));
  revalidatePath('/invoices/' + id);
}
