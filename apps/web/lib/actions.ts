'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import {
  canDeleteClient,
  confirmationMatches,
  DEFAULT_ACCOUNT_KEY,
  docLabel,
  isBillingEvidence,
  isDocType,
  isKnownCurrency,
  normalizeCurrency,
  normalizePath,
  parseBriefText,
  prefixesAreDistinct,
  round2,
  weekRange,
  type ParsedBrief,
} from '@claude-invoicer/core';
import { getDb } from './db';
import {
  briefs,
  clients,
  folderMappings,
  invoiceLines,
  invoices,
  milestones,
  oneOffCharges,
  paymentAccounts,
  settings,
  weekAdjustments,
} from './db/schema';
import { getSettings } from './settings';
import { newId } from './format';
import {
  insertInvoice,
  issueWeekInvoice,
  issueMilestoneInvoice,
  issueBriefMilestones,
  markPaidTx,
  markPaidAndReceipt,
  emailInvoiceById,
  emailReceiptById,
} from './invoice-service';
import { extractDocxText } from './docx';
import { auth } from './auth';

/**
 * Server Actions are public HTTP endpoints dispatched by action id, not by
 * route — the middleware's path matcher does not protect them. Every action
 * that changes state calls this first. `markPaidPublic` is the deliberate
 * exception: it is authorised by the unguessable invoice token instead.
 */
async function requireOwner(): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error('Not signed in');
}

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim();
}
function num(fd: FormData, key: string, fallback = 0): number {
  const v = Number(fd.get(key));
  return Number.isFinite(v) ? v : fallback;
}
/** Like num(), but truncated for integer columns — a posted "14.5" must not reach an int4 column. */
function int(fd: FormData, key: string, fallback = 0): number {
  return Math.trunc(num(fd, key, fallback));
}
function numOrNull(fd: FormData, key: string): number | null {
  const raw = String(fd.get(key) ?? '').trim();
  if (raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : null;
}
/**
 * Like num(), but a blank field falls back rather than reading as 0 —
 * Number('') is 0 and finite, so num() can't tell "left blank" apart from
 * "typed 0". Used where the fallback is a meaningful default (e.g. the
 * client's own rate) that a blank field should defer to, not silently
 * override. Negatives are clamped to 0, same as the rest of this file's form
 * inputs — a form is not a security boundary.
 */
function numOrFallback(fd: FormData, key: string, fallback: number): number {
  const raw = String(fd.get(key) ?? '').trim();
  if (raw === '') return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, v);
}

// ---------------- Clients ----------------

/**
 * Create a client, optionally mapping a folder in the same transaction. The
 * mapping picks up every interval already tracked under that folder and its
 * subfolders; `billFrom=today` sets a cutoff at the start of today (in the
 * user's own browser timezone, via the `todayStartMs` hidden field) so this
 * morning's work is still billed. Falls back to the current instant if that
 * field is missing or unparseable (e.g. a JavaScript-disabled submit), which
 * is the safe direction — it undercounts rather than silently billing all
 * history.
 */
export async function createClient(fd: FormData): Promise<void> {
  await requireOwner();
  const name = str(fd, 'name');
  if (!name) throw new Error('Client name is required');
  const rawPath = str(fd, 'path');
  const db = getDb();
  const s = await getSettings();
  const id = newId();

  await db.transaction(async (tx) => {
    await tx.insert(clients).values({
      id,
      name,
      hourlyRate: num(fd, 'hourlyRate'),
      currency: normalizeCurrency(str(fd, 'currency')) || s.defaultCurrency,
      email: str(fd, 'email') || null,
      address: str(fd, 'address') || null,
    });

    if (rawPath) {
      const path = normalizePath(rawPath);
      const [existing] = await tx.select().from(folderMappings).where(eq(folderMappings.path, path));
      if (existing) {
        const [owner] = await tx.select().from(clients).where(eq(clients.id, existing.clientId));
        throw new Error(
          `That folder is already assigned to ${owner?.name ?? 'another client'}. Create the client without a folder, then move the folder from that client's page.`,
        );
      }
      let billFromMs = 0;
      if (str(fd, 'billFrom') === 'today') {
        const todayStartMs = Number(str(fd, 'todayStartMs'));
        billFromMs = Number.isFinite(todayStartMs) && todayStartMs > 0 ? todayStartMs : Date.now();
      }
      const label = str(fd, 'label') || null;
      await tx.insert(folderMappings).values({ id: newId(), clientId: id, path, label, billFromMs });
    }
  });

  revalidatePath('/');
  revalidatePath('/clients/' + id);
  redirect('/clients/' + id);
}

export async function updateClient(fd: FormData): Promise<void> {
  await requireOwner();
  const id = str(fd, 'id');
  if (!id) throw new Error('Missing client id');
  const round = int(fd, 'roundIncrementMin', -1);
  const db = getDb();
  await db
    .update(clients)
    .set({
      name: str(fd, 'name'),
      hourlyRate: num(fd, 'hourlyRate'),
      currency: normalizeCurrency(str(fd, 'currency')) || 'USD',
      email: str(fd, 'email') || null,
      address: str(fd, 'address') || null,
      roundIncrementMin: round >= 0 ? round : null,
    })
    .where(eq(clients.id, id));
  revalidatePath('/');
  revalidatePath('/clients/' + id);
}

