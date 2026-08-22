# Phase D1 — Brief ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop a client estimate (a `.docx` file or pasted text) into the app and get an editable brief attached to a client and folder, with its work items as milestones carrying estimate ranges — so there is something concrete to bill against.

**Architecture:** Parsing is a pure function in `packages/core` (the only workspace with a test runner), pinned by a fixture taken from a real client estimate. File extraction is a thin server-side step in `apps/web` that turns a `.docx` into tab-delimited text and hands it to the same parser as a paste, so there is exactly one parsing path. Nothing is ever saved from a parse alone — the user confirms an editable table first.

**Tech Stack:** TypeScript, Next.js 15 App Router (server actions, server components), Drizzle ORM + Neon Postgres, JSZip for `.docx`, Tailwind, vitest (core only).

**Spec:** `docs/superpowers/specs/2026-08-14-agency-overhaul-design.md` (sections D1 and D2)

**Not in this plan:** `MILESTONES.md`, the agent sync, milestone completion, invoicing and burn-down — all Phase D2, which depends on this. D1 ends with a brief you can see, edit and attach; D2 makes it bill.

## Global Constraints

- **This phase needs a migration.** `apps/web/drizzle/0006_phase_d1.sql`, additive and idempotent, wrapped in `BEGIN;`/`COMMIT;`, run by the user in the Neon SQL editor **before** the branch merges to `main`. `0003`, `0004` and `0005` have already been run.
- **Any statement that can legitimately fail goes AFTER `COMMIT;`** — a failure there must never roll back the schema the app needs to boot. That is what took production down on 2026-08-17; do not repeat it.
- **`apps/web/lib/db/schema.ts` is the source of truth** for the live schema. `0005_reconcile_schema.sql` reconciled the two; keep them in step.
- **`packages/core` must stay pure** — no DB, no React, no Node built-ins. The `.docx` unzip therefore lives in `apps/web`, not core. (Core *tests* may use Node built-ins; the rule binds the shipped module.)
- **Nothing is created from a parse alone.** The parse result is always shown in an editable table the user confirms.
- **Skipped rows are reported, never silently dropped.** Every subtotal or summary row the parser ignores appends to `warnings`.
- **Every mutating server action calls `await requireOwner();` as its first statement** (`apps/web/lib/actions.ts`). Server Actions are dispatched by id, not route, so the middleware does not protect them.
- **Invoices snapshot identity at issue time** — nothing here changes an issued document.
- Core tests: `npm test` from the repo root (138 passing). Web: `npm --prefix apps/web run typecheck` and `npm --prefix apps/web run build`. There is no test runner in `apps/web`; do not add one.
- Pre-existing environment noise, not yours to fix: `jose`/`next-auth` Edge Runtime warnings during build, and an `EINVAL readlink` error from a stale `apps/web/.next` (clear it and rebuild).
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ
  ```

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/brief.ts` | **Create.** `parseBriefText` — money/hours/range scanning, section tracking, skip rules. |
| `packages/core/test/brief.test.ts` | **Create.** Unit rules plus the real-estimate fixture. |
| `packages/core/test/fixtures/story-to-tell-estimate.txt` | **Create.** Tab-delimited text of a real client estimate. |
| `packages/core/src/index.ts` | **Modify.** Re-export. |
| `apps/web/lib/docx.ts` | **Create.** `.docx` → tab-delimited text. Web-only (uses JSZip). |
| `apps/web/lib/db/schema.ts` | **Modify.** `briefs` and `milestones`; `folderMappings.billingMode`; `invoices.briefId`/`milestoneId`. |
| `apps/web/drizzle/0006_phase_d1.sql` | **Create.** The migration the user runs. |
| `apps/web/lib/actions.ts` | **Modify.** `parseBriefUpload`, `createBrief`, `deleteBrief`. |
| `apps/web/lib/queries.ts` | **Modify.** `listBriefs`, `getBriefDetail`. |
| `apps/web/components/brief-import-form.tsx` | **Create.** Paste/upload → confirm table → save. |
| `apps/web/app/clients/[id]/page.tsx` | **Modify.** Briefs section. |
| `apps/web/app/briefs/[id]/page.tsx` | **Create.** Brief detail. |

---

### Task 1: The brief parser in core

The parser is the only real logic in this phase, so it is built first and test-first.

