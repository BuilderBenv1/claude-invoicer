# The Automation Agency — invoicing overhaul

**Date:** 2026-08-14
**Branch:** `feat/agency-overhaul`
**Status:** approved design, not yet implemented

## Context

`claude-invoicer` turns tracked Claude session time into weekly invoices. A local
agent (`apps/agent`) reads `~/.claude/projects/*/*.jsonl`, computes idle-capped
activity intervals and uploads them to a Vercel dashboard (`apps/web`, Next.js +
Neon + Auth.js). Shared pure logic lives in `packages/core`. Invoices snapshot
business + client identity at issue time so old PDFs never change. PDFs are
rendered with `pdf-lib` (never reintroduce `@react-pdf/renderer` — it fails on
Next 15 serverless).

This design covers six requested changes, decomposed into four independently
shippable phases:

1. Delete clients without opening them (A)
2. Currency selector (A)
3. Folders picking up existing Claude work on assignment (A)
4. Bank details on invoices, and the correct UK document type (B)
5. A far more professional, user-friendly app branded "The Automation Agency" (C)
6. Briefs with costed milestones that invoice themselves as work completes (D)

Phases A–C are self-contained. D depends on B (it issues invoices).

## Decisions taken

| Question | Decision |
|---|---|
| Deleting a client with invoices | Blocked — archive instead. Delete is only offered when the client has zero invoices. |
| Document types | Invoice + pro forma + quote, on separate number sequences. |
| Bank details | One default set plus per-currency overrides, snapshotted onto each invoice. |
| UI scope | Full restyle **and** restructure (new IA). |
| Milestone completion detection | `MILESTONES.md` checklist in the project folder, read by the local agent. |
| Brief billing model | Per brief: fixed-price **or** time & materials. |
| On milestone completion | Issue + email automatically, after a configurable hold window (default 10 min). |
| Brief input | Paste text → deterministic parse → editable confirm table. |

## Out of scope

FX conversion between currencies; LLM-based brief parsing (deterministic parser
only); card/Stripe payment collection; multi-user accounts; changing the weekly
Mon–Sun billing model; changing the agent's interval/idle-cap engine.

---

# Phase A — Client management & currency

## A1. Delete a client

New server action `deleteClient(fd)` in `lib/actions.ts`.

- **Guard:** count `invoices` for the client. If `> 0`, throw
  `"<name> has N invoices — archive them instead so the billing record survives."`
  The guard runs inside the delete transaction, not just in the UI.
- **Confirmation:** the form carries a `confirmName` text input; the action
  requires `confirmName.trim().toLowerCase() === client.name.trim().toLowerCase()`.
- **Cascade:** `folder_mappings`, `one_off_charges` and `week_adjustments` already
  declare `onDelete: 'cascade'`; no schema change needed. `activity_intervals` are
  *not* deleted — they are raw tracking data, and the folders simply return to the
  unassigned pool.
- **Placement:** on the `/clients` row (Phase C) and on the client detail page,
  where `archiveClient` lives today.

## A2. Archive / restore

`archiveClient` currently sets `archived = 1` and every query filters
`archived = 0`, so an archived client vanishes with no way back.

- New action `unarchiveClient(fd)`.
- `listClients()` gains `{ includeArchived }`; a new `listArchivedClients()` feeds
  an "Archived (N)" section on `/clients` with **Restore** and **Delete** actions.
- Archived clients stay excluded from the dashboard, weekly billing and the cron.

## A3. Currency

`clients.currency` and `settings.defaultCurrency` are free-text inputs today.

- New `apps/web/lib/currencies.ts`: `CURRENCIES: { code, symbol, name }[]` —
  GBP, USD, EUR, AUD, CAD, CHF, SEK, NOK, NZD, AED, INR, ZAR.
- New `<CurrencySelect>` component used in: add-client, client settings, manual
  invoice form, global settings. Shows `£ GBP — Pound Sterling`.
