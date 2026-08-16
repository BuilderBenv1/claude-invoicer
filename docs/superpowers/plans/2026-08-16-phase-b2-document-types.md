# Phase B2 — Quotes, pro formas and document types — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user send a **quote** for prospective work and a **pro forma** when they want paying up front, convert either into a real invoice when it's accepted or paid, and keep the invoice number sequence unbroken while doing it.

**Architecture:** One table, three document types (`invoices.docType`), each with its own number sequence so a quote never consumes an invoice number. The decisive change is that "is this row billing evidence?" becomes a real predicate: every query that treats an invoice as proof of billing must now filter on `docType = 'invoice'`. That predicate lives in `packages/core` with tests, and the sweep across call sites is enumerated exhaustively — the same technique that made Phase B1's `subtotal` → `total` sweep verifiable.

**Tech Stack:** TypeScript, Next.js 15 App Router (server actions, server components), Drizzle ORM + Neon Postgres, pdf-lib, Tailwind, vitest (core only).

**Spec:** `docs/superpowers/specs/2026-08-14-agency-overhaul-design.md` (sections B1 and B2)

**Not in this plan:** the PDF visual rebuild, the logo upload, and pagination — all moved to Phase C, where the brand is decided. This phase keeps the PDF functionally correct (document-type title and legal line) without restyling it.

## Global Constraints

- **This phase needs a migration.** `apps/web/drizzle/0004_phase_b2.sql`, additive and idempotent, run by the user in the Neon SQL editor **before** the branch merges to `main`. Phase B1's `0003` has already been run against the live database.
- **`apps/web/lib/db/schema.ts` is the source of truth** for the live schema; the older `drizzle/*.sql` snapshots are not.
- **`packages/core` must stay pure** — no DB, no React, no Node built-ins.
- **PDF rendering is pdf-lib only.** Never introduce `@react-pdf/renderer`. All drawn text goes through the `draw`/`fit`/`drawCentered` helpers, which apply `toWinAnsi`.
- **Invoices snapshot identity at issue time.** Every document snapshots its identity, totals, terms and pay-to block when created, and nothing recomputes them on read.
- **Only `docType = 'invoice'` is billing evidence.** It alone counts toward revenue, unpaid and overdue totals, the billed-weeks set, the delete guard's invoice count, and receipts. A quote or pro forma must never mark a week billed, block a client delete, or be markable as paid.
- **Quotes and pro formas are always manual documents** with `prevBilledThroughMs = -1` and `cutoffMs = -1`, never tied to a tracked week. This also keeps them clear of the `invoices_client_week_unique` partial index.
- **The invoice sequence must stay unbroken.** A quote or pro forma must never consume an `INV-` number.
- **Existing rows are invoices.** The migration backfills `doc_type = 'invoice'`, so nothing about the user's current documents changes.
- Core tests: `npm test` from the repo root (106 passing). Web: `npm --prefix apps/web run typecheck` and `npm --prefix apps/web run build`. There is no test runner in `apps/web`; do not add one.
- Pre-existing environment noise, not yours to fix: `jose`/`next-auth` Edge Runtime warnings during build, and an `EINVAL readlink` error from a stale `apps/web/.next` (clear it and rebuild).
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ
  ```

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/documents.ts` | **Create.** Document types, labels, legal lines, the billing-evidence predicate, number formatting. |
| `packages/core/test/documents.test.ts` | **Create.** |
| `packages/core/src/index.ts` | **Modify.** Re-export. |
| `apps/web/lib/db/schema.ts` | **Modify.** `docType`, `convertedFromId`, `convertedToId` on `invoices`; `quoteSeq`, `proformaSeq` and three prefixes on `settings`. |
| `apps/web/drizzle/0004_phase_b2.sql` | **Create.** The migration the user runs. |
| `apps/web/lib/invoice-service.ts` | **Modify.** Per-type numbering; `convertDocument`; receipts restricted to invoices. |
| `apps/web/lib/queries.ts` | **Modify.** The billing-evidence filter sweep; document lists. |
| `apps/web/lib/actions.ts` | **Modify.** `createDocument`, `convertDocument`, guards. |
| `apps/web/components/manual-invoice-form.tsx` | **Modify.** Becomes the document form, with a type picker. |
| `apps/web/app/invoices/page.tsx`, `app/invoices/[id]/page.tsx`, `app/i/[token]/page.tsx` | **Modify.** Type-aware display, convert action, filters. |
| `apps/web/lib/pdf/render.ts`, `apps/web/lib/email.ts` | **Modify.** Type-aware title, legal line and copy. |
| `apps/web/app/settings/page.tsx` | **Modify.** Editable number prefixes. |