export async function archiveClient(fd: FormData): Promise<void> {
  await requireOwner();
  const id = str(fd, 'id');
  const db = getDb();
  await db.update(clients).set({ archived: 1 }).where(eq(clients.id, id));
  revalidatePath('/');
  redirect('/');
}

export async function unarchiveClient(fd: FormData): Promise<void> {
  await requireOwner();
  const id = str(fd, 'id');
  if (!id) throw new Error('Missing client id');
  const db = getDb();
  await db.update(clients).set({ archived: 0 }).where(eq(clients.id, id));
  revalidatePath('/');
  revalidatePath('/clients/' + id);
}

/**
 * Permanently delete a client. Only clients who have never been invoiced can be
 * deleted; anyone else must be archived so the billing record survives. Folder
 * mappings, one-off charges and week adjustments cascade; the raw activity
 * intervals are kept and their folders simply return to the unassigned pool.
 */
export async function deleteClient(fd: FormData): Promise<void> {
  await requireOwner();
  const id = str(fd, 'id');
  if (!id) throw new Error('Missing client id');
  const db = getDb();

  await db.transaction(async (tx) => {
    const [client] = await tx.select().from(clients).where(eq(clients.id, id));
    if (!client) throw new Error('Client not found');

    // Only real invoices are billing history worth protecting — a client you
    // merely quoted has nothing to preserve. Matches invoiceCountFor, which
    // decides whether the UI offers Delete at all.
    const clientInvoices = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.clientId, id), eq(invoices.docType, 'invoice')));
    const check = canDeleteClient(client.name, clientInvoices.length);
    if (!check.allowed) throw new Error(check.reason);

    if (!confirmationMatches(str(fd, 'confirmName'), client.name)) {
      throw new Error(`Type “${client.name}” exactly to confirm deletion.`);
    }

    // An invoice created between the check and this delete makes the foreign
    // key reject the statement, which is the safe outcome.
    await tx.delete(clients).where(eq(clients.id, id));
  });

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
  await requireOwner();
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
  await requireOwner();
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
  await requireOwner();
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
  await requireOwner();
  const id = str(fd, 'id');
  const clientId = str(fd, 'clientId');
  const db = getDb();
  await db.delete(folderMappings).where(eq(folderMappings.id, id));
  revalidatePath('/');
  if (clientId) revalidatePath('/clients/' + clientId);
}

// ---------------- One-off charges ----------------

export async function addOneOff(fd: FormData): Promise<void> {
  await requireOwner();
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
  await requireOwner();
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
  await requireOwner();
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
  await requireOwner();
  const clientId = str(fd, 'clientId');
  const weekStart = str(fd, 'weekStart');
  const includeOneOffs = str(fd, 'includeOneOffs') === '1';
  if (!clientId) throw new Error('Missing client id');
  if (!weekStart) throw new Error('Missing week');

  const res = await issueWeekInvoice(clientId, weekStart, { includeOneOffs });
  if (!res.ok) {
    const msg =
      res.reason === 'already-invoiced'
        ? `Week of ${weekStart} is already invoiced${res.number ? ` (${res.number})` : ''}.`
        : res.reason === 'week-not-finished'
          ? `The week of ${weekStart} isn't finished yet — you can invoice it once it ends.`
          : res.reason === 'client-archived'
            ? 'This client is archived. Restore them before issuing an invoice.'
            : `Nothing to invoice for the week of ${weekStart}.`;
    throw new Error(msg);
  }
  try {
    await emailInvoiceById(res.id);
  } catch (e) {
    console.error('invoice email failed', e);
  }

  revalidatePath('/');
  revalidatePath('/clients/' + clientId);
  revalidatePath('/invoices');
  redirect('/invoices/' + res.id);
}

interface ManualLineInput {
  label: string;
  hours: number;
  ratePerHour: number;
  amount: number;
}

/**
 * Create an invoice by hand (for older / off-Claude work). Accepts arbitrary line
 * items, an optional issue date and number override, and an optional "already
 * paid" flag that issues the receipt immediately. Not tied to a tracked week, so
 * its week-window fields are set to -1 (never collides with a real week start).
 */