- `formatMoney` in `lib/format.ts` hardcodes locale `en-US`; change to `en-GB`
  so GBP/EUR render with the right grouping and symbol placement. Same change in
  the `money()` helper inside `lib/pdf/render.ts`.
- Changing a client's currency when they already have invoices shows a warning
  ("past invoices keep their original currency") — it does not block, and it does
  not rewrite history, because invoices snapshot `currency` at issue.

## A4. Folder assignment picks up existing work

Nothing is broken here — `matchClientId` is longest-prefix, the agent uploads
every folder regardless of mapping, and `folder_mappings.billFromMs` defaults to
`0` — so assigning a folder already bills all of its history and every subfolder.
The gap is purely UI: the "Add a client" form has no folder field, so the user
must add a client and then find the folder in a separate unassigned list.

- The add-client form gains a folder picker: a searchable `<select>` of currently
  unassigned folders **annotated with their tracked time and last-seen date**
  (`unassignedFolders()` already returns `activeMs` and `lastSeenMs`), plus a
  free-text path field for a folder that has no activity yet.
- A radio: **Bill all past work in this folder** (default, `billFromMs = 0`) /
  **Bill from today** (`billFromMs = Date.now()`).
- `createClient` is extended to accept `path`, `label` and `billFrom`, creating the
  mapping in the same transaction as the client.
- After save, the client page shows the picked-up weeks immediately — no extra
  banner state needed, because the hours were already visible in the picker.

---

# Phase B — Documents & payment

## B1. Document types

One table, three types: `invoices.docType ∈ { 'invoice', 'proforma', 'quote' }`.

- A **quote** is prospective work, has no due date, and prints
  "This is a quotation, not a request for payment."
- A **pro forma** is a request for payment up front. It prints
  "This is a pro forma invoice and is not a VAT/tax invoice."
- Converting either issues a *new* row with `docType='invoice'`, the next real
  invoice number, `convertedFromId` pointing back, and `convertedToId` set on the
  source. The source is not deleted.
- Only `docType='invoice'` rows count toward revenue, unpaid/overdue totals, the
  weekly "already billed" set (`billedWeekStarts`) and the receipt flow. Every
  query that treats an invoice as billing evidence must filter on `docType`.

## B2. Numbering

HMRC expects an unbroken sequential invoice run, so quotes and pro formas must
not consume invoice numbers.

- `settings` gains `quoteSeq`, `proformaSeq`, and prefixes `invoicePrefix`
  (`'INV'`), `quotePrefix` (`'QUO'`), `proformaPrefix` (`'PF'`).
- `insertInvoice` in `lib/invoice-service.ts` picks the sequence and prefix from
  `docType`, reusing the existing atomic increment.

## B3. Payment accounts

New table:

```
payment_accounts(
  id             text primary key,
  currency       text not null,           -- ISO code, or 'DEFAULT'
  account_name   text,
  bank_name      text,
  sort_code      text,
  account_number text,
  iban           text,
  bic            text,
  routing_number text,
  notes          text                     -- free text, e.g. a Wise link
)
unique index payment_accounts_currency_unique on (currency)
```

- **Resolution order:** exact currency match → `'DEFAULT'` → nothing printed.
- `renderPaymentBlock(account, invoice)` produces newline-separated display lines
  and always appends `Payment reference: <invoice number>`.
- The rendered block is **snapshotted** onto `invoices.paymentDetails` at issue,
  matching the existing identity-snapshot rule, so changing banks never alters an
  already-issued PDF.
- Settings UI: a default block plus "Add details for another currency".

## B4. Payment terms, due dates, overdue

- `settings.paymentTermsDays` (default `14`).
- `invoices.paymentTermsDays` (snapshot) and `invoices.dueAt` (computed at issue
  as `issuedAt + paymentTermsDays` days; null for quotes).
- **Overdue is derived, never stored:** `status === 'unpaid' && dueAt && dueAt < now`.
  Surfaced as a badge in the invoice list, on the dashboard, and on `/i/[token]`.

## B5. VAT

Off by default, ready for when the company is registered.

