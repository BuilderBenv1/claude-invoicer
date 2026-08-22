# Phase D2 — Milestone Tracking and Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tick a milestone off in a `MILESTONES.md` checklist inside the project folder and have the system notice, wait a hold window, then issue (and best-effort email) an invoice for that milestone — the agreed amount for a fixed-price brief, the tracked hours for time & materials.

**Architecture:** A pure core module owns the `MILESTONES.md` grammar so the local agent and the web app can never disagree about it. The agent syncs the file to the server at the end of each scan tick through two token-authenticated endpoints. The server owns every state transition and all billing; the file is an input, never the source of truth. A due sweep issues invoices once the hold window expires, and runs both from the agent's sync and from the existing daily cron as a backstop.

**Tech Stack:** TypeScript, vitest (packages/core only), Next.js 15 App Router route handlers, Drizzle ORM + Neon Postgres, Zod for request validation.

**Spec:** `docs/superpowers/specs/2026-08-14-agency-overhaul-design.md` — sections D3 (MILESTONES.md contract), D4 (agent ↔ server protocol), D5 (billing rules), D6 (auto-issue and hold window).

## Global Constraints

- **No database migration.** Every column and index D2 needs was created by `apps/web/drizzle/0006_phase_d1.sql`, including the partial unique index `invoices_milestone_unique ON invoices (milestone_id) WHERE milestone_id IS NOT NULL`. Do not write a new migration; do not add columns to `schema.ts`.
- **Tests live only in `packages/core`.** It is the only workspace with a test runner (vitest). Web and agent code is verified by `npx tsc --noEmit` and `npm run build`, not unit tests. Push logic into core so it can be tested.
- **Money and hours round through `round2` from core.** Never hand-roll rounding.
- **Documents snapshot identity and totals at issue time.** `insertInvoice` already does this; never recompute on read.
- **Email is best-effort.** `RESEND_API_KEY` is not configured in production. Issuing an invoice MUST succeed when email fails. Wrap every send in try/catch, log a warning, carry on.
- **Milestone status vocabulary is exactly:** `pending` → `ready` → `invoiced`, plus terminal `complete` (delivered but nothing to bill). No other values.
- **Once a milestone is `invoiced` or `complete` its state is terminal.** Later file states for that key are ignored. Unticking a box never un-invoices anything.
- **The agent's `MILESTONES.md` writes are append-only.** Never modify, reorder or delete an existing line.
- A milestone invoice takes its currency from `brief.currency`, not the client's current currency.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/milestones.ts` | **Create.** The `MILESTONES.md` grammar: render, parse, append-only merge. Pure, no I/O. |
| `packages/core/test/milestones.test.ts` | **Create.** Tests for the above. |
| `packages/core/src/types.ts` | **Modify.** `FolderMapping` gains `billedBy?: 'week' \| 'brief'`. |
| `packages/core/src/billing.ts` | **Modify.** Add `excludeBriefBilledFolders`. |
| `packages/core/test/billing.test.ts` | **Modify.** Tests for the exclusion. |
| `packages/core/src/index.ts` | **Modify.** Export the new symbols. |
| `apps/web/lib/queries.ts` | **Modify.** Shared `loadCoreMappings`; apply the exclusion at all four sites; `getBriefDetail` returns tracked hours. |
| `apps/web/lib/invoice-service.ts` | **Modify.** `issueMilestoneInvoice`, `runMilestoneDueSweep`; apply the exclusion in `issueWeekInvoice`. |
| `apps/web/lib/milestone-file.ts` | **Create.** Shapes DB rows into the agent's brief payload. |
| `apps/web/app/api/agent/briefs/route.ts` | **Create.** `GET` — active briefs with resolved folder paths. |
| `apps/web/app/api/agent/milestones/route.ts` | **Create.** `POST` — apply ticks, then run the due sweep. |
| `apps/web/app/api/cron/weekly/route.ts` | **Modify.** Run the due sweep as a backstop. |
| `apps/agent/src/milestones.ts` | **Create.** Fetch briefs, merge `MILESTONES.md`, report ticks. |
| `apps/agent/src/index.ts` | **Modify.** Call the sync at the end of each non-dry tick. |
| `apps/web/lib/actions.ts` | **Modify.** `completeMilestone`, `cancelMilestone`, `issueMilestoneNow`. |
| `apps/web/app/briefs/[id]/page.tsx` | **Modify.** Status controls, burn-down colouring, margin line. |

---

## Two corrections to the spec, already ruled on

**1. The T&M billing window must be derived from the brief, not the milestone.**
D5 says the window is `(milestone.billed_through_ms, now]`. Taken literally that double-bills: a
second milestone's own `billed_through_ms` is still `0`, so its window would reopen at the epoch
and re-bill everything the first milestone already billed. The window therefore opens at **the
greatest `billed_through_ms` across all milestones in the brief**, which is the cutoff of the most
recent milestone invoice. Each milestone still stores its own cutoff on issue, so that maximum is
always the last billed instant. No schema change — it is a `MAX()` over rows the brief already owns.

**2. One exclusion rule, not two.**
D5 describes excluding fixed-price folders from weekly billing via
`folder_mappings.billing_mode = 'fixed'`, and separately requires weekly auto-send to skip folders
carrying an active T&M brief. Both say the same thing — *this folder's time is billed by its brief,
not by the week* — and building them as two mechanisms invites one being applied where the other
isn't, which double-bills. This plan uses a single field, `FolderMapping.billedBy`, set to
`'brief'` when the mapping is `billing_mode = 'fixed'` **or** an active brief points at it. One
function, `excludeBriefBilledFolders`, applied everywhere `applyFolderCutoffs` is applied. When a
brief stops being `'active'`, its folder returns to weekly billing on its own.

---

### Task 1: The `MILESTONES.md` grammar