export async function createManualInvoice(fd: FormData): Promise<void> {
  await requireOwner();
  const clientId = str(fd, 'clientId');
  if (!clientId) throw new Error('Pick a client');

  let lines: ManualLineInput[] = [];
  try {
    const parsed = JSON.parse(str(fd, 'lines') || '[]') as unknown;
    lines = (Array.isArray(parsed) ? parsed : [])
      .map((l) => {
        const row = l as Record<string, unknown>;
        return {
          label: String(row.label ?? '').trim(),
          hours: Number(row.hours) || 0,
          ratePerHour: Number(row.ratePerHour) || 0,
          amount: Math.round((Number(row.amount) || 0) * 100) / 100,
        };
      })
      .filter((l) => l.label && l.amount !== 0);
  } catch {
    throw new Error('Could not read the line items');
  }
  if (lines.length === 0) throw new Error('Add at least one line item with a description and amount');

  const rawType = str(fd, 'docType') || 'invoice';
  if (!isDocType(rawType)) throw new Error('Unknown document type');

  const customNumber = str(fd, 'number');
  const issuedAtStr = str(fd, 'issuedAt');
  const markPaid = str(fd, 'markPaid') === '1';
  const paidAtStr = str(fd, 'paidAt');
  const db = getDb();

  const newInvoiceId = await db.transaction(async (tx) => {
    const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
    if (!s) throw new Error('Settings not initialized');
    const [client] = await tx.select().from(clients).where(eq(clients.id, clientId));
    if (!client) throw new Error('Client not found');
    if (client.archived) throw new Error('This client is archived. Restore them before issuing an invoice.');

    // A hand-typed number that collides with an existing one would otherwise
    // only surface as a bare unique-constraint violation once it hits the DB —
    // check it here, at the point of entry, so the user is told plainly.
    if (customNumber) {
      const [existing] = await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.number, customNumber));
      if (existing) throw new Error(`Number ${customNumber} is already used by another document.`);
    }

    const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
    const issuedAt = issuedAtStr ? new Date(`${issuedAtStr}T12:00:00Z`) : undefined;

    const { id } = await insertInvoice(tx, {
      client,
      settings: s,
      lines,
      subtotal,
      prevBilledThroughMs: -1,
      cutoffMs: -1,
      notes: `Manual ${docLabel(rawType).toLowerCase()}`,
      number: customNumber || undefined,
      issuedAt,
      docType: rawType,
    });

    if (markPaid && isBillingEvidence(rawType)) {
      const paidAt = paidAtStr ? new Date(`${paidAtStr}T12:00:00Z`) : new Date();
      await markPaidTx(tx, id, paidAt);
    }
    return id;
  });

  revalidatePath('/');
  revalidatePath('/invoices');
  redirect('/invoices/' + newInvoiceId);
}

/**
 * Turn a quote or pro forma into a real invoice: a new document with the next
 * invoice number, the same lines and totals, linked to the source in both
 * directions. The source is kept — it is the record of what was quoted.
 */
export async function convertDocument(fd: FormData): Promise<void> {
  await requireOwner();
  const sourceId = str(fd, 'id');
  if (!sourceId) throw new Error('Missing document id');
  const db = getDb();

  const newId2 = await db.transaction(async (tx) => {
    // Locked so a concurrent conversion of the same source (double-click, or
    // the same document open in two tabs) blocks on this row instead of both
    // transactions reading convertedToId as null and each issuing an invoice.
    const [source] = await tx.select().from(invoices).where(eq(invoices.id, sourceId)).for('update');
    if (!source) throw new Error('Document not found');
    if (isBillingEvidence(source.docType)) throw new Error('This is already an invoice.');
    if (source.convertedToId) throw new Error('This document has already been converted.');

    const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
    if (!s) throw new Error('Settings not initialized');
    const [client] = await tx.select().from(clients).where(eq(clients.id, source.clientId));
    if (!client) throw new Error('Client not found');
    if (client.archived) throw new Error('This client is archived. Restore them before invoicing.');

    const sourceLines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, sourceId));
    const newLines = sourceLines.map((l) => ({
      label: l.label,
      hours: l.hours,
      ratePerHour: l.ratePerHour,
      amount: l.amount,
    }));
    // Recomputed from the rows actually being inserted rather than trusted
    // from source.subtotal — they should always agree, but recomputing here
    // removes a class of silent drift.
    const subtotal = round2(newLines.reduce((sum, l) => sum + l.amount, 0));

    const { id } = await insertInvoice(tx, {
      client,
      settings: s,
      lines: newLines,
      subtotal,
      prevBilledThroughMs: -1,
      cutoffMs: -1,
      notes: `Converted from ${source.number}`,
      docType: 'invoice',
      convertedFromId: source.id,
      // The source is the record of what was quoted — if the client's currency
      // changed since, the invoice must still honour the quoted currency rather
      // than silently re-denominating the same line amounts.
      currency: source.currency,
    });

    await tx.update(invoices).set({ convertedToId: id }).where(eq(invoices.id, sourceId));
    return id;
  });

  revalidatePath('/invoices');
  revalidatePath('/invoices/' + sourceId);
  redirect('/invoices/' + newId2);
}

