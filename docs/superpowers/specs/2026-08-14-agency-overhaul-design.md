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
| Brief billing model | Per brief: fixed-price **or** time & materials. A T&M milestone bills the tracked hours attributable to it when completed. |
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
- **What counts as "invoiced":** only rows with `docType = 'invoice'`. A client
  you merely sent a quote to has no billing history, and "I quoted them, they
  never replied, delete them" is ordinary. Phase A counts all invoice rows
  because only invoices exist yet; Phase B must add the `docType` filter when it
  introduces quotes and pro formas. The count lives in one helper
  (`invoiceCountFor` in `lib/queries.ts`) so that is a one-line change.

## A2. Archive / restore

`archiveClient` currently sets `archived = 1` and every query filters
`archived = 0`, so an archived client vanishes with no way back.

- New action `unarchiveClient(fd)`.
- `getOverview()` returns an `archived` list alongside `stats`, feeding an
  "Archived (N)" section with **Restore** and **Delete** actions. It moves to
  `/clients` in Phase C.
- Archived clients stay excluded from the dashboard, weekly billing and the cron.

## A3. Currency

`clients.currency` and `settings.defaultCurrency` are free-text inputs today.

- New `packages/core/src/currency.ts`: `CURRENCIES: { code, symbol, name }[]` —
  GBP, USD, EUR, AUD, CAD, CHF, SEK, NOK, NZD, AED, INR, ZAR. It lives in core,
  not the web app, because core is the only workspace with a test runner.
  `currencyOptionsWith(stored)` appends a stored code that predates the
  catalogue, so editing a client never silently rewrites their currency.
- New `<CurrencySelect>` component used in: add-client, client settings, global
  settings. The manual invoice form needs no selector — it derives currency from
  the chosen client.
- Money formatting is duplicated three times today (`lib/format.ts`,
  `lib/pdf/render.ts`, `components/manual-invoice-form.tsx`), each hardcoding
  locale `en-US`, so GBP renders with US grouping. One tested implementation
  replaces all three, picking the locale from the currency (GBP→`en-GB`,
  USD→`en-US`, EUR→`en-IE`, …) rather than one fixed locale — a fixed `en-GB`
  would render the existing USD invoices as `US$1,234.56`.
- Because some of those locales emit no-break spaces, and because client names
  and addresses are free text, a `toWinAnsi(text)` sanitiser is added to core and
  applied at the PDF drawing layer. pdf-lib's standard fonts encode cp1252 only
  and **throw** on anything else, so this also closes an existing crash path.
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
  **Bill from the start of today**.
- **"Bill from" always means a day boundary in the user's local time, never the
  current instant** — `Date.now()` on a UTC server would silently drop work
  already done earlier that day. The browser computes local midnight and submits
  it, following the pattern `components/bill-from-form.tsx` already uses; the
  server falls back to `Date.now()` only if that field is missing. Phase D reuses
  this vocabulary for brief folders and must use the same rule. Where the
  instantaneous meaning is genuinely wanted, the control is labelled "Now".
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
- **Quotes and pro formas are always manual documents** with window fields `-1`,
  never tied to a tracked week. A week's work is already done, so it is billed
  with a real invoice; quotes and pro formas are for prospective work. This also
  keeps them clear of the `invoices_client_week_unique` partial index, which
  would otherwise let a quote block the real invoice for that week.
- **Receipts belong to invoices only.** Marking a quote or pro forma "paid" is
  not a thing; payment against a pro forma is recorded on the invoice it
  converts into.
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

## B6. PDF rebuild — **moved to Phase C**

The logo upload and the full PDF visual rebuild move into Phase C, where the
brand palette, wordmark and typography are decided. Rebuilding the document's
look before the brand exists would mean doing it twice. Phase B keeps the PDF
functionally correct — due date, VAT breakdown, pay-to block, document-type
title and legal line — and Phase C restyles it, adds the logo, and takes on
pagination.