**Files:**
- Create: `packages/core/src/milestones.ts`
- Create: `packages/core/test/milestones.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `currencySymbol` from `./currency.js`.
- Produces:
  - `interface MilestoneFileItem { key: string; idx: number; title: string; section?: string; amount?: number; hoursLow?: number; hoursHigh?: number }`
  - `interface MilestoneFileInput { briefTitle: string; clientName: string; billingMode: 'fixed' | 'time'; currency: string; items: MilestoneFileItem[] }`
  - `interface MilestoneFileEntry { key: string; checked: boolean }`
  - `renderMilestonesFile(input: MilestoneFileInput): string`
  - `parseMilestonesFile(text: string): MilestoneFileEntry[]`
  - `mergeMilestonesFile(existing: string | null, input: MilestoneFileInput): string`
  - `MILESTONE_LINE_RE: RegExp`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/milestones.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  renderMilestonesFile,
  parseMilestonesFile,
  mergeMilestonesFile,
  type MilestoneFileInput,
} from '../src/milestones.js';

const fixed: MilestoneFileInput = {
  briefTitle: 'A Story To Tell — Work Estimate',
  clientName: 'Clive',
  billingMode: 'fixed',
  currency: 'GBP',
  items: [
    { key: '8f2a', idx: 0, title: 'Discovery & spec', section: '1. Setup', amount: 800 },
    { key: 'c41d', idx: 1, title: 'API integration', amount: 1200 },
  ],
};

const tm: MilestoneFileInput = {
  ...fixed,
  billingMode: 'time',
  items: [
    { key: '8f2a', idx: 0, title: 'Discovery & spec', hoursLow: 6, hoursHigh: 8 },
    { key: 'c41d', idx: 1, title: 'API integration', hoursLow: 10, hoursHigh: 10 },
  ],
};

describe('renderMilestonesFile', () => {
  it('renders a heading, the client name and one unchecked line per item', () => {
    const out = renderMilestonesFile(fixed);
    expect(out).toContain('# A Story To Tell — Work Estimate');
    expect(out).toContain('Clive');
    expect(out).toContain('- [ ] M1 · Discovery & spec — £800 <!-- id:8f2a -->');
    expect(out).toContain('- [ ] M2 · API integration — £1,200 <!-- id:c41d -->');
  });

  it('shows an hours range instead of money for a time & materials brief', () => {
    const out = renderMilestonesFile(tm);
    expect(out).toContain('- [ ] M1 · Discovery & spec — 6–8 hrs <!-- id:8f2a -->');
    expect(out).toContain('- [ ] M2 · API integration — 10 hrs <!-- id:c41d -->');
  });

  it('round-trips through the parser as all-unchecked', () => {
    const entries = parseMilestonesFile(renderMilestonesFile(fixed));
    expect(entries).toEqual([
      { key: '8f2a', checked: false },
      { key: 'c41d', checked: false },
    ]);
  });
});

describe('parseMilestonesFile', () => {
  it('reads a tick in either case and ignores prose', () => {
    const text = [
      'Some heading text that is not a milestone.',
      '- [x] M1 · Done thing — £800 <!-- id:aaaa -->',
      '- [X] M2 · Also done <!-- id:bbbb -->',
      '- [ ] M3 · Not done <!-- id:cccc -->',
      '* [x] M4 · Star bullet <!-- id:dddd -->',
    ].join('\n');
    expect(parseMilestonesFile(text)).toEqual([
      { key: 'aaaa', checked: true },
      { key: 'bbbb', checked: true },
      { key: 'cccc', checked: false },
      { key: 'dddd', checked: true },
    ]);
  });

  it('ignores a checklist line with no id comment', () => {
    expect(parseMilestonesFile('- [x] I typed this myself')).toEqual([]);
  });

  it('ignores an id comment that is not on a checklist line', () => {
    expect(parseMilestonesFile('Just prose <!-- id:aaaa -->')).toEqual([]);
  });

  it('tolerates leading indentation and extra spaces', () => {
    expect(parseMilestonesFile('   -   [x]   M1 · x   <!--  id:aaaa  -->')).toEqual([
      { key: 'aaaa', checked: true },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseMilestonesFile('')).toEqual([]);
  });

  it('keeps the first occurrence when a key is duplicated', () => {
    const text = '- [x] a <!-- id:aaaa -->\n- [ ] b <!-- id:aaaa -->';
    expect(parseMilestonesFile(text)).toEqual([{ key: 'aaaa', checked: true }]);
  });
});

describe('mergeMilestonesFile', () => {
  it('writes the full scaffold when no file exists', () => {
    expect(mergeMilestonesFile(null, fixed)).toBe(renderMilestonesFile(fixed));
  });

  it('writes the full scaffold when the file is blank', () => {
    expect(mergeMilestonesFile('   \n  ', fixed)).toBe(renderMilestonesFile(fixed));
  });

  it('preserves a tick the user made', () => {
    const existing = renderMilestonesFile(fixed).replace('- [ ] M1', '- [x] M1');
    const merged = mergeMilestonesFile(existing, fixed);
    expect(merged).toContain('- [x] M1 · Discovery & spec');
    expect(parseMilestonesFile(merged)).toEqual([
      { key: '8f2a', checked: true },
      { key: 'c41d', checked: false },
    ]);
  });

  it('preserves user prose added around the list', () => {
    const existing = renderMilestonesFile(fixed) + '\nMy own notes here.\n';
    expect(mergeMilestonesFile(existing, fixed)).toContain('My own notes here.');
  });

  it('appends only keys the file does not already have', () => {
    const existing = renderMilestonesFile(fixed);
    const grown: MilestoneFileInput = {
      ...fixed,
      items: [...fixed.items, { key: 'eeee', idx: 2, title: 'New work', amount: 300 }],
    };
    const merged = mergeMilestonesFile(existing, grown);
    expect(parseMilestonesFile(merged).map((e) => e.key)).toEqual(['8f2a', 'c41d', 'eeee']);
    expect(merged.indexOf('- [ ] M1 · Discovery & spec')).toBe(
      existing.indexOf('- [ ] M1 · Discovery & spec'),
    );
  });

  it('does not rewrite a line whose text the user edited', () => {
    const existing = renderMilestonesFile(fixed).replace(
      'M1 · Discovery & spec — £800',
      'M1 · Discovery (renamed by me)',
    );
    const merged = mergeMilestonesFile(existing, fixed);
    expect(merged).toContain('M1 · Discovery (renamed by me)');
    expect(merged).not.toContain('M1 · Discovery & spec — £800');
  });

  it('returns the file unchanged when every key is already present', () => {
    const existing = renderMilestonesFile(fixed);
    expect(mergeMilestonesFile(existing, fixed)).toBe(existing);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/milestones.test.ts --root packages/core`
Expected: FAIL — `Cannot find module '../src/milestones.js'`.

- [ ] **Step 3: Implement the module**

Create `packages/core/src/milestones.ts`:

