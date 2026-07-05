# Invoice Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner adjust a week's billable hours before invoicing, email invoices (manually or via a weekly cron), and let clients mark their invoice paid via a link that updates the dashboard and emails a receipt.

**Architecture:** A pure adjustment helper lands in `packages/core`. In `apps/web`, a new non-action service module (`lib/invoice-service.ts`) holds the shared transaction logic (`insertInvoice`, `issueWeekInvoice`, `markPaidTx`, email orchestration, cron runner) used by server actions, a public tokenized invoice surface, and a Vercel cron route. A new `lib/email.ts` wraps Resend. Emailing is best-effort and fires on issue.

**Tech Stack:** Next.js 15 (App Router, server actions), Drizzle ORM + Neon serverless Postgres, pdf-lib, Resend, vitest (core only), Tailwind.

## Global Constraints

- Node `>=20`. All code is ESM (`"type": "module"`).
- PDF/email/cron routes and any code touching `Buffer`/pdf-lib MUST set `export const runtime = 'nodejs'`.
- Do NOT reintroduce `@react-pdf/renderer`. PDFs use pdf-lib via `lib/pdf/render.ts`.
- Schema migrations are applied **manually in the Neon SQL editor** (no local `DATABASE_URL`, no drizzle CLI). `lib/db/schema.ts` is kept in sync for types only.
- Secrets live only in env vars; `.env*` is gitignored. Never commit key values. New env names: `RESEND_API_KEY`, `EMAIL_FROM`, `APP_BASE_URL`, `CRON_SECRET`.
- Money is rounded to 2 dp via core `round2`. Week boundaries use `settings.timezone`.
- A `'use server'` module (`lib/actions.ts`) may only export async server actions; all shared non-action helpers live in `lib/invoice-service.ts` / `lib/email.ts`.
- Server-side test gate for `apps/web` is `npm run typecheck --workspace @claude-invoicer/web` (there is no web unit-test harness); full behavior is verified manually on a Vercel preview in the final task.

---

### Task 1: Core — week adjustment line

**Files:**
- Modify: `packages/core/src/billing.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/adjustment.test.ts` (create)

**Interfaces:**
- Consumes: `InvoiceLine`, `round2` (existing, `billing.ts`).
- Produces: `adjustmentLine(adjustHours: number, ratePerHour: number): InvoiceLine | null`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/adjustment.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { adjustmentLine } from '../src/billing.js';

describe('adjustmentLine', () => {
  it('builds a positive adjustment line at the given rate', () => {
    expect(adjustmentLine(2, 100)).toEqual({
      label: 'Time adjustment',
      rawMs: 0,
      hours: 2,
      ratePerHour: 100,
      amount: 200,
    });
  });

  it('supports a negative adjustment (a discount)', () => {
    const line = adjustmentLine(-1.5, 80);
    expect(line?.hours).toBe(-1.5);
    expect(line?.amount).toBe(-120);
  });

  it('returns null for a zero adjustment', () => {
    expect(adjustmentLine(0, 100)).toBeNull();
  });

  it('rounds hours and amount to 2dp', () => {
    const line = adjustmentLine(0.1 + 0.2, 100); // 0.30000000000000004
    expect(line?.hours).toBe(0.3);
    expect(line?.amount).toBe(30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @claude-invoicer/core`
Expected: FAIL — `adjustmentLine is not exported` / not a function.

- [ ] **Step 3: Implement `adjustmentLine`**

In `packages/core/src/billing.ts`, add after `invoiceSubtotal` (around line 212):

```ts
/**
 * A signed manual adjustment to a week's billable hours, expressed as a single
 * invoice line priced at `ratePerHour`. Returns null when the delta is zero.
 * The delta is absolute hours (positive adds, negative discounts).
 */
export function adjustmentLine(adjustHours: number, ratePerHour: number): InvoiceLine | null {
  if (!adjustHours) return null;
  const hours = round2(adjustHours);
  return { label: 'Time adjustment', rawMs: 0, hours, ratePerHour, amount: round2(hours * ratePerHour) };
}
```

- [ ] **Step 4: Export it**

In `packages/core/src/index.ts`, add `adjustmentLine,` to the `./billing.js` export block (next to `invoiceSubtotal,`):

```ts
  buildInvoiceLines,
  invoiceSubtotal,
  adjustmentLine,
  applyFolderCutoffs,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace @claude-invoicer/core`
Expected: PASS (all files, including existing billing/matcher/time-engine tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/billing.ts packages/core/src/index.ts packages/core/test/adjustment.test.ts
git commit -m "feat(core): add adjustmentLine for signed week hours deltas"
```

---

### Task 2: Schema migration + public-token helper

**Files:**
- Modify: `apps/web/lib/db/schema.ts`
- Modify: `apps/web/lib/format.ts`
- Reference (manual SQL): the design doc's schema block

**Interfaces:**
- Produces: `weekAdjustments` table + `WeekAdjustment` type; `invoices.publicToken/emailedAt/emailedTo`; `settings.autoSendWeekly`; `newToken(): string`.

- [ ] **Step 1: Apply the migration in the Neon SQL editor (manual)**

This is a human action — run this SQL in the Neon SQL editor for the project's database before deploying code that reads the new columns (it is additive and idempotent):

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS public_token text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS emailed_to text;
UPDATE invoices SET public_token = encode(gen_random_bytes(18), 'hex') WHERE public_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_public_token_unique ON invoices(public_token);

ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_send_weekly integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS week_adjustments (
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_start_ms bigint NOT NULL,
  adjust_hours double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, week_start_ms)
);

-- Concurrency guard (chosen during review): a given client+week can be invoiced
-- once. Partial so manual / one-off invoices (window = -1) can still repeat.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_client_week_unique
  ON invoices(client_id, prev_billed_through_ms) WHERE prev_billed_through_ms >= 0;

-- One receipt per invoice (guards a concurrent double mark-paid from creating two).
CREATE UNIQUE INDEX IF NOT EXISTS receipts_invoice_unique ON receipts(invoice_id);
```

- [ ] **Step 2: Update Drizzle schema — invoices columns**

In `apps/web/lib/db/schema.ts`, inside the `invoices` table (after `taxId` / before `clientName`, order is cosmetic), add:

```ts
  publicToken: text('public_token'),
  emailedAt: timestamp('emailed_at', { withTimezone: true }),
  emailedTo: text('emailed_to'),
```

- [ ] **Step 3: Update Drizzle schema — settings column**

In the `settings` table (after `receiptSeq`), add:

```ts
  autoSendWeekly: integer('auto_send_weekly').notNull().default(0),
```

- [ ] **Step 4: Add the `week_adjustments` table + type**

At the end of `apps/web/lib/db/schema.ts`, before the `export type` block, add:

```ts
/** Signed per-week billable-hours adjustment (applied at issue time). */
export const weekAdjustments = pgTable(
  'week_adjustments',
  {
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    weekStartMs: bigint('week_start_ms', { mode: 'number' }).notNull(),
    adjustHours: doublePrecision('adjust_hours').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.clientId, t.weekStartMs] }) }),
);
```

Then add to the type exports at the bottom:

```ts
export type WeekAdjustment = typeof weekAdjustments.$inferSelect;
```

- [ ] **Step 5: Add `newToken` helper**

In `apps/web/lib/format.ts`, add at the end:

```ts
/** Unguessable URL-safe token for public invoice links (144 bits of entropy). */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace @claude-invoicer/web`
Expected: PASS (no type errors).

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/db/schema.ts apps/web/lib/format.ts
git commit -m "feat(web): schema for public token, email fields, week adjustments"
```