**Files:**
- Create: `packages/core/src/brief.ts`
- Create: `packages/core/test/brief.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `round2` from `./billing.js`.
- Produces:
  - `interface ParsedItem { section: string; title: string; hoursLow: number; hoursHigh: number; amountLow: number; amountHigh: number }`
  - `interface ParsedBrief { title: string; currency: string; ratePerHour: number; items: ParsedItem[]; warnings: string[] }`
  - `parseBriefText(text: string): ParsedBrief`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/brief.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseBriefText } from '../src/brief.js';

describe('parseBriefText — money and ranges', () => {
  it('reads a tab-delimited row with an hours range and a cost range', () => {
    const r = parseBriefText('Build the API\t2-3 hrs\t$60-$90');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      title: 'Build the API',
      hoursLow: 2,
      hoursHigh: 3,
      amountLow: 60,
      amountHigh: 90,
    });
  });
  it('treats a single figure as both ends of the range', () => {
    const r = parseBriefText('Fixed piece\t4 hrs\t$120');
    expect(r.items[0]).toMatchObject({ hoursLow: 4, hoursHigh: 4, amountLow: 120, amountHigh: 120 });
  });
  it('accepts en dash, em dash, hyphen and "to" as range separators', () => {
    for (const sep of ['\u2013', '\u2014', '-', ' to ']) {
      const r = parseBriefText(`Item\t2${sep}3 hrs\t$60${sep}$90`);
      expect(r.items[0], sep).toMatchObject({ hoursLow: 2, hoursHigh: 3, amountLow: 60, amountHigh: 90 });
    }
  });
  it('reads fractional hours', () => {
    expect(parseBriefText('Small job\t0.5-1 hr\t$15-$30').items[0]).toMatchObject({ hoursLow: 0.5, hoursHigh: 1 });
  });
  it('strips thousands separators from money', () => {
    expect(parseBriefText('Big job\t40 hrs\t$1,200').items[0]!.amountLow).toBe(1200);
  });
  it('detects the currency from the first symbol seen', () => {
    expect(parseBriefText('A\t1 hr\t\u00a350').currency).toBe('GBP');
    expect(parseBriefText('A\t1 hr\t$50').currency).toBe('USD');
    expect(parseBriefText('A\t1 hr\t\u20ac50').currency).toBe('EUR');
  });
  it('defaults the currency to GBP when no symbol appears', () => {
    expect(parseBriefText('A\t1 hr\t50').currency).toBe('GBP');
  });
});

describe('parseBriefText — structure', () => {
  it('picks up an hourly rate stated once', () => {
    expect(parseBriefText('Rate: $30/hr\nA\t1 hr\t$30').ratePerHour).toBe(30);
    expect(parseBriefText('Rate: \u00a345 per hour\nA\t1 hr\t\u00a345').ratePerHour).toBe(45);
  });
  it('assigns items to the numbered section above them', () => {
    const r = parseBriefText('1. Setup\nA\t1 hr\t$30\n2. Build\nB\t2 hrs\t$60');
    expect(r.items.map((i) => i.section)).toEqual(['1. Setup', '2. Build']);
  });
  it('takes the title from the first non-empty line', () => {
    expect(parseBriefText('A STORY TO TELL\nWork Estimate\nA\t1 hr\t$30').title).toBe('A STORY TO TELL');
  });
});

describe('parseBriefText — what it must NOT count', () => {
  it('skips subtotal rows and says so', () => {
    const r = parseBriefText('A\t1 hr\t$30\nSubtotal\t1 hr\t$30');
    expect(r.items).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/subtotal/i);
  });
  it('skips a table header row', () => {
    const r = parseBriefText('Work\tEstimated time\tEstimated cost\nA\t1 hr\t$30');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.title).toBe('A');
  });
  it('skips everything after an Overall Estimate heading', () => {
    const r = parseBriefText('1. Work\nA\t1 hr\t$30\nOverall Estimate\nArea\tHours\tCost\nWork\t1\t$30');
    expect(r.items).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/summary|overall/i);
  });
  it('ignores prose that merely mentions a number', () => {
    expect(parseBriefText('This estimate is valid for 30 days from 11 August 2026.').items).toHaveLength(0);
  });
  it('requires an amount or a duration, not just any text', () => {
    expect(parseBriefText('Some heading\nJust a sentence about the work.').items).toHaveLength(0);
  });
  it('returns an empty result rather than throwing on empty input', () => {
    const r = parseBriefText('');
    expect(r.items).toEqual([]);
    expect(r.title).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/brief.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/brief.ts`:

```ts
import { round2 } from './billing.js';

export interface ParsedItem {
  section: string;
  title: string;
  hoursLow: number;
  hoursHigh: number;
  amountLow: number;
  amountHigh: number;
}

export interface ParsedBrief {
  title: string;
  currency: string;
  ratePerHour: number;
  items: ParsedItem[];
  /** Rows deliberately skipped, and why — surfaced so nothing vanishes silently. */
  warnings: string[];
}

const DASH = '[\\u2013\\u2014-]';
const SYMBOL_CURRENCY: [string, string][] = [['\u00a3', 'GBP'], ['$', 'USD'], ['\u20ac', 'EUR']];

/** A row that restates other rows rather than describing work of its own. */
const AGGREGATE_ROW = /^(sub)?total\b|^overall\b|^estimated\s+(time|cost)\b|^area\b|^work$|^hours$/i;
/** A heading after which everything restates what came before. */
const SUMMARY_HEADING = /^(overall estimate|summary)\b/i;
/** "1. Moving to the Free + Pro Plans" */
const SECTION_HEADING = /^\d+\.\s+\S/;

function num(raw: string): number {
  return round2(Number(raw.replace(/,/g, '')));
}

const HOURS_UNIT = 'h(?:rs?|ours?)?\\b';

/** Low/high hours from "2-3 hrs", "2 to 3 hrs" or "4 hrs". Null when absent. */
function hoursRange(text: string): { low: number; high: number } | null {
  const both = new RegExp(`([\\d.,]+)\\s*(?:${DASH}|to)\\s*([\\d.,]+)\\s*${HOURS_UNIT}`, 'i').exec(text);
  if (both) return { low: num(both[1]!), high: num(both[2]!) };
  const one = new RegExp(`([\\d.,]+)\\s*${HOURS_UNIT}`, 'i').exec(text);
  if (!one) return null;
  const v = num(one[1]!);
  return { low: v, high: v };
}

/** Money ranges: "$60-$90", "60-90", "$1,200". Null when absent. */
function moneyRange(text: string): { low: number; high: number } | null {
  const both = new RegExp(
    `[\\u00a3$\\u20ac]\\s*([\\d.,]+)\\s*(?:${DASH}|to)\\s*[\\u00a3$\\u20ac]?\\s*([\\d.,]+)`,
  ).exec(text);
  if (both) return { low: num(both[1]!), high: num(both[2]!) };
  const one = /[\u00a3$\u20ac]\s*([\d.,]+)/.exec(text);
  if (one) return { low: num(one[1]!), high: num(one[1]!) };
  const bare = new RegExp(`(?:^|\\s)([\\d.,]+)\\s*(?:${DASH}|to)\\s*([\\d.,]+)\\s*$`).exec(text);
  if (bare) return { low: num(bare[1]!), high: num(bare[2]!) };
  const single = /(?:^|\s)([\d.,]+)\s*$/.exec(text);
  return single ? { low: num(single[1]!), high: num(single[1]!) } : null;
}

/**
 * Pull work items out of an estimate. Deterministic — no model call.
 *
 * Real estimates are Word tables of `Work | Estimated time | Estimated cost`
 * with ranges, numbered sections, subtotal rows and a summary table that
 * restates everything. Counting a subtotal as work would double the money, so
 * aggregate rows and everything after a summary heading are skipped — and every
 * skip is reported rather than dropped.
 */
export function parseBriefText(text: string): ParsedBrief {
  const out: ParsedBrief = { title: '', currency: '', ratePerHour: 0, items: [], warnings: [] };
  let section = '';
  let inSummary = false;
  let skippedAggregates = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!out.title) out.title = line;

    const rate = /rate[:\s]*[\u00a3$\u20ac]?\s*([\d.,]+)\s*(?:\/|per\s+)h/i.exec(line);
    if (rate && !out.ratePerHour) out.ratePerHour = num(rate[1]!);

    if (SUMMARY_HEADING.test(line)) {
      inSummary = true;
      out.warnings.push(
        `Ignored everything from "${line}" onwards — a summary restates rows already counted.`,
      );
      continue;
    }
    if (inSummary) continue;

    if (SECTION_HEADING.test(line) && !line.includes('\t')) {
      section = line;
      continue;
    }

    const cells = line.split('\t').map((c) => c.trim()).filter(Boolean);
    const title = cells[0] ?? '';
    if (!title) continue;

    if (AGGREGATE_ROW.test(title)) {
      skippedAggregates += 1;
      continue;
    }

    const rest = cells.length > 1 ? cells.slice(1).join(' ') : line.slice(title.length);
    const hours = hoursRange(rest);
    const money = moneyRange(rest);
    if (!hours && !money) continue;

    if (!out.currency) {
      for (const [sym, code] of SYMBOL_CURRENCY) {
        if (rest.includes(sym)) {
          out.currency = code;
          break;
        }
      }
    }

    out.items.push({
      section,
      title,
      hoursLow: hours?.low ?? 0,
      hoursHigh: hours?.high ?? 0,
      amountLow: money?.low ?? 0,
      amountHigh: money?.high ?? 0,
    });
  }

  if (skippedAggregates > 0) {
    out.warnings.push(
      `Skipped ${skippedAggregates} subtotal or header row${skippedAggregates === 1 ? '' : 's'} — counting them would double the total.`,
    );
  }
  if (!out.currency) out.currency = 'GBP';
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the new brief tests plus the existing 138.

- [ ] **Step 5: Export from core's index**

In `packages/core/src/index.ts`, add:

```ts
export { parseBriefText, type ParsedBrief, type ParsedItem } from './brief.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/brief.ts packages/core/test/brief.test.ts packages/core/src/index.ts
git commit -m "feat(core): parse an estimate into work items with ranges

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 2: Pin the parser against a real estimate

Unit rules pass on inputs chosen to make them pass. This locks the parser against a genuine client estimate, so a change that starts double-counting fails loudly rather than quietly inflating an invoice.

**Files:**
- Create: `packages/core/test/fixtures/story-to-tell-estimate.txt`
- Modify: `packages/core/test/brief.test.ts`

**Interfaces:**
- Consumes: `parseBriefText` (Task 1).

- [ ] **Step 1: Create the fixture**

Create `packages/core/test/fixtures/story-to-tell-estimate.txt` with the content below. **The separators between the three columns must be real tab characters.** After writing it, verify with `grep -P '\t' packages/core/test/fixtures/story-to-tell-estimate.txt | head -3` — if that prints nothing, the tabs became spaces and the fixture is wrong.

```
A STORY TO TELL
Work Estimate - Free/Pro Migration, New Features & Homepage Rebuild
Prepared by Ben Horne - 11 August 2026 - Rate: $30/hr
1. Moving to the Free + Pro Plans
Work	Estimated time	Estimated cost
Remove the Basic plan, update Stripe and the pricing page	2-3 hrs	$60-$90
Set the Free/Pro rules throughout the app	8-12 hrs	$240-$360
Add the delete option without letting it bypass Free limits	3-4 hrs	$90-$120
Set storage limits for Free and Pro	2-3 hrs	$60-$90
Subtotal	15-22 hrs	$450-$660
2. New Pro Features
Work	Estimated time	Estimated cost
AI Story Captions - automatically create captions for photos	6-8 hrs	$180-$240
Memory Audio - upload, save and play audio alongside a memory	6-8 hrs	$180-$240
Memory Clips - upload, process and play short 10-20 second videos	10-16 hrs	$300-$480
Subtotal	22-32 hrs	$660-$960
3. Homepage Rebuild
Work	Estimated time	Estimated cost
New hero section, headline, copy and layout	2-3 hrs	$60-$90
Start Your Story button and Free/Pro journey	2-3 hrs	$60-$90
Simple Upload, Create, Share guide	2-3 hrs	$60-$90
Remove the existing sections that are no longer needed	2-3 hrs	$60-$90
Update the contact email and contact flow	0.5-1 hr	$15-$30
Subtotal	8.5-13 hrs	$255-$390
4. Testing & Launch
Test the main Free and Pro journeys before deployment	2-4 hrs	$60-$120
Overall Estimate
Area	Hours	Estimated cost
Free + Pro subscription changes	15-22	$450-$660
New Pro features	22-32	$660-$960
Homepage rebuild	8.5-13	$255-$390
Testing and launch	2-4	$60-$120
This estimate is valid for 30 days from 11 August 2026.
```

- [ ] **Step 2: Write the failing fixture test**