export async function markInvoicePaid(fd: FormData): Promise<void> {
  await requireOwner();
  const invoiceId = str(fd, 'invoiceId');
  if (!invoiceId) throw new Error('Missing invoice id');
  const receiptNumber = await markPaidAndReceipt(invoiceId);
  if (receiptNumber) {
    try {
      await emailReceiptById(invoiceId);
    } catch (e) {
      console.error('receipt email failed', e);
    }
  }
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
  await requireOwner();
  const invoiceId = str(fd, 'invoiceId');
  const db = getDb();
  // The other side of a conversion link this delete breaks, if any — revalidated
  // below so its "converted" badge / link doesn't point at a 404 until then.
  let linkedId: string | null = null;
  await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!inv) return;
    await tx
      .update(oneOffCharges)
      .set({ billedInvoiceId: null })
      .where(eq(oneOffCharges.billedInvoiceId, invoiceId));

    // Deleting a converted invoice must release its source, or the quote is
    // left linked to a row that no longer exists and can never be converted again.
    if (inv.convertedFromId) {
      await tx.update(invoices).set({ convertedToId: null }).where(eq(invoices.id, inv.convertedFromId));
      linkedId = inv.convertedFromId;
    }
    // Deleting the source of a conversion leaves the same dangling link in the
    // other direction — clear the target's back-reference too.
    if (inv.convertedToId) {
      await tx.update(invoices).set({ convertedFromId: null }).where(eq(invoices.id, inv.convertedToId));
      linkedId = inv.convertedToId;
    }

    await tx.delete(invoices).where(eq(invoices.id, invoiceId));
  });
  revalidatePath('/');
  revalidatePath('/invoices');
  if (linkedId) revalidatePath('/invoices/' + linkedId);
  redirect('/invoices');
}

/**
 * Set a week's billable-hours adjustment (a signed delta applied at issue time).
 * `set` overrides the stored value; otherwise `delta` is added to it. Zero clears it.
 */
export async function adjustWeek(fd: FormData): Promise<void> {
  await requireOwner();
  const clientId = str(fd, 'clientId');
  const weekStart = str(fd, 'weekStart');
  if (!clientId || !weekStart) throw new Error('Missing client or week');
  const s = await getSettings();
  const { startMs } = weekRange(weekStart, s.timezone);
  const db = getDb();

  const [cur] = await db
    .select()
    .from(weekAdjustments)
    .where(and(eq(weekAdjustments.clientId, clientId), eq(weekAdjustments.weekStartMs, startMs)));
  const current = cur?.adjustHours ?? 0;

  const setRaw = String(fd.get('set') ?? '').trim();
  let next = setRaw !== '' ? Number(setRaw) || 0 : current + (Number(fd.get('delta')) || 0);
  next = round2(next);

  if (next === 0) {
    await db
      .delete(weekAdjustments)
      .where(and(eq(weekAdjustments.clientId, clientId), eq(weekAdjustments.weekStartMs, startMs)));
  } else {
    await db
      .insert(weekAdjustments)
      .values({ clientId, weekStartMs: startMs, adjustHours: next })
      .onConflictDoUpdate({
        target: [weekAdjustments.clientId, weekAdjustments.weekStartMs],
        set: { adjustHours: next },
      });
  }
  revalidatePath('/');
  revalidatePath('/clients/' + clientId);
}

/**
 * Issue (and email) an invoice for a client's unbilled one-off charges on their
 * own — no tracked week required. Window fields are -1 (not a tracked week).
 */
export async function billOneOffs(fd: FormData): Promise<void> {
  await requireOwner();
  const clientId = str(fd, 'clientId');
  if (!clientId) throw new Error('Missing client id');
  const db = getDb();

  const newInvoiceId = await db.transaction(async (tx) => {
    const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
    if (!s) throw new Error('Settings not initialized');
    const [client] = await tx.select().from(clients).where(eq(clients.id, clientId));
    if (!client) throw new Error('Client not found');
    if (client.archived) throw new Error('This client is archived. Restore them before issuing an invoice.');

    const charges = await tx
      .select()
      .from(oneOffCharges)
      .where(and(eq(oneOffCharges.clientId, clientId), isNull(oneOffCharges.billedInvoiceId)));
    if (charges.length === 0) throw new Error('No unbilled one-off charges for this client');

    const subtotal = round2(charges.reduce((sum, c) => sum + c.amount, 0));
    const { id } = await insertInvoice(tx, {
      client,
      settings: s,
      lines: charges.map((c) => ({ label: c.description, hours: 0, ratePerHour: 0, amount: c.amount })),
      subtotal,
      prevBilledThroughMs: -1,
      cutoffMs: -1,
      notes: 'One-off charges',
    });
    for (const c of charges) {
      await tx.update(oneOffCharges).set({ billedInvoiceId: id }).where(eq(oneOffCharges.id, c.id));
    }
    return id;
  });

  try {
    await emailInvoiceById(newInvoiceId);
  } catch (e) {
    console.error('one-off invoice email failed', e);
  }
  revalidatePath('/');
  revalidatePath('/clients/' + clientId);
  revalidatePath('/invoices');
  redirect('/invoices/' + newInvoiceId);
}

// ---------------- Settings ----------------