```ts
import { currencySymbol } from './currency.js';

/** One milestone as it appears in the file. */
export interface MilestoneFileItem {
  key: string;
  idx: number;
  title: string;
  section?: string;
  /** Fixed-price briefs: the agreed amount. */
  amount?: number;
  /** Time & materials briefs: the estimate range, shown as a target only. */
  hoursLow?: number;
  hoursHigh?: number;
}

export interface MilestoneFileInput {
  briefTitle: string;
  clientName: string;
  billingMode: 'fixed' | 'time';
  currency: string;
  items: MilestoneFileItem[];
}

export interface MilestoneFileEntry {
  key: string;
  checked: boolean;
}

/**
 * A checklist line carrying an id comment. The id is what makes a line a
 * milestone — a checklist line the user typed by hand has none and is ignored,
 * so their own todos in this file are never mistaken for billable work.
 */
export const MILESTONE_LINE_RE =
  /^\s*[-*]\s*\[([ xX])\]\s*.*?<!--\s*id:([A-Za-z0-9]{4,16})\s*-->/;

function formatAmount(amount: number, currency: string): string {
  // Deliberately not formatMoney: this is plain text a human edits, so it uses
  // a bare grouped number rather than locale-specific currency placement.
  const sym = currencySymbol(currency);
  const [int, frac] = (Math.round(amount * 100) / 100).toFixed(2).split('.') as [string, string];
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === '00' ? `${sym}${grouped}` : `${sym}${grouped}.${frac}`;
}

function formatHours(low?: number, high?: number): string {
  if (low == null && high == null) return '';
  const lo = low ?? high ?? 0;
  const hi = high ?? low ?? 0;
  return lo === hi ? `${lo} hrs` : `${lo}–${hi} hrs`;
}

/** The trailing detail after the title: money for fixed, an hours range for T&M. */
function itemSuffix(item: MilestoneFileItem, input: MilestoneFileInput): string {
  if (input.billingMode === 'fixed') {
    return item.amount ? ` — ${formatAmount(item.amount, input.currency)}` : '';
  }
  const hrs = formatHours(item.hoursLow, item.hoursHigh);
  return hrs ? ` — ${hrs}` : '';
}

function renderLine(item: MilestoneFileItem, input: MilestoneFileInput): string {
  return `- [ ] M${item.idx + 1} · ${item.title}${itemSuffix(item, input)} <!-- id:${item.key} -->`;
}

/** The whole file, from scratch. Used when no file exists yet. */
export function renderMilestonesFile(input: MilestoneFileInput): string {
  const mode =
    input.billingMode === 'fixed'
      ? 'Each milestone is invoiced at its agreed amount when ticked.'
      : 'Each milestone invoices the time tracked against this folder since the last one.';
  return [
    `# ${input.briefTitle}`,
    '',
    `Milestones for ${input.clientName}. Tick a box when the milestone is delivered —`,
    'it is picked up automatically and invoiced.',
    '',
    mode,
    '',
    ...input.items.map((it) => renderLine(it, input)),
    '',
  ].join('\n');
}

/** Every milestone line in the file, in file order. First occurrence of a key wins. */
export function parseMilestonesFile(text: string): MilestoneFileEntry[] {
  const out: MilestoneFileEntry[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = MILESTONE_LINE_RE.exec(line);
    if (!m) continue;
    const key = m[2]!;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, checked: m[1] !== ' ' });
  }
  return out;
}

/**
 * Append-only merge. An existing file is never rewritten: lines for keys it
 * already carries are left exactly as they are, whatever the user did to them,
 * and only genuinely new keys are appended. This is what makes it impossible
 * for a sync to clobber a tick.
 */
