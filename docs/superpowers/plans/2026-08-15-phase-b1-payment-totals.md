# Phase B1 — Payment details, totals and due dates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the business's bank details, a payment due date and a VAT-ready total on every invoice, so an invoice tells the client what to pay, where to pay it and by when — and close the server-side gap that lets an archived client still be invoiced.

**Architecture:** All money maths and document copy move into `packages/core` (the only workspace with a test runner) as pure functions. `apps/web` gains one new table (`payment_accounts`) and a set of additive columns on `invoices` and `settings`. Payment details are **snapshotted onto the invoice at issue**, matching the existing identity-snapshot rule, so changing banks never alters an already-issued PDF.

**Tech Stack:** TypeScript, Next.js 15 App Router (server actions, server components), Drizzle ORM + Neon Postgres, pdf-lib, Tailwind, vitest (core only).

**Spec:** `docs/superpowers/specs/2026-08-14-agency-overhaul-design.md` (sections B3, B4, B5, and the totals half of B6)

**Not in this plan:** document types (`docType`, quotes, pro formas), separate number sequences, conversion, and the full PDF visual rebuild with logo. Those are Phase B2, which depends on this one.

## Global Constraints

- **This phase DOES need a database migration.** One additive `.sql` file, run by the user in the Neon SQL editor **before** the branch merges to `main` — auto-deploy from `main` would otherwise 500 against a schema missing the new columns.
- **`apps/web/drizzle/*.sql` snapshots do not describe the live database** (`week_adjustments`, `round_mode` and `public_token` were applied by hand-run SQL). **`apps/web/lib/db/schema.ts` IS current** — author the migration against `schema.ts`, never against the old snapshots.
- **`packages/core` must stay pure** — no DB, no React, no Node built-ins.
- **PDF rendering is pdf-lib only.** Never introduce `@react-pdf/renderer`; it fails on Next 15 Vercel serverless.
- **Invoices snapshot identity at issue time.** Every new invoice field added here is a snapshot: once written it is never recomputed, so editing Settings later cannot change an issued document.
- **`subtotal` becomes strictly NET.** `total = subtotal + taxAmount` is the payable figure. Every display of the amount due moves to `total`. Estimates that are not invoices (the week drill-down) keep using their own computed subtotal.
- **VAT is off by default** (`vatRate = 0`), so every existing invoice and every new one behaves exactly as today until the user turns it on.
- **Tax rate is a percentage, not a fraction** — `20` means 20%.
- Core tests: `npm test` from the repo root. Web: `npm --prefix apps/web run typecheck` and `npm --prefix apps/web run build`. There is no test runner in `apps/web`; do not add one.
- Pre-existing environment noise, not yours to fix: `jose`/`next-auth` Edge Runtime warnings during build, and an `EINVAL readlink` error from a stale `apps/web/.next` (clear it and rebuild).
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ
  ```

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/invoicing.ts` | **Create.** Totals maths, due-date calculation, overdue test. |
| `packages/core/src/payment.ts` | **Create.** Payment-account resolution by currency and pay-to block rendering. |
| `packages/core/src/index.ts` | **Modify.** Re-export both. |
| `packages/core/test/invoicing.test.ts`, `payment.test.ts` | **Create.** |
| `apps/web/lib/db/schema.ts` | **Modify.** New columns on `invoices` and `settings`; new `paymentAccounts` table. |
| `apps/web/drizzle/0003_phase_b1.sql` | **Create.** The migration the user runs in Neon. |
| `apps/web/lib/invoice-service.ts` | **Modify.** Archived guard; snapshot totals, terms, due date and pay-to block at issue. |
| `apps/web/lib/actions.ts` | **Modify.** Archived guards; payment-account actions; settings fields. |
| `apps/web/lib/queries.ts` | **Modify.** Load payment accounts for the settings page. |
| `apps/web/components/payment-accounts-form.tsx` | **Create.** Default + per-currency bank details editor. |
| `apps/web/app/settings/page.tsx` | **Modify.** Payment details, VAT and terms sections. |
| `apps/web/lib/pdf/render.ts` | **Modify.** Due date, net/VAT/total block, pay-to block. |
| `apps/web/lib/email.ts`, `app/invoices/page.tsx`, `app/invoices/[id]/page.tsx`, `app/i/[token]/page.tsx` | **Modify.** `subtotal` → `total`; overdue badge. |

---

### Task 1: Stop an archived client being invoiced server-side

Phase A hid the invoice buttons for archived clients, but `issueWeekInvoice`, `billOneOffs` and `createManualInvoice` have no server-side check — a direct POST still issues. The weekly cron already filters `archived = 0`, so this closes the last path.