---

### Task 3: Email module (Resend) + dependency + env example

**Files:**
- Modify: `apps/web/package.json` (via npm install)
- Create: `apps/web/lib/email.ts`
- Modify: `apps/web/.env.example`

**Interfaces:**
- Consumes: `InvoiceDetail` (from `lib/queries`), `renderInvoicePdf`/`renderReceiptPdf`.
- Produces: `sendInvoiceEmail(detail: InvoiceDetail, to: string): Promise<void>`, `sendReceiptEmail(detail: InvoiceDetail, to: string): Promise<void>`.

- [ ] **Step 1: Install Resend**

Run: `npm install resend --workspace @claude-invoicer/web`
Expected: `resend` added to `apps/web/package.json` dependencies; lockfile updated.

- [ ] **Step 2: Create `apps/web/lib/email.ts`**

```ts
import { Resend } from 'resend';
import type { InvoiceDetail } from './queries';
import { renderInvoicePdf, renderReceiptPdf } from './pdf/render';
import { formatMoney, formatDate } from './format';
import type { Invoice, InvoiceLine } from './db/schema';

function client(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  return new Resend(key);
}
function baseUrl(): string {
  return (process.env.APP_BASE_URL || 'https://claude-invoicer-web.vercel.app').replace(/\/$/, '');
}
function fromAddress(): string {
  return process.env.EMAIL_FROM || 'onboarding@resend.dev';
}

function shell(title: string, bodyRows: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a2233;max-width:560px;margin:0 auto;padding:24px">
${title}${bodyRows}
<p style="color:#7a8699;font-size:12px;margin-top:28px">Generated by Claude Invoicer</p>
</div>`;
}