export async function updateSettings(fd: FormData): Promise<void> {
  await requireOwner();
  const db = getDb();
  await getSettings(); // ensure row exists

  const invoicePrefix = str(fd, 'invoicePrefix') || 'INV';
  const quotePrefix = str(fd, 'quotePrefix') || 'QUO';
  const proformaPrefix = str(fd, 'proformaPrefix') || 'PF';
  // Sharing a prefix across types would either collide numbers or silently
  // interleave a quote/pro forma into the invoice sequence, defeating the
  // unbroken-run guarantee the per-type sequences exist to provide.
  if (!prefixesAreDistinct(invoicePrefix, quotePrefix, proformaPrefix)) {
    throw new Error('Invoice, quote and pro forma prefixes must all be different.');
  }

  await db
    .update(settings)
    .set({
      businessName: str(fd, 'businessName') || 'My Business',
      businessEmail: str(fd, 'businessEmail') || null,
      businessAddress: str(fd, 'businessAddress') || null,
      taxId: str(fd, 'taxId') || null,
      defaultCurrency: normalizeCurrency(str(fd, 'defaultCurrency')) || 'USD',
      defaultRoundIncrementMin: int(fd, 'defaultRoundIncrementMin', 15),
      roundMode: str(fd, 'roundMode') || 'up',
      defaultIdleCapMin: int(fd, 'defaultIdleCapMin', 5),
      timezone: str(fd, 'timezone') || 'UTC',
      autoSendWeekly: str(fd, 'autoSendWeekly') === '1' ? 1 : 0,
      paymentTermsDays: int(fd, 'paymentTermsDays', 14),
      vatRate: num(fd, 'vatRate', 0),
      vatNumber: str(fd, 'vatNumber') || null,
      invoicePrefix,
      quotePrefix,
      proformaPrefix,
    })
    .where(eq(settings.id, 1));
  revalidatePath('/');
  revalidatePath('/settings');
}

/** Manually email (or re-send) an invoice to the given / on-file recipient. */
export async function emailInvoice(fd: FormData): Promise<void> {
  await requireOwner();
  const invoiceId = str(fd, 'invoiceId');
  if (!invoiceId) throw new Error('Missing invoice id');
  const to = str(fd, 'to');
  const res = await emailInvoiceById(invoiceId, to || undefined);
  if (!res.sent) throw new Error('No recipient email — enter an address to send to.');
  revalidatePath('/invoices/' + invoiceId);
}

/** Client-facing mark-paid via the public token: marks paid, issues + emails the receipt. */
export async function markPaidPublic(fd: FormData): Promise<void> {
  const token = str(fd, 'token');
  if (!token) throw new Error('Missing token');
  const db = getDb();
  const [inv] = await db.select().from(invoices).where(eq(invoices.publicToken, token));
  if (!inv) throw new Error('Invoice not found');

  const receiptNumber = await markPaidAndReceipt(inv.id);
  if (receiptNumber) {
    try {
      await emailReceiptById(inv.id);
    } catch (e) {
      console.error('receipt email failed', e);
    }
  }
  revalidatePath('/i/' + token);
  revalidatePath('/');
  revalidatePath('/invoices');
  revalidatePath('/invoices/' + inv.id);
}

// ---------------- Payment accounts ----------------

/**
 * Create or replace the bank details for one currency. `currency` is either an
 * ISO code or 'DEFAULT' for the fallback used when a currency has no own row.
 */
export async function savePaymentAccount(fd: FormData): Promise<void> {
  await requireOwner();
  const raw = str(fd, 'currency');
  if (!raw) throw new Error('Pick a currency for these details');
  const currency = raw === DEFAULT_ACCOUNT_KEY ? DEFAULT_ACCOUNT_KEY : normalizeCurrency(raw);
  if (currency !== DEFAULT_ACCOUNT_KEY && !isKnownCurrency(currency)) {
    throw new Error(`"${currency}" isn't a currency this app knows — pick one from the list.`);
  }
  const values = {
    accountName: str(fd, 'accountName') || null,
    bankName: str(fd, 'bankName') || null,
    sortCode: str(fd, 'sortCode') || null,
    accountNumber: str(fd, 'accountNumber') || null,
    iban: str(fd, 'iban') || null,
    bic: str(fd, 'bic') || null,
    routingNumber: str(fd, 'routingNumber') || null,
    notes: str(fd, 'notes') || null,
  };
  const db = getDb();
  await db
    .insert(paymentAccounts)
    .values({ id: newId(), currency, ...values })
    .onConflictDoUpdate({ target: paymentAccounts.currency, set: values });
  revalidatePath('/settings');
}

export async function deletePaymentAccount(fd: FormData): Promise<void> {
  await requireOwner();
  const currency = str(fd, 'currency');
  if (!currency) throw new Error('Missing currency');
  const db = getDb();
  await db.delete(paymentAccounts).where(eq(paymentAccounts.currency, currency));
  revalidatePath('/settings');
}

// ---------------- Briefs ----------------

const MAX_BRIEF_BYTES = 2 * 1024 * 1024;

/**
 * Parse an uploaded or pasted estimate. Returns the parse for the user to
 * confirm — it never writes anything. `error` is set rather than thrown so the
 * form can show the problem beside the field instead of on an error page.
 *
 * `sourceText` carries back whatever text was actually handed to the parser
 * (the paste, or the extracted file contents) so the caller can round-trip it
 * into `createBrief` without trying to reconstruct it client-side — for an
 * uploaded file there is no client-side copy of that text to reconstruct.
 */