Append to `packages/core/test/brief.test.ts` (the `readFileSync` here is in a *test*; core's no-Node-built-ins rule binds the shipped module, not its tests):

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('parseBriefText — a real client estimate', () => {
  const text = readFileSync(
    fileURLToPath(new URL('./fixtures/story-to-tell-estimate.txt', import.meta.url)),
    'utf8',
  );
  const parsed = parseBriefText(text);

  it('finds every work item and no subtotal or summary row', () => {
    expect(parsed.items).toHaveLength(13);
  });
  it('does not double-count: the money matches the sum of the sections', () => {
    expect(parsed.items.reduce((s, i) => s + i.amountLow, 0)).toBe(1425);
    expect(parsed.items.reduce((s, i) => s + i.amountHigh, 0)).toBe(2130);
  });
  it('totals the hours across all four sections', () => {
    expect(parsed.items.reduce((s, i) => s + i.hoursLow, 0)).toBeCloseTo(47.5, 5);
    expect(parsed.items.reduce((s, i) => s + i.hoursHigh, 0)).toBeCloseTo(71, 5);
  });
  it('groups the items under their four sections', () => {
    const sections = [...new Set(parsed.items.map((i) => i.section))];
    expect(sections).toHaveLength(4);
    expect(sections[0]).toMatch(/Free \+ Pro/);
  });
  it('reads the rate and currency from the document', () => {
    expect(parsed.ratePerHour).toBe(30);
    expect(parsed.currency).toBe('USD');
  });
  it('reports what it skipped rather than dropping it silently', () => {
    expect(parsed.warnings.join(' ')).toMatch(/subtotal|summary|overall/i);
  });
  it('takes the document title from its first line', () => {
    expect(parsed.title).toBe('A STORY TO TELL');
  });
});
```

- [ ] **Step 3: Run the fixture test**

Run: `npm test`

If the counts are off, fix `parseBriefText` — **not** the expectations, which were derived from the real document by hand. The likely culprits are the three `Work / Estimated time / Estimated cost` header rows (must hit `AGGREGATE_ROW`) and section 4, which has no header row above it.

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/fixtures/story-to-tell-estimate.txt packages/core/test/brief.test.ts
git commit -m "test(core): pin the brief parser against a real client estimate

13 items, 1425-2130 USD, 47.5-71 hrs, with subtotals and the summary
table skipped. A change that starts double-counting now fails loudly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 3: Schema and migration

**Files:**
- Modify: `apps/web/lib/db/schema.ts`
- Create: `apps/web/drizzle/0006_phase_d1.sql`

**Interfaces:**
- Produces: `briefs`, `milestones`; `folderMappings.billingMode`; `invoices.briefId`/`milestoneId`; types `Brief`, `Milestone`.

- [ ] **Step 1: Add the tables to schema.ts**

In `apps/web/lib/db/schema.ts`, after `paymentAccounts`, add:

```ts
/** A costed piece of client work, ingested from an estimate or proposal. */
export const briefs = pgTable(
  'briefs',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** 'fixed' bills each milestone's agreed amount; 'time' bills tracked hours. */
    billingMode: text('billing_mode').notNull().default('time'),
    currency: text('currency').notNull(),
    ratePerHour: doublePrecision('rate_per_hour').notNull().default(0),
    folderMappingId: text('folder_mapping_id'),
    /** The estimate as ingested, kept verbatim so the parse can be revisited. */
    sourceText: text('source_text'),
    status: text('status').notNull().default('active'),
    autoInvoice: integer('auto_invoice').notNull().default(1),
    holdMinutes: integer('hold_minutes').notNull().default(10),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ clientIdx: index('brief_client_idx').on(t.clientId) }),
);