function invoiceHtml(invoice: Invoice, lines: InvoiceLine[], link: string, tz: string): string {
  const rows = lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #e8ecf3">${l.label}</td>
         <td style="padding:6px 0;border-bottom:1px solid #e8ecf3;text-align:right">${formatMoney(l.amount, invoice.currency)}</td></tr>`,
    )
    .join('');
  const body = `
<p>Hi ${invoice.clientName || 'there'},</p>
<p>Here is invoice <strong>${invoice.number}</strong>${invoice.notes ? ` (${invoice.notes})` : ''} from ${invoice.businessName || 'your contractor'}.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">${rows}
<tr><td style="padding:10px 0;font-weight:600">Total due</td>
<td style="padding:10px 0;text-align:right;font-weight:600">${formatMoney(invoice.subtotal, invoice.currency)}</td></tr></table>
<p style="margin:24px 0">
  <a href="${link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">View &amp; pay invoice</a>
</p>
<p style="color:#7a8699;font-size:13px">Issued ${formatDate(invoice.issuedAt, tz)}. The full invoice PDF is attached.</p>`;
  return shell(`<h2 style="margin:0 0 8px">Invoice ${invoice.number}</h2>`, body);
}

function receiptHtml(invoice: Invoice, receiptNumber: string | null, tz: string): string {
  const body = `
<p>Hi ${invoice.clientName || 'there'},</p>
<p>Thanks — we've recorded invoice <strong>${invoice.number}</strong> as paid${invoice.paidAt ? ` on ${formatDate(invoice.paidAt, tz)}` : ''}.</p>
<p>Your receipt${receiptNumber ? ` <strong>${receiptNumber}</strong>` : ''} for ${formatMoney(invoice.subtotal, invoice.currency)} is attached.</p>`;
  return shell(`<h2 style="margin:0 0 8px">Receipt ${receiptNumber ?? ''}</h2>`, body);
}

export async function sendInvoiceEmail(detail: InvoiceDetail, to: string): Promise<void> {
  const { invoice, lines, settings } = detail;
  const link = `${baseUrl()}/i/${invoice.publicToken}`;
  const pdf = await renderInvoicePdf(detail);
  const { error } = await client().emails.send({
    from: fromAddress(),
    to,
    subject: `Invoice ${invoice.number} from ${invoice.businessName || 'your contractor'}`,
    html: invoiceHtml(invoice, lines, link, settings.timezone),
    attachments: [{ filename: `${invoice.number}.pdf`, content: Buffer.from(pdf) }],
  });
  if (error) throw new Error(`Resend send failed: ${error.message ?? 'unknown error'}`);
}

export async function sendReceiptEmail(detail: InvoiceDetail, to: string): Promise<void> {
  const { invoice, receiptNumber, settings } = detail;
  const pdf = await renderReceiptPdf(detail);
  const { error } = await client().emails.send({
    from: fromAddress(),
    to,
    subject: `Receipt for invoice ${invoice.number}`,
    html: receiptHtml(invoice, receiptNumber, settings.timezone),
    attachments: [{ filename: `${receiptNumber ?? invoice.number}-receipt.pdf`, content: Buffer.from(pdf) }],
  });
  if (error) throw new Error(`Resend send failed: ${error.message ?? 'unknown error'}`);
}
```

- [ ] **Step 3: Add new env names to `.env.example`**

Append to `apps/web/.env.example`:

```bash

# --- Email (Resend) + public links + cron ---
RESEND_API_KEY="re_xxx"
EMAIL_FROM="help@yourdomain.com"
# Canonical prod URL used to build public invoice links in emails
APP_BASE_URL="https://claude-invoicer-web.vercel.app"
# Random secret; Vercel Cron sends it as the request's bearer token
CRON_SECRET="generate-a-long-random-string"
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace @claude-invoicer/web`
Expected: PASS (the `resend` types resolve; `InvoiceDetail`/`Invoice`/`InvoiceLine` imports valid).

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/lib/email.ts apps/web/.env.example package-lock.json
git commit -m "feat(web): Resend email module + env config"
```

---

### Task 4: Shared invoice service

**Files:**
- Create: `apps/web/lib/invoice-service.ts`
- Modify: `apps/web/lib/queries.ts` (add `getInvoiceByToken`)

**Interfaces:**
- Consumes: `getDb`, schema tables, core `weekRange`/`weekStartKey`/`buildInvoiceLines`/`invoiceSubtotal`/`adjustmentLine`/`round2`/`applyFolderCutoffs`/`intervalsForClient`, `getSettings`, `getInvoiceDetail`, `sendInvoiceEmail`/`sendReceiptEmail`, `newId`/`newToken`.
- Produces:
  - `insertInvoice(tx, args): Promise<{ id: string; number: string; token: string }>`
  - `issueWeekInvoice(clientId, weekStart, opts): Promise<{ ok: true; id; number } | { ok: false; reason: 'already-invoiced' | 'nothing' }>`
  - `markPaidTx(tx, invoiceId, paidAt?): Promise<string | null>` (returns receipt number, or null if already paid)
  - `ensurePublicToken(inv): Promise<string>`
  - `emailInvoiceById(invoiceId, toOverride?): Promise<{ sent: boolean; to?: string }>`
  - `emailReceiptById(invoiceId): Promise<boolean>`
  - `runWeeklyAutoSend(): Promise<CronSummary>`
  - `getInvoiceByToken(token): Promise<InvoiceDetail | null>` (in `queries.ts`)

- [ ] **Step 1: Add `getInvoiceByToken` to `queries.ts`**

In `apps/web/lib/queries.ts`, after `getInvoiceDetail` (around line 354), add:

```ts
export async function getInvoiceByToken(token: string): Promise<InvoiceDetail | null> {
  const db = getDb();
  const [inv] = await db.select().from(invoices).where(eq(invoices.publicToken, token));
  if (!inv) return null;
  const [lines, rcpt, s] = await Promise.all([
    db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)),
    db.select().from(receipts).where(eq(receipts.invoiceId, inv.id)),
    getSettings(),
  ]);
  return { invoice: inv, lines, receiptNumber: rcpt[0]?.number ?? null, settings: s };
}
```

- [ ] **Step 2: Create `apps/web/lib/invoice-service.ts`**

```ts
import { and, eq, isNull } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import {
  applyFolderCutoffs,
  intervalsForClient,
  buildInvoiceLines,
  invoiceSubtotal,
  adjustmentLine,
  round2,
  weekRange,
  weekStartKey,
  type ActivityInterval as CoreInterval,
  type FolderMapping as CoreMapping,
} from '@claude-invoicer/core';
import { getDb, schema } from './db';
import {
  activityIntervals,
  clients,
  folderMappings,
  invoiceLines,
  invoices,
  oneOffCharges,
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
}

/** Insert an invoice + its lines, assign number & public token, snapshot identity. */
export async function insertInvoice(
  tx: Tx,
  a: InsertInvoiceArgs,
): Promise<{ id: string; number: string; token: string }> {
  const id = newId();
  const token = newToken();
  let number = a.number ?? '';
  let seq = a.settings.invoiceSeq;
  if (!number) {
    seq = a.settings.invoiceSeq + 1;
    number = `INV-${String(seq).padStart(4, '0')}`;
  }
  await tx.insert(invoices).values({
    id,
    number,
    clientId: a.client.id,
    status: 'unpaid',
    currency: a.client.currency,
    subtotal: round2(a.subtotal),
    prevBilledThroughMs: a.prevBilledThroughMs,
    cutoffMs: a.cutoffMs,
    notes: a.notes,
    publicToken: token,
    businessName: a.settings.businessName,
    businessEmail: a.settings.businessEmail,
    businessAddress: a.settings.businessAddress,
    taxId: a.settings.taxId,
    clientName: a.client.name,
    clientEmail: a.client.email,
    clientAddress: a.client.address,
    ...(a.issuedAt ? { issuedAt: a.issuedAt } : {}),
  });
  await tx.insert(invoiceLines).values(a.lines.map((l) => ({ invoiceId: id, ...l })));
  if (!a.number) await tx.update(settings).set({ invoiceSeq: seq }).where(eq(settings.id, 1));
  return { id, number, token };
}

export type IssueResult =
  | { ok: true; id: string; number: string }
  | { ok: false; reason: 'already-invoiced' | 'nothing' };

/** Issue one client's week invoice (respecting the saved adjustment + one-offs). */
export async function issueWeekInvoice(
  clientId: string,
  weekStart: string,
  opts: { includeOneOffs: boolean },
): Promise<IssueResult> {
  const db = getDb();
  return db.transaction(async (tx): Promise<IssueResult> => {
    const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
    if (!s) throw new Error('Settings not initialized');
    const [client] = await tx.select().from(clients).where(eq(clients.id, clientId));
    if (!client) throw new Error('Client not found');

    const { startMs, endMs } = weekRange(weekStart, s.timezone);

    const existing = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.clientId, clientId), eq(invoices.prevBilledThroughMs, startMs)));
    if (existing[0]) return { ok: false, reason: 'already-invoiced' };

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
}