export async function parseBriefUpload(
  fd: FormData,
): Promise<ParsedBrief & { error?: string; sourceText?: string }> {
  await requireOwner();
  const empty: ParsedBrief = { title: '', currency: 'GBP', ratePerHour: 0, items: [], warnings: [] };
  // A parse with no items leaves the user staring at an empty table with no
  // explanation, so every parsing path — paste and every file type — goes
  // through this guard rather than returning the empty ParsedBrief bare.
  const withGuard = (
    p: ParsedBrief,
    sourceText: string,
  ): ParsedBrief & { error?: string; sourceText?: string } =>
    p.items.length === 0
      ? {
          ...p,
          sourceText,
          error: 'No work items found. Check the estimate has rows with hours and a cost, or paste the text and edit it by hand.',
        }
      : { ...p, sourceText };

  try {
    const pasted = str(fd, 'text');
    if (pasted) return withGuard(parseBriefText(pasted), pasted);

    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { ...empty, error: 'Choose a file or paste the estimate text.' };
    }
    if (file.size > MAX_BRIEF_BYTES) {
      return { ...empty, error: 'That file is over 2 MB. Paste the text instead.' };
    }

    const name = file.name.toLowerCase();
    if (name.endsWith('.docx')) {
      const text = await extractDocxText(await file.arrayBuffer());
      return withGuard(parseBriefText(text), text);
    }
    if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv')) {
      const text = await file.text();
      return withGuard(parseBriefText(text), text);
    }
    return {
      ...empty,
      error: 'Upload a .docx, .txt, .md or .csv — or paste the text. (.doc and .pdf are not supported yet.)',
    };
  } catch (e) {
    return { ...empty, error: `Could not parse the estimate: ${e instanceof Error ? e.message : 'unknown error'}` };
  }
}

interface BriefItemInput {
  section: string;
  title: string;
  deliverable: string;
  amount: number;
  hoursLow: number;
  hoursHigh: number;
  amountLow: number;
  amountHigh: number;
}

/** Short, stable, human-legible key for a milestone: M1, M2, … */
function milestoneKey(idx: number): string {
  return `M${idx + 1}`;
}

/** Save a confirmed brief and its milestones. */
export async function createBrief(fd: FormData): Promise<void> {
  await requireOwner();
  const clientId = str(fd, 'clientId');
  if (!clientId) throw new Error('Pick a client');
  const title = str(fd, 'title') || 'Untitled brief';

  // A form is not a security boundary — the estimate fields are free-text
  // inputs client-side, so a negative here is clamped to 0 rather than
  // trusted, whatever the browser did or didn't validate.
  const nonNeg = (v: unknown): number => Math.max(0, Number(v) || 0);

  let items: BriefItemInput[] = [];
  try {
    const parsed = JSON.parse(str(fd, 'items') || '[]') as unknown;
    items = (Array.isArray(parsed) ? parsed : [])
      .map((r) => {
        const row = r as Record<string, unknown>;
        return {
          section: String(row.section ?? '').trim(),
          title: String(row.title ?? '').trim(),
          deliverable: String(row.deliverable ?? '').trim(),
          amount: nonNeg(row.amount),
          hoursLow: nonNeg(row.hoursLow),
          hoursHigh: nonNeg(row.hoursHigh),
          amountLow: nonNeg(row.amountLow),
          amountHigh: nonNeg(row.amountHigh),
        };
      })
      .filter((r) => r.title);
  } catch {
    throw new Error('Could not read the work items');
  }
  if (items.length === 0) throw new Error('A brief needs at least one work item');

  const billingMode = str(fd, 'billingMode') === 'fixed' ? 'fixed' : 'time';
  const folderMappingId = str(fd, 'folderMappingId');
  const db = getDb();
  const briefId = newId();

  await db.transaction(async (tx) => {
    const [client] = await tx.select().from(clients).where(eq(clients.id, clientId));
    if (!client) throw new Error('Client not found');

    await tx.insert(briefs).values({
      id: briefId,
      clientId,
      title,
      billingMode,
      currency: normalizeCurrency(str(fd, 'currency')) || client.currency,
      ratePerHour: numOrFallback(fd, 'ratePerHour', client.hourlyRate),
      folderMappingId: folderMappingId || null,
      sourceText: str(fd, 'sourceText') || null,
    });

    await tx.insert(milestones).values(
      items.map((it, i) => ({
        id: newId(),
        briefId,
        idx: i,
        key: milestoneKey(i),
        section: it.section || null,
        title: it.title,
        deliverable: it.deliverable || null,
        amount: billingMode === 'fixed' ? it.amount || it.amountHigh : 0,
        estimateHoursLow: it.hoursLow,
        estimateHoursHigh: it.hoursHigh,
        estimateAmountLow: it.amountLow,
        estimateAmountHigh: it.amountHigh,
      })),
    );
  });

  revalidatePath('/clients/' + clientId);
  redirect('/briefs/' + briefId);
}