**Files:**
- Modify: `apps/web/lib/invoice-service.ts` (`IssueResult` type, `issueWeekInvoice`)
- Modify: `apps/web/lib/actions.ts` (`issueInvoice` message, `billOneOffs`, `createManualInvoice`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `IssueResult`'s `reason` union gains `'client-archived'`.

- [ ] **Step 1: Widen the result type**

In `apps/web/lib/invoice-service.ts`, change the `IssueResult` type to:

```ts
export type IssueResult =
  | { ok: true; id: string; number: string }
  | { ok: false; reason: 'already-invoiced' | 'nothing' | 'week-not-finished' | 'client-archived'; number?: string };
```

- [ ] **Step 2: Guard `issueWeekInvoice`**

In the same file, inside the transaction, immediately after the `if (!client) throw new Error('Client not found');` line, add:

```ts
    if (client.archived) return { ok: false, reason: 'client-archived' };
```

- [ ] **Step 3: Surface the reason in the action**

In `apps/web/lib/actions.ts`, in `issueInvoice`, extend the message ladder so the new reason has copy. Replace the existing `const msg = ...` expression with:

```ts
    const msg =
      res.reason === 'already-invoiced'
        ? `Week of ${weekStart} is already invoiced${res.number ? ` (${res.number})` : ''}.`
        : res.reason === 'week-not-finished'
          ? `The week of ${weekStart} isn't finished yet — you can invoice it once it ends.`
          : res.reason === 'client-archived'
            ? 'This client is archived. Restore them before issuing an invoice.'
            : `Nothing to invoice for the week of ${weekStart}.`;
```

- [ ] **Step 4: Guard the other two entry points**

In `apps/web/lib/actions.ts`, in `billOneOffs`, immediately after its `if (!client) throw new Error('Client not found');` line, add:

```ts
    if (client.archived) throw new Error('This client is archived. Restore them before issuing an invoice.');
```

Add the identical two lines after the matching `if (!client) throw new Error('Client not found');` inside `createManualInvoice`.

- [ ] **Step 5: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed. The `IssueResult` widening is what proves every consumer of `reason` still compiles.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/invoice-service.ts apps/web/lib/actions.ts
git commit -m "fix(web): refuse to invoice an archived client server-side

Phase A hid the buttons; the actions themselves were still reachable.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 2: Totals, due dates and overdue in core

**Files:**
- Create: `packages/core/src/invoicing.ts`
- Create: `packages/core/test/invoicing.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `round2` from `./billing.js`.
- Produces:
  - `interface InvoiceTotals { subtotal: number; taxRate: number; taxAmount: number; total: number }`
  - `computeTotals(subtotal: number, taxRate: number): InvoiceTotals`
  - `dueDateFrom(issuedAt: Date, termsDays: number): Date | null`
  - `isOverdue(status: string, dueAt: Date | null, nowMs: number): boolean`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/invoicing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeTotals, dueDateFrom, isOverdue } from '../src/invoicing.js';

describe('computeTotals', () => {
  it('leaves the total equal to the subtotal when VAT is off', () => {
    expect(computeTotals(1000, 0)).toEqual({ subtotal: 1000, taxRate: 0, taxAmount: 0, total: 1000 });
  });
  it('treats the rate as a percentage, not a fraction', () => {
    expect(computeTotals(1000, 20)).toEqual({ subtotal: 1000, taxRate: 20, taxAmount: 200, total: 1200 });
  });
  it('rounds tax and total to two decimals', () => {
    const t = computeTotals(99.99, 20);
    expect(t.taxAmount).toBe(20);
    expect(t.total).toBe(119.99);
  });
  it('rounds a rate that produces a third decimal', () => {
    const t = computeTotals(10.1, 17.5);
    expect(t.taxAmount).toBe(1.77);
    expect(t.total).toBe(11.87);
  });
  it('treats a negative or non-finite rate as zero rather than crediting tax', () => {
    expect(computeTotals(100, -5).taxAmount).toBe(0);
    expect(computeTotals(100, Number.NaN).taxAmount).toBe(0);
    expect(computeTotals(100, -5).total).toBe(100);
  });
  it('carries a negative subtotal through without inventing tax on it', () => {
    expect(computeTotals(-50, 20)).toEqual({ subtotal: -50, taxRate: 20, taxAmount: -10, total: -60 });
  });
});

describe('dueDateFrom', () => {
  const issued = new Date('2026-08-14T12:00:00.000Z');
  it('adds the term in whole days', () => {
    expect(dueDateFrom(issued, 14)?.toISOString()).toBe('2026-08-28T12:00:00.000Z');
  });
  it('returns null when there are no payment terms', () => {
    expect(dueDateFrom(issued, 0)).toBeNull();
  });
  it('returns null for a negative term rather than a date in the past', () => {
    expect(dueDateFrom(issued, -3)).toBeNull();
  });
  it('crosses a month boundary correctly', () => {
    expect(dueDateFrom(new Date('2026-08-25T00:00:00.000Z'), 10)?.toISOString()).toBe('2026-09-04T00:00:00.000Z');
  });
});