export function mergeMilestonesFile(existing: string | null, input: MilestoneFileInput): string {
  if (!existing || !existing.trim()) return renderMilestonesFile(input);
  const present = new Set(parseMilestonesFile(existing).map((e) => e.key));
  const missing = input.items.filter((it) => !present.has(it.key));
  if (missing.length === 0) return existing;
  return [existing.replace(/\s*$/, ''), '', ...missing.map((it) => renderLine(it, input)), ''].join('\n');
}
```

- [ ] **Step 4: Export from the core barrel**

In `packages/core/src/index.ts`, after the `parseBriefText` export line:

```ts
export {
  MILESTONE_LINE_RE,
  renderMilestonesFile,
  parseMilestonesFile,
  mergeMilestonesFile,
  type MilestoneFileItem,
  type MilestoneFileInput,
  type MilestoneFileEntry,
} from './milestones.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/milestones.test.ts --root packages/core`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/milestones.ts packages/core/test/milestones.test.ts packages/core/src/index.ts
git commit -m "feat(core): MILESTONES.md render, parse and append-only merge"
```

---

### Task 2: Exclude brief-billed folders from weekly time billing

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/billing.ts`
- Modify: `packages/core/test/billing.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `matchMapping` from `./matcher.js`; `ActivityInterval`, `FolderMapping` from `./types.js`.
- Produces: `FolderMapping.billedBy?: 'week' | 'brief'`; `excludeBriefBilledFolders(intervals: ActivityInterval[], mappings: FolderMapping[]): ActivityInterval[]`.

- [ ] **Step 1: Write the failing tests**

Read the top of `packages/core/test/billing.test.ts` first and reuse its existing `interval(...)`
helper — do not define a second one. Add `excludeBriefBilledFolders` to that file's import list
from `../src/billing.js`, then append:

```ts
describe('excludeBriefBilledFolders', () => {
  const mappings = [
    { clientId: 'c1', path: 'C:/work/site', billedBy: 'week' as const },
    { clientId: 'c1', path: 'C:/work/app', billedBy: 'brief' as const },
    { clientId: 'c1', path: 'C:/work/plain' },
  ];

  it('drops intervals in a folder billed by its brief', () => {
    expect(excludeBriefBilledFolders([interval('C:/work/app/src', 0, 60)], mappings)).toEqual([]);
  });

  it('keeps intervals in a folder billed by the week', () => {
    expect(excludeBriefBilledFolders([interval('C:/work/site/x', 0, 60)], mappings)).toHaveLength(1);
  });

  it('keeps intervals in a folder with no billedBy set', () => {
    expect(excludeBriefBilledFolders([interval('C:/work/plain/y', 0, 60)], mappings)).toHaveLength(1);
  });

  it('keeps unmapped intervals untouched', () => {
    expect(excludeBriefBilledFolders([interval('C:/elsewhere/z', 0, 60)], mappings)).toHaveLength(1);
  });

  it('uses the most specific mapping when folders nest', () => {
    const nested = [
      { clientId: 'c1', path: 'C:/work', billedBy: 'week' as const },
      { clientId: 'c1', path: 'C:/work/app', billedBy: 'brief' as const },
    ];
    expect(excludeBriefBilledFolders([interval('C:/work/app/src', 0, 60)], nested)).toEqual([]);
    expect(excludeBriefBilledFolders([interval('C:/work/other', 0, 60)], nested)).toHaveLength(1);
  });

  it('returns a new array and does not mutate the input', () => {
    const input = [interval('C:/work/site/x', 0, 60)];
    const out = excludeBriefBilledFolders(input, mappings);
    expect(out).not.toBe(input);
    expect(input).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/billing.test.ts --root packages/core`
Expected: FAIL — `excludeBriefBilledFolders is not exported`.

- [ ] **Step 3: Add the type field**

In `packages/core/src/types.ts`, inside `interface FolderMapping`, after `billFromMs`:

```ts
  /**
   * Who bills this folder's time. 'brief' means a brief owns it — either a
   * fixed-price brief (the amount is agreed) or an active time & materials
   * brief (the hours bill at milestone completion). Either way the weekly
   * path must skip it or the same work bills twice. Absent means 'week'.
   */
  billedBy?: 'week' | 'brief';
```

- [ ] **Step 4: Implement the filter**

In `packages/core/src/billing.ts`, directly after `applyFolderCutoffs`:

```ts
/**
 * Drop intervals whose folder is billed by a brief rather than by the week.
 * Unmapped intervals pass through — they belong to no client and are filtered
 * elsewhere. Always applied alongside applyFolderCutoffs; applying one without
 * the other is how the same hours end up on two invoices.
 */
export function excludeBriefBilledFolders(
  intervals: ActivityInterval[],
  mappings: FolderMapping[],
): ActivityInterval[] {
  return intervals.filter((it) => matchMapping(it.cwd, mappings)?.billedBy !== 'brief');
}
```

- [ ] **Step 5: Export it**

In `packages/core/src/index.ts`, add `excludeBriefBilledFolders,` to the `from './billing.js'`
export block, directly after `applyFolderCutoffs,`.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — everything that passed before, plus 6 new tests.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/billing.ts packages/core/src/index.ts packages/core/test/billing.test.ts
git commit -m "feat(core): exclude brief-billed folders from weekly time billing"
```

---

### Task 3: Wire `billedBy` through the web app

**Files:**
- Modify: `apps/web/lib/queries.ts`
- Modify: `apps/web/lib/invoice-service.ts`

**Interfaces:**
- Consumes: `excludeBriefBilledFolders` from `@claude-invoicer/core` (Task 2).
- Produces: `loadCoreMappings(exec?): Promise<CoreMapping[]>` exported from `apps/web/lib/queries.ts`, callable with the db handle or a transaction.

- [ ] **Step 1: Add the shared loader in `queries.ts`**

Keep the existing `toCoreMapping` exactly as it is and add the loader beneath it. `briefs` must be
in this file's import list from `./db/schema`.

```ts
/**
 * Folder mappings decorated with who bills them. A mapping is brief-billed when
 * it is marked fixed-price OR an active brief points at it; both mean the weekly
 * path must not bill its hours. Loading briefs here rather than at each call
 * site is deliberate — every consumer needs this decoration, and one that
 * forgot it would silently double-bill.
 */
export async function loadCoreMappings(exec?: DbOrTx): Promise<CoreMapping[]> {
  const e = exec ?? getDb();
  const [raw, briefRows] = await Promise.all([
    e.select().from(folderMappings),
    e.select({ folderMappingId: briefs.folderMappingId }).from(briefs).where(eq(briefs.status, 'active')),
  ]);
  const briefFolders = new Set(
    briefRows.map((b) => b.folderMappingId).filter((x): x is string => !!x),
  );
  return raw.map((m) => ({
    ...toCoreMapping(m),
    billedBy:
      m.billingMode === 'fixed' || briefFolders.has(m.id) ? ('brief' as const) : ('week' as const),
  }));
}
```

For `DbOrTx`, export the two aliases that already exist at the top of `invoice-service.ts` and
import the pair here:

```ts
// in apps/web/lib/invoice-service.ts — change the two existing lines to export
export type Db = NeonDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
```

```ts
// in apps/web/lib/queries.ts
import type { Db, Tx } from './invoice-service';
type DbOrTx = Db | Tx;
```

If that import direction creates a cycle at build time, move both aliases into `apps/web/lib/db.ts`
and import them from there in both files instead. Do not resolve it with `any`.

- [ ] **Step 2: Apply the exclusion at every cutoff site in `queries.ts`**

Add `excludeBriefBilledFolders` to the `@claude-invoicer/core` import list. Four places in this file
read `applyFolderCutoffs(intervalsForClient(...), coreMappings)` — in `invoiceDayGrid`,
`getOverview`, `getClientDetail` and `getWeekDetail`. Wrap each:

```ts
const ci = excludeBriefBilledFolders(
  applyFolderCutoffs(intervalsForClient(intervals, clientId, coreMappings), coreMappings),
  coreMappings,
);
```

Use the client-id variable already present at each site — `inv.clientId` in `invoiceDayGrid`,
`client.id` in `getOverview`, `clientId` in the other two. Rename nothing.

Then replace every `rawMappings.map(toCoreMapping)` in this file with `await loadCoreMappings(db)`,
and drop the now-unused `db.select().from(folderMappings)` from any `Promise.all` that only fed it.
Where a `Promise.all` still needs other rows, keep it and call `loadCoreMappings` alongside.

- [ ] **Step 3: Apply the same in `issueWeekInvoice`**

In `apps/web/lib/invoice-service.ts`, add `excludeBriefBilledFolders` to the core import and
`loadCoreMappings` to the `./queries` import. Replace the
`const rawMappings = await tx.select().from(folderMappings)` block and the `coreMappings` literal
that follows it with:

```ts
    const coreMappings = await loadCoreMappings(tx);
```

and the cutoff line with:

```ts
    const ci = excludeBriefBilledFolders(
      applyFolderCutoffs(intervalsForClient(intervals, clientId, coreMappings), coreMappings),
      coreMappings,
    );
```

Leave `folderMappings` in this file's schema import — Task 4 uses it.

- [ ] **Step 4: Typecheck and build**

Run: `cd apps/web && npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/queries.ts apps/web/lib/invoice-service.ts
git commit -m "feat(web): route folder mappings through loadCoreMappings and skip brief-billed folders"
```

---

### Task 4: Issue a milestone invoice, and the due sweep

**Files:**
- Modify: `apps/web/lib/invoice-service.ts`
- Modify: `apps/web/app/api/cron/weekly/route.ts`

**Interfaces:**
- Consumes: `insertInvoice`, `emailInvoiceById` (already in this file); `loadCoreMappings` (Task 3).
- Produces:
  - `type MilestoneIssueResult = { ok: true; id: string; number: string } | { ok: false; reason: 'already-invoiced' | 'nothing-to-bill' | 'no-amount' | 'not-ready' | 'brief-missing' | 'client-archived' }`
  - `issueMilestoneInvoice(milestoneId: string): Promise<MilestoneIssueResult>`
  - `runMilestoneDueSweep(): Promise<{ issued: number; failed: number }>`

- [ ] **Step 1: Add the issue function**

In `apps/web/lib/invoice-service.ts`, after `issueWeekInvoice`. Add `briefs`, `milestones` to the
schema import; `max` to the drizzle-orm import; `matchMapping` to the core import.

```ts
export type MilestoneIssueResult =
  | { ok: true; id: string; number: string }
  | {
      ok: false;
      reason:
        | 'already-invoiced'
        | 'nothing-to-bill'
        | 'no-amount'
        | 'not-ready'
        | 'brief-missing'
        | 'client-archived';
    };

/** True only for a duplicate on invoices_milestone_unique. */
function isDuplicateMilestoneError(e: unknown): boolean {
  const err = e as PgUniqueError;
  const code = err?.code ?? err?.cause?.code;
  if (code !== '23505') return false;
  const constraint =
    err?.constraint ?? err?.constraint_name ?? err?.cause?.constraint ?? err?.cause?.constraint_name;
  if (constraint) return constraint === 'invoices_milestone_unique';
  const message = err?.message ?? err?.cause?.message ?? '';
  return message.includes('invoices_milestone_unique');
}

/**
 * Bill one milestone. Fixed-price briefs invoice the agreed amount as a single
 * line. Time & materials briefs invoice the hours actually tracked against the
 * brief's folder since the brief last billed — NOT the estimate.
 *
 * The window opens at the greatest billed_through_ms across the brief's
 * milestones, which is the cutoff of the most recent milestone invoice. Reading
 * this milestone's own row instead would reopen the window at 0 for every
 * milestone after the first and re-bill everything.
 */
export async function issueMilestoneInvoice(milestoneId: string): Promise<MilestoneIssueResult> {
  const db = getDb();
  try {
    return await db.transaction(async (tx): Promise<MilestoneIssueResult> => {
      // Lock the row so two concurrent sweeps cannot both pass the status
      // check. The unique index is the backstop; this avoids leaning on it.
      const [m] = await tx.select().from(milestones).where(eq(milestones.id, milestoneId)).for('update');
      if (!m) return { ok: false, reason: 'brief-missing' };
      if (m.status === 'invoiced' || m.status === 'complete') return { ok: false, reason: 'already-invoiced' };
      if (m.status !== 'ready') return { ok: false, reason: 'not-ready' };

      const [brief] = await tx.select().from(briefs).where(eq(briefs.id, m.briefId));
      if (!brief) return { ok: false, reason: 'brief-missing' };
      const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
      if (!s) throw new Error('Settings not initialized');
      const [client] = await tx.select().from(clients).where(eq(clients.id, brief.clientId));
      if (!client) return { ok: false, reason: 'brief-missing' };
      if (client.archived) return { ok: false, reason: 'client-archived' };

      const cutoffMs = Date.now();
      let lines: NewLine[];
      let prevBilledThroughMs: number;

      if (brief.billingMode === 'fixed') {
        if (m.amount <= 0) return { ok: false, reason: 'no-amount' };
        lines = [{ label: m.title, hours: 0, ratePerHour: 0, amount: round2(m.amount) }];
        // A fixed-price milestone bills an agreed sum, not a time window. -1
        // marks "not a week invoice", exactly as the manual-document path does,
        // which keeps invoiceDayGrid from trying to rebuild a grid for it.
        prevBilledThroughMs = -1;
      } else {
        const [row] = await tx
          .select({ prev: max(milestones.billedThroughMs) })
          .from(milestones)
          .where(eq(milestones.briefId, brief.id));
        const windowStart = Number(row?.prev ?? 0);

        const folderPath = brief.folderMappingId
          ? (await tx.select().from(folderMappings).where(eq(folderMappings.id, brief.folderMappingId)))[0]?.path
          : undefined;
        if (!folderPath) return { ok: false, reason: 'nothing-to-bill' };

        const coreMappings = await loadCoreMappings(tx);
        const rawIntervals = await tx.select().from(activityIntervals);
        const all: CoreInterval[] = rawIntervals.map((r) => ({
          sessionId: r.sessionId,
          cwd: r.cwd,
          startMs: r.startMs,
          endMs: r.endMs,
          activeMs: r.activeMs,
        }));
        // Scope to this brief's folder. Cutoffs still apply; the brief-billed
        // exclusion deliberately does NOT — that filter exists to keep these
        // hours off the weekly invoice, and this is the invoice they were kept for.
        const scoped = applyFolderCutoffs(
          all.filter((it) => matchMapping(it.cwd, coreMappings)?.path === folderPath),
          coreMappings,
        );
        const timeLines = buildInvoiceLines(scoped, {
          ratePerHour: brief.ratePerHour || client.hourlyRate,
          roundIncrementMin: client.roundIncrementMin ?? s.defaultRoundIncrementMin,
          roundMode: s.roundMode as RoundMode,
          billedThroughMs: windowStart,
          cutoffMs,
          groupBy: 'total',
          mappings: coreMappings,
          timeZone: s.timezone,
        });
        if (timeLines.length === 0 || timeLines.every((l) => l.hours <= 0)) {
          // Nothing tracked since the last milestone. The work is still done —
          // make it terminal rather than have every sweep retry it forever.
          await tx
            .update(milestones)
            .set({ status: 'complete', invoicedAt: new Date(), billedThroughMs: cutoffMs })
            .where(eq(milestones.id, milestoneId));
          return { ok: false, reason: 'nothing-to-bill' };
        }
        lines = timeLines.map((l) => ({
          label: `${m.title} — ${l.label.toLowerCase()}`,
          hours: l.hours,
          ratePerHour: l.ratePerHour,
          amount: l.amount,
        }));
        prevBilledThroughMs = windowStart;
      }

      const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
      const { id, number } = await insertInvoice(tx, {
        client,
        settings: s,
        lines,
        subtotal,
        prevBilledThroughMs,
        cutoffMs,
        notes: `${brief.title} · ${m.title}`,
        currency: brief.currency,
      });
      await tx.update(invoices).set({ briefId: brief.id, milestoneId: m.id }).where(eq(invoices.id, id));
      await tx
        .update(milestones)
        .set({ status: 'invoiced', invoicedAt: new Date(), invoiceId: id, billedThroughMs: cutoffMs })
        .where(eq(milestones.id, milestoneId));
      return { ok: true, id, number };
    });
  } catch (e) {
    if (isDuplicateMilestoneError(e)) return { ok: false, reason: 'already-invoiced' };
    throw e;
  }
}
```

- [ ] **Step 2: Add the due sweep**

Directly after `issueMilestoneInvoice`:

```ts
/**
 * Issue every milestone whose hold window has expired, on a brief with
 * auto_invoice on. Runs after each agent sync and from the daily cron, so a
 * tick still bills within a day even when the local agent is off.
 *
 * Email is best-effort by design: RESEND_API_KEY is frequently unset, and an
 * unsent email must never roll back or hide an invoice that was issued.
 */
export async function runMilestoneDueSweep(): Promise<{ issued: number; failed: number }> {
  const db = getDb();
  const now = new Date();
  const due = await db
    .select({ id: milestones.id })
    .from(milestones)
    .innerJoin(briefs, eq(milestones.briefId, briefs.id))
    .where(
      and(
        eq(milestones.status, 'ready'),
        eq(briefs.autoInvoice, 1),
        eq(briefs.status, 'active'),
        sql`${milestones.readyAt} + make_interval(mins => ${briefs.holdMinutes}) <= ${now}`,
      ),
    );

  let issued = 0;
  let failed = 0;
  for (const row of due) {
    try {
      const res = await issueMilestoneInvoice(row.id);
      if (!res.ok) continue;
      issued++;
      try {
        await emailInvoiceById(res.id);
      } catch (e) {
        console.warn(`milestone invoice ${res.number} issued but not emailed:`, e);
      }
    } catch (e) {
      failed++;
      console.error(`milestone ${row.id} failed to issue:`, e);
    }
  }
  return { issued, failed };
}
```

- [ ] **Step 3: Run the sweep from the daily cron**

In `apps/web/app/api/cron/weekly/route.ts`:

```ts
import { runWeeklyAutoSend, runMilestoneDueSweep } from '@/lib/invoice-service';
```

and inside the `try`:

```ts
    const summary = await runWeeklyAutoSend();
    // Backstop for when the local agent is off: without this a ticked
    // milestone would sit at 'ready' indefinitely.
    const milestones = await runMilestoneDueSweep();
    return Response.json({ ...summary, milestones });
```

- [ ] **Step 4: Typecheck and build**

Run: `cd apps/web && npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/invoice-service.ts apps/web/app/api/cron/weekly/route.ts
git commit -m "feat(web): issue milestone invoices and sweep the hold window"
```

---

### Task 5: Agent ↔ server endpoints

**Files:**
- Create: `apps/web/lib/milestone-file.ts`
- Create: `apps/web/app/api/agent/briefs/route.ts`
- Create: `apps/web/app/api/agent/milestones/route.ts`

**Interfaces:**
- Consumes: `runMilestoneDueSweep` (Task 4); `MilestoneFileItem` from core (Task 1).
- Produces:
  - `buildAgentBriefs(): Promise<AgentBrief[]>` from `apps/web/lib/milestone-file.ts`, where
    `AgentBrief = { id, title, clientName, folderPath, billingMode: 'fixed'|'time', currency, items: MilestoneFileItem[] }`
  - `GET /api/agent/briefs` → `{ briefs: AgentBrief[] }`
  - `POST /api/agent/milestones` body `{ updates: { briefId: string; key: string; checked: boolean }[] }` → `{ ok: true; applied: number; issued: number }`

- [ ] **Step 1: Create the brief-to-file adapter**

Create `apps/web/lib/milestone-file.ts`:

```ts
import { and, eq, isNotNull } from 'drizzle-orm';
import type { MilestoneFileItem } from '@claude-invoicer/core';
import { getDb } from './db';
import { briefs, clients, folderMappings, milestones } from './db/schema';

export interface AgentBrief {
  id: string;
  title: string;
  clientName: string;
  folderPath: string;
  billingMode: 'fixed' | 'time';
  currency: string;
  items: MilestoneFileItem[];
}

/**
 * Active briefs that resolve to a real folder, shaped for the agent's file
 * writer. A brief with no folder is omitted — there is nowhere to put the file.
 */
export async function buildAgentBriefs(): Promise<AgentBrief[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: briefs.id,
      title: briefs.title,
      billingMode: briefs.billingMode,
      currency: briefs.currency,
      clientName: clients.name,
      folderPath: folderMappings.path,
    })
    .from(briefs)
    .innerJoin(clients, eq(briefs.clientId, clients.id))
    .innerJoin(folderMappings, eq(briefs.folderMappingId, folderMappings.id))
    .where(and(eq(briefs.status, 'active'), isNotNull(briefs.folderMappingId)));

  const out: AgentBrief[] = [];
  for (const b of rows) {
    const ms = await db
      .select()
      .from(milestones)
      .where(eq(milestones.briefId, b.id))
      .orderBy(milestones.idx);
    out.push({
      id: b.id,
      title: b.title,
      clientName: b.clientName,
      folderPath: b.folderPath,
      billingMode: b.billingMode === 'fixed' ? 'fixed' : 'time',
      currency: b.currency,
      items: ms.map((m) => ({
        key: m.key,
        idx: m.idx,
        title: m.title,
        section: m.section ?? undefined,
        amount: m.amount || undefined,
        hoursLow: m.estimateHoursLow || undefined,
        hoursHigh: m.estimateHoursHigh || undefined,
      })),
    });
  }
  return out;
}
```

- [ ] **Step 2: Create the briefs endpoint**

Create `apps/web/app/api/agent/briefs/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { buildAgentBriefs } from '@/lib/milestone-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const token = process.env.AGENT_TOKEN;
  const provided = req.headers.get('authorization') ?? '';
  if (!token || provided !== `Bearer ${token}`) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return Response.json({ briefs: await buildAgentBriefs() });
}
```

- [ ] **Step 3: Create the updates endpoint**

Create `apps/web/app/api/agent/milestones/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { milestones } from '@/lib/db/schema';
import { runMilestoneDueSweep } from '@/lib/invoice-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  updates: z
    .array(
      z.object({
        briefId: z.string().min(1),
        key: z.string().min(1).max(16),
        checked: z.boolean(),
      }),
    )
    .max(500),
});

export async function POST(req: NextRequest): Promise<Response> {
  const token = process.env.AGENT_TOKEN;
  const provided = req.headers.get('authorization') ?? '';
  if (!token || provided !== `Bearer ${token}`) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: 'bad request' }, { status: 400 });

  const db = getDb();
  let applied = 0;
  for (const u of parsed.data.updates) {
    // Only pending -> ready. An unticked box is ignored, and invoiced/complete
    // are terminal: the file can never walk a milestone backwards.
    if (!u.checked) continue;
    const res = await db
      .update(milestones)
      .set({ status: 'ready', readyAt: new Date() })
      .where(
        and(
          eq(milestones.briefId, u.briefId),
          eq(milestones.key, u.key),
          eq(milestones.status, 'pending'),
        ),
      )
      .returning({ id: milestones.id });
    applied += res.length;
  }

  const swept = await runMilestoneDueSweep();
  return Response.json({ ok: true, applied, issued: swept.issued });
}
```

- [ ] **Step 4: Typecheck and build**

Run: `cd apps/web && npx tsc --noEmit && npm run build`
Expected: clean, and the route list now includes `/api/agent/briefs` and `/api/agent/milestones`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/milestone-file.ts apps/web/app/api/agent
git commit -m "feat(web): agent endpoints for brief sync and milestone ticks"
```

---

### Task 6: The agent side of the sync

**Files:**
- Create: `apps/agent/src/milestones.ts`
- Modify: `apps/agent/src/index.ts`

**Interfaces:**
- Consumes: `GET /api/agent/briefs`, `POST /api/agent/milestones` (Task 5); `mergeMilestonesFile`, `parseMilestonesFile`, `MilestoneFileItem` from core (Task 1).
- Produces: `syncMilestones(apiBaseUrl: string, token: string): Promise<{ files: number; ticks: number; issued: number }>`

- [ ] **Step 1: Create the sync module**

Create `apps/agent/src/milestones.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mergeMilestonesFile,
  parseMilestonesFile,
  type MilestoneFileItem,
} from '@claude-invoicer/core';

interface AgentBrief {
  id: string;
  title: string;
  clientName: string;
  folderPath: string;
  billingMode: 'fixed' | 'time';
  currency: string;
  items: MilestoneFileItem[];
}

const FILE_NAME = 'MILESTONES.md';

/**
 * Write each active brief's MILESTONES.md into its folder, then report back any
 * ticked boxes. The merge is append-only, so a file the user has edited or
 * ticked is never rewritten — only new milestones get appended.
 *
 * Every ticked key is re-sent on every scan, not just newly ticked ones. That
 * is deliberate and safe: the server only moves pending -> ready, so a repeat
 * is a no-op, and a tick made while the agent was offline still gets picked up.
 */
export async function syncMilestones(
  apiBaseUrl: string,
  token: string,
): Promise<{ files: number; ticks: number; issued: number }> {
  const res = await fetch(`${apiBaseUrl}/api/agent/briefs`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`brief fetch failed: ${res.status} ${res.statusText}`);
  const { briefs } = (await res.json()) as { briefs: AgentBrief[] };

  const updates: { briefId: string; key: string; checked: boolean }[] = [];
  let files = 0;

  for (const b of briefs) {
    if (!existsSync(b.folderPath)) continue; // folder not on this machine
    const path = join(b.folderPath, FILE_NAME);
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const merged = mergeMilestonesFile(existing, {
      briefTitle: b.title,
      clientName: b.clientName,
      billingMode: b.billingMode,
      currency: b.currency,
      items: b.items,
    });
    if (merged !== existing) {
      writeFileSync(path, merged, 'utf8');
      files++;
    }
    for (const e of parseMilestonesFile(merged)) {
      if (e.checked) updates.push({ briefId: b.id, key: e.key, checked: true });
    }
  }

  if (updates.length === 0) return { files, ticks: 0, issued: 0 };

  const post = await fetch(`${apiBaseUrl}/api/agent/milestones`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ updates }),
  });
  if (!post.ok) throw new Error(`milestone post failed: ${post.status} ${post.statusText}`);
  const json = (await post.json()) as { applied?: number; issued?: number };
  return { files, ticks: json.applied ?? 0, issued: json.issued ?? 0 };
}
```

- [ ] **Step 2: Call it from the scan tick**

In `apps/agent/src/index.ts` add the import:

```ts
import { syncMilestones } from './milestones.js';
```

Add this helper above `runOnce`:

```ts
async function syncBriefs(cfg: AgentConfig): Promise<void> {
  // Best-effort: a brief-sync failure must never block interval upload, which
  // is the agent's primary job.
  try {
    const ms = await syncMilestones(cfg.apiBaseUrl, cfg.deviceToken);
    if (ms.files || ms.ticks || ms.issued) {
      log(`milestones: ${ms.files} file(s) written, ${ms.ticks} tick(s), ${ms.issued} invoice(s) issued`);
    }
  } catch (e) {
    log(`milestone sync failed (non-fatal): ${(e as Error).message}`);
  }
}
```

Then call `await syncBriefs(cfg);` immediately before each `return` in `runOnce`'s **resync** branch
and its **normal** branch — including the early `return` taken when `result.intervals.length === 0`,
since a tick can arrive in a scan that found no new time. Do **not** call it in the `dryRun` branch:
a dry run must write nothing.

- [ ] **Step 3: Typecheck**

Run: `cd apps/agent && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Verify the dry run still writes nothing**