export async function deleteBrief(fd: FormData): Promise<void> {
  await requireOwner();
  const id = str(fd, 'id');
  if (!id) throw new Error('Missing brief id');
  const db = getDb();
  const [brief] = await db.select().from(briefs).where(eq(briefs.id, id));
  if (!brief) {
    // Already gone — a double-click race, most likely. Refresh so the UI
    // drops it instead of leaving the caller with no feedback at all.
    revalidatePath('/');
    return;
  }
  // Milestones cascade on delete, so a brief that has already billed would take
  // its milestone rows with it and leave those invoices pointing at nothing.
  // Invoices are the accounting record; the brief is not worth that.
  const billed = await db
    .select({ id: milestones.id })
    .from(milestones)
    .where(and(eq(milestones.briefId, id), isNotNull(milestones.invoiceId)));
  if (billed.length > 0) {
    throw new Error(
      `Cannot delete "${brief.title}" — ${billed.length} milestone(s) have already been invoiced. ` +
        'Archive the brief instead.',
    );
  }
  await db.delete(briefs).where(eq(briefs.id, id));
  revalidatePath('/clients/' + brief.clientId);
  redirect('/clients/' + brief.clientId);
}

/**
 * Edit a brief's own fields. The brief is the thing work is done against, so it
 * has to be amendable after import — scope and pricing move.
 *
 * `recompute` rewrites every milestone's estimate range as hours × the new
 * rate. That is the honest way to change currency on a time & materials brief:
 * the quoted amounts were themselves derived from hours × rate, so applying an
 * FX rate to them would compound one derivation on top of another. A fixed-price
 * brief's agreed `amount` is deliberately NOT touched — that is a number agreed
 * with the client, not a computed one.
 */
export async function updateBrief(fd: FormData): Promise<void> {
  await requireOwner();
  const id = str(fd, 'id');
  if (!id) throw new Error('Missing brief id');
  const db = getDb();
  const [brief] = await db.select().from(briefs).where(eq(briefs.id, id));
  if (!brief) throw new Error('Brief not found');

  const title = str(fd, 'title') || brief.title;
  const currency = normalizeCurrency(str(fd, 'currency')) || brief.currency;
  const ratePerHour = numOrFallback(fd, 'ratePerHour', brief.ratePerHour);
  const billingMode = str(fd, 'billingMode') === 'fixed' ? 'fixed' : 'time';
  const recompute = str(fd, 'recompute') === 'on';

  await db.transaction(async (tx) => {
    await tx
      .update(briefs)
      .set({ title, currency, ratePerHour, billingMode })
      .where(eq(briefs.id, id));

    if (recompute) {
      const rows = await tx.select().from(milestones).where(eq(milestones.briefId, id));
      for (const m of rows) {
        // Never re-price a milestone that has already been billed — its invoice
        // is the record of what was charged and must not drift from it.
        if (m.status === 'invoiced' || m.invoiceId) continue;
        await tx
          .update(milestones)
          .set({
            estimateAmountLow: round2(m.estimateHoursLow * ratePerHour),
            estimateAmountHigh: round2(m.estimateHoursHigh * ratePerHour),
          })
          .where(eq(milestones.id, m.id));
      }
    }
  });

  revalidatePath('/briefs/' + id);
  revalidatePath('/clients/' + brief.clientId);
}

/**
 * Edit one milestone's scope and estimate. Blocked once billed: the invoice is
 * the record of what was charged, and letting the milestone drift away from it
 * would leave the two disagreeing with no way to tell which was right.
 */
export async function updateMilestone(fd: FormData): Promise<void> {
  await requireOwner();
  const id = str(fd, 'id');
  if (!id) throw new Error('Missing milestone id');
  const db = getDb();
  const [m] = await db.select().from(milestones).where(eq(milestones.id, id));
  if (!m) throw new Error('Milestone not found');
  if (m.status === 'invoiced' || m.invoiceId) {
    throw new Error('That milestone has already been invoiced and can no longer be edited.');
  }

  const [brief] = await db.select().from(briefs).where(eq(briefs.id, m.briefId));
  if (!brief) throw new Error('Brief not found');

  const title = str(fd, 'title') || m.title;
  // A range typed backwards is a slip, not an instruction — order it rather
  // than storing a range whose low exceeds its high.
  const rawLow = numOrFallback(fd, 'hoursLow', m.estimateHoursLow);
  const rawHigh = numOrFallback(fd, 'hoursHigh', m.estimateHoursHigh);
  const hoursLow = Math.min(rawLow, rawHigh);
  const hoursHigh = Math.max(rawLow, rawHigh);

  // On a time & materials brief the estimated cost IS hours × rate, so it is
  // derived here rather than typed. Letting it be entered separately lets the
  // two drift, and then neither is trustworthy. A fixed-price brief keeps its
  // agreed amount, which is a negotiated number, not a computed one.
  const isFixed = brief.billingMode === 'fixed';
  const amount = isFixed ? numOrFallback(fd, 'amount', m.amount) : 0;

  await db
    .update(milestones)
    .set({
      title,
      estimateHoursLow: hoursLow,
      estimateHoursHigh: hoursHigh,
      estimateAmountLow: round2(hoursLow * brief.ratePerHour),
      estimateAmountHigh: round2(hoursHigh * brief.ratePerHour),
      amount,
    })
    .where(eq(milestones.id, id));

  revalidatePath('/briefs/' + m.briefId);
}

