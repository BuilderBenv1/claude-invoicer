'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import {
  buildInvoiceLines,
  intervalsForClient,
  invoiceSubtotal,
  normalizePath,
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

// ---------------- Folder mappings ----------------

export async function addMapping(fd: FormData): Promise<void> {
  const clientId = str(fd, 'clientId');
  const rawPath = str(fd, 'path');
  if (!clientId || !rawPath) throw new Error('Client and folder path are required');
  const db = getDb();
  await db
    .insert(folderMappings)
    .values({
      id: newId(),
      clientId,
      path: normalizePath(rawPath),
      label: str(fd, 'label') || null,
    })
    .onConflictDoUpdate({
      target: folderMappings.path,
      set: { clientId, label: str(fd, 'label') || null },
    });
  revalidatePath('/');
  revalidatePath('/clients/' + clientId);
}

export async function removeMapping(fd: FormData): Promise<void> {
  const id = str(fd, 'id');
  const clientId = str(fd, 'clientId');
  const db = getDb();
  await db.delete(folderMappings).where(eq(folderMappings.id, id));
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

export async function issueInvoice(fd: FormData): Promise<void> {
  const clientId = str(fd, 'clientId');
  if (!clientId) throw new Error('Missing client id');
  const db = getDb();

  const newInvoiceId = await db.transaction(async (tx) => {
    const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
    if (!s) throw new Error('Settings not initialized');
    const [client] = await tx.select().from(clients).where(eq(clients.id, clientId));
    if (!client) throw new Error('Client not found');

    const rawMappings = await tx.select().from(folderMappings);
    const coreMappings: CoreMapping[] = rawMappings.map((m) => ({
      clientId: m.clientId,
      path: m.path,
      label: m.label ?? undefined,
    }));
    const rawIntervals = await tx.select().from(activityIntervals);
    const intervals: CoreInterval[] = rawIntervals.map((r) => ({
      sessionId: r.sessionId,
      cwd: r.cwd,
      startMs: r.startMs,
      endMs: r.endMs,
      activeMs: r.activeMs,
    }));

    const ci = intervalsForClient(intervals, clientId, coreMappings);
    const cutoffMs = Date.now();
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
    const subtotal = invoiceSubtotal(lines);
    if (lines.length === 0 || subtotal <= 0) {
      throw new Error('No unbilled time to invoice for this client.');
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
      subtotal,
      prevBilledThroughMs: client.billedThroughMs,
      cutoffMs,
      businessName: s.businessName,
      businessEmail: s.businessEmail,
      businessAddress: s.businessAddress,
      taxId: s.taxId,
      clientName: client.name,
      clientEmail: client.email,
      clientAddress: client.address,
    });
    await tx.insert(invoiceLines).values(
      lines.map((l) => ({
        invoiceId: id,
        label: l.label,
        hours: l.hours,
        ratePerHour: l.ratePerHour,
        amount: l.amount,
      })),
    );
    // Advance the reset mark — "reset the clock".
    await tx.update(clients).set({ billedThroughMs: cutoffMs }).where(eq(clients.id, clientId));
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

/** Delete an invoice; if it was the client's latest, un-reset their clock. */
export async function deleteInvoice(fd: FormData): Promise<void> {
  const invoiceId = str(fd, 'invoiceId');
  const db = getDb();
  await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!inv) return;
    const [client] = await tx.select().from(clients).where(eq(clients.id, inv.clientId));
    if (client && client.billedThroughMs === inv.cutoffMs) {
      await tx
        .update(clients)
        .set({ billedThroughMs: inv.prevBilledThroughMs })
        .where(eq(clients.id, inv.clientId));
    }
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