Run: `npm run agent:once -- --dry-run`
Expected: the folder summary table prints, and no `MILESTONES.md` is created anywhere.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/milestones.ts apps/agent/src/index.ts
git commit -m "feat(agent): sync MILESTONES.md and report ticks each scan"
```

---

### Task 7: Milestone controls on the brief page

**Files:**
- Modify: `apps/web/lib/actions.ts`
- Modify: `apps/web/lib/queries.ts`
- Modify: `apps/web/app/briefs/[id]/page.tsx`

**Interfaces:**
- Consumes: `issueMilestoneInvoice`, `emailInvoiceById` (Task 4); `requireOwner` (already in `actions.ts`).
- Produces: server actions `completeMilestone(fd)`, `cancelMilestone(fd)`, `issueMilestoneNow(fd)`; `getBriefDetail` additionally returns `trackedHours: number`.

- [ ] **Step 1: Add the server actions**

In `apps/web/lib/actions.ts`, following the shape of the existing brief actions. Every one calls
`requireOwner()` first — not optional; all 23 mutating actions in this file do it.

```ts
export async function completeMilestone(fd: FormData): Promise<void> {
  await requireOwner();
  const id = String(fd.get('id') ?? '');
  if (!id) throw new Error('Missing milestone');
  // pending -> ready only. Never walks a terminal milestone backwards.
  await getDb()
    .update(milestones)
    .set({ status: 'ready', readyAt: new Date() })
    .where(and(eq(milestones.id, id), eq(milestones.status, 'pending')));
  revalidatePath('/briefs/[id]', 'page');
}