/**
 * Attach (or detach) the folder a brief bills against, after import.
 *
 * A brief with no folder is invisible to the agent — `buildAgentBriefs` inner-
 * joins on the mapping — so no MILESTONES.md is ever written and time &
 * materials milestones have nothing to bill. The folder could previously only
 * be chosen at import time, which left a brief imported without one permanently
 * stuck.
 */
export async function setBriefFolder(fd: FormData): Promise<void> {
  await requireOwner();
  const id = str(fd, 'id');
  if (!id) throw new Error('Missing brief id');
  const folderMappingId = str(fd, 'folderMappingId');
  const db = getDb();

  const [brief] = await db.select().from(briefs).where(eq(briefs.id, id));
  if (!brief) throw new Error('Brief not found');

  if (folderMappingId) {
    // The mapping must belong to this brief's own client. Without this check a
    // brief could be pointed at another client's folder and bill their hours.
    const [mapping] = await db
      .select()
      .from(folderMappings)
      .where(eq(folderMappings.id, folderMappingId));
    if (!mapping) throw new Error('That folder no longer exists');
    if (mapping.clientId !== brief.clientId) {
      throw new Error('That folder belongs to a different client');
    }
  }

  await db
    .update(briefs)
    .set({ folderMappingId: folderMappingId || null })
    .where(eq(briefs.id, id));
  revalidatePath('/briefs/' + id);
  revalidatePath('/clients/' + brief.clientId);
}

/** Refresh every surface a milestone state change is visible on. */
function revalidateMilestone(briefId: string): void {
  revalidatePath('/briefs/' + briefId);
  revalidatePath('/'); // the dashboard's "Needs attention" list
  revalidatePath('/invoices');
}

/** Mark a milestone delivered: pending -> ready, starting the hold window. */
export async function completeMilestone(fd: FormData): Promise<void> {
  await requireOwner();
  const id = str(fd, 'id');
  if (!id) throw new Error('Missing milestone id');
  const db = getDb();
  const [m] = await db
    .update(milestones)
    .set({ status: 'ready', readyAt: new Date() })
    .where(and(eq(milestones.id, id), eq(milestones.status, 'pending')))
    .returning({ briefId: milestones.briefId });
  if (m) revalidateMilestone(m.briefId);
}

/** Pull a milestone back out of its hold window, before anything is billed. */
export async function cancelMilestone(fd: FormData): Promise<void> {
  await requireOwner();
  const id = str(fd, 'id');
  if (!id) throw new Error('Missing milestone id');
  const db = getDb();
  // Only 'ready' can be cancelled — invoiced and complete are terminal.
  const [m] = await db
    .update(milestones)
    .set({ status: 'pending', readyAt: null })
    .where(and(eq(milestones.id, id), eq(milestones.status, 'ready')))
    .returning({ briefId: milestones.briefId });
  if (m) revalidateMilestone(m.briefId);
}

/** Bill a ready milestone now, without waiting out the hold window. */
/**
 * Bill every milestone currently marked delivered on this brief, as one invoice
 * with a line each — without waiting out the hold window.
 *
 * This is the button that matters when several milestones are finished in one
 * go: it produces a single multi-line invoice rather than one per milestone.
 */
export async function issueBriefNow(fd: FormData): Promise<void> {
  await requireOwner();
  const briefId = str(fd, 'briefId');
  if (!briefId) throw new Error('Missing brief id');
  const res = await issueBriefMilestones(briefId);
  if (res.ok) {
    try {
      await emailInvoiceById(res.id);
    } catch (e) {
      console.warn('milestone invoice issued but not emailed:', e);
    }
  } else if (res.reason !== 'nothing-to-bill' && res.reason !== 'already-invoiced') {
    throw new Error(`Could not issue: ${res.reason}`);
  }
  revalidateMilestone(briefId);
}

export async function issueMilestoneNow(fd: FormData): Promise<void> {
  await requireOwner();
  const id = str(fd, 'id');
  if (!id) throw new Error('Missing milestone id');
  const [m] = await getDb()
    .select({ briefId: milestones.briefId })
    .from(milestones)
    .where(eq(milestones.id, id));
  const res = await issueMilestoneInvoice(id);
  if (res.ok) {
    // Best-effort: RESEND_API_KEY is often unset, and a failed send must not
    // hide an invoice that was genuinely issued.
    try {
      await emailInvoiceById(res.id);
    } catch (e) {
      console.warn('milestone invoice issued but not emailed:', e);
    }
  } else if (res.reason !== 'nothing-to-bill' && res.reason !== 'already-invoiced') {
    throw new Error(`Could not issue this milestone: ${res.reason}`);
  }
  if (m) revalidateMilestone(m.briefId);
}