/** Mark an invoice paid + issue a receipt inside a transaction. Returns receipt number (null if already paid). */
export async function markPaidTx(tx: Tx, invoiceId: string, paidAt: Date = new Date()): Promise<string | null> {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw new Error('Invoice not found');
  if (inv.status === 'paid') return null;
  const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
  const seq = (s?.receiptSeq ?? 0) + 1;
  const number = `RCPT-${String(seq).padStart(4, '0')}`;
  await tx.update(invoices).set({ status: 'paid', paidAt }).where(eq(invoices.id, invoiceId));
  await tx.insert(receipts).values({ id: newId(), invoiceId, number });
  await tx.update(settings).set({ receiptSeq: seq }).where(eq(settings.id, 1));
  return number;
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
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @claude-invoicer/web`
Expected: PASS. (If the `Tx` type alias errors, confirm `drizzle-orm/neon-serverless` exports `NeonDatabase` — it does, and `lib/db/index.ts` already imports it.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/invoice-service.ts apps/web/lib/queries.ts
git commit -m "feat(web): shared invoice service (insert/issue/mark-paid/email/cron)"
```

---

### Task 5: Refactor existing actions onto the service + fire emails

Behavior-preserving refactor of `issueInvoice`, `createManualInvoice`, `markInvoicePaid` so they call the shared service, plus: `issueInvoice` and `markInvoicePaid` now fire best-effort emails.

**Files:**
- Modify: `apps/web/lib/actions.ts`

**Interfaces:**
- Consumes: `issueWeekInvoice`, `insertInvoice`, `markPaidTx`, `emailInvoiceById`, `emailReceiptById`, `round2`.

- [ ] **Step 1: Update imports in `actions.ts`**

Replace the core import block (lines 6–15) so it also imports `round2`, and add the service import. The top import section becomes:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { normalizePath, round2, weekRange } from '@claude-invoicer/core';
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
  weekAdjustments,
} from './db/schema';
import { getSettings } from './settings';
import { newId } from './format';
import {
  insertInvoice,
  issueWeekInvoice,
  markPaidTx,
  emailInvoiceById,
  emailReceiptById,
} from './invoice-service';
```

(Note: `buildInvoiceLines`, `intervalsForClient`, `invoiceSubtotal`, `applyFolderCutoffs`, and the Core type aliases are no longer used directly in `actions.ts` — remove them from the import to keep typecheck clean. `activityIntervals`/`folderMappings` remain used elsewhere? They are only used by the old `issueInvoice` body being replaced — after this task, verify with typecheck and drop any now-unused imports it flags.)

- [ ] **Step 2: Replace `issueInvoice`**

Replace the entire `issueInvoice` function (lines ~222–345) with:

```ts
export async function issueInvoice(fd: FormData): Promise<void> {
  const clientId = str(fd, 'clientId');
  const weekStart = str(fd, 'weekStart');
  const includeOneOffs = str(fd, 'includeOneOffs') === '1';
  if (!clientId) throw new Error('Missing client id');
  if (!weekStart) throw new Error('Missing week');

  const res = await issueWeekInvoice(clientId, weekStart, { includeOneOffs });
  if (!res.ok) {
    throw new Error(
      res.reason === 'already-invoiced'
        ? `Week of ${weekStart} is already invoiced.`
        : `Nothing to invoice for the week of ${weekStart}.`,
    );
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
```

- [ ] **Step 3: Replace the body of `createManualInvoice`'s transaction to use `insertInvoice` + `markPaidTx`**

Replace the `db.transaction(...)` block inside `createManualInvoice` (lines ~389–446) with:

```ts
  const newInvoiceId = await db.transaction(async (tx) => {
    const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
    if (!s) throw new Error('Settings not initialized');
    const [client] = await tx.select().from(clients).where(eq(clients.id, clientId));
    if (!client) throw new Error('Client not found');

    const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
    const issuedAt = issuedAtStr ? new Date(`${issuedAtStr}T12:00:00Z`) : undefined;

    const { id } = await insertInvoice(tx, {
      client,
      settings: s,
      lines,
      subtotal,
      prevBilledThroughMs: -1,
      cutoffMs: -1,
      notes: 'Manual invoice',
      number: customNumber || undefined,
      issuedAt,
    });

    if (markPaid) {
      const paidAt = paidAtStr ? new Date(`${paidAtStr}T12:00:00Z`) : new Date();
      await markPaidTx(tx, id, paidAt);
    }
    return id;
  });
```

(Manual invoices get a public token via `insertInvoice` but are NOT auto-emailed — they are typically historical. The owner can email them from the invoice page in Task 8.)

- [ ] **Step 4: Replace `markInvoicePaid`**

Replace the entire `markInvoicePaid` function (lines ~453–473) with:

```ts
export async function markInvoicePaid(fd: FormData): Promise<void> {
  const invoiceId = str(fd, 'invoiceId');
  if (!invoiceId) throw new Error('Missing invoice id');
  const db = getDb();
  const receiptNumber = await db.transaction((tx) => markPaidTx(tx, invoiceId));
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
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace @claude-invoicer/web`
Expected: PASS. Remove any imports flagged as unused (e.g. leftover `buildInvoiceLines`, `activityIntervals`, `folderMappings`, `invoiceLines`, `applyFolderCutoffs`, core types) if `createManualInvoice`/`issueInvoice` no longer reference them. `invoiceLines` is still used by `createManualInvoice`? No — `insertInvoice` handles lines now; drop it if unused. `weekAdjustments` import is added for Task 6; it may be flagged unused until then — either add it in Task 6 instead, or add a `// used in adjustWeek (Task 6)` and accept the warning. To keep typecheck strictly clean, DEFER adding `weekAdjustments`/`and`/`isNull`/`weekRange` to whichever later task first uses them.

> Implementation note: keep the import list minimal per task — add a symbol to the import only in the task that first uses it. The blocks above show the final intended set; trim to what compiles at each step.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/actions.ts
git commit -m "refactor(web): route issue/manual/mark-paid through invoice service + fire emails"
```

---

### Task 6: Week hours adjustment — action, query display, client-page UI

**Files:**
- Modify: `apps/web/lib/actions.ts` (add `adjustWeek`)
- Modify: `apps/web/lib/queries.ts` (thread adjustments into `clientWeeks`, `getWeekDetail`)
- Modify: `apps/web/app/clients/[id]/page.tsx` (adjust controls)

**Interfaces:**
- Consumes: `weekAdjustments`, `weekRange`, `adjustmentLine`, `round2`, `adjustWeek`.
- Produces: `BillableWeek.adjustHours`; `adjustWeek(fd: FormData): Promise<void>`.

- [ ] **Step 1: Add `adjustWeek` action**

Ensure `actions.ts` imports include `and`, `weekRange`, `weekAdjustments` (add now if deferred). Append this action to `actions.ts` (after the invoices section):

```ts
/**
 * Set a week's billable-hours adjustment (a signed delta applied at issue time).
 * `set` overrides the stored value; otherwise `delta` is added to it. Zero clears it.
 */
export async function adjustWeek(fd: FormData): Promise<void> {
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
```

- [ ] **Step 2: Thread adjustments into `queries.ts`**

(a) Add imports: in the core import block of `queries.ts` add `adjustmentLine,` and `round2,`; add `weekAdjustments,` and `type WeekAdjustment,` to the schema import.

(b) In `loadAll()`, add `weekAdjustments` to the parallel select and return it:

```ts
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
```

(c) Add a per-client adjustment map helper (near `billedWeekStarts`):

```ts
function adjustmentsFor(rows: WeekAdjustment[], clientId: string): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of rows) if (r.clientId === clientId) m.set(r.weekStartMs, r.adjustHours);
  return m;
}
```

(d) Add `adjustHours` to `BillableWeek`:

```ts
export interface BillableWeek {
  weekKey: string;
  startMs: number;
  endMs: number;
  activeMs: number;
  amount: number;
  adjustHours: number;
  billed: boolean;
  isCurrent: boolean;
}
```

(e) Change `clientWeeks` to accept + apply the adjustment map:

```ts
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
```

(f) Update both callers of `clientWeeks`:

In `getOverview`, destructure `adjRows` from `loadAll()` and inside the `stats` map:
```ts
    const billed = billedWeekStarts(invoiceRows, client.id);
    const adj = adjustmentsFor(adjRows, client.id);
    const weeks = clientWeeks(ci, client, coreMappings, billed, adj, s);
```

In `getClientDetail`, destructure `adjRows` too and:
```ts
  const billed = billedWeekStarts(invoiceRows, clientId);
  const adj = adjustmentsFor(adjRows, clientId);
  const weeks = clientWeeks(ci, client, coreMappings, billed, adj, s);
```

(g) In `getWeekDetail`, include the adjustment in the returned `lines` + `subtotal` so the drill-down matches what will be invoiced. After building `lines`, add:

```ts
  const [adjRow] = await db
    .select()
    .from(weekAdjustments)
    .where(and(eq(weekAdjustments.clientId, clientId), eq(weekAdjustments.weekStartMs, startMs)));
  const adjLine = adjustmentLine(adjRow?.adjustHours ?? 0, client.hourlyRate);
  const linesWithAdj = adjLine ? [...lines, adjLine] : lines;
```

Then return `lines: linesWithAdj` and `subtotal: invoiceSubtotal(linesWithAdj)`. Add `and` to the `drizzle-orm` import in `queries.ts` (currently only `desc, eq`).

- [ ] **Step 3: Add adjust controls to the client page**

In `apps/web/app/clients/[id]/page.tsx`:

(a) Import `adjustWeek`:
```ts
import {
  updateClient,
  addMapping,
  updateMapping,
  removeMapping,
  addOneOff,
  removeOneOff,
  issueInvoice,
  adjustWeek,
  archiveClient,
} from '@/lib/actions';
```

(b) Widen the billable-weeks filter and compute the step. Replace:
```ts
  const billableWeeks = weeks.filter((w) => w.amount > 0 || w.billed);
```
with:
```ts
  const billableWeeks = weeks.filter((w) => w.activeMs > 0 || w.billed || w.adjustHours !== 0);
  const stepH = Math.round((roundIncrementMin / 60) * 100) / 100;
```

(c) Add an "Adjust" header column. In the `<thead>` row, add a `<th>` before the Action column:
```tsx
                  <th className="pb-2 text-right">Adjust (hrs)</th>
                  <th className="pb-2 text-right">Action</th>
```

(d) In the amount cell, show the current adjustment note. Replace the amount `<td>` with:
```tsx
                      <td className="py-2 text-right">
                        {formatMoney(w.amount, client.currency)}
                        {w.adjustHours !== 0 && (
                          <div className="text-xs text-amber-300">
                            adj {w.adjustHours > 0 ? '+' : ''}
                            {w.adjustHours}h
                          </div>
                        )}
                      </td>
```

(e) Add the adjust cell before the existing Action `<td>` (only interactive when not yet billed):
```tsx
                      <td className="py-2 text-right">
                        {w.billed ? (
                          <span className="text-slate-600">—</span>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <form action={adjustWeek} className="inline">
                              <input type="hidden" name="clientId" value={client.id} />
                              <input type="hidden" name="weekStart" value={w.weekKey} />
                              <input type="hidden" name="delta" value={-stepH} />
                              <button className="btn-ghost px-2" type="submit" aria-label="Reduce hours">
                                −
                              </button>
                            </form>
                            <form action={adjustWeek} className="inline-flex items-center gap-1">
                              <input type="hidden" name="clientId" value={client.id} />
                              <input type="hidden" name="weekStart" value={w.weekKey} />
                              <input
                                name="set"
                                type="number"
                                step="0.25"
                                defaultValue={w.adjustHours || ''}
                                placeholder="0"
                                className="input w-16 py-0.5 text-right"
                                aria-label="Set adjustment hours"
                              />
                              <button className="btn-ghost px-2" type="submit">
                                Set
                              </button>
                            </form>
                            <form action={adjustWeek} className="inline">
                              <input type="hidden" name="clientId" value={client.id} />
                              <input type="hidden" name="weekStart" value={w.weekKey} />
                              <input type="hidden" name="delta" value={stepH} />
                              <button className="btn-ghost px-2" type="submit" aria-label="Add hours">
                                +
                              </button>
                            </form>
                          </div>
                        )}
                      </td>
```

(f) Add a helper line under the table explaining the control:
```tsx
        <p className="text-xs text-slate-500">
          Adjust nudges the week's billable hours by a signed delta (step {stepH}h) — it rides on the
          final tracked total and is applied whether you invoice by hand or the weekly cron does.
        </p>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace @claude-invoicer/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions.ts apps/web/lib/queries.ts apps/web/app/clients/[id]/page.tsx
git commit -m "feat(web): per-week hours adjustment (+/- and set), applied at issue time"
```

---

### Task 7: Bill one-off charges on their own

**Files:**
- Modify: `apps/web/lib/actions.ts` (add `billOneOffs`)
- Modify: `apps/web/app/clients/[id]/page.tsx` (button)

**Interfaces:**
- Consumes: `insertInvoice`, `emailInvoiceById`, `round2`, `isNull`.
- Produces: `billOneOffs(fd: FormData): Promise<void>`.

- [ ] **Step 1: Add `billOneOffs` action**

Ensure `isNull` is imported from `drizzle-orm`. Append to `actions.ts`:

```ts
/**
 * Issue (and email) an invoice for a client's unbilled one-off charges on their
 * own — no tracked week required. Window fields are -1 (not a tracked week).
 */
export async function billOneOffs(fd: FormData): Promise<void> {
  const clientId = str(fd, 'clientId');
  if (!clientId) throw new Error('Missing client id');
  const db = getDb();

  const newInvoiceId = await db.transaction(async (tx) => {
    const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
    if (!s) throw new Error('Settings not initialized');
    const [client] = await tx.select().from(clients).where(eq(clients.id, clientId));
    if (!client) throw new Error('Client not found');

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
```

- [ ] **Step 2: Add the button to the one-off section**

In `apps/web/app/clients/[id]/page.tsx`, import `billOneOffs` (add to the actions import), and in the one-off charges `<section>`, replace the existing hint paragraph with the hint + a conditional button:

```tsx
        <p className="text-xs text-slate-500">
          Flat fees not based on tracked time (e.g. a fixed-price website). Added to the next invoice
          you issue for this client, or bill them on their own below.
        </p>
        {oneOffTotal > 0 && (
          <form action={billOneOffs}>
            <input type="hidden" name="clientId" value={client.id} />
            <button className="btn-primary" type="submit">
              Bill one-offs now ({formatMoney(oneOffTotal, client.currency)})
            </button>
          </form>
        )}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @claude-invoicer/web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions.ts apps/web/app/clients/[id]/page.tsx
git commit -m "feat(web): 'Bill one-offs now' — issue + email a fixed-fee invoice"
```

---

### Task 8: Invoice detail — manual email control

**Files:**
- Modify: `apps/web/lib/actions.ts` (add `emailInvoice`)
- Modify: `apps/web/app/invoices/[id]/page.tsx`

**Interfaces:**
- Consumes: `emailInvoiceById`.
- Produces: `emailInvoice(fd: FormData): Promise<void>` (throws on failure so the owner sees it).

- [ ] **Step 1: Add `emailInvoice` action**

Append to `actions.ts`:

```ts
/** Manually email (or re-send) an invoice to the given / on-file recipient. */
export async function emailInvoice(fd: FormData): Promise<void> {
  const invoiceId = str(fd, 'invoiceId');
  if (!invoiceId) throw new Error('Missing invoice id');
  const to = str(fd, 'to');
  const res = await emailInvoiceById(invoiceId, to || undefined);
  if (!res.sent) throw new Error('No recipient email — enter an address to send to.');
  revalidatePath('/invoices/' + invoiceId);
}
```

- [ ] **Step 2: Add the email control to the invoice page**

In `apps/web/app/invoices/[id]/page.tsx`:

(a) Import `emailInvoice`:
```ts
import { markInvoicePaid, deleteInvoice, emailInvoice } from '@/lib/actions';
```

(b) Add an email card between the line-items card and the actions row (after the `</div>` that closes the `card` table wrapper, before the `flex flex-wrap items-center gap-3` actions block):

```tsx
      <div className="card space-y-2">
        <form action={emailInvoice} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <div className="flex-1 min-w-[16rem]">
            <label className="label">Client email</label>
            <input
              name="to"
              type="email"
              defaultValue={invoice.emailedTo ?? invoice.clientEmail ?? ''}
              placeholder="client@example.com"
              className="input"
            />
          </div>
          <button className="btn-primary" type="submit">
            {invoice.emailedAt ? 'Re-send email' : 'Email to client'}
          </button>
        </form>
        {invoice.emailedAt && (
          <p className="text-xs text-slate-500">
            Emailed {formatDate(invoice.emailedAt, settings.timezone)}
            {invoice.emailedTo ? ` to ${invoice.emailedTo}` : ''}. Public link:{' '}
            <code className="text-slate-400">/i/{invoice.publicToken}</code>
          </p>
        )}
      </div>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @claude-invoicer/web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions.ts apps/web/app/invoices/[id]/page.tsx
git commit -m "feat(web): manual email/re-send control on the invoice page"
```

---

### Task 9: Public invoice page + tokenized routes + client mark-paid

**Files:**
- Modify: `apps/web/lib/actions.ts` (add `markPaidPublic`)
- Modify: `apps/web/middleware.ts`
- Create: `apps/web/app/i/[token]/page.tsx`
- Create: `apps/web/app/i/[token]/pdf/route.ts`
- Create: `apps/web/app/i/[token]/receipt/route.ts`

**Interfaces:**
- Consumes: `getInvoiceByToken`, `markPaidTx`, `emailReceiptById`, `renderInvoicePdf`/`renderReceiptPdf`.
- Produces: `markPaidPublic(fd: FormData): Promise<void>`; public routes `/i/[token]`, `/i/[token]/pdf`, `/i/[token]/receipt`.

- [ ] **Step 1: Add `markPaidPublic` action**

Append to `actions.ts`:

```ts
/** Client-facing mark-paid via the public token: marks paid, issues + emails the receipt. */
export async function markPaidPublic(fd: FormData): Promise<void> {
  const token = str(fd, 'token');
  if (!token) throw new Error('Missing token');
  const db = getDb();
  const [inv] = await db.select().from(invoices).where(eq(invoices.publicToken, token));
  if (!inv) throw new Error('Invoice not found');

  const receiptNumber = await db.transaction((tx) => markPaidTx(tx, inv.id));
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
```

- [ ] **Step 2: Open the public paths in middleware**

Replace the matcher in `apps/web/middleware.ts`:

```ts
export { auth as middleware } from '@/lib/auth';

// Protect everything except the agent ingest endpoint, the cron endpoint, the
// auth routes, the public invoice pages (/i/...), the login page, and static assets.
export const config = {
  matcher: ['/((?!api/ingest|api/auth|api/cron|i/|_next/static|_next/image|favicon.ico|login).*)'],
};
```

- [ ] **Step 3: Create the public invoice page**

`apps/web/app/i/[token]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { getInvoiceByToken } from '@/lib/queries';
import { formatMoney, formatDate } from '@/lib/format';
import { markPaidPublic } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const detail = await getInvoiceByToken(token);
  if (!detail) notFound();
  const { invoice, lines, receiptNumber, settings } = detail;
  const paid = invoice.status === 'paid';

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <header className="flex items-start justify-between">
        <div>
          <div className="text-lg font-semibold">{invoice.businessName || 'Invoice'}</div>
          <div className="text-sm text-slate-400">
            {invoice.number} · issued {formatDate(invoice.issuedAt, settings.timezone)}
            {invoice.notes ? ` · ${invoice.notes}` : ''}
          </div>
        </div>
        <span
          className={
            paid
              ? 'rounded bg-green-900/40 px-3 py-1 text-sm text-green-300'
              : 'rounded bg-amber-900/40 px-3 py-1 text-sm text-amber-300'
          }
        >
          {invoice.status}
        </span>
      </header>

      <div className="text-sm text-slate-400">
        Billed to <span className="text-slate-200">{invoice.clientName}</span>
      </div>

      <div className="card">
        <table className="w-full text-sm">
          <thead className="text-slate-400">
            <tr className="text-left">
              <th className="pb-2">Description</th>
              <th className="pb-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-800">
                <td className="py-2">{l.label}</td>
                <td className="py-2 text-right">{formatMoney(l.amount, invoice.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700">
              <td className="pt-3 font-semibold">Total due</td>
              <td className="pt-3 text-right text-lg font-semibold">
                {formatMoney(invoice.subtotal, invoice.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a className="btn-ghost" href={`/i/${token}/pdf`} target="_blank" rel="noreferrer">
          Download invoice PDF
        </a>
        {!paid ? (
          <form action={markPaidPublic}>
            <input type="hidden" name="token" value={token} />
            <button className="btn-primary" type="submit">
              Mark as paid
            </button>
          </form>
        ) : (
          <a className="btn-ghost" href={`/i/${token}/receipt`} target="_blank" rel="noreferrer">
            Download receipt {receiptNumber ? `(${receiptNumber})` : ''}
          </a>
        )}
      </div>

      {paid && invoice.paidAt && (
        <p className="text-sm text-green-300">Paid on {formatDate(invoice.paidAt, settings.timezone)}. Thank you!</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create the public PDF route**

`apps/web/app/i/[token]/pdf/route.ts`:

```ts
import { getInvoiceByToken } from '@/lib/queries';
import { renderInvoicePdf } from '@/lib/pdf/render';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const detail = await getInvoiceByToken(token);
  if (!detail) return new Response('not found', { status: 404 });
  try {
    const buf = await renderInvoicePdf(detail);
    return new Response(new Uint8Array(buf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${detail.invoice.number}.pdf"`,
      },
    });
  } catch (e) {
    console.error('public PDF render failed', e);
    return new Response('Could not generate the invoice PDF.', { status: 500 });
  }
}
```

- [ ] **Step 5: Create the public receipt route**

`apps/web/app/i/[token]/receipt/route.ts`:

```ts
import { getInvoiceByToken } from '@/lib/queries';
import { renderReceiptPdf } from '@/lib/pdf/render';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const detail = await getInvoiceByToken(token);
  if (!detail) return new Response('not found', { status: 404 });
  if (detail.invoice.status !== 'paid') {
    return new Response('receipt available after the invoice is marked paid', { status: 409 });
  }
  const buf = await renderReceiptPdf(detail);
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${detail.receiptNumber ?? detail.invoice.number}-receipt.pdf"`,
    },
  });
}
```

- [ ] **Step 6: Typecheck + build**

Run: `npm run typecheck --workspace @claude-invoicer/web`
Expected: PASS.
Run: `npm run build --workspace @claude-invoicer/web`
Expected: build succeeds; route list includes `/i/[token]`, `/i/[token]/pdf`, `/i/[token]/receipt`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/actions.ts apps/web/middleware.ts "apps/web/app/i/[token]"
git commit -m "feat(web): public tokenized invoice page + client mark-paid + receipt"
```

---

### Task 10: Weekly cron + auto-send toggle

**Files:**
- Create: `apps/web/app/api/cron/weekly/route.ts`
- Create: `apps/web/vercel.json`
- Modify: `apps/web/lib/actions.ts` (`updateSettings` → persist `autoSendWeekly`)
- Modify: `apps/web/app/settings/page.tsx` (toggle)

**Interfaces:**
- Consumes: `runWeeklyAutoSend`.

- [ ] **Step 1: Create the cron route**

`apps/web/app/api/cron/weekly/route.ts`:

```ts
import { runWeeklyAutoSend } from '@/lib/invoice-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get('authorization');
    if (header !== `Bearer ${secret}`) return new Response('unauthorized', { status: 401 });
  }
  try {
    const summary = await runWeeklyAutoSend();
    return Response.json(summary);
  } catch (e) {
    console.error('weekly cron failed', e);
    return new Response('cron failed', { status: 500 });
  }
}
```

- [ ] **Step 2: Create `apps/web/vercel.json`**

```json
{
  "crons": [{ "path": "/api/cron/weekly", "schedule": "0 7 * * *" }]
}
```

(Runs daily at 07:00 UTC; the runner only acts on the previous completed week and is idempotent. Confirm in Vercel that the project's Root Directory is `apps/web` so this file is picked up; if the Root Directory is the repo root, move `vercel.json` there and set the path accordingly.)

- [ ] **Step 3: Persist `autoSendWeekly` in `updateSettings`**

In `actions.ts` `updateSettings`, add to the `.set({...})` object:

```ts
      autoSendWeekly: str(fd, 'autoSendWeekly') === '1' ? 1 : 0,
```

- [ ] **Step 4: Add the toggle to the settings page**

In `apps/web/app/settings/page.tsx`, add inside the form (e.g. after the Defaults group, before the submit button):

```tsx
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="autoSendWeekly" value="1" defaultChecked={s.autoSendWeekly === 1} />
          Enable weekly auto-send — each day the cron issues + emails every client's previous completed
          week (clients without an email are skipped).
        </label>
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck --workspace @claude-invoicer/web`
Expected: PASS.
Run: `npm run build --workspace @claude-invoicer/web`
Expected: build succeeds; `/api/cron/weekly` appears in the route list.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/cron/weekly/route.ts apps/web/vercel.json apps/web/lib/actions.ts apps/web/app/settings/page.tsx
git commit -m "feat(web): weekly auto-send cron + settings toggle"
```

---

### Task 11: Configuration + end-to-end verification

No new code — this task deploys, configures secrets, and verifies the full flow on a real deployment (there is no local DB).

- [ ] **Step 1: Confirm the Neon migration ran** (Task 2, Step 1). In the Neon SQL editor:

```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'invoices' AND column_name IN ('public_token','emailed_at','emailed_to');
SELECT to_regclass('week_adjustments');
SELECT column_name FROM information_schema.columns WHERE table_name = 'settings' AND column_name = 'auto_send_weekly';
```
Expected: all present.

- [ ] **Step 2: Set env vars in Vercel** (Production + Preview) — values from the scratch file, never committed:
  - `RESEND_API_KEY`, `EMAIL_FROM=help@punthub.co.uk`, `APP_BASE_URL=https://claude-invoicer-web.vercel.app`, `CRON_SECRET` (the generated value).

- [ ] **Step 3: Verify the sending domain in Resend** — add the DNS records for `punthub.co.uk` so `help@punthub.co.uk` can send. (Until verified, set `EMAIL_FROM` to `onboarding@resend.dev`, which only delivers to the Resend account owner — enough to smoke-test.)

- [ ] **Step 4: Deploy** — push the branch and let Vercel build a preview (or merge to `main` for prod). Confirm the build registers the cron (Vercel → Project → Cron Jobs shows `/api/cron/weekly`).

- [ ] **Step 5: E2E — adjustment + email.** On the deployed app: open a client with a tracked week, set an adjustment (`+`/`−` and `Set`), confirm the week Amount updates and shows the `adj` note. Click **Invoice** → redirected to the invoice; the "Time adjustment" line is present. If the client has an email (use your own), confirm the invoice email arrives with the PDF + "View & pay invoice" link.

- [ ] **Step 6: E2E — public mark-paid + receipt.** Open the email's link (`/i/<token>`), click **Mark as paid**. Confirm: the page shows paid + a receipt download; the owner dashboard/invoice now shows `paid`; a receipt email arrives.

- [ ] **Step 7: E2E — bill one-offs.** Add a one-off charge to a client, click **Bill one-offs now**, confirm an invoice of just that charge is issued (and emailed if the client has an email).

- [ ] **Step 8: E2E — cron.** Temporarily enable "weekly auto-send" in Settings. Trigger the endpoint manually:

```bash
curl -s -H "Authorization: Bearer <CRON_SECRET>" https://<deployment>/api/cron/weekly
```
Expected: JSON summary lists the previous week's issued/skipped clients. Run it again → the same clients are `skipped` with reason `already-invoiced` (idempotent). Verify emails went to clients with addresses only.

- [ ] **Step 9: Final commit / merge.** If working on a branch, open a PR or merge to `main` per the finishing-a-development-branch skill.

---

## Self-Review

**Spec coverage:**
- Week adjustment (persisted delta, applied at issue for manual + cron) → Tasks 1, 4 (`issueWeekInvoice`), 6. ✓
- Delta-applies-to-final-total semantics → `issueWeekInvoice` recomputes tracked time at issue and adds `adjustmentLine`. ✓
- Email delivery via Resend, best-effort, fires on issue, optional/editable recipient → Tasks 3, 4, 5, 8. ✓
- Receipt auto-email on mark-paid (owner + public) → Tasks 4 (`emailReceiptById`), 5, 9. ✓
- Public tokenized invoice page + mark-paid + pdf/receipt + middleware → Task 9. ✓
- Weekly cron (daily, previous completed week, idempotent, global toggle, skip no-email) → Tasks 4 (`runWeeklyAutoSend`), 10. ✓
- Bill one-offs on their own → Task 7. ✓
- Shared `insertInvoice` across week/manual/one-off paths → Task 4/5/7. ✓
- Schema + env + vercel.json → Tasks 2, 3, 10, 11. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output.

**Type consistency:** `issueWeekInvoice`→`IssueResult` used in `issueInvoice` action and `runWeeklyAutoSend`. `insertInvoice` return `{id,number,token}` consumed by all callers. `markPaidTx(tx,id,paidAt?)` used by owner/public/manual paths. `BillableWeek.adjustHours` added in Task 6 and consumed by the client page. `getInvoiceByToken` (Task 4) consumed by Task 9 routes/page. `newToken` (Task 2) consumed by Task 4. All consistent.