export async function cancelMilestone(fd: FormData): Promise<void> {
  await requireOwner();
  const id = String(fd.get('id') ?? '');
  if (!id) throw new Error('Missing milestone');
  // Only a milestone still inside its hold window can be pulled back.
  await getDb()
    .update(milestones)
    .set({ status: 'pending', readyAt: null })
    .where(and(eq(milestones.id, id), eq(milestones.status, 'ready')));
  revalidatePath('/briefs/[id]', 'page');
}

export async function issueMilestoneNow(fd: FormData): Promise<void> {
  await requireOwner();
  const id = String(fd.get('id') ?? '');
  if (!id) throw new Error('Missing milestone');
  const res = await issueMilestoneInvoice(id);
  if (res.ok) {
    try {
      await emailInvoiceById(res.id);
    } catch (e) {
      console.warn('milestone invoice issued but not emailed:', e);
    }
  } else if (res.reason !== 'nothing-to-bill' && res.reason !== 'already-invoiced') {
    throw new Error(`Could not issue: ${res.reason}`);
  }
  revalidatePath('/briefs/[id]', 'page');
}
```

Add `milestones` to this file's schema import, and `issueMilestoneInvoice`, `emailInvoiceById` to
its `./invoice-service` import.

- [ ] **Step 2: Return tracked hours from `getBriefDetail`**

In `apps/web/lib/queries.ts`:

```ts
export async function getBriefDetail(
  id: string,
): Promise<{ brief: Brief; milestones: Milestone[]; trackedHours: number } | null> {
  const db = getDb();
  const [brief] = await db.select().from(briefs).where(eq(briefs.id, id));
  if (!brief) return null;
  const rows = await db.select().from(milestones).where(eq(milestones.briefId, id)).orderBy(milestones.idx);

  // Hours tracked against this brief's folder, all time. An internal burn-down
  // and margin check; it never reaches the client.
  let trackedHours = 0;
  if (brief.folderMappingId) {
    const [fm] = await db.select().from(folderMappings).where(eq(folderMappings.id, brief.folderMappingId));
    if (fm) {
      const coreMappings = await loadCoreMappings(db);
      const rawIntervals = await db.select().from(activityIntervals);
      const scoped = applyFolderCutoffs(
        rawIntervals.map(toCoreInterval).filter((it) => matchMapping(it.cwd, coreMappings)?.path === fm.path),
        coreMappings,
      );
      trackedHours = round2(scoped.reduce((s, it) => s + it.activeMs, 0) / MS_PER_HOUR);
    }
  }
  return { brief, milestones: rows, trackedHours };
}
```

Add `matchMapping`, `round2`, `MS_PER_HOUR` to this file's core import list if absent.

- [ ] **Step 3: Rewrite the page's status column and footer**

In `apps/web/app/briefs/[id]/page.tsx`, change the actions import:

```ts
import { deleteBrief, completeMilestone, cancelMilestone, issueMilestoneNow } from '@/lib/actions';
```

Destructure the new field:

```ts
  const { brief, milestones, trackedHours } = detail;