/** One work item within a brief. Estimates are ranges, never a single figure. */
export const milestones = pgTable(
  'milestones',
  {
    id: text('id').primaryKey(),
    briefId: text('brief_id')
      .notNull()
      .references(() => briefs.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    /** Short stable id; Phase D2 writes it into MILESTONES.md. */
    key: text('key').notNull(),
    section: text('section'),
    title: text('title').notNull(),
    deliverable: text('deliverable'),
    /** Fixed-price briefs only; T&M leaves this 0 and bills tracked time. */
    amount: doublePrecision('amount').notNull().default(0),
    estimateHoursLow: doublePrecision('estimate_hours_low').notNull().default(0),
    estimateHoursHigh: doublePrecision('estimate_hours_high').notNull().default(0),
    estimateAmountLow: doublePrecision('estimate_amount_low').notNull().default(0),
    estimateAmountHigh: doublePrecision('estimate_amount_high').notNull().default(0),
    /** T&M: time already billed for this milestone. Window is (this, cutoff]. */
    billedThroughMs: bigint('billed_through_ms', { mode: 'number' }).notNull().default(0),
    status: text('status').notNull().default('pending'),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    invoicedAt: timestamp('invoiced_at', { withTimezone: true }),
    invoiceId: text('invoice_id'),
  },
  (t) => ({
    briefKeyUnique: uniqueIndex('milestones_brief_key_unique').on(t.briefId, t.key),
    briefIdx: index('milestone_brief_idx').on(t.briefId),
  }),
);
```

Add `billingMode: text('billing_mode').notNull().default('time'),` to `folderMappings`, and `briefId: text('brief_id'),` plus `milestoneId: text('milestone_id'),` to `invoices`.

At the bottom of the file add:

```ts
export type Brief = typeof briefs.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
```

- [ ] **Step 2: Write the migration**

Create `apps/web/drizzle/0006_phase_d1.sql`:

```sql
-- Phase D1: briefs and milestones.
-- Run in the Neon SQL editor BEFORE merging to main.
-- Additive, idempotent and atomic. (0003, 0004 and 0005 have been run.)

BEGIN;

CREATE TABLE IF NOT EXISTS briefs (
  id                text PRIMARY KEY,
  client_id         text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title             text NOT NULL,
  billing_mode      text NOT NULL DEFAULT 'time',
  currency          text NOT NULL,
  rate_per_hour     double precision NOT NULL DEFAULT 0,
  folder_mapping_id text,
  source_text       text,
  status            text NOT NULL DEFAULT 'active',
  auto_invoice      integer NOT NULL DEFAULT 1,
  hold_minutes      integer NOT NULL DEFAULT 10,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS rate_per_hour double precision NOT NULL DEFAULT 0;
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS folder_mapping_id text;
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS source_text text;
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS auto_invoice integer NOT NULL DEFAULT 1;
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS hold_minutes integer NOT NULL DEFAULT 10;
CREATE INDEX IF NOT EXISTS brief_client_idx ON briefs (client_id);

CREATE TABLE IF NOT EXISTS milestones (
  id                    text PRIMARY KEY,
  brief_id              text NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  idx                   integer NOT NULL,
  key                   text NOT NULL,
  section               text,
  title                 text NOT NULL,
  deliverable           text,
  amount                double precision NOT NULL DEFAULT 0,
  estimate_hours_low    double precision NOT NULL DEFAULT 0,
  estimate_hours_high   double precision NOT NULL DEFAULT 0,
  estimate_amount_low   double precision NOT NULL DEFAULT 0,
  estimate_amount_high  double precision NOT NULL DEFAULT 0,
  billed_through_ms     bigint NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'pending',
  ready_at              timestamptz,
  invoiced_at           timestamptz,
  invoice_id            text
);
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS section text;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS deliverable text;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS billed_through_ms bigint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS milestone_brief_idx ON milestones (brief_id);

ALTER TABLE folder_mappings ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'time';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS brief_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS milestone_id text;

COMMIT;

-- ============================================================================
-- Outside the transaction on purpose: these are the only statements that can
-- fail on live data, and a failure must never roll back the schema the app
-- needs to boot. (That is what took production down on 2026-08-17.)
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS milestones_brief_key_unique ON milestones (brief_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_milestone_unique
  ON invoices (milestone_id) WHERE milestone_id IS NOT NULL;
```

- [ ] **Step 3: Cross-check schema against migration**

Go column by column: every column added to `schema.ts` must have a matching SQL statement with the same name, type, nullability and default, and vice versa. Put the table in your report.

- [ ] **Step 4: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed. Nothing reads the new tables yet.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/db/schema.ts apps/web/drizzle/0006_phase_d1.sql
git commit -m "feat(db): briefs and milestones

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 4: Extract text from a .docx

A `.docx` is a zip containing `word/document.xml`. Paragraphs become newlines and table cells become tabs — exactly the shape `parseBriefText` expects, so an uploaded file and a paste travel one path from here on.

**Files:**
- Create: `apps/web/lib/docx.ts`
- Modify: `apps/web/package.json` (add `jszip`)

**Interfaces:**
- Produces: `extractDocxText(buf: ArrayBuffer): Promise<string>`

- [ ] **Step 1: Add the dependency**

Run: `npm --prefix apps/web install jszip@^3.10.1`

JSZip is pure JS with no native bindings, so it runs on Vercel's serverless runtime. Do not reach for `mammoth` — it pulls a much larger tree for formatting fidelity this does not need.

- [ ] **Step 2: Write the extractor**

Create `apps/web/lib/docx.ts`:

```ts
import JSZip from 'jszip';

/**
 * Plain text from a .docx, with table structure preserved as tabs.
 *
 * A .docx is a zip; the body lives in word/document.xml. Paragraphs (`w:p`)
 * become newlines and table cells (`w:tc`) become tabs, which is the shape
 * `parseBriefText` reads — so an uploaded estimate and a pasted one follow the
 * same path from here.
 */
export async function extractDocxText(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('That file does not look like a Word document.');
  const xml = await doc.async('string');

  return xml
    .replace(/<w:tab\b[^>]*\/>/g, ' ')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.replace(/\t+$/, '').trimEnd())
    .filter((l) => l.trim() !== '')
    .join('\n');
}
```

`&amp;` is decoded **last**, so an encoded `&amp;lt;` cannot turn into a tag.

- [ ] **Step 3: Verify against the real file**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

This is the one part of the phase whose input is a binary format, so exercise it rather than trusting it:

```bash
cd apps/web && npx tsx -e "
const { extractDocxText } = await import('./lib/docx.ts');
const fs = await import('node:fs');
const b = fs.readFileSync('C:/Users/theka/Downloads/A Story To Tell Work Estimate.docx');
const t = await extractDocxText(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
console.log(t.split('\n').slice(0, 25).join('\n'));
console.log('--- lines:', t.split('\n').length, '--- tabbed rows:', t.split('\n').filter(l => l.includes('\t')).length);
"
```

Expected: readable lines, and a non-zero count of tabbed rows. **If the tabbed-row count is 0 the parser will find nothing** — stop and fix the extractor before continuing. Put the first 25 lines and both counts in your report.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/docx.ts apps/web/package.json package-lock.json
git commit -m "feat(web): extract text from a .docx, preserving table structure

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 5: Actions and queries

**Files:**
- Modify: `apps/web/lib/actions.ts`
- Modify: `apps/web/lib/queries.ts`

**Interfaces:**
- Consumes: `parseBriefText` (Task 1), `extractDocxText` (Task 4), `briefs`/`milestones` (Task 3).
- Produces:
  - `parseBriefUpload(fd: FormData): Promise<ParsedBrief & { error?: string }>` — fields `file` or `text`
  - `createBrief(fd: FormData): Promise<void>` — fields `clientId`, `title`, `billingMode`, `currency`, `ratePerHour`, `folderMappingId`, `sourceText`, `items` (JSON)
  - `deleteBrief(fd: FormData): Promise<void>` — field `id`
  - `listBriefs(clientId: string): Promise<BriefSummary[]>` where `BriefSummary = { brief: Brief; milestoneCount: number; hoursLow: number; hoursHigh: number; amountLow: number; amountHigh: number }`
  - `getBriefDetail(id: string): Promise<{ brief: Brief; milestones: Milestone[] } | null>`

- [ ] **Step 1: Write the parse action**

In `apps/web/lib/actions.ts`, add `parseBriefText` and `type ParsedBrief` to the core import, `extractDocxText` from `./docx`, and `briefs`, `milestones` to the schema import. Then add a new section at the end of the file:

```ts
// ---------------- Briefs ----------------

const MAX_BRIEF_BYTES = 2 * 1024 * 1024;

/**
 * Parse an uploaded or pasted estimate. Returns the parse for the user to
 * confirm — it never writes anything. `error` is set rather than thrown so the
 * form can show the problem beside the field instead of on an error page.
 */
export async function parseBriefUpload(fd: FormData): Promise<ParsedBrief & { error?: string }> {
  await requireOwner();
  const empty: ParsedBrief = { title: '', currency: 'GBP', ratePerHour: 0, items: [], warnings: [] };

  const pasted = str(fd, 'text');
  if (pasted) return parseBriefText(pasted);

  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ...empty, error: 'Choose a file or paste the estimate text.' };
  }
  if (file.size > MAX_BRIEF_BYTES) {
    return { ...empty, error: 'That file is over 2 MB. Paste the text instead.' };
  }

  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.docx')) {
      const parsed = parseBriefText(await extractDocxText(await file.arrayBuffer()));
      return parsed.items.length === 0
        ? { ...parsed, error: 'No work items found in that document. Paste the text and edit it by hand.' }
        : parsed;
    }
    if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv')) {
      return parseBriefText(await file.text());
    }
    return {
      ...empty,
      error: 'Upload a .docx, .txt, .md or .csv — or paste the text. (.doc and .pdf are not supported yet.)',
    };
  } catch (e) {
    return { ...empty, error: `Could not read that file: ${e instanceof Error ? e.message : 'unknown error'}` };
  }
}
```

- [ ] **Step 2: Write the create and delete actions**

Append to the same section:

```ts
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
          amount: Number(row.amount) || 0,
          hoursLow: Number(row.hoursLow) || 0,
          hoursHigh: Number(row.hoursHigh) || 0,
          amountLow: Number(row.amountLow) || 0,
          amountHigh: Number(row.amountHigh) || 0,
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
      ratePerHour: num(fd, 'ratePerHour', client.hourlyRate),
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
  if (!brief) return;
  // Milestones cascade. Phase D2 will refuse this once a milestone is invoiced.
  await db.delete(briefs).where(eq(briefs.id, id));
  revalidatePath('/clients/' + brief.clientId);
  redirect('/clients/' + brief.clientId);
}
```

- [ ] **Step 3: Write the queries**

In `apps/web/lib/queries.ts`, add `briefs`, `milestones`, `type Brief`, `type Milestone` to the schema import, then add near `listClients`:

```ts
export interface BriefSummary {
  brief: Brief;
  milestoneCount: number;
  hoursLow: number;
  hoursHigh: number;
  amountLow: number;
  amountHigh: number;
}