---

### Task 1: Document types in core

**Files:**
- Create: `packages/core/src/documents.ts`
- Create: `packages/core/test/documents.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type DocType = 'invoice' | 'proforma' | 'quote'`
  - `DOC_TYPES: DocType[]`
  - `isDocType(v: string): v is DocType`
  - `docLabel(t: DocType): string` — "Invoice" / "Pro forma invoice" / "Quote"
  - `docTitle(t: DocType): string` — the uppercase PDF heading
  - `docLegalLine(t: DocType): string | null`
  - `isBillingEvidence(t: string): boolean`
  - `canBePaid(t: string): boolean`
  - `formatDocNumber(prefix: string, seq: number): string`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/documents.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DOC_TYPES,
  canBePaid,
  docLabel,
  docLegalLine,
  docTitle,
  formatDocNumber,
  isBillingEvidence,
  isDocType,
} from '../src/documents.js';

describe('DOC_TYPES', () => {
  it('lists exactly the three supported types', () => {
    expect(DOC_TYPES).toEqual(['invoice', 'proforma', 'quote']);
  });
});

describe('isDocType', () => {
  it('accepts the three known types', () => {
    expect(isDocType('invoice')).toBe(true);
    expect(isDocType('proforma')).toBe(true);
    expect(isDocType('quote')).toBe(true);
  });
  it('rejects anything else, including an empty string', () => {
    expect(isDocType('receipt')).toBe(false);
    expect(isDocType('')).toBe(false);
    expect(isDocType('INVOICE')).toBe(false);
  });
});

describe('docLabel and docTitle', () => {
  it('names each type for the UI', () => {
    expect(docLabel('invoice')).toBe('Invoice');
    expect(docLabel('proforma')).toBe('Pro forma invoice');
    expect(docLabel('quote')).toBe('Quote');
  });
  it('gives the PDF an uppercase heading', () => {
    expect(docTitle('invoice')).toBe('INVOICE');
    expect(docTitle('proforma')).toBe('PRO FORMA INVOICE');
    expect(docTitle('quote')).toBe('QUOTE');
  });
});

describe('docLegalLine', () => {
  it('says nothing extra on a real invoice', () => {
    expect(docLegalLine('invoice')).toBeNull();
  });
  it('states a pro forma is not a tax invoice', () => {
    expect(docLegalLine('proforma')).toBe(
      'This is a pro forma invoice and is not a VAT or tax invoice. A tax invoice will follow on payment.',
    );
  });
  it('states a quote is not a request for payment', () => {
    expect(docLegalLine('quote')).toBe('This is a quotation, not a request for payment.');
  });
});

describe('isBillingEvidence', () => {
  it('is true only for a real invoice', () => {
    expect(isBillingEvidence('invoice')).toBe(true);
    expect(isBillingEvidence('proforma')).toBe(false);
    expect(isBillingEvidence('quote')).toBe(false);
  });
  it('treats an unknown or empty type as evidence, so legacy rows are never lost', () => {
    expect(isBillingEvidence('')).toBe(true);
    expect(isBillingEvidence('something-new')).toBe(true);
  });
});