```

Replace the status `<td>` with state-driven controls:

```tsx
                <td className="py-2 text-right">
                  {m.status === 'pending' && (
                    <form action={completeMilestone} className="inline">
                      <input type="hidden" name="id" value={m.id} />
                      <button className="btn-secondary text-xs" type="submit">
                        Mark delivered
                      </button>
                    </form>
                  )}
                  {m.status === 'ready' && (
                    <div className="flex justify-end gap-2">
                      <form action={issueMilestoneNow} className="inline">
                        <input type="hidden" name="id" value={m.id} />
                        <button className="btn-primary text-xs" type="submit">
                          Invoice now
                        </button>
                      </form>
                      <form action={cancelMilestone} className="inline">
                        <input type="hidden" name="id" value={m.id} />
                        <button className="btn-secondary text-xs" type="submit">
                          Cancel
                        </button>
                      </form>
                    </div>
                  )}
                  {m.status === 'invoiced' && m.invoiceId && (
                    <Link href={`/invoices/${m.invoiceId}`} className="text-xs text-emerald-400 hover:underline">
                      Invoiced
                    </Link>
                  )}
                  {m.status === 'complete' && (
                    <span className="text-xs text-slate-500">Done · nothing to bill</span>
                  )}
                </td>
```

Replace the "arrives in the next phase" paragraph with the burn-down and margin block:

```tsx
      {(() => {
        const lowTotal = sum((m) => m.estimateHoursLow);
        const highTotal = sum((m) => m.estimateHoursHigh);
        const tone =
          trackedHours > highTotal
            ? 'text-rose-400'
            : trackedHours > lowTotal
              ? 'text-amber-400'
              : 'text-emerald-400';
        const earned = sum((m) => (m.status === 'invoiced' ? m.amount : 0));
        return (
          <div className="card space-y-1 text-sm">
            <p>
              <span className="text-slate-400">Tracked against this folder: </span>
              <span className={tone}>{trackedHours} hrs</span>
              <span className="text-slate-500">
                {' '}of {lowTotal}–{highTotal} estimated
              </span>
            </p>
            {brief.billingMode === 'fixed' && earned > 0 && trackedHours > 0 && (
              <p className="text-slate-400">
                Invoiced {formatMoney(earned, brief.currency)} — effective{' '}
                {formatMoney(Math.round((earned / trackedHours) * 100) / 100, brief.currency)}/hr.{' '}
                <span className="text-slate-500">Internal only; never shown to the client.</span>
              </p>
            )}
            {trackedHours > highTotal && (
              <p className="text-rose-400">
                Past the top of the estimate — flag this with the client before it becomes an issue.
              </p>
            )}
          </div>
        );
      })()}