/** Briefs for a client, newest first, with their estimate rolled up. */
export async function listBriefs(clientId: string): Promise<BriefSummary[]> {
  const db = getDb();
  const briefRows = await db
    .select()
    .from(briefs)
    .where(eq(briefs.clientId, clientId))
    .orderBy(desc(briefs.createdAt));
  if (briefRows.length === 0) return [];
  const milestoneRows = await db.select().from(milestones);

  return briefRows.map((brief) => {
    const mine = milestoneRows.filter((m) => m.briefId === brief.id);
    return {
      brief,
      milestoneCount: mine.length,
      hoursLow: round2(mine.reduce((s, m) => s + m.estimateHoursLow, 0)),
      hoursHigh: round2(mine.reduce((s, m) => s + m.estimateHoursHigh, 0)),
      amountLow: round2(mine.reduce((s, m) => s + m.estimateAmountLow, 0)),
      amountHigh: round2(mine.reduce((s, m) => s + m.estimateAmountHigh, 0)),
    };
  });
}

export async function getBriefDetail(
  id: string,
): Promise<{ brief: Brief; milestones: Milestone[] } | null> {
  const db = getDb();
  const [brief] = await db.select().from(briefs).where(eq(briefs.id, id));
  if (!brief) return null;
  const rows = await db.select().from(milestones).where(eq(milestones.briefId, id)).orderBy(milestones.idx);
  return { brief, milestones: rows };
}
```

`round2` and `desc` are already imported into `queries.ts`.

- [ ] **Step 4: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions.ts apps/web/lib/queries.ts
git commit -m "feat(web): ingest, save and read briefs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 6: The import form

**Files:**
- Create: `apps/web/components/brief-import-form.tsx`

**Interfaces:**
- Consumes: `parseBriefUpload`, `createBrief` (Task 5), `<CurrencySelect>`.
- Produces: `<BriefImportForm clientId={string} defaultCurrency={string} defaultRate={number} folders={{ id: string; label: string }[]} />`

- [ ] **Step 1: Build the component**

Create `apps/web/components/brief-import-form.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { createBrief, parseBriefUpload } from '@/lib/actions';
import { CurrencySelect } from '@/components/currency-select';

interface Row {
  section: string;
  title: string;
  hoursLow: string;
  hoursHigh: string;
  amountLow: string;
  amountHigh: string;
}

const n = (v: string) => Number(v) || 0;