describe('canBePaid', () => {
  it('is true only for a real invoice', () => {
    expect(canBePaid('invoice')).toBe(true);
    expect(canBePaid('proforma')).toBe(false);
    expect(canBePaid('quote')).toBe(false);
  });
  it('treats an unknown type as payable, matching isBillingEvidence', () => {
    expect(canBePaid('')).toBe(true);
  });
});

describe('formatDocNumber', () => {
  it('zero-pads the sequence to four digits', () => {
    expect(formatDocNumber('INV', 7)).toBe('INV-0007');
    expect(formatDocNumber('QUO', 1)).toBe('QUO-0001');
  });
  it('does not truncate a sequence past four digits', () => {
    expect(formatDocNumber('INV', 12345)).toBe('INV-12345');
  });
  it('trims a prefix and falls back when it is blank', () => {
    expect(formatDocNumber('  PF  ', 3)).toBe('PF-0003');
    expect(formatDocNumber('', 3)).toBe('DOC-0003');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/documents.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/documents.ts`:

```ts
/** The three kinds of document this app issues. */
export type DocType = 'invoice' | 'proforma' | 'quote';

export const DOC_TYPES: DocType[] = ['invoice', 'proforma', 'quote'];

export function isDocType(v: string): v is DocType {
  return (DOC_TYPES as string[]).includes(v);
}

const LABELS: Record<DocType, string> = {
  invoice: 'Invoice',
  proforma: 'Pro forma invoice',
  quote: 'Quote',
};

export function docLabel(t: DocType): string {
  return LABELS[t];
}

export function docTitle(t: DocType): string {
  return LABELS[t].toUpperCase();
}

/**
 * The line a document must carry to avoid being mistaken for a tax invoice.
 * Null for a real invoice, which needs no disclaimer.
 */
export function docLegalLine(t: DocType): string | null {
  if (t === 'proforma') {
    return 'This is a pro forma invoice and is not a VAT or tax invoice. A tax invoice will follow on payment.';
  }
  if (t === 'quote') return 'This is a quotation, not a request for payment.';
  return null;
}

/**
 * Whether a row counts as proof that work has been billed: revenue and unpaid
 * totals, the billed-weeks set, and the client-delete guard all depend on this.
 * An unknown or empty type counts as evidence so that a legacy row — or a type
 * added later without updating this file — is never silently dropped from the
 * accounts. Being wrongly counted is recoverable; being wrongly ignored means
 * double-billing a client.
 */
export function isBillingEvidence(t: string): boolean {
  return t !== 'proforma' && t !== 'quote';
}

/** Only a real invoice can be marked paid and receive a receipt. */
export function canBePaid(t: string): boolean {
  return isBillingEvidence(t);
}

/** "INV-0007" — the prefix, a hyphen, and the sequence zero-padded to four. */
export function formatDocNumber(prefix: string, seq: number): string {
  const p = prefix.trim() || 'DOC';
  return `${p}-${String(seq).padStart(4, '0')}`;
}
```

The fail-safe direction of `isBillingEvidence` is deliberate and load-bearing: it is a denylist, not an allowlist, so a row whose type this file does not recognise still counts toward billing rather than vanishing from it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the new document tests plus the existing 106.

- [ ] **Step 5: Export from core's index**

In `packages/core/src/index.ts`, add:

```ts
export {
  DOC_TYPES,
  isDocType,
  docLabel,
  docTitle,
  docLegalLine,
  isBillingEvidence,
  canBePaid,
  formatDocNumber,
  type DocType,
} from './documents.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/documents.ts packages/core/test/documents.test.ts packages/core/src/index.ts
git commit -m "feat(core): document types, their copy, and the billing-evidence predicate

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 2: Schema and migration

**Files:**
- Modify: `apps/web/lib/db/schema.ts`
- Create: `apps/web/drizzle/0004_phase_b2.sql`

**Interfaces:**
- Produces: `invoices` gains `docType`, `convertedFromId`, `convertedToId`; `settings` gains `quoteSeq`, `proformaSeq`, `invoicePrefix`, `quotePrefix`, `proformaPrefix`.

- [ ] **Step 1: Add the invoice columns**

In `apps/web/lib/db/schema.ts`, inside the `invoices` table definition, after `status`:

```ts
  /** 'invoice' | 'proforma' | 'quote'. Only 'invoice' is billing evidence. */
  docType: text('doc_type').notNull().default('invoice'),
  /** Set on a converted invoice, pointing at the quote or pro forma it came from. */
  convertedFromId: text('converted_from_id'),
  /** Set on a quote or pro forma once it has been converted. */
  convertedToId: text('converted_to_id'),
```

- [ ] **Step 2: Add the settings columns**

In the `settings` table definition, add:

```ts
  quoteSeq: integer('quote_seq').notNull().default(0),
  proformaSeq: integer('proforma_seq').notNull().default(0),
  invoicePrefix: text('invoice_prefix').notNull().default('INV'),
  quotePrefix: text('quote_prefix').notNull().default('QUO'),
  proformaPrefix: text('proforma_prefix').notNull().default('PF'),
```

- [ ] **Step 3: Write the migration**

Create `apps/web/drizzle/0004_phase_b2.sql`:

```sql
-- Phase B2: quotes, pro formas and document types.
-- Run this in the Neon SQL editor BEFORE merging to main.
-- Additive and safe to re-run. (0003_phase_b1.sql has already been run.)

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'invoice';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS converted_from_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS converted_to_id text;

-- Every existing document is a real invoice.
UPDATE invoices SET doc_type = 'invoice' WHERE doc_type IS NULL OR doc_type = '';

ALTER TABLE settings ADD COLUMN IF NOT EXISTS quote_seq integer NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS proforma_seq integer NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_prefix text NOT NULL DEFAULT 'INV';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS quote_prefix text NOT NULL DEFAULT 'QUO';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS proforma_prefix text NOT NULL DEFAULT 'PF';

-- Document numbers must stay unique per type; a converted invoice keeps its own.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_unique ON invoices (number);
```

**Before writing the unique index, check for existing duplicates.** If the live data ever produced two rows with the same number (a manual override could have), the index creation fails. Note this in your report so the controller can tell the user to check with:

```sql
SELECT number, count(*) FROM invoices GROUP BY number HAVING count(*) > 1;
```

If that returns rows, the index line must be removed from the migration and the duplicates resolved by hand first.

- [ ] **Step 4: Cross-check schema against migration**

Go column by column: every column added to `schema.ts` must have a matching SQL statement with the same name, type and default, and vice versa. Record the table in your report.

- [ ] **Step 5: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed. Nothing reads the new columns yet.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/db/schema.ts apps/web/drizzle/0004_phase_b2.sql
git commit -m "feat(db): document type, conversion links and per-type number sequences

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 3: Per-type numbering at issue

**Files:**
- Modify: `apps/web/lib/invoice-service.ts` (`InsertInvoiceArgs`, `insertInvoice`)

**Interfaces:**
- Consumes: `formatDocNumber`, `type DocType` (Task 1); the settings columns (Task 2).
- Produces: `InsertInvoiceArgs` gains `docType?: DocType` (defaulting to `'invoice'`) and `convertedFromId?: string`. Every document draws from the sequence matching its own type.

- [ ] **Step 1: Extend the argument type**

In `apps/web/lib/invoice-service.ts`, add to `InsertInvoiceArgs`:

```ts
  /** Defaults to 'invoice'. Quotes and pro formas use their own sequences. */
  docType?: DocType;
  /** Set when this invoice was converted from a quote or pro forma. */
  convertedFromId?: string;
```

Add `formatDocNumber` and `type DocType` to the `@claude-invoicer/core` import.

- [ ] **Step 2: Number from the matching sequence**

Replace the number-assignment block at the top of `insertInvoice` with:

```ts
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
```

Each branch keeps the existing atomic `UPDATE ... SET x = x + 1 RETURNING x` shape, which is what makes concurrent issues safe — do not replace it with a read-then-write.

- [ ] **Step 3: Persist the type and the conversion link**

In the `values({...})` object, add:

```ts
    docType,
    convertedFromId: a.convertedFromId ?? null,
```

- [ ] **Step 4: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed. Existing callers pass no `docType`, so they still produce invoices from the invoice sequence.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/invoice-service.ts
git commit -m "feat(web): number each document type from its own sequence

A quote or pro forma never consumes an invoice number, so the invoice run
stays unbroken.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 4: The billing-evidence sweep

This is the highest-risk task in the phase, and it is the direct analogue of Phase B1's `subtotal` → `total` sweep. A quote that is wrongly treated as billing evidence would mark a week as already invoiced — so the real work never gets billed — or block a client from being deleted. The call sites are enumerated exhaustively below.

**Files:**
- Modify: `apps/web/lib/queries.ts` (`billedWeekStarts`, `invoiceCountFor`, `getWeekDetail`'s invoice lookup, `listInvoices`)
- Modify: `apps/web/lib/invoice-service.ts` (`issueWeekInvoice`'s already-invoiced check)

**Interfaces:**
- Consumes: `isBillingEvidence` (Task 1).

- [ ] **Step 1: Filter the billed-weeks set**

In `apps/web/lib/queries.ts`, add `isBillingEvidence` to the core import, then in `billedWeekStarts` change the loop body so only real invoices mark a week billed:

```ts
function billedWeekStarts(invoiceRows: Invoice[], clientId: string): Set<number> {
  const set = new Set<number>();
  for (const inv of invoiceRows) {
    // A quote or pro forma for a client must never mark their week billed —
    // the real work would then never be invoiced.
    if (inv.clientId === clientId && isBillingEvidence(inv.docType)) set.add(inv.prevBilledThroughMs);
  }
  return set;
}
```

- [ ] **Step 2: Filter the delete guard's count**

In the same file, in `invoiceCountFor` (added in Phase A, with a doc comment noting this phase would change it), apply the filter:

```ts
/**
 * How many real invoices a client has. Quotes and pro formas do not count —
 * a client you only ever quoted has no billing history worth protecting.
 */
function invoiceCountFor(invoiceRows: Invoice[], clientId: string): number {
  return invoiceRows.filter((inv) => inv.clientId === clientId && isBillingEvidence(inv.docType)).length;
}
```

- [ ] **Step 3: Filter the week drill-down's invoice lookup**

Still in `queries.ts`, `getWeekDetail` finds the invoice for a week with `invoiceRows.find((inv) => inv.clientId === clientId && inv.prevBilledThroughMs === startMs)`. Add `&& isBillingEvidence(inv.docType)` to that predicate, so a quote never makes a week display as invoiced.

- [ ] **Step 4: Filter the already-invoiced guard**

In `apps/web/lib/invoice-service.ts`, `issueWeekInvoice` checks for an existing invoice for the week with a `where(and(eq(invoices.clientId, ...), eq(invoices.prevBilledThroughMs, startMs)))`. Add a document-type condition so only a real invoice blocks re-issuing:

```ts
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
```

- [ ] **Step 5: Prove the sweep is complete**

Run: `grep -rn "invoiceRows\|from(invoices)" apps/web/lib`

Check every match against this table. Each one either filters on document type, or has a stated reason not to:

| Site | Must filter? |
|---|---|
| `queries.ts` `billedWeekStarts` | ✅ yes — Step 1 |
| `queries.ts` `invoiceCountFor` | ✅ yes — Step 2 |
| `queries.ts` `getWeekDetail` invoice lookup | ✅ yes — Step 3 |
| `queries.ts` `loadAll` (`db.select().from(invoices)`) | ❌ no — loads every row; the consumers filter |
| `queries.ts` `listInvoices` | ❌ no — the document list shows all types by design |
| `queries.ts` `getInvoiceDetail` / `getInvoiceByToken` | ❌ no — fetching one document by id or token |
| `invoice-service.ts` `issueWeekInvoice` existing check | ✅ yes — Step 4 |
| `invoice-service.ts` `markPaidTx` | ✅ yes — Task 5 handles it |
| `actions.ts` `deleteInvoice` / `markPaidPublic` | ❌ no — operating on one document by id or token |

Any match not in this table is a site this task missed. Record the grep output and your judgement of each match in your report.

- [ ] **Step 6: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/queries.ts apps/web/lib/invoice-service.ts
git commit -m "feat(web): only real invoices count as billing evidence

A quote or pro forma no longer marks a week billed, blocks a client delete,
or makes a week display as invoiced.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 5: Restrict payment and receipts to invoices

A pro forma is a request for payment, but the payment is recorded against the invoice it converts into — otherwise a receipt would exist for a document that is not a tax invoice.

**Files:**
- Modify: `apps/web/lib/invoice-service.ts` (`markPaidTx`)
- Modify: `apps/web/lib/actions.ts` (`markInvoicePaid`, `markPaidPublic`)

**Interfaces:**
- Consumes: `canBePaid` (Task 1).

- [ ] **Step 1: Guard the transaction**

In `apps/web/lib/invoice-service.ts`, add `canBePaid` to the core import, and in `markPaidTx` immediately after the `if (!inv) throw new Error('Invoice not found');` line:

```ts
  if (!canBePaid(inv.docType)) {
    throw new Error('Only an invoice can be marked paid. Convert this document to an invoice first.');
  }
```

This is the single funnel — both the owner-facing and the public mark-paid paths go through it — so the guard cannot be bypassed by posting directly to either action.

- [ ] **Step 2: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/invoice-service.ts
git commit -m "feat(web): only an invoice can be marked paid and receive a receipt

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 6: Create a quote or pro forma, and convert it

**Files:**
- Modify: `apps/web/lib/actions.ts` (`createManualInvoice` → accepts a type; new `convertDocument`)
- Modify: `apps/web/components/manual-invoice-form.tsx`

**Interfaces:**
- Consumes: `DOC_TYPES`, `docLabel`, `isDocType`, `isBillingEvidence` from core; `insertInvoice`'s `docType` and `convertedFromId` (Task 3).
- Produces:
  - `createManualInvoice` additionally reads a `docType` field.
  - `convertDocument(fd: FormData): Promise<void>` — field `id`.

- [ ] **Step 1: Accept a document type when creating by hand**

In `apps/web/lib/actions.ts`, add `isDocType`, `docLabel` and `isBillingEvidence` to the core import. In `createManualInvoice`, read and validate the type near the top:

```ts
  const rawType = str(fd, 'docType') || 'invoice';
  if (!isDocType(rawType)) throw new Error('Unknown document type');
```

Pass `docType: rawType` into the `insertInvoice` call. Guard the already-paid shortcut so it cannot apply to a quote or pro forma — replace the `if (markPaid)` condition with:

```ts
    if (markPaid && isBillingEvidence(rawType)) {
```

and change the redirect and revalidation to stay correct for all three types (they all live under `/invoices/[id]`, so no change is needed there).

- [ ] **Step 2: Write the conversion action**

Add to `apps/web/lib/actions.ts`:

```ts
/**
 * Turn a quote or pro forma into a real invoice: a new document with the next
 * invoice number, the same lines and totals, linked to the source in both
 * directions. The source is kept — it is the record of what was quoted.
 */
export async function convertDocument(fd: FormData): Promise<void> {
  const sourceId = str(fd, 'id');
  if (!sourceId) throw new Error('Missing document id');
  const db = getDb();

  const newId2 = await db.transaction(async (tx) => {
    const [source] = await tx.select().from(invoices).where(eq(invoices.id, sourceId));
    if (!source) throw new Error('Document not found');
    if (isBillingEvidence(source.docType)) throw new Error('This is already an invoice.');
    if (source.convertedToId) throw new Error('This document has already been converted.');

    const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
    if (!s) throw new Error('Settings not initialized');
    const [client] = await tx.select().from(clients).where(eq(clients.id, source.clientId));
    if (!client) throw new Error('Client not found');
    if (client.archived) throw new Error('This client is archived. Restore them before invoicing.');

    const sourceLines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, sourceId));

    const { id } = await insertInvoice(tx, {
      client,
      settings: s,
      lines: sourceLines.map((l) => ({
        label: l.label,
        hours: l.hours,
        ratePerHour: l.ratePerHour,
        amount: l.amount,
      })),
      subtotal: source.subtotal,
      prevBilledThroughMs: -1,
      cutoffMs: -1,
      notes: `Converted from ${source.number}`,
      docType: 'invoice',
      convertedFromId: source.id,
    });

    await tx.update(invoices).set({ convertedToId: id }).where(eq(invoices.id, sourceId));
    return id;
  });

  revalidatePath('/invoices');
  revalidatePath('/invoices/' + sourceId);
  redirect('/invoices/' + newId2);
}
```

Note the conversion re-derives totals through `insertInvoice` rather than copying `source.total`: VAT or payment terms may have changed since the quote was written, and the invoice must reflect the terms in force when it is issued.

- [ ] **Step 3: Add the type picker to the form**

In `apps/web/components/manual-invoice-form.tsx`, add a document-type `<select>` as the first field of the first card, with the label "Document type", `name="docType"`, defaulting to `invoice`, listing `DOC_TYPES` through `docLabel`. Import `DOC_TYPES` and `docLabel` from `@claude-invoicer/core`, hold the choice in state, and use it to:
- change the submit button's text to `Create ${docLabel(type).toLowerCase()}`;
- hide the "Mark as already paid" block entirely unless the type is `invoice`, since a quote cannot be paid;
- show the type's legal line (via `docLegalLine`) as a small note under the picker when it is not null, so the user sees what the document will say.

Keep every other field as it is.

- [ ] **Step 4: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions.ts apps/web/components/manual-invoice-form.tsx
git commit -m "feat(web): create quotes and pro formas, and convert them to invoices

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 7: Show the document type everywhere it matters

**Files:**
- Modify: `apps/web/app/invoices/page.tsx`
- Modify: `apps/web/app/invoices/[id]/page.tsx`
- Modify: `apps/web/app/i/[token]/page.tsx`

**Interfaces:**
- Consumes: `docLabel`, `docLegalLine`, `isBillingEvidence`, `canBePaid` from core; `convertDocument` (Task 6).

- [ ] **Step 1: Type column and filter on the list**

In `apps/web/app/invoices/page.tsx`:
- Rename the page heading to "Documents" and the button to "+ New document".
- Add a "Type" column showing `docLabel(inv.docType as DocType)`, styled muted for non-invoices.
- Show the status cell only for real invoices; a quote or pro forma shows `—` unless it has been converted, in which case it shows a muted "converted" badge.
- Add a simple type filter above the table: links for All / Invoices / Pro formas / Quotes using a `?type=` search param, filtering the rows server-side. Read `searchParams` in the page props — it is a `Promise` in Next 15, so `await` it.
- Keep the empty-payment-details notice from Phase B1.

- [ ] **Step 2: Type, legal line and convert on the detail page**

In `apps/web/app/invoices/[id]/page.tsx`:
- Show `docLabel(...)` beside the number in the header.
- Render `docLegalLine(...)` as a muted line under the totals when non-null.
- Replace the "Mark paid" control with a **Convert to invoice** button (posting `convertDocument` with the document id) when the document is not billing evidence and has not been converted.
- When `convertedToId` is set, show a link to the resulting invoice; when `convertedFromId` is set, show a link back to the source.
- Keep Mark paid, Email and the receipt display for real invoices only.

- [ ] **Step 3: The client-facing page**

In `apps/web/app/i/[token]/page.tsx`:
- Show `docLabel(...)` in the heading and `docLegalLine(...)` prominently near the total.
- Hide the "Mark as paid" control unless `canBePaid(...)` — a client must not be able to mark a quote paid.
- For a quote, suppress the due date and the pay-to block: it is not a request for payment, and showing bank details on it invites a payment against a document with no invoice number to reference.

- [ ] **Step 4: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/invoices/page.tsx "apps/web/app/invoices/[id]/page.tsx" "apps/web/app/i/[token]/page.tsx"
git commit -m "feat(web): show document type, its legal line, and the convert action

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 8: Type-aware PDF, email and number prefixes

**Files:**
- Modify: `apps/web/lib/pdf/render.ts`
- Modify: `apps/web/lib/email.ts`
- Modify: `apps/web/app/settings/page.tsx`
- Modify: `apps/web/lib/actions.ts` (`updateSettings`)

**Interfaces:**
- Consumes: `docTitle`, `docLegalLine`, `docLabel`, `isBillingEvidence` from core.

- [ ] **Step 1: PDF title and legal line**

In `apps/web/lib/pdf/render.ts`, in `renderInvoicePdf`:
- Replace the hard-coded `'INVOICE'` title with `docTitle(invoice.docType as DocType)`.
- After the totals block (and before the pay-to block), draw `docLegalLine(...)` when non-null, in `MUTED` at size 8, via the existing `draw` helper so it is sanitised.
- Suppress the pay-to block and the DUE meta entry for a quote — same reasoning as the web page.

Leave the rest of the layout untouched; the visual rebuild is Phase C.

- [ ] **Step 2: Email copy**

In `apps/web/lib/email.ts`, the subject and body say "Invoice". Make both use `docLabel(...)`, and for a quote replace the "please pay" framing with an acceptance framing ("here's your quote — reply to accept"). Keep the attachment logic unchanged.

- [ ] **Step 3: Editable prefixes in Settings**

In `apps/web/app/settings/page.tsx`, add three short text fields (`invoicePrefix`, `quotePrefix`, `proformaPrefix`) in the Invoicing area, with a note that changing a prefix affects only documents issued from then on. In `updateSettings`, persist all three with `str(fd, ...) || <default>`.

- [ ] **Step 4: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

Then render one PDF of each type if you can, and confirm: the title changes, the legal line appears on the two non-invoice types, a quote shows no due date and no pay-to block, and a real invoice is unchanged from before this task.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/pdf/render.ts apps/web/lib/email.ts apps/web/app/settings/page.tsx apps/web/lib/actions.ts
git commit -m "feat(web): type-aware document PDF, email copy and number prefixes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

## Phase B2 completion checklist

- [ ] `npm test` — core green (106 existing + the new documents suite)
- [ ] `npm --prefix apps/web run typecheck` — clean
- [ ] `npm --prefix apps/web run build` — clean
- [ ] The Task 4 grep table is recorded, with every `invoiceRows` / `from(invoices)` site accounted for
- [ ] A quote does not mark a week billed, does not block a client delete, and cannot be marked paid
- [ ] Issuing a quote then an invoice produces `QUO-0001` and `INV-000N` — the invoice run is unbroken
- [ ] **The user has run `0004_phase_b2.sql` in the Neon SQL editor**, after checking for duplicate document numbers
- [ ] An existing invoice looks and behaves exactly as it did before this phase