describe('isOverdue', () => {
  const due = new Date('2026-08-28T12:00:00.000Z');
  const dueMs = due.getTime();
  it('is overdue once the due date has passed and it is still unpaid', () => {
    expect(isOverdue('unpaid', due, dueMs + 1)).toBe(true);
  });
  it('is not overdue at the exact due instant', () => {
    expect(isOverdue('unpaid', due, dueMs)).toBe(false);
  });
  it('is never overdue once paid', () => {
    expect(isOverdue('paid', due, dueMs + 86_400_000)).toBe(false);
  });
  it('is never overdue without a due date', () => {
    expect(isOverdue('unpaid', null, dueMs + 86_400_000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/invoicing.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/invoicing.ts`:

```ts
import { round2 } from './billing.js';

const MS_PER_DAY = 86_400_000;

export interface InvoiceTotals {
  /** Net of tax. */
  subtotal: number;
  /** Percentage, e.g. 20 for 20% VAT. */
  taxRate: number;
  taxAmount: number;
  /** The payable figure: subtotal + taxAmount. */
  total: number;
}

/**
 * Split a net subtotal into tax and payable total. The rate is a PERCENTAGE
 * (20 = 20%). A missing, negative or non-finite rate means no tax, so a bad
 * settings value can never credit tax back to a client.
 */
export function computeTotals(subtotal: number, taxRate: number): InvoiceTotals {
  const rate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0;
  const taxAmount = round2(subtotal * (rate / 100));
  return { subtotal: round2(subtotal), taxRate: rate, taxAmount, total: round2(round2(subtotal) + taxAmount) };
}

/** Payment due date, or null when the terms are zero or nonsensical (due on receipt). */
export function dueDateFrom(issuedAt: Date, termsDays: number): Date | null {
  if (!Number.isFinite(termsDays) || termsDays <= 0) return null;
  return new Date(issuedAt.getTime() + Math.floor(termsDays) * MS_PER_DAY);
}

/** Unpaid and past its due date. Derived on read — never stored. */
export function isOverdue(status: string, dueAt: Date | null, nowMs: number): boolean {
  if (status === 'paid' || !dueAt) return false;
  return dueAt.getTime() < nowMs;
}
```

Note `computeTotals` keeps `taxRate` in the returned object even when it clamps to 0, so the caller stores what was actually applied rather than what was configured.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the new invoicing tests plus the existing 79.

- [ ] **Step 5: Export from core's index**

In `packages/core/src/index.ts`, add:

```ts
export {
  computeTotals,
  dueDateFrom,
  isOverdue,
  type InvoiceTotals,
} from './invoicing.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/invoicing.ts packages/core/test/invoicing.test.ts packages/core/src/index.ts
git commit -m "feat(core): invoice totals, due dates and the overdue test

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 3: Payment-account resolution and the pay-to block, in core

**Files:**
- Create: `packages/core/src/payment.ts`
- Create: `packages/core/test/payment.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `normalizeCurrency` from `./currency.js`.
- Produces:
  - `DEFAULT_ACCOUNT_KEY = 'DEFAULT'`
  - `interface PaymentAccount { currency: string; accountName?: string | null; bankName?: string | null; sortCode?: string | null; accountNumber?: string | null; iban?: string | null; bic?: string | null; routingNumber?: string | null; notes?: string | null }`
  - `resolvePaymentAccount(accounts: PaymentAccount[], currency: string): PaymentAccount | null`
  - `renderPaymentBlock(account: PaymentAccount | null, reference: string): string`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/payment.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_ACCOUNT_KEY, renderPaymentBlock, resolvePaymentAccount } from '../src/payment.js';
import type { PaymentAccount } from '../src/payment.js';

const gbp: PaymentAccount = {
  currency: 'GBP',
  accountName: 'The Automation Agency Ltd',
  bankName: 'Monzo',
  sortCode: '04-00-04',
  accountNumber: '12345678',
};
const fallback: PaymentAccount = {
  currency: DEFAULT_ACCOUNT_KEY,
  accountName: 'The Automation Agency Ltd',
  iban: 'GB00MONZ00000012345678',
  bic: 'MONZGB2L',
};

describe('resolvePaymentAccount', () => {
  it('prefers an exact currency match', () => {
    expect(resolvePaymentAccount([fallback, gbp], 'GBP')).toBe(gbp);
  });
  it('matches the currency case-insensitively', () => {
    expect(resolvePaymentAccount([fallback, gbp], 'gbp')).toBe(gbp);
  });
  it('falls back to the default account when the currency has none', () => {
    expect(resolvePaymentAccount([fallback, gbp], 'USD')).toBe(fallback);
  });
  it('returns null when there is neither a match nor a default', () => {
    expect(resolvePaymentAccount([gbp], 'USD')).toBeNull();
  });
  it('returns null for an empty list', () => {
    expect(resolvePaymentAccount([], 'GBP')).toBeNull();
  });
});

describe('renderPaymentBlock', () => {
  it('returns an empty string when there is no account, so nothing is printed', () => {
    expect(renderPaymentBlock(null, 'INV-0007')).toBe('');
  });
  it('lists only the fields that are filled in, labelled', () => {
    expect(renderPaymentBlock(gbp, 'INV-0007')).toBe(
      [
        'The Automation Agency Ltd',
        'Monzo',
        'Sort code: 04-00-04',
        'Account number: 12345678',
        'Payment reference: INV-0007',
      ].join('\n'),
    );
  });
  it('renders international fields when those are the ones present', () => {
    expect(renderPaymentBlock(fallback, 'INV-0008')).toBe(
      [
        'The Automation Agency Ltd',
        'IBAN: GB00MONZ00000012345678',
        'BIC: MONZGB2L',
        'Payment reference: INV-0008',
      ].join('\n'),
    );
  });
  it('always ends with the payment reference, even for a bare account', () => {
    expect(renderPaymentBlock({ currency: 'GBP' }, 'INV-0009')).toBe('Payment reference: INV-0009');
  });
  it('includes free-text notes last, before the reference', () => {
    const withNotes: PaymentAccount = { currency: 'GBP', accountName: 'A', notes: 'Wise: wise.com/pay/abc' };
    expect(renderPaymentBlock(withNotes, 'INV-0010')).toBe(
      ['A', 'Wise: wise.com/pay/abc', 'Payment reference: INV-0010'].join('\n'),
    );
  });
  it('ignores blank and whitespace-only fields', () => {
    const messy: PaymentAccount = { currency: 'GBP', accountName: '  ', bankName: 'Monzo', iban: '' };
    expect(renderPaymentBlock(messy, 'INV-0011')).toBe(['Monzo', 'Payment reference: INV-0011'].join('\n'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/payment.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/payment.ts`:

```ts
import { normalizeCurrency } from './currency.js';

/** The `currency` value of the fallback account used when a currency has no own details. */
export const DEFAULT_ACCOUNT_KEY = 'DEFAULT';

export interface PaymentAccount {
  /** An ISO currency code, or DEFAULT_ACCOUNT_KEY for the fallback. */
  currency: string;
  accountName?: string | null;
  bankName?: string | null;
  sortCode?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  bic?: string | null;
  routingNumber?: string | null;
  /** Free text, e.g. a Wise link or payment instructions. */
  notes?: string | null;
}

/** Exact currency match, then the default account, then nothing. */
export function resolvePaymentAccount(
  accounts: PaymentAccount[],
  currency: string,
): PaymentAccount | null {
  const want = normalizeCurrency(currency);
  return (
    accounts.find((a) => normalizeCurrency(a.currency) === want) ??
    accounts.find((a) => normalizeCurrency(a.currency) === DEFAULT_ACCOUNT_KEY) ??
    null
  );
}

/**
 * The pay-to block as newline-separated display lines. Blank fields are omitted
 * so no invoice ever prints an empty label, and the payment reference is always
 * last — it is what lets the business match the money to the invoice.
 */
export function renderPaymentBlock(account: PaymentAccount | null, reference: string): string {
  if (!account) return '';
  const lines: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    const v = (value ?? '').trim();
    if (v) lines.push(label ? `${label}: ${v}` : v);
  };
  push('', account.accountName);
  push('', account.bankName);
  push('Sort code', account.sortCode);
  push('Account number', account.accountNumber);
  push('IBAN', account.iban);
  push('BIC', account.bic);
  push('Routing number', account.routingNumber);
  push('', account.notes);
  push('Payment reference', reference);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Export from core's index**

In `packages/core/src/index.ts`, add:

```ts
export {
  DEFAULT_ACCOUNT_KEY,
  resolvePaymentAccount,
  renderPaymentBlock,
  type PaymentAccount,
} from './payment.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/payment.ts packages/core/test/payment.test.ts packages/core/src/index.ts
git commit -m "feat(core): resolve payment details by currency and render the pay-to block

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 4: Schema and migration

**Files:**
- Modify: `apps/web/lib/db/schema.ts`
- Create: `apps/web/drizzle/0003_phase_b1.sql`

**Interfaces:**
- Produces:
  - `invoices` gains `dueAt`, `paymentTermsDays`, `paymentDetails`, `taxRate`, `taxAmount`, `total`.
  - `settings` gains `paymentTermsDays`, `vatRate`, `vatNumber`.
  - New table `paymentAccounts` exported as `paymentAccounts`, with type `PaymentAccountRow`.

- [ ] **Step 1: Add the invoice columns**

In `apps/web/lib/db/schema.ts`, inside the `invoices` table definition, add these after the existing `cutoffMs` line:

```ts
  /** Snapshot: payment terms applied at issue, in days. 0 = due on receipt. */
  paymentTermsDays: integer('payment_terms_days').notNull().default(0),
  dueAt: timestamp('due_at', { withTimezone: true }),
  /** Snapshot: the rendered pay-to block, newline separated. */
  paymentDetails: text('payment_details'),
  /** Snapshot: VAT percentage applied (0 = none). */
  taxRate: doublePrecision('tax_rate').notNull().default(0),
  taxAmount: doublePrecision('tax_amount').notNull().default(0),
  /** The payable figure: subtotal + taxAmount. `subtotal` is strictly net. */
  total: doublePrecision('total').notNull().default(0),
```

- [ ] **Step 2: Add the settings columns**

In the same file, inside the `settings` table definition, add:

```ts
  /** Default payment terms for new invoices, in days. */
  paymentTermsDays: integer('payment_terms_days').notNull().default(14),
  /** VAT percentage; 0 disables VAT entirely. */
  vatRate: doublePrecision('vat_rate').notNull().default(0),
  vatNumber: text('vat_number'),
```

- [ ] **Step 3: Add the payment_accounts table**

In the same file, after the `settings` table, add:

```ts
/** Bank details shown on invoices: one row per currency, plus a 'DEFAULT' fallback. */
export const paymentAccounts = pgTable(
  'payment_accounts',
  {
    id: text('id').primaryKey(),
    /** An ISO currency code, or 'DEFAULT' for the fallback used by any other currency. */
    currency: text('currency').notNull(),
    accountName: text('account_name'),
    bankName: text('bank_name'),
    sortCode: text('sort_code'),
    accountNumber: text('account_number'),
    iban: text('iban'),
    bic: text('bic'),
    routingNumber: text('routing_number'),
    notes: text('notes'),
  },
  (t) => ({ currencyUnique: uniqueIndex('payment_accounts_currency_unique').on(t.currency) }),
);
```

And at the bottom of the file, alongside the other type exports, add:

```ts
export type PaymentAccountRow = typeof paymentAccounts.$inferSelect;
```

- [ ] **Step 4: Write the migration**

Create `apps/web/drizzle/0003_phase_b1.sql`:

```sql
-- Phase B1: payment details, totals and due dates.
-- Run this in the Neon SQL editor BEFORE merging to main.
-- Additive and safe to re-run.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_details text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate double precision NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_amount double precision NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total double precision NOT NULL DEFAULT 0;

-- Existing invoices carry no VAT, so their payable total is their subtotal.
-- Runs once; after this, `total` is written at issue time.
UPDATE invoices SET total = subtotal WHERE total = 0 AND subtotal <> 0;

ALTER TABLE settings ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 14;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS vat_rate double precision NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS vat_number text;

CREATE TABLE IF NOT EXISTS payment_accounts (
  id             text PRIMARY KEY,
  currency       text NOT NULL,
  account_name   text,
  bank_name      text,
  sort_code      text,
  account_number text,
  iban           text,
  bic            text,
  routing_number text,
  notes          text
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_currency_unique ON payment_accounts (currency);
```

The backfill's `AND subtotal <> 0` guard means re-running it cannot clobber a genuinely zero-total invoice issued after the migration.

- [ ] **Step 5: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed. Nothing reads the new columns yet, so this task is type-level only.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/db/schema.ts apps/web/drizzle/0003_phase_b1.sql
git commit -m "feat(db): columns for payment terms, due dates, VAT totals and bank details

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 5: Snapshot totals, terms, due date and pay-to block at issue

**Files:**
- Modify: `apps/web/lib/invoice-service.ts` (`insertInvoice`)

**Interfaces:**
- Consumes: `computeTotals`, `dueDateFrom` (Task 2); `resolvePaymentAccount`, `renderPaymentBlock` (Task 3); `paymentAccounts` (Task 4).
- Produces: every invoice written by `insertInvoice` — week, manual, and one-off — carries `total`, `taxRate`, `taxAmount`, `paymentTermsDays`, `dueAt` and `paymentDetails`.

- [ ] **Step 1: Extend the imports**

In `apps/web/lib/invoice-service.ts`, add to the `@claude-invoicer/core` import: `computeTotals`, `dueDateFrom`, `resolvePaymentAccount`, `renderPaymentBlock`. Add `paymentAccounts` to the `./db/schema` import.

- [ ] **Step 2: Snapshot everything inside `insertInvoice`**

In `insertInvoice`, after the number is resolved and before `await tx.insert(invoices).values({...})`, add:

```ts
  const totals = computeTotals(a.subtotal, a.settings.vatRate);
  const issuedAt = a.issuedAt ?? new Date();
  const termsDays = a.settings.paymentTermsDays;
  const dueAt = dueDateFrom(issuedAt, termsDays);

  const accounts = await tx.select().from(paymentAccounts);
  const paymentDetails = renderPaymentBlock(
    resolvePaymentAccount(accounts, a.client.currency),
    number,
  );
```

Then in the `values({...})` object, replace the `subtotal: round2(a.subtotal),` line with:

```ts
    subtotal: totals.subtotal,
    taxRate: totals.taxRate,
    taxAmount: totals.taxAmount,
    total: totals.total,
    paymentTermsDays: termsDays,
    dueAt,
    paymentDetails: paymentDetails || null,
```

and replace the trailing `...(a.issuedAt ? { issuedAt: a.issuedAt } : {}),` with `issuedAt,` — the date is now always computed above, so the conditional spread is redundant and the stored `issuedAt` must match the one the due date was derived from.

- [ ] **Step 3: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/invoice-service.ts
git commit -m "feat(web): snapshot totals, terms, due date and bank details at issue

Changing banks or VAT settings later cannot alter an already-issued invoice.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 6: Payment accounts editor in Settings

**Files:**
- Modify: `apps/web/lib/queries.ts` (new `listPaymentAccounts`)
- Modify: `apps/web/lib/actions.ts` (`savePaymentAccount`, `deletePaymentAccount`)
- Create: `apps/web/components/payment-accounts-form.tsx`
- Modify: `apps/web/app/settings/page.tsx`

**Interfaces:**
- Consumes: `DEFAULT_ACCOUNT_KEY`, `CURRENCIES`, `normalizeCurrency` from core; `paymentAccounts` from schema.
- Produces:
  - `listPaymentAccounts(): Promise<PaymentAccountRow[]>`
  - `savePaymentAccount(fd: FormData): Promise<void>` — fields `currency`, `accountName`, `bankName`, `sortCode`, `accountNumber`, `iban`, `bic`, `routingNumber`, `notes`
  - `deletePaymentAccount(fd: FormData): Promise<void>` — field `currency`
  - `<PaymentAccountsForm accounts={PaymentAccountRow[]} />`

- [ ] **Step 1: Query the accounts**

In `apps/web/lib/queries.ts`, add `paymentAccounts` and `type PaymentAccountRow` to the schema import, then add near `listClients`:

```ts
/** Bank details rows, default first, then by currency. */
export async function listPaymentAccounts(): Promise<PaymentAccountRow[]> {
  const db = getDb();
  const rows = await db.select().from(paymentAccounts);
  return rows.sort((a, b) =>
    a.currency === 'DEFAULT' ? -1 : b.currency === 'DEFAULT' ? 1 : a.currency.localeCompare(b.currency),
  );
}
```

- [ ] **Step 2: Write the actions**

In `apps/web/lib/actions.ts`, add `DEFAULT_ACCOUNT_KEY` and `normalizeCurrency` to the core import, `paymentAccounts` to the schema import, then add a new section at the end of the file:

```ts
// ---------------- Payment accounts ----------------

/**
 * Create or replace the bank details for one currency. `currency` is either an
 * ISO code or 'DEFAULT' for the fallback used when a currency has no own row.
 */
export async function savePaymentAccount(fd: FormData): Promise<void> {
  const raw = str(fd, 'currency');
  if (!raw) throw new Error('Pick a currency for these details');
  const currency = raw === DEFAULT_ACCOUNT_KEY ? DEFAULT_ACCOUNT_KEY : normalizeCurrency(raw);
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
  const currency = str(fd, 'currency');
  if (!currency) throw new Error('Missing currency');
  const db = getDb();
  await db.delete(paymentAccounts).where(eq(paymentAccounts.currency, currency));
  revalidatePath('/settings');
}
```

- [ ] **Step 3: Build the editor component**

Create `apps/web/components/payment-accounts-form.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { CURRENCIES, DEFAULT_ACCOUNT_KEY } from '@claude-invoicer/core';
import { deletePaymentAccount, savePaymentAccount } from '@/lib/actions';

interface AccountRow {
  currency: string;
  accountName: string | null;
  bankName: string | null;
  sortCode: string | null;
  accountNumber: string | null;
  iban: string | null;
  bic: string | null;
  routingNumber: string | null;
  notes: string | null;
}

const FIELDS: { name: keyof AccountRow; label: string; placeholder?: string }[] = [
  { name: 'accountName', label: 'Account name' },
  { name: 'bankName', label: 'Bank' },
  { name: 'sortCode', label: 'Sort code', placeholder: '04-00-04' },
  { name: 'accountNumber', label: 'Account number' },
  { name: 'iban', label: 'IBAN' },
  { name: 'bic', label: 'BIC / SWIFT' },
  { name: 'routingNumber', label: 'Routing number' },
];

function AccountFields({ account }: { account: AccountRow }) {
  return (
    <>
      {FIELDS.map((f) => (
        <div key={f.name}>
          <label className="label">{f.label}</label>
          <input
            name={f.name}
            defaultValue={(account[f.name] as string | null) ?? ''}
            placeholder={f.placeholder}
            className="input"
          />
        </div>
      ))}
      <div className="sm:col-span-2">
        <label className="label">Payment note (optional)</label>
        <input
          name="notes"
          defaultValue={account.notes ?? ''}
          placeholder="Wise: wise.com/pay/… — or any instruction for the client"
          className="input"
        />
      </div>
    </>
  );
}

/**
 * Bank details printed on invoices. The DEFAULT row is used for any currency
 * without its own; only the fields you fill in are printed.
 */
export function PaymentAccountsForm({ accounts }: { accounts: AccountRow[] }) {
  const existing = new Set(accounts.map((a) => a.currency));
  const [adding, setAdding] = useState('');
  const available = CURRENCIES.filter((c) => !existing.has(c.code));
  const blank: AccountRow = {
    currency: '',
    accountName: null,
    bankName: null,
    sortCode: null,
    accountNumber: null,
    iban: null,
    bic: null,
    routingNumber: null,
    notes: null,
  };

  return (
    <div className="space-y-4">
      {!existing.has(DEFAULT_ACCOUNT_KEY) && (
        <form action={savePaymentAccount} className="card grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="currency" value={DEFAULT_ACCOUNT_KEY} />
          <div className="sm:col-span-2 text-sm font-semibold text-slate-300">
            Default details — used for any currency without its own
          </div>
          <AccountFields account={blank} />
          <div className="sm:col-span-2">
            <button className="btn-primary" type="submit">Save default details</button>
          </div>
        </form>
      )}

      {accounts.map((a) => (
        <div key={a.currency} className="card space-y-3">
          <div className="text-sm font-semibold text-slate-300">
            {a.currency === DEFAULT_ACCOUNT_KEY
              ? 'Default details — used for any currency without its own'
              : `${a.currency} details`}
          </div>
          {/* Save and Remove are sibling forms, not nested — HTML forbids nesting,
              and React 18 has no formAction, so one form cannot host both actions. */}
          <form action={savePaymentAccount} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="currency" value={a.currency} />
            <AccountFields account={a} />
            <div className="sm:col-span-2">
              <button className="btn-primary" type="submit">Save</button>
            </div>
          </form>
          <form action={deletePaymentAccount}>
            <input type="hidden" name="currency" value={a.currency} />
            <button className="btn-danger" type="submit">
              Remove {a.currency === DEFAULT_ACCOUNT_KEY ? 'default' : a.currency} details
            </button>
          </form>
        </div>
      ))}

      {available.length > 0 && (
        <form action={savePaymentAccount} className="card grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Add details for another currency</label>
            <select
              name="currency"
              className="input"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              required
            >
              <option value="" disabled>Pick a currency…</option>
              {available.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </select>
          </div>
          {adding !== '' && (
            <>
              <AccountFields account={blank} />
              <div className="sm:col-span-2">
                <button className="btn-primary" type="submit">Add {adding} details</button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Render it on the settings page**

In `apps/web/app/settings/page.tsx`, import `listPaymentAccounts` from `@/lib/queries` and `PaymentAccountsForm` from `@/components/payment-accounts-form`, load the accounts alongside the settings:

```tsx
  const [s, accounts] = await Promise.all([getSettings(), listPaymentAccounts()]);
```

and add this section after the existing settings form's closing `</form>`:

```tsx
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Payment details (printed on invoices)
        </h2>
        <p className="text-xs text-slate-500">
          An invoice shows the details matching its currency, falling back to the default. Only the
          fields you fill in are printed, and the details are copied onto each invoice as it is
          issued — changing them later never alters an invoice you have already sent.
        </p>
        <PaymentAccountsForm accounts={accounts} />
      </section>
```

- [ ] **Step 5: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/queries.ts apps/web/lib/actions.ts apps/web/components/payment-accounts-form.tsx apps/web/app/settings/page.tsx
git commit -m "feat(web): edit bank details per currency in Settings

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 7: VAT and payment-terms fields in Settings

**Files:**
- Modify: `apps/web/lib/actions.ts` (`updateSettings`)
- Modify: `apps/web/app/settings/page.tsx`

**Interfaces:**
- Consumes: the `settings` columns from Task 4.
- Produces: `updateSettings` additionally persists `paymentTermsDays`, `vatRate`, `vatNumber`.

- [ ] **Step 1: Persist the new fields**

In `apps/web/lib/actions.ts`, in `updateSettings`, add to the `.set({...})` object:

```ts
      paymentTermsDays: num(fd, 'paymentTermsDays', 14),
      vatRate: num(fd, 'vatRate', 0),
      vatNumber: str(fd, 'vatNumber') || null,
```

- [ ] **Step 2: Add the fields to the form**

In `apps/web/app/settings/page.tsx`, inside the existing settings form after the Tax ID block, add:

```tsx
        <div>
          <label className="label">VAT number</label>
          <input name="vatNumber" defaultValue={s.vatNumber ?? ''} className="input" />
        </div>
        <div>
          <label className="label">VAT rate (%)</label>
          <input name="vatRate" type="number" step="0.1" min="0" defaultValue={s.vatRate} className="input" />
          <p className="mt-1 text-xs text-slate-500">
            0 turns VAT off entirely — no VAT line, no VAT number printed. Set 20 once you are
            registered. Invoices already issued keep the rate they were issued with.
          </p>
        </div>
        <div>
          <label className="label">Payment terms (days)</label>
          <input
            name="paymentTermsDays"
            type="number"
            min="0"
            defaultValue={s.paymentTermsDays}
            className="input"
          />
          <p className="mt-1 text-xs text-slate-500">
            Sets the due date printed on new invoices. 0 means due on receipt.
          </p>
        </div>
```

- [ ] **Step 3: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions.ts apps/web/app/settings/page.tsx
git commit -m "feat(web): VAT rate, VAT number and payment terms in Settings

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 8: Move every payable figure from `subtotal` to `total`, and show overdue

This is the highest-risk task in the phase: `subtotal` is now strictly net, so any display of "the amount due" still reading `subtotal` would understate the bill once VAT is on. The call sites are enumerated exhaustively below — there are exactly seven, and the four `subtotal` uses NOT in this list are deliberate (they compute the net figure, or belong to the week estimate, which is not an invoice).

**Files:**
- Modify: `apps/web/lib/email.ts` (2 sites)
- Modify: `apps/web/app/invoices/page.tsx` (1 site + overdue badge)
- Modify: `apps/web/app/invoices/[id]/page.tsx` (1 site + due date + overdue + pay-to block)
- Modify: `apps/web/app/i/[token]/page.tsx` (1 site + due date + overdue + pay-to block)
- Modify: `apps/web/lib/pdf/render.ts` (2 sites — Task 9 rebuilds the layout; this task only corrects the figure)

**Interfaces:**
- Consumes: `isOverdue` from core (Task 2); `invoice.total`, `invoice.dueAt`, `invoice.paymentDetails` (Task 4).

- [ ] **Step 1: Email**

In `apps/web/lib/email.ts`, change both `formatMoney(invoice.subtotal, invoice.currency)` calls to `formatMoney(invoice.total, invoice.currency)`.

- [ ] **Step 2: PDF figures**

In `apps/web/lib/pdf/render.ts`, change the "Total due" amount and the receipt's "AMOUNT PAID" amount from `invoice.subtotal` to `invoice.total`. Both are single-token changes; Task 9 rebuilds the surrounding block.

- [ ] **Step 3: Invoice list — amount and overdue badge**

In `apps/web/app/invoices/page.tsx`, change `formatMoney(inv.subtotal, inv.currency)` to `formatMoney(inv.total, inv.currency)`. Import `isOverdue` from `@claude-invoicer/core`, compute `const now = Date.now();` once inside the component, and replace the existing right-aligned status cell (the paid/amber ternary) with a three-way one. Keep the cell's `text-right` alignment and the existing badge classes so the column still lines up:

```tsx
                  <td className="py-2 text-right">
                    {inv.status === 'paid' ? (
                      <span className="rounded bg-green-900/40 px-2 py-0.5 text-xs text-green-300">paid</span>
                    ) : isOverdue(inv.status, inv.dueAt, now) ? (
                      <span className="rounded bg-red-900/40 px-2 py-0.5 text-xs text-red-300">overdue</span>
                    ) : (
                      <span className="rounded bg-amber-900/40 px-2 py-0.5 text-xs text-amber-300">unpaid</span>
                    )}
                  </td>
```

Do not add a column — the table has exactly five (`Number`, `Client`, `Issued`, `Amount`, `Status`) and this replaces the fifth cell's contents.

- [ ] **Step 4: Invoice detail — amount, due date, pay-to block**

In `apps/web/app/invoices/[id]/page.tsx`, change the total to `invoice.total`, and add below it, still inside the totals area:

```tsx
              {invoice.taxAmount > 0 && (
                <div className="text-xs text-slate-500">
                  Net {formatMoney(invoice.subtotal, invoice.currency)} · VAT {invoice.taxRate}%{' '}
                  {formatMoney(invoice.taxAmount, invoice.currency)}
                </div>
              )}
              {invoice.dueAt && (
                <div className={`text-xs ${isOverdue(invoice.status, invoice.dueAt, Date.now()) ? 'text-red-300' : 'text-slate-500'}`}>
                  Due {formatDate(invoice.dueAt, settings.timezone)}
                  {isOverdue(invoice.status, invoice.dueAt, Date.now()) ? ' — overdue' : ''}
                </div>
              )}
```

and, after the line-items table, a pay-to block:

```tsx
        {invoice.paymentDetails && (
          <section className="card space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Pay to</h2>
            {invoice.paymentDetails.split('\n').map((line, i) => (
              <div key={i} className="text-sm text-slate-300">{line}</div>
            ))}
          </section>
        )}
```

Import `isOverdue` from `@claude-invoicer/core` and `formatDate` from `@/lib/format` if they are not already imported.

- [ ] **Step 5: Public invoice page**

In `apps/web/app/i/[token]/page.tsx`, apply the same three changes as Step 4 — total, the VAT/due lines, and the pay-to block. This is the page the client actually sees, so the pay-to block matters most here.

- [ ] **Step 6: Prove no payable figure still reads `subtotal`**

Run: `grep -rn "invoice\.subtotal\|inv\.subtotal" apps/web`

Note that `subtotal` is **not** banned — it is the net figure, and showing it beside a VAT line is correct. What must not remain is a *payable* figure reading it. Check each match against this allow-list:

| Location | Allowed? |
|---|---|
| `app/invoices/[id]/page.tsx` — inside the `taxAmount > 0` net/VAT detail line | ✅ allowed, added by Step 4 |
| `app/i/[token]/page.tsx` — same net/VAT detail line | ✅ allowed, added by Step 5 |
| `lib/pdf/render.ts` — the `Subtotal` row of the totals block | ✅ allowed, added by Task 9 (not yet present at this point) |
| Anything labelled Total, Amount, Amount paid, or the figure in an email | ❌ must read `total` |

Expected right now, before Task 9: matches only in the two net/VAT detail lines you just added. Any match on a total, an amount-due, or an email figure is a site this task missed.

- [ ] **Step 7: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/email.ts apps/web/lib/pdf/render.ts apps/web/app/invoices/page.tsx "apps/web/app/invoices/[id]/page.tsx" "apps/web/app/i/[token]/page.tsx"
git commit -m "feat(web): show the payable total, the due date and how to pay

subtotal is now strictly net; every amount-due display reads total.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 9: Put the due date, the VAT breakdown and the pay-to block on the PDF

**Files:**
- Modify: `apps/web/lib/pdf/render.ts`

**Interfaces:**
- Consumes: `invoice.dueAt`, `invoice.paymentDetails`, `invoice.taxRate`, `invoice.taxAmount`, `invoice.total`.

- [ ] **Step 1: Add the due date to the meta column**

In `renderInvoicePdf`, the right-hand meta column currently draws ISSUED and STATUS. Insert a DUE block between them, and push the `metaBottom` down accordingly:

```ts
  draw(page, 'ISSUED', M, y, f.reg, 8, MUTED, RIGHT);
  draw(page, day(invoice.issuedAt, tz), M, y - 14, f.reg, 10, INK, RIGHT);
  let metaY = y - 32;
  if (invoice.dueAt) {
    draw(page, 'DUE', M, metaY, f.reg, 8, MUTED, RIGHT);
    draw(page, day(invoice.dueAt, tz), M, metaY - 14, f.reg, 10, INK, RIGHT);
    metaY -= 32;
  }
  draw(page, 'STATUS', M, metaY, f.reg, 8, MUTED, RIGHT);
  draw(page, invoice.status.toUpperCase(), M, metaY - 14, f.bold, 11, invoice.status === 'paid' ? GREEN : MUTED, RIGHT);
  const metaBottom = metaY - 14;
```

- [ ] **Step 2: Replace the single total with a net / VAT / total block**

Replace the current "Total due" pair of `draw` calls with:

```ts
  y -= 10;
  if (invoice.taxAmount !== 0) {
    draw(page, 'Subtotal', M, y, f.reg, 10, MUTED, COL_RATE);
    draw(page, formatMoney(invoice.subtotal, invoice.currency), M, y, f.reg, 10, INK, COL_AMT);
    y -= 16;
    draw(page, `VAT ${invoice.taxRate}%`, M, y, f.reg, 10, MUTED, COL_RATE);
    draw(page, formatMoney(invoice.taxAmount, invoice.currency), M, y, f.reg, 10, INK, COL_AMT);
    y -= 18;
  }
  draw(page, 'Total due', M, y, f.bold, 13, INK, COL_RATE);
  draw(page, formatMoney(invoice.total, invoice.currency), M, y, f.bold, 13, INK, COL_AMT);
```

- [ ] **Step 3: Draw the pay-to block**

Add a helper next to `partyBlock`:

```ts
/** Bank details block, drawn from the invoice's snapshotted newline-separated text. */
function payToBlock(page: PDFPage, f: Fonts, details: string, y: number): number {
  draw(page, 'PAY TO', M, y, f.reg, 8, MUTED);
  let yy = y - 14;
  for (const line of details.split('\n')) {
    if (!line.trim()) continue;
    draw(page, line, M, yy, f.reg, 9, INK);
    yy -= 12;
  }
  return yy;
}
```

and call it in `renderInvoicePdf` after the totals and before the hours grid:

```ts
  if (invoice.paymentDetails) {
    y -= 34;
    y = payToBlock(page, f, invoice.paymentDetails, y);
  }
```

- [ ] **Step 4: Update the receipt's amount**

In `renderReceiptPdf`, confirm the centred amount reads `invoice.total` (Task 8 Step 2 changed it). If Task 8 left it on `subtotal`, fix it here.

Leave `header` alone. It prints `Tax ID: …` from the invoice's own snapshot; the VAT *number* is a settings field with no snapshot column yet, and reading live settings into an issued document would break the snapshot rule. Phase B2 adds `invoices.vat_number` alongside the document-type columns and prints it then.

- [ ] **Step 5: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

Then render one PDF by eye if you have a way to: the layout must not collide when `dueAt` is null, when `taxAmount` is 0, and when `paymentDetails` is null — all three are the default state for an existing invoice, so the common case must look exactly as it does today apart from the total.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/pdf/render.ts
git commit -m "feat(pdf): due date, VAT breakdown and pay-to block on the invoice

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

## Phase B1 completion checklist

- [ ] `npm test` — core green (79 existing + the new invoicing and payment suites)
- [ ] `npm --prefix apps/web run typecheck` — clean
- [ ] `npm --prefix apps/web run build` — clean
- [ ] `grep -rn "invoice\.subtotal\|inv\.subtotal" apps/web` returns **only** net/VAT breakdown lines (invoice detail page, public page, PDF totals block) — no total, amount-due or email figure among them
- [ ] `apps/web/drizzle/0003_phase_b1.sql` exists and is additive only
- [ ] **The user has run `0003_phase_b1.sql` in the Neon SQL editor** — this must happen before the branch merges to `main`, or the deploy will 500
- [ ] With VAT at 0 and no payment accounts configured, an issued invoice looks exactly as it did before apart from carrying a due date