```

- [ ] **Step 4: Typecheck and build**

Run: `cd apps/web && npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all core tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/actions.ts apps/web/lib/queries.ts "apps/web/app/briefs/[id]/page.tsx"
git commit -m "feat(web): milestone controls, burn-down and margin on the brief page"
```

---

### Task 8: Ready milestones under "Needs attention" on the dashboard

D6 requires a milestone sitting inside its hold window to be visible from the dashboard, not only
from its own brief page — that window is the user's chance to stop an invoice before it goes out,
and it is worthless if they have to already be looking at the right brief to find it.

**Files:**
- Modify: `apps/web/lib/queries.ts`
- Modify: `apps/web/app/page.tsx`

**Interfaces:**
- Consumes: `cancelMilestone`, `issueMilestoneNow` (Task 7).
- Produces: `OverviewData.readyMilestones: ReadyMilestone[]` where
  `ReadyMilestone = { id: string; title: string; briefId: string; briefTitle: string; clientName: string; readyAt: Date | null; holdMinutes: number; autoInvoice: boolean }`

- [ ] **Step 1: Extend `OverviewData` and `getOverview`**

In `apps/web/lib/queries.ts`, add the interface above `OverviewData`, add the field to
`OverviewData`, and load the rows in `getOverview`:

```ts
export interface ReadyMilestone {
  id: string;
  title: string;
  briefId: string;
  briefTitle: string;
  clientName: string;
  readyAt: Date | null;
  holdMinutes: number;
  autoInvoice: boolean;
}
```

Add to `OverviewData`:

```ts
  readyMilestones: ReadyMilestone[];
```

In `getOverview`, after `const db = getDb();` near the end:

```ts
  const readyRows = await db
    .select({
      id: milestones.id,
      title: milestones.title,
      briefId: briefs.id,
      briefTitle: briefs.title,
      clientName: clients.name,
      readyAt: milestones.readyAt,
      holdMinutes: briefs.holdMinutes,
      autoInvoice: briefs.autoInvoice,
    })
    .from(milestones)
    .innerJoin(briefs, eq(milestones.briefId, briefs.id))
    .innerJoin(clients, eq(briefs.clientId, clients.id))
    .where(and(eq(milestones.status, 'ready'), eq(briefs.status, 'active')))
    .orderBy(milestones.readyAt);
  const readyMilestones: ReadyMilestone[] = readyRows.map((r) => ({
    ...r,
    autoInvoice: r.autoInvoice === 1,
  }));
```

and add `readyMilestones,` to the returned object.

- [ ] **Step 2: Render the section on the dashboard**

In `apps/web/app/page.tsx`, destructure `readyMilestones` from the overview and add this section
**above** the existing `Clients` section, so it is the first thing on the page when non-empty:

```tsx
      {readyMilestones.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-400">
            Needs attention
          </h2>
          <div className="card space-y-3">
            {readyMilestones.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Link href={`/briefs/${m.briefId}`} className="hover:underline">
                    {m.title}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {m.clientName} · {m.briefTitle} ·{' '}
                    {m.autoInvoice
                      ? `invoices automatically ${m.holdMinutes} min after being marked delivered`
                      : 'waiting for you to invoice it'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <form action={issueMilestoneNow} className="inline">
                    <input type="hidden" name="id" value={m.id} />
                    <button className="btn-primary text-xs" type="submit">
                      Invoice now
                    </button>
                  </form>
                  <form action={cancelMilestone} className="inline">
                    <input type="hidden" name="id" value={m.id} />
                    <button className="btn-secondary text-xs" type="submit">
                      Cancel
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
```

Import the two actions at the top of the file, alongside whatever it already imports from
`@/lib/actions`. Both call `revalidatePath('/briefs/[id]', 'page')`; add
`revalidatePath('/', 'page')` to each of them in `apps/web/lib/actions.ts` so this section refreshes
after either button.

- [ ] **Step 3: Typecheck and build**

Run: `cd apps/web && npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/queries.ts apps/web/app/page.tsx apps/web/lib/actions.ts
git commit -m "feat(web): surface ready milestones under Needs attention on the dashboard"
```

---

## Verification before finishing

- [ ] `npm test` — every core test passes.
- [ ] `cd apps/web && npx tsc --noEmit && npm run build` — clean; the route list includes `/api/agent/briefs` and `/api/agent/milestones`.
- [ ] `cd apps/agent && npx tsc --noEmit` — clean.
- [ ] `npm run agent:once -- --dry-run` — prints the folder table and creates no `MILESTONES.md`.
- [ ] `git diff --stat main -- apps/web/drizzle` is **empty** — D2 adds no migration.
- [ ] `git diff --stat main -- apps/web/lib/db/schema.ts` is **empty** — D2 adds no columns.