The original B6 text follows, as the Phase C requirement:

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
  /** Fixed-price briefs only: the agreed price for this milestone. T&M briefs
      leave this 0 and bill tracked time instead. */
  amount          double precision not null default 0,
  estimate_hours_low  double precision not null default 0,
  estimate_hours_high double precision not null default 0,
  estimate_amount_low  double precision not null default 0,
  estimate_amount_high double precision not null default 0,
  /** Set when this milestone's tracked time has been invoiced (T&M). */
  billed_through_ms   bigint not null default 0,
  status          text not null default 'pending',   -- see state machine below
  ready_at        timestamptz,            -- when the box was seen ticked
  invoiced_at     timestamptz,
  invoice_id      text
)
unique index milestones_brief_key_unique on milestones(brief_id, key)
unique index invoices_milestone_unique   on invoices(milestone_id) where milestone_id is not null
```

**Milestone state machine.** `pending → ready` when the agent reports the box
ticked. From `ready`, both modes go to `invoiced` once the hold window elapses —
a *fixed-price* milestone bills its agreed `amount`, a *time & materials* one
bills the hours tracked in `(billed_through_ms, cutoff]` at the client's rate
(see D5). A T&M milestone with **no tracked time** in its window has nothing to
bill and goes to `done` instead, which is terminal and carries no invoice.
`invoiced` and `done` are both terminal: later file states for that key are
ignored, so unticking a box never reverses anything. Cancelling a `ready`
milestone returns it to `pending`.

`folder_mappings` gains `billing_mode text not null default 'time'`.

`invoices` gains `brief_id text` and `milestone_id text` (both nullable, set only
on milestone invoices).

## D2. Brief ingestion (deterministic, no LLM)

**Designed against a real document.** `A Story To Tell Work Estimate.docx` was read
before this was written, and the earlier bullet-list design would have extracted
almost nothing from it — while happily turning its `Subtotal` rows and its summary
table into duplicate milestones, double-counting the money. What real estimates
look like here:

- **Tables**, not lists: `Work | Estimated time | Estimated cost`.
- **Ranges everywhere**: `2–3 hrs`, `$60–$90`. Single figures are the exception.
- **Two levels**: numbered sections, each with line items and a `Subtotal` row.
- **A summary table at the end** repeating each section's totals.
- **Prose that is not work**: assumptions, open questions, validity terms.
- **A section written as prose** rather than a table row ("Estimated time: 2–4 hours").
- **One rate stated once at the top** (`Rate: $30/hr`), not per line.

### Input

Two routes, both landing in the same confirm step:

1. **Paste text** into a textarea.
2. **Upload `.docx` / `.pdf` / `.md` / `.txt`.** Extraction runs server-side in the
   upload action. `.docx` is a zip — read `word/document.xml`, map `<w:p>` to a
   newline and `<w:tr>`/`<w:tc>` to a tab-delimited row, then strip tags. That
   keeps table structure legible to the parser without a heavyweight dependency.
   Reject anything over 2 MB. If extraction yields nothing, say so and offer the
   paste box rather than failing silently.

### `packages/core/src/brief.ts`

`parseBriefText(text): ParsedBrief` where
`ParsedBrief = { currency?: string; ratePerHour?: number; items: ParsedItem[]; warnings: string[] }`
and each item carries `section`, `title`, `hoursLow/High`, `amountLow/High`.

Rules, in order:

- **Rows before lines.** A tab-delimited row with 2–3 cells is a candidate: first
  cell is the title, the others are scanned for hours and money. Failing that, a
  line carrying both a duration and an amount is a candidate.
- **Ranges** are `A–B` on either en dash, em dash, hyphen or `to`, and set
  low/high. A single figure sets both ends equal.
- **Money**: `£1,200`, `$60`, `1200 GBP`, `€1.200,00`. The first symbol seen sets
  the brief's currency.
- **Hours**: `8h`, `8 hrs`, `8 hours`, `0.5 hr`, `~8h`, `(8h)`.
- **Rate**: a line matching `/rate[:\s]*[£$€]?\s*([\d.]+)\s*(?:\/|per )\s*h/i`
  sets `ratePerHour` for the whole brief.
- **Sections**: a numbered heading (`1. Moving to the Free + Pro Plans`) opens a
  section; subsequent items inherit it. Sections group the confirm table and
  prefix the milestone key, so two sections may reuse a title without clashing.
- **Skipped, and counted as skipped, never silently**: any row whose first cell
  matches `/^(sub)?total|^overall|^estimated (time|cost)$/i`, and every row after
  a heading matching `/^(overall|summary)/i` — that is the duplicate summary
  table. Each skip appends to `warnings` so the user sees what was dropped and
  why, rather than wondering where their rows went.
- **Prose is not work.** A candidate must carry an amount or a duration; a
  paragraph mentioning a number in passing does not qualify.

### The confirm step

The parse result is **always** shown in an editable table before saving; nothing
is created from a parse alone. The table shows section, title, hours low/high,
amount low/high, and a computed total the user can check against the document's
own stated total. `warnings` render above it. The user may edit any cell, delete
a row, or add one — a brief the parser fluffed is still a two-minute job by hand,
which is the point of never auto-saving.

Against the real estimate this should yield **13 items across 4 sections,
≈47.5–71 hrs, $1,425–$2,130**, with the four `Subtotal` rows and the summary
table skipped. That case belongs in the core tests as a fixture, so a future
parser change that starts double-counting fails loudly.

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

**Time & materials brief.** Completing a milestone issues an invoice for the
hours actually **tracked against that brief's folder** since the previous
milestone invoice, priced at the client's rate — not the estimate. The estimate
range is a burn-down warning, never the amount billed. This is the mode that
matches an estimate document saying "these are estimates rather than fixed-price
quotes": the client is billed for real work done, and the range is the promise
you made about roughly how much that would be.

- The window is `(milestone.billed_through_ms, now]`, and on issue the
  milestone's `billed_through_ms` is set to the cutoff, so the next milestone
  bills only what follows. This mirrors how week invoices already derive their
  window, so no time can be billed twice.
- The folder's `billing_mode` stays `'time'`, but **weekly auto-send must skip a
  folder that has an active T&M brief** — otherwise the same hours bill both
  weekly and at milestone completion. This is the T&M analogue of the
  fixed-price exclusion, and carries the same double-billing risk.
- Burn-down: green below `estimate_hours_low`, amber between low and high, red
  past `estimate_hours_high`. That threshold is what lets the user honour the
  "I'll flag anything looking likely to reach the top end before it becomes an
  issue" promise the estimate makes.

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

**`apps/web/drizzle/` does not describe the live database.** `week_adjustments`,
`round_mode` and `public_token` were all applied by hand-run SQL pasted from plan
documents and never made it into a migration file. Phase A needs no migration so
this is harmless today, but Phase B must **dump the live Neon schema first** and
author its migration against that, not against the `drizzle/` snapshots.

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