- `settings.vatRate` (default `0`), `settings.vatNumber` (the existing `taxId`
  column keeps its meaning; `vatNumber` is printed with the VAT breakdown).
- `invoices` gains `taxRate`, `taxAmount`, `total`.
- **`subtotal` becomes strictly net**, and `total = subtotal + taxAmount` is the
  payable figure. Every place that currently prints or sums `invoice.subtotal` as
  the amount due must move to `invoice.total`: the PDF (invoice + receipt), the
  invoice detail page, `/i/[token]`, the email bodies, and any dashboard sums.
  The migration backfills `total = subtotal` for existing rows.

## B6. PDF rebuild

- `settings.logoDataUrl` (text). Uploaded in Settings via a client-side
  `FileReader`, PNG/JPEG only, rejected above 250 KB. Embedded with pdf-lib's
  `embedPng` / `embedJpg`.
- New layout: logo + business block, document-type title, invoice number, issued
  and **due** dates, bill-to, line items, net/VAT/total, **pay-to block**,
  hours-by-day grid (unchanged), type-specific legal line, and a footer that no
  longer says "Generated by Claude Invoicer".
- Receipt PDF gets the same header treatment and uses `total`.

---

# Phase C — Brand and restructure

## C1. Brand

Business identity stays editable in Settings (`businessName` already drives the
PDF), so switching to another company name is a one-field change. The app's own
chrome is branded **The Automation Agency**: wordmark in the sidebar, `<title>`,
login page, and email templates.

Visual direction: near-black canvas, elevated panels, a single confident accent,
a tightened type scale, and real empty states. Implemented via Tailwind design
tokens in `tailwind.config.ts` plus the `@layer components` classes in
`globals.css` (which already centralise `.card` / `.input` / `.btn-*`).
The `frontend-design` skill is used for this phase rather than defaults.

## C2. Information architecture

| Route | Change |
|---|---|
| `/` | Dashboard: unpaid + overdue totals, this week's billable, **Needs attention** (weeks ready to invoice, milestones ready, unassigned folders), recent activity. No longer the add-client / assign-folder dumping ground. |
| `/clients` | **New.** Searchable list, inline rate + currency, row actions (open / archive / delete), archived section, add-client form with the Phase A folder picker. |
| `/clients/[id]` | Split the current single 330-line scroll into tabs: Weeks · Folders · Briefs · Charges · Settings. |
| `/invoices` | Filters (status, client, document type, date range), search, totals row. |
| `/invoices/[id]` | Restyled; actions become Send / Convert / Mark paid / Delete. |
| `/settings` | Tabs: Business · Payment details · Invoicing · Time tracking · Automation. |

## C3. Interaction quality

- **Destructive confirmation:** a shared client component wrapping `<dialog>`,
  used for delete client, delete invoice, remove folder, remove charge.
- **Inline feedback:** server actions currently `throw`, which renders Next's
  error page. Forms that can fail on user input (delete, issue invoice, add
  brief, manual invoice) move to `useActionState` returning `{ ok, error }` and
  render the message beside the form. Redirect-style actions keep their current
  shape.
- Loading states on submit buttons via `useFormStatus`.

---

# Phase D — Briefs and milestones

## D1. Schema

```
briefs(
  id                text primary key,
  client_id         text not null references clients(id) on delete cascade,
  title             text not null,
  billing_mode      text not null default 'fixed',   -- 'fixed' | 'time'
  currency          text not null,
  folder_mapping_id text references folder_mappings(id) on delete set null,
  source_text       text,                            -- the pasted brief, kept verbatim
  status            text not null default 'active',  -- 'active' | 'complete' | 'archived'
  auto_invoice      integer not null default 1,
  hold_minutes      integer not null default 10,
  created_at        timestamptz not null default now()
)

milestones(
  id              text primary key,
  brief_id        text not null references briefs(id) on delete cascade,
  idx             integer not null,
  key             text not null,          -- short stable id written into MILESTONES.md
  title           text not null,
  deliverable     text,
  amount          double precision not null default 0,
  estimate_hours  double precision not null default 0,
  status          text not null default 'pending',   -- see state machine below
  ready_at        timestamptz,            -- when the box was seen ticked
  invoiced_at     timestamptz,
  invoice_id      text
)
unique index milestones_brief_key_unique on milestones(brief_id, key)
unique index invoices_milestone_unique   on invoices(milestone_id) where milestone_id is not null
```

