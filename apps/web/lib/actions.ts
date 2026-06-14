'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import {
  buildInvoiceLines,
  intervalsForClient,
  invoiceSubtotal,
  normalizePath,
  weekRange,
  applyFolderCutoffs,
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
  settings,
} from './db/schema';
import { getSettings } from './settings';
import { newId } from './format';

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

// ---------------- Clients ----------------

export async function createClient(fd: FormData): Promise<void> {
  const name = str(fd, 'name');
  if (!name) throw new Error('Client name is required');
  const db = getDb();
  const s = await getSettings();
  const id = newId();
  await db.insert(clients).values({
    id,
    name,
    hourlyRate: num(fd, 'hourlyRate'),
    currency: str(fd, 'currency') || s.defaultCurrency,
    email: str(fd, 'email') || null,
    address: str(fd, 'address') || null,
  });
  revalidatePath('/');
  revalidatePath('/clients/' + id);
}

export async function updateClient(fd: FormData): Promise<void> {
  const id = str(fd, 'id');
  if (!id) throw new Error('Missing client id');
  const round = num(fd, 'roundIncrementMin', -1);
  const db = getDb();
  await db
    .update(clients)
    .set({
      name: str(fd, 'name'),
      hourlyRate: num(fd, 'hourlyRate'),
      currency: str(fd, 'currency') || 'USD',
      email: str(fd, 'email') || null,
      address: str(fd, 'address') || null,
      roundIncrementMin: round >= 0 ? round : null,
    })
    .where(eq(clients.id, id));
  revalidatePath('/');
  revalidatePath('/clients/' + id);
}

export async function archiveClient(fd: FormData): Promise<void> {
  const id = str(fd, 'id');
  const db = getDb();
  await db.update(clients).set({ archived: 1 }).where(eq(clients.id, id));
  revalidatePath('/');
  redirect('/');
}

/**
 * Set (or clear) a single folder's "bill from" cutoff — that folder's time before
 * it is excluded from estimates and invoices, leaving the client's other folders
 * untouched. mode: 'now' uses the current instant, 'set' uses the supplied epoch
 * ms (computed in the user's browser), 'clear' removes it.
 */
export async function setFolderBillFrom(fd: FormData): Promise<void> {
  const mappingId = str(fd, 'mappingId');
  const clientId = str(fd, 'clientId');
  if (!mappingId) throw new Error('Missing folder id');
  const mode = str(fd, 'mode');
  let ms = 0;
  if (mode === 'now') ms = Date.now();
  else if (mode === 'set') ms = Math.max(0, Number(str(fd, 'ms')) || 0);
  // mode === 'clear' -> 0
  const db = getDb();
  await db.update(folderMappings).set({ billFromMs: ms }).where(eq(folderMappings.id, mappingId));
  revalidatePath('/');
  if (clientId) revalidatePath('/clients/' + clientId);
}

// ---------------- Folder mappings ----------------

export async function addMapping(fd: FormData): Promise<void> {
  const clientId = str(fd, 'clientId');
  const rawPath = str(fd, 'path');
  if (!clientId || !rawPath) throw new Error('Client and folder path are required');
  const db = getDb();
  const rate = numOrNull(fd, 'hourlyRate');
  await db
    .insert(folderMappings)
    .values({
      id: newId(),
      clientId,
      path: normalizePath(rawPath),
      label: str(fd, 'label') || null,
      hourlyRate: rate,
    })
    .onConflictDoUpdate({
      target: folderMappings.path,
      set: { clientId, label: str(fd, 'label') || null, hourlyRate: rate },
    });
  revalidatePath('/');
  revalidatePath('/clients/' + clientId);
}

/** Edit an existing folder mapping's label and per-folder rate. */
export async function updateMapping(fd: FormData): Promise<void> {
  const id = str(fd, 'id');
  const clientId = str(fd, 'clientId');
  if (!id) throw new Error('Missing mapping id');
  const db = getDb();
  await db
    .update(folderMappings)
    .set({ label: str(fd, 'label') || null, hourlyRate: numOrNull(fd, 'hourlyRate') })
    .where(eq(folderMappings.id, id));
  revalidatePath('/');
  if (clientId) revalidatePath('/clients/' + clientId);
}