/**
 * Upload or paste an estimate, then confirm what was found before anything is
 * saved. The parse is deliberately never trusted: a document it reads badly is
 * still a couple of minutes of editing, and a wrong milestone becomes a wrong
 * invoice later.
 */
export function BriefImportForm({
  clientId,
  defaultCurrency,
  defaultRate,
  folders,
}: {
  clientId: string;
  defaultCurrency: string;
  defaultRate: number;
  folders: { id: string; label: string }[];
}) {
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [title, setTitle] = useState('');
  const [rate, setRate] = useState(String(defaultRate));
  const [currency, setCurrency] = useState(defaultCurrency);
  const [sourceText, setSourceText] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');

  const parse = (fd: FormData) =>
    start(async () => {
      setError('');
      const res = await parseBriefUpload(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setTitle(res.title);
      setCurrency(res.currency || defaultCurrency);
      if (res.ratePerHour) setRate(String(res.ratePerHour));
      setWarnings(res.warnings);
      setSourceText(String(fd.get('text') ?? ''));
      setRows(
        res.items.map((i) => ({
          section: i.section,
          title: i.title,
          hoursLow: String(i.hoursLow),
          hoursHigh: String(i.hoursHigh),
          amountLow: String(i.amountLow),
          amountHigh: String(i.amountHigh),
        })),
      );
    });

  const update = (i: number, key: keyof Row, v: string) =>
    setRows((rs) => (rs ? rs.map((r, j) => (j === i ? { ...r, [key]: v } : r)) : rs));

  if (!rows) {
    return (
      <form action={parse} className="card space-y-3">
        <div>
          <label className="label">Upload an estimate</label>
          <input type="file" name="file" accept=".docx,.txt,.md,.csv" className="input" />
          <p className="mt-1 text-xs text-slate-500">
            Word (.docx), plain text, Markdown or CSV. Nothing is saved until you confirm what was found.
          </p>
        </div>
        <div>
          <label className="label">…or paste the text</label>
          <textarea name="text" rows={6} className="input font-mono text-xs" />
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <button className="btn-primary" type="submit" disabled={pending}>
          {pending ? 'Reading…' : 'Read estimate'}
        </button>
      </form>
    );
  }

  const totals = rows.reduce(
    (a, r) => ({
      hoursLow: a.hoursLow + n(r.hoursLow),
      hoursHigh: a.hoursHigh + n(r.hoursHigh),
      amountLow: a.amountLow + n(r.amountLow),
      amountHigh: a.amountHigh + n(r.amountHigh),
    }),
    { hoursLow: 0, hoursHigh: 0, amountLow: 0, amountHigh: 0 },
  );

  const items = rows
    .filter((r) => r.title.trim())
    .map((r) => ({
      section: r.section,
      title: r.title,
      deliverable: '',
      amount: n(r.amountHigh),
      hoursLow: n(r.hoursLow),
      hoursHigh: n(r.hoursHigh),
      amountLow: n(r.amountLow),
      amountHigh: n(r.amountHigh),
    }));

  return (
    <form action={createBrief} className="card space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <input type="hidden" name="sourceText" value={sourceText} />

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-200">
          {warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="label">Brief title</label>
          <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} className="input" required />
        </div>
        <div>
          <label className="label">Currency</label>
          <CurrencySelect name="currency" defaultValue={currency} />
        </div>
        <div>
          <label className="label">Rate / hr</label>
          <input
            name="ratePerHour"
            type="number"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="input"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Billing</label>
          <select name="billingMode" defaultValue="time" className="input">
            <option value="time">Time &amp; materials — bill the hours actually tracked</option>
            <option value="fixed">Fixed price — bill each milestone&apos;s agreed amount</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Folder (optional)</label>
          <select name="folderMappingId" defaultValue="" className="input">
            <option value="">Not linked to a folder yet</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-slate-400">
            <tr className="text-left">
              <th className="pb-2">Work</th>
              <th className="pb-2 text-right">Hours low</th>
              <th className="pb-2 text-right">Hours high</th>
              <th className="pb-2 text-right">Cost low</th>
              <th className="pb-2 text-right">Cost high</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-800">
                <td className="py-1">
                  <input className="input" value={r.title} onChange={(e) => update(i, 'title', e.target.value)} />
                  {r.section && <div className="mt-1 text-xs text-slate-500">{r.section}</div>}
                </td>
                <td className="py-1">
                  <input className="input w-20 text-right" value={r.hoursLow} onChange={(e) => update(i, 'hoursLow', e.target.value)} />
                </td>
                <td className="py-1">
                  <input className="input w-20 text-right" value={r.hoursHigh} onChange={(e) => update(i, 'hoursHigh', e.target.value)} />
                </td>
                <td className="py-1">
                  <input className="input w-24 text-right" value={r.amountLow} onChange={(e) => update(i, 'amountLow', e.target.value)} />
                </td>
                <td className="py-1">
                  <input className="input w-24 text-right" value={r.amountHigh} onChange={(e) => update(i, 'amountHigh', e.target.value)} />
                </td>
                <td className="py-1">
                  <button
                    type="button"
                    className="btn-ghost px-2"
                    onClick={() => setRows((rs) => (rs ? rs.filter((_, j) => j !== i) : rs))}
                    aria-label="Remove row"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700 font-semibold">
              <td className="pt-2">{rows.length} items</td>
              <td className="pt-2 text-right">{totals.hoursLow}</td>
              <td className="pt-2 text-right">{totals.hoursHigh}</td>
              <td className="pt-2 text-right">{totals.amountLow}</td>
              <td className="pt-2 text-right">{totals.amountHigh}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        Check these against the estimate you sent the client before saving — especially the totals.
      </p>

      <div className="flex gap-2">
        <button className="btn-primary" type="submit" disabled={items.length === 0}>
          Save brief
        </button>
        <button type="button" className="btn-ghost" onClick={() => setRows(null)}>
          Start over
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/brief-import-form.tsx
git commit -m "feat(web): import an estimate and confirm it before saving

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 7: Briefs on the client page, and a brief detail page

**Files:**
- Modify: `apps/web/app/clients/[id]/page.tsx`
- Create: `apps/web/app/briefs/[id]/page.tsx`

**Interfaces:**
- Consumes: `listBriefs`, `getBriefDetail`, `deleteBrief` (Task 5), `<BriefImportForm>` (Task 6).

- [ ] **Step 1: Add a Briefs section to the client page**

In `apps/web/app/clients/[id]/page.tsx`, import `listBriefs` from `@/lib/queries` and `BriefImportForm` from `@/components/brief-import-form`. Load the briefs alongside the detail — note `getClientDetail` may return null, so keep the existing `notFound()` check working:

```tsx
  const [detail, briefList] = await Promise.all([getClientDetail(id), listBriefs(id)]);
  if (!detail) notFound();
```

Then add this section after the one-off charges section:

```tsx
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Briefs</h2>
        <p className="text-xs text-slate-500">
          A costed piece of work to bill against. Upload the estimate you sent the client, or paste it in.
        </p>
        {briefList.length > 0 && (
          <div className="space-y-2">
            {briefList.map((b) => (
              <div key={b.brief.id} className="card flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link href={`/briefs/${b.brief.id}`} className="font-medium hover:underline">
                    {b.brief.title}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {b.milestoneCount} items · {b.hoursLow}–{b.hoursHigh} hrs ·{' '}
                    {formatMoney(b.amountLow, b.brief.currency)}–{formatMoney(b.amountHigh, b.brief.currency)} ·{' '}
                    {b.brief.billingMode === 'fixed' ? 'fixed price' : 'time & materials'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <BriefImportForm
          clientId={client.id}
          defaultCurrency={client.currency}
          defaultRate={client.hourlyRate}
          folders={mappings.map((m) => ({ id: m.id, label: m.label ?? m.path }))}
        />
      </section>
```

- [ ] **Step 2: Create the brief detail page**

Create `apps/web/app/briefs/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBriefDetail } from '@/lib/queries';
import { formatMoney } from '@/lib/format';
import { deleteBrief } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getBriefDetail(id);
  if (!detail) notFound();
  const { brief, milestones } = detail;

  const sum = (pick: (m: (typeof milestones)[number]) => number) =>
    Math.round(milestones.reduce((s, m) => s + pick(m), 0) * 100) / 100;

  return (
    <div className="space-y-8">
      <header>
        <Link href={`/clients/${brief.clientId}`} className="text-xs text-slate-500 hover:underline">
          ← Client
        </Link>
        <h1 className="text-2xl font-semibold">{brief.title}</h1>
        <p className="text-sm text-slate-400">
          {brief.billingMode === 'fixed' ? 'Fixed price' : 'Time & materials'} ·{' '}
          {formatMoney(brief.ratePerHour, brief.currency)}/hr · {milestones.length} milestones
        </p>
      </header>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-slate-400">
            <tr className="text-left">
              <th className="pb-2">#</th>
              <th className="pb-2">Work</th>
              <th className="pb-2 text-right">Estimated hours</th>
              <th className="pb-2 text-right">Estimated cost</th>
              <th className="pb-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {milestones.map((m) => (
              <tr key={m.id} className="border-t border-slate-800">
                <td className="py-2 font-mono text-xs text-slate-500">{m.key}</td>
                <td className="py-2">
                  {m.title}
                  {m.section && <div className="text-xs text-slate-500">{m.section}</div>}
                </td>
                <td className="py-2 text-right">
                  {m.estimateHoursLow === m.estimateHoursHigh
                    ? m.estimateHoursLow
                    : `${m.estimateHoursLow}–${m.estimateHoursHigh}`}
                </td>
                <td className="py-2 text-right">
                  {formatMoney(m.estimateAmountLow, brief.currency)}
                  {m.estimateAmountLow !== m.estimateAmountHigh &&
                    `–${formatMoney(m.estimateAmountHigh, brief.currency)}`}
                </td>
                <td className="py-2 text-right">
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{m.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700 font-semibold">
              <td />
              <td className="pt-2">Total</td>
              <td className="pt-2 text-right">
                {sum((m) => m.estimateHoursLow)}–{sum((m) => m.estimateHoursHigh)}
              </td>
              <td className="pt-2 text-right">
                {formatMoney(
                  sum((m) => m.estimateAmountLow),
                  brief.currency,
                )}
                –
                {formatMoney(
                  sum((m) => m.estimateAmountHigh),
                  brief.currency,
                )}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        Ticking milestones off and billing against them arrives in the next phase. For now this is the
        record of what was quoted.
      </p>

      <form action={deleteBrief}>
        <input type="hidden" name="id" value={brief.id} />
        <button className="btn-danger" type="submit">
          Delete brief
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/clients/[id]/page.tsx" "apps/web/app/briefs/[id]/page.tsx"
git commit -m "feat(web): briefs on the client page, and a brief detail page

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

## Phase D1 completion checklist

- [ ] `npm test` — core green (138 existing + the new brief suite and fixture)
- [ ] `npm --prefix apps/web run typecheck` — clean
- [ ] `npm --prefix apps/web run build` — clean
- [ ] The real-estimate fixture yields 13 items, 1425–2130, 47.5–71 hrs
- [ ] `extractDocxText` was run against the real `.docx` and produced a non-zero count of tabbed rows
- [ ] `0006_phase_d1.sql` is additive, and its two unique indexes sit AFTER `COMMIT;`
- [ ] **The user has run `0006_phase_d1.sql` in Neon** — before merge, or the deploy 500s
- [ ] Uploading the estimate to a client produces a brief with 13 milestones