**Milestone state machine.** `pending → ready` when the agent reports the box
ticked. From `ready`, a *fixed-price* brief goes to `invoiced` once the hold
window elapses; a *time & materials* brief goes straight to `done` (terminal, no
invoice — it only records progress). `invoiced` and `done` are both terminal:
later file states for that key are ignored, so unticking a box never reverses
anything. Cancelling a `ready` milestone returns it to `pending`.

`folder_mappings` gains `billing_mode text not null default 'time'`.

`invoices` gains `brief_id text` and `milestone_id text` (both nullable, set only
on milestone invoices).

## D2. Brief parsing (deterministic, no LLM)

`packages/core/src/brief.ts` → `parseBriefText(text): ParsedMilestone[]`.

- A line is a milestone candidate when it starts with a list/number marker
  (`-`, `*`, `1.`, `Milestone 2:`) **and** contains a money amount, or when it is
  a list item appearing under a heading matching `/milestones?/i`.
- Money: `£1,200` / `$800` / `1200 GBP` / `€1.200,00`. The first currency symbol
  seen sets the brief's currency suggestion.
- Hours: `~8h`, `8h`, `8 hrs`, `8 hours`, `(8h)`.
- Title: the line with the marker, money and hours stripped, then trimmed of
  trailing `—`, `-`, `:`.
- Deliverable: the remainder after a `:` on the same line, or an immediately
  following indented line.
- A line starting with `Total` is used only to sanity-check the sum; a mismatch
  renders a warning in the confirm table, never an error.
- Zero matches is a valid result: the UI shows an empty editable table and keeps
  the raw text in `source_text`.

The parse result is **always** shown in an editable table before saving. Nothing
is created from a parse alone.

## D3. `MILESTONES.md` contract

Written into the brief's folder. Location: `<folder>/MILESTONES.md`.

```markdown
# <Brief title>

Milestones for <Client name>. Tick a box when the milestone is delivered —
it is picked up automatically and invoiced.

- [ ] M1 · Discovery & spec — £800  <!-- id:8f2a -->
- [ ] M2 · API integration — £1,200  <!-- id:c41d -->
```

- Line grammar (also the parser):
  `^\s*[-*]\s*\[( |x|X)\]\s*(?<body>.*?)<!--\s*id:(?<key>[A-Za-z0-9]{4,16})\s*-->`
- `renderMilestonesFile(brief, milestones)` and
  `parseMilestonesFile(text): { key, checked }[]` both live in
  `packages/core/src/milestones.ts` so the agent and the web app share them.
- **Agent write rules — append-only:**
  - file missing → write the full scaffold;
  - file present → append lines only for keys not already in the file;
  - **never** modify, reorder or delete an existing line.
  This makes it impossible for a sync to clobber a tick.
- Unticking a box does **not** un-invoice anything. Once a milestone reaches
  `invoiced` its state is terminal and further file states for that key are
  ignored.

## D4. Agent ↔ server protocol

Both endpoints authenticate with the existing `AGENT_TOKEN` bearer secret, the
same as `/api/ingest`.

- `GET /api/agent/briefs` →
  `{ briefs: [{ id, title, clientName, folderPath, milestones: [{ key, idx, title, amount, currency, status }] }] }`
  Only briefs with a resolved folder path are returned.
- `POST /api/agent/milestones` with `{ updates: [{ briefId, key, checked }] }` →
  `{ applied, issued }`. The server marks `pending → ready` with
  `ready_at = now()` on a checked transition, ignores everything else, then runs
  the due sweep (D6) before responding.