export async function removeMapping(fd: FormData): Promise<void> {
  const id = str(fd, 'id');
  const clientId = str(fd, 'clientId');
  const db = getDb();
  await db.delete(folderMappings).where(eq(folderMappings.id, id));
  revalidatePath('/');
  if (clientId) revalidatePath('/clients/' + clientId);
}

// ---------------- One-off charges ----------------

export async function addOneOff(fd: FormData): Promise<void> {
  const clientId = str(fd, 'clientId');
  const description = str(fd, 'description');
  const amount = num(fd, 'amount');
  if (!clientId || !description) throw new Error('Description required');
  if (!(amount > 0)) throw new Error('Amount must be greater than zero');
  const db = getDb();
  await db.insert(oneOffCharges).values({ id: newId(), clientId, description, amount });
  revalidatePath('/');
  revalidatePath('/clients/' + clientId);
}

export async function removeOneOff(fd: FormData): Promise<void> {
  const id = str(fd, 'id');
  const clientId = str(fd, 'clientId');
  const db = getDb();
  // Only unbilled charges can be removed here; billed ones belong to an invoice.
  await db.delete(oneOffCharges).where(and(eq(oneOffCharges.id, id), isNull(oneOffCharges.billedInvoiceId)));
  revalidatePath('/');
  if (clientId) revalidatePath('/clients/' + clientId);
}

/** Assign an unmapped folder to an existing client, or create a client on the fly. */
export async function assignFolder(fd: FormData): Promise<void> {
  const rawPath = str(fd, 'path');
  if (!rawPath) throw new Error('Folder path required');
  const existingClientId = str(fd, 'clientId');
  const db = getDb();
  const s = await getSettings();

  let clientId = existingClientId;
  if (clientId === '__new__' || !clientId) {
    const newClientName = str(fd, 'newClientName');
    if (!newClientName) throw new Error('New client name required');
    clientId = newId();
    await db.insert(clients).values({
      id: clientId,
      name: newClientName,
      hourlyRate: num(fd, 'hourlyRate'),
      currency: s.defaultCurrency,
    });
  }

  await db
    .insert(folderMappings)
    .values({ id: newId(), clientId, path: normalizePath(rawPath), label: str(fd, 'label') || null })
    .onConflictDoUpdate({ target: folderMappings.path, set: { clientId } });
  revalidatePath('/');
  revalidatePath('/clients/' + clientId);
}

// ---------------- Invoices ----------------

/**
 * Issue an invoice for a single calendar week (Mon–Sun). `weekStart` is the
 * Monday key "YYYY-MM-DD". Each week can be invoiced once per client. Unbilled
 * one-off charges are included only when `includeOneOffs` is set (the UI defaults
 * this on for the current week).
 */