New agent module `apps/agent/src/milestones.ts`, run at the end of each scan tick
in `apps/agent/src/index.ts`. Failures are logged and non-fatal — a brief sync
error must never block interval upload. It is skipped entirely on `--dry-run`.

## D5. Billing rules

**Fixed-price brief.** Ticking a milestone issues an invoice for that milestone's
`amount`, one line (`title`), then emails it. **The brief folder's tracked time is
excluded from weekly time-billing** — otherwise the same work bills twice.

- Mechanism: attaching a fixed brief sets `folder_mappings.billing_mode = 'fixed'`.
- New pure function `excludeFixedPriceFolders(intervals, mappings)` in
  `packages/core/src/billing.ts`, applied alongside `applyFolderCutoffs` in every
  path that computes billable weekly amounts (`getOverview`, `getClientDetail`,
  `getWeekDetail`, `issueWeekInvoice`, the weekly cron).
- The hours are still tracked and still shown — the brief page displays
  hours spent vs price earned and the effective £/hr, as an internal margin check
  that never reaches the client.
- Core's `FolderMapping` type gains `billingMode?: 'time' | 'fixed'`.

**Time & materials brief.** Milestones do not invoice; a ticked milestone goes to
`done`. They record progress and burn-down against `estimate_hours`, with a
warning when tracked hours pass the estimate. Time keeps billing weekly exactly
as it does today, and the folder's `billing_mode` stays `'time'`.

## D6. Auto-issue and the hold window

`issueMilestoneInvoice(milestoneId)` in `lib/invoice-service.ts` reuses
`insertInvoice`, then `emailInvoiceById`.

- The **due sweep** issues every milestone where
  `status = 'ready' AND ready_at + hold_minutes < now()`, and the brief has
  `auto_invoice = 1`.
- It runs (a) at the end of every `POST /api/agent/milestones` — giving ~5-minute
  granularity from the agent's own scan loop, with no new cron — and (b) inside
  the existing daily `/api/cron/weekly` as a backstop for when the agent is off.
- `hold_minutes = 0` means issue immediately.
- Double-issue is impossible: `invoices_milestone_unique` plus the existing
  `23505 → already-done` catch pattern.
- While a milestone is `ready` but not yet issued, the dashboard shows it under
  **Needs attention** with a **Cancel** button that returns it to `pending`.

---

# Cross-cutting

## Migrations

One `.sql` file per phase in `apps/web/drizzle/`, applied by the user in the Neon
SQL editor **before** the branch merges to `main` — auto-deploy from `main` would
otherwise 500 against a schema that lacks the new columns. Each file is additive
(`ADD COLUMN ... DEFAULT`, `CREATE TABLE IF NOT EXISTS`) and safe to re-run.

Backfills: `invoices.doc_type = 'invoice'`, `invoices.total = subtotal`,
`invoices.tax_rate = 0`, `invoices.tax_amount = 0`.

## Testing

- `packages/core` (vitest, currently 39 passing): new tests for
  `parseBriefText`, `parseMilestonesFile`, `renderMilestonesFile` (including the
  append-only merge), `excludeFixedPriceFolders`, and due-date calculation.
- `apps/web`: `tsc --noEmit` and `next build` must stay green; PDF changes are
  verified by rendering each document type once and opening the output.
- The `total` vs `subtotal` migration is the highest-risk edit — every read site
  is enumerated in B5 and must be checked off individually.

## Rollout

Each phase gets its own implementation plan in `docs/superpowers/plans/`, written
and executed one at a time — the spec is deliberately not turned into a single
plan. Phases merge independently in order A → B → C → D. Phase D additionally
requires rebuilding and restarting the local agent; the Startup-folder VBS picks
up the new build on next login.

## Risks

- **A stray tick emails a client.** Mitigated by the hold window with a Cancel
  button, and by `auto_invoice` being a per-brief toggle.
- **Double-billing a fixed-price folder.** Mitigated by `billing_mode = 'fixed'`
  exclusion; this is the one change that alters existing billing maths, so it
  carries dedicated core tests.
- **Broken invoice sequence.** Mitigated by separate sequences per document type.