export async function issueInvoice(fd: FormData): Promise<void> {
  const clientId = str(fd, 'clientId');
  const weekStart = str(fd, 'weekStart');
  const includeOneOffs = str(fd, 'includeOneOffs') === '1';
  if (!clientId) throw new Error('Missing client id');
  if (!weekStart) throw new Error('Missing week');

  const db = getDb();

  const newInvoiceId = await db.transaction(async (tx) => {
    const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
    if (!s) throw new Error('Settings not initialized');
    const [client] = await tx.select().from(clients).where(eq(clients.id, clientId));
    if (!client) throw new Error('Client not found');

    const { startMs, endMs } = weekRange(weekStart, s.timezone);

    // Guard: a given week can only be invoiced once per client.
    const existing = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.clientId, clientId), eq(invoices.prevBilledThroughMs, startMs)));
    if (existing[0]) {
      throw new Error(`Week of ${weekStart} is already invoiced (${existing[0].number}).`);
    }

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

    // Apply per-folder "bill from" cutoffs before windowing to the week.
    const ci = applyFolderCutoffs(intervalsForClient(intervals, clientId, coreMappings), coreMappings);
    const roundIncrementMin = client.roundIncrementMin ?? s.defaultRoundIncrementMin;
    const timeLines = buildInvoiceLines(ci, {
      ratePerHour: client.hourlyRate,
      roundIncrementMin,
      billedThroughMs: startMs, // lower bound: start of the week
      cutoffMs: endMs, // upper bound: end of the week
      groupBy: 'project',
      mappings: coreMappings,
      timeZone: s.timezone,
    });

    const charges = includeOneOffs
      ? await tx
          .select()
          .from(oneOffCharges)
          .where(and(eq(oneOffCharges.clientId, clientId), isNull(oneOffCharges.billedInvoiceId)))
      : [];

    const subtotal =
      invoiceSubtotal(timeLines) + Math.round(charges.reduce((sum, c) => sum + c.amount, 0) * 100) / 100;

    if (timeLines.length === 0 && charges.length === 0) {
      throw new Error(`Nothing to invoice for the week of ${weekStart}.`);
    }

    const seq = s.invoiceSeq + 1;
    const number = `INV-${String(seq).padStart(4, '0')}`;
    const id = newId();

    await tx.insert(invoices).values({
      id,
      number,
      clientId,
      status: 'unpaid',
      currency: client.currency,
      subtotal: Math.round(subtotal * 100) / 100,
      prevBilledThroughMs: startMs, // window start (identifies the billed week)
      cutoffMs: endMs, // window end
      notes: `Week of ${weekStart}`,
      businessName: s.businessName,
      businessEmail: s.businessEmail,
      businessAddress: s.businessAddress,
      taxId: s.taxId,
      clientName: client.name,
      clientEmail: client.email,
      clientAddress: client.address,
    });

    const allLines = [
      ...timeLines.map((l) => ({
        invoiceId: id,
        label: l.label,
        hours: l.hours,
        ratePerHour: l.ratePerHour,
        amount: l.amount,
      })),
      ...charges.map((c) => ({
        invoiceId: id,
        label: c.description,
        hours: 0,
        ratePerHour: 0,
        amount: c.amount,
      })),
    ];
    await tx.insert(invoiceLines).values(allLines);

    for (const c of charges) {
      await tx.update(oneOffCharges).set({ billedInvoiceId: id }).where(eq(oneOffCharges.id, c.id));
    }

    await tx.update(settings).set({ invoiceSeq: seq }).where(eq(settings.id, 1));
    return id;
  });

  revalidatePath('/');
  revalidatePath('/clients/' + clientId);
  revalidatePath('/invoices');
  redirect('/invoices/' + newInvoiceId);
}

export async function markInvoicePaid(fd: FormData): Promise<void> {
  const invoiceId = str(fd, 'invoiceId');
  if (!invoiceId) throw new Error('Missing invoice id');
  const db = getDb();

  await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!inv) throw new Error('Invoice not found');
    if (inv.status === 'paid') return;
    const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
    const seq = (s?.receiptSeq ?? 0) + 1;
    const number = `RCPT-${String(seq).padStart(4, '0')}`;
    await tx.update(invoices).set({ status: 'paid', paidAt: new Date() }).where(eq(invoices.id, invoiceId));
    await tx.insert(receipts).values({ id: newId(), invoiceId, number });
    await tx.update(settings).set({ receiptSeq: seq }).where(eq(settings.id, 1));
  });

  revalidatePath('/');
  revalidatePath('/invoices');
  revalidatePath('/invoices/' + invoiceId);
}

/**
 * Delete an invoice. The billed week becomes available to invoice again (weeks
 * are derived from existing invoices), and any one-off charges it carried return
 * to the unbilled pool.
 */
export async function deleteInvoice(fd: FormData): Promise<void> {
  const invoiceId = str(fd, 'invoiceId');
  const db = getDb();
  await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!inv) return;
    await tx
      .update(oneOffCharges)
      .set({ billedInvoiceId: null })
      .where(eq(oneOffCharges.billedInvoiceId, invoiceId));
    await tx.delete(invoices).where(eq(invoices.id, invoiceId));
  });
  revalidatePath('/');
  revalidatePath('/invoices');
  redirect('/invoices');
}

// ---------------- Settings ----------------

export async function updateSettings(fd: FormData): Promise<void> {
  const db = getDb();
  await getSettings(); // ensure row exists
  await db
    .update(settings)
    .set({
      businessName: str(fd, 'businessName') || 'My Business',
      businessEmail: str(fd, 'businessEmail') || null,
      businessAddress: str(fd, 'businessAddress') || null,
      taxId: str(fd, 'taxId') || null,
      defaultCurrency: str(fd, 'defaultCurrency') || 'USD',
      defaultRoundIncrementMin: num(fd, 'defaultRoundIncrementMin', 15),
      defaultIdleCapMin: num(fd, 'defaultIdleCapMin', 5),
      timezone: str(fd, 'timezone') || 'UTC',
    })
    .where(eq(settings.id, 1));
  revalidatePath('/');
  revalidatePath('/settings');
}
