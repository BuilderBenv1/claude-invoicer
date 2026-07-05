# Invoice Lifecycle: Adjustable Hours, Email Delivery & Client Self-Serve Payment

**Date:** 2026-07-05
**Status:** Approved (pending spec review)
**Project:** claude-invoicer (`apps/web`)

## Goal

Extend the per-week invoicing flow so the owner can (1) adjust a week's billable
hours before it is invoiced, (2) email invoices to clients — manually or on a
weekly cron — and (3) let clients mark their own invoice paid via a link, which
updates the owner's dashboard.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Adjust hours | **Quick +/- on the week**, persisted so both manual issue and cron respect it |
| Weekly cron | **Auto-issue + email clients** (fully hands-off), with a global on/off toggle |
| Client mark-paid | **Mark paid + issue receipt instantly** |
| Email provider | **Resend** (`help@punthub.co.uk` sender) |

### The reconciliation

"Quick adjust before issuing" and "hands-off auto-send" only coexist if the
adjustment is **saved on the week**, not entered at click-time. So the adjustment
is stored in a `week_adjustments` row and applied identically whether the owner
clicks "Invoice" or the cron issues it. The owner's window to adjust a week is
until the daily cron run fires for that (now-completed) week; if missed, deleting
the invoice frees the week to re-issue (existing behavior), and the stored
adjustment re-applies.

## Architecture

Five components, sharing the public-token + email infrastructure. All work is in
`apps/web` except the adjustment math, which is a pure function in
`packages/core`. A single low-level `insertInvoice(tx, {...})` helper (invoice row +
lines + `public_token` + sequence bump) backs all three issue paths — week invoices,
manual invoices, and one-off-only invoices — so numbering, tokens, and snapshots stay
consistent.

### Component 1 — Week hours adjustment

- **Storage:** new table `week_adjustments (client_id, week_start_ms, adjust_hours)`,
  PK `(client_id, week_start_ms)`. `adjust_hours` is a signed delta (can be negative).
- **Delta semantics (important):** `adjust_hours` is an **absolute hours delta applied to
  the week's tracked total at issue time** — NOT a snapshot of the hours when it was set,
  and NOT a percentage. Setting −1 h mid-week and then continuing to work means the final
  invoice bills `[full week tracked, rounded per project] − 1 h`. The delta "follows" the
  week until it is issued. Implementers must recompute tracked time at issue time and add
  the adjustment on top; they must never freeze the displayed total into the stored value.
- **Core:** a pure helper in `packages/core/src/billing.ts`:
  `adjustmentLine(adjustHours, ratePerHour)` → an `InvoiceLine`
  `{ label: 'Time adjustment', hours, ratePerHour, amount }` when `adjustHours !== 0`,
  else `null`. Amount = `round(adjustHours * ratePerHour * 100) / 100`, billed at the
  **client's default hourly rate**.
- **UI (client page, unbilled week rows only):** show current adjustment if set, plus
  a form with `−` / `+` buttons (step = the client's rounding increment in hours,
  e.g. 15 min → 0.25 h) and a number field to set an exact delta. The displayed week
  amount includes the adjustment line, and a small note ("adjusted +2.00 h") appears.
- **Action:** `adjustWeek(fd)` — reads `clientId`, `weekStart`, and either `delta`
  (buttons) or `set` (number); upserts `week_adjustments` (deletes the row when the
  resulting value is 0); revalidates.
- **At issue time:** after building the time lines, look up the week's adjustment; if
  non-zero, append the adjustment line (stored as a normal `invoice_lines` row) and
  include it in the subtotal. Guard: refuse to issue if the resulting subtotal < 0.

### Component 2 — Email delivery (Resend)

- Add `resend` dependency to `apps/web`.
- **`lib/email.ts`** — isolated Resend wrapper (swappable later; no heavy abstraction):
  - `sendInvoiceEmail(invoice, lines, to)`: builds a simple inline-styled HTML email
    (business name, amount due, billing period, a prominent **"View & pay invoice"**
    button → `${APP_BASE_URL}/i/{publicToken}`), attaches the invoice PDF (generated
    via the existing `lib/pdf/render.ts`), sends from `EMAIL_FROM`.
  - `sendReceiptEmail(invoice, receiptNumber, to)`: a short confirmation with the
    receipt PDF attached.
  - Throws a clear error only if `RESEND_API_KEY` is missing. A missing recipient is
    **not** an error (see below).
- **Email is optional and fires automatically on issue.** Emailing an invoice — whether
  from the manual "Invoice" button or the cron — is **best-effort**: if a recipient email
  is known, the invoice is emailed the moment it is issued; if not, the invoice still
  issues and is simply not sent. A send failure is surfaced as a warning but never rolls
  back or blocks the issue.
- **Recipient resolution + override.** The recipient defaults to the client's on-file
  email (an optional field). On the invoice detail page, an email control lets the owner
  **enter or edit the recipient and Send / Re-send** — for invoices issued with no email
  on file, or to reach a different address. The address actually sent to is stored in
  `emailed_to`; `emailed_at` records when.
- Action `emailInvoice(fd)` (invoiceId, optional `to`) — ensures a `public_token` exists
  (generates for old invoices), resolves recipient = `to || client email`, sends, sets
  `emailed_at` / `emailed_to`. The issue path and cron call the same underlying send
  helper so behavior is identical everywhere.

### Component 3 — Public client invoice page + instant mark-paid

- **Schema:** `invoices.public_token` (text, unique) — an unguessable token
  (≥128 bits) set on invoice creation and backfilled for existing rows.
- **Where the paid button lives:** the invoice email's call-to-action is a **link** to
  `/i/{token}` (the public page); the **"Mark as paid"** button is on that page, not
  inside the email. Rationale: email clients strip interactive/stateful buttons, and a
  raw state-changing "mark paid" link in an email body can be auto-triggered by spam
  scanners / link-preview prefetch, marking invoices paid without the client acting. One
  tap from the email opens the page; the button is one more tap.
- **Routes (unauthenticated):**
  - `/i/[token]/page.tsx` — client-facing invoice view (business identity, line items,
    total, status). If unpaid: **"Mark as paid"** button. If paid: "Paid on {date}" +
    "Download receipt". Always: "Download invoice PDF".
  - `/i/[token]/pdf/route.ts` — public invoice PDF by token.
  - `/i/[token]/receipt/route.ts` — public receipt PDF by token (only when paid).
- **Middleware:** extend the matcher to also bypass auth for `i/` and `api/cron`:
  `'/((?!api/ingest|api/auth|api/cron|i/|_next/static|_next/image|favicon.ico|login).*)'`
- **Action:** `markPaidPublic(fd)` — looks up the invoice by `token`, then runs the
  same paid+receipt transaction as the owner flow. Extract a shared
  `markPaidTx(tx, invoiceId, settings)` helper used by both `markInvoicePaid` and
  `markPaidPublic`. Idempotent (no-op if already paid). After committing, **emails the
  receipt** (best-effort) to `emailed_to ?? clientEmail` — graceful no-op if neither
  exists. Revalidates `/i/{token}`, `/`, `/invoices`, `/invoices/{id}`.
- The owner's own `markInvoicePaid` also emails the receipt (same best-effort helper),
  so a receipt goes out whether the client or the owner marks it paid.

### Component 4 — Weekly cron (auto-issue + email)

- **`apps/web/vercel.json`:** `{ "crons": [{ "path": "/api/cron/weekly", "schedule": "0 7 * * *" }] }`
  (daily 07:00 UTC — Vercel's free tier caps cron at once/day, which is also robust to
  timezone drift and missed runs).
- **`/api/cron/weekly/route.ts` (GET):**
  1. Verify `Authorization: Bearer ${CRON_SECRET}` (Vercel sends this automatically when
     `CRON_SECRET` is set); 401 on mismatch.
  2. If `settings.auto_send_weekly` is off → return a no-op summary.
  3. Determine the **previous completed week** in `settings.timezone`.
  4. For each active client (`archived = 0`) with an email:
     - Skip if that week is already invoiced (idempotent).
     - Issue the invoice for the week (respecting the saved adjustment **and** unbilled
       one-off charges), then email it and set `emailed_at`.
     - Skip if there is nothing to bill (no time, no one-offs, no adjustment).
     - Wrap each client in try/catch so one failure doesn't abort the batch.
  5. Return a JSON summary `{ issued, skipped, errors }`.
- **Refactor:** extract the transaction body of the current `issueInvoice` into a
  reusable `issueWeekInvoice(clientId, weekStart, { includeOneOffs })` used by both the
  manual action (then redirect) and the cron (in a loop).
- **Toggle:** add `auto_send_weekly` to Settings with a checkbox in the Settings page.
  Clients without an email are always skipped. No per-client toggle (global only; easy
  to add later).

### Component 5 — Bill one-off charges on their own

For clients billed fixed fees with little or no tracked time, one-off charges shouldn't
have to wait to "ride along" with a tracked week.

- **UI (client page, one-off charges section):** when the client has unbilled one-off
  charges, show the total and a **"Bill one-offs now"** button.
- **Action `billOneOffs(fd)` (clientId):** in a transaction, gather the client's unbilled
  one-off charges, create an invoice from them via `insertInvoice` with the week-window
  fields set to `-1` (not a tracked week — same convention as manual invoices, so it never
  collides with a real week start), mark those charges `billedInvoiceId`, then fire the
  invoice email (best-effort, same helper as every other path). Errors if there are no
  unbilled one-offs.
- Behaves like any other invoice thereafter: public link, client mark-paid, receipt email,
  and deleting it returns its one-off charges to the unbilled pool (existing
  `deleteInvoice` already clears `billedInvoiceId` for the invoice).

## Schema changes (run in Neon SQL editor — matches current deploy flow)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- invoices: public link token + email send record
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS public_token text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS emailed_to text;
UPDATE invoices SET public_token = encode(gen_random_bytes(18), 'hex') WHERE public_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_public_token_unique ON invoices(public_token);

-- settings: weekly auto-send toggle
ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_send_weekly integer NOT NULL DEFAULT 0;

-- per-week hours adjustment
CREATE TABLE IF NOT EXISTS week_adjustments (
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_start_ms bigint NOT NULL,
  adjust_hours double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, week_start_ms)
);
```

`lib/db/schema.ts` is updated to match (Drizzle types), but migrations are applied
manually in Neon (no local `DATABASE_URL` / no drizzle CLI, per the current workflow).

## Env & config

New environment variables (set in Vercel Production + Preview, and local `.env.local`;
actual values stored outside the repo, never committed):

- `RESEND_API_KEY` — Resend API key
- `EMAIL_FROM` — `help@punthub.co.uk`
- `APP_BASE_URL` — canonical prod URL for building invoice links (e.g.
  `https://claude-invoicer-web.vercel.app`)
- `CRON_SECRET` — random secret; Vercel sends it as the cron request's bearer token

`apps/web/.env.example` is updated with the new names (no values).

## Security

- Public invoice access is gated by an unguessable per-invoice token (standard
  invoice-link model — Stripe, etc.). Anyone with the link can view and mark paid;
  only the intended client receives the link.
- Cron endpoint requires the `CRON_SECRET` bearer token; it is excluded from auth
  middleware but self-guards.
- Mark-paid is idempotent and only ever transitions unpaid → paid.
- Secrets live only in env vars; `.env*` is gitignored and the spec references names only.

## Testing

- **`packages/core`:** unit tests for `adjustmentLine` (positive / negative / zero /
  rounding) — TDD.
- **Manual (deployed Preview/Prod, since there is no local DB):** adjust a week → issue
  → email to self → open public link → mark paid → confirm the dashboard flips to paid
  and a receipt exists → trigger the cron manually (`curl` with the bearer) against a
  test client and confirm one invoice is issued + emailed, and a second run is a no-op.

## Deployment steps

1. Run the SQL above in the Neon SQL editor.
2. Set the four env vars in Vercel (Production + Preview).
3. Verify the `punthub.co.uk` domain in Resend so `help@punthub.co.uk` can send.
4. Push to `main` → Vercel auto-deploys (cron registers from `vercel.json`).
5. Turn on "Enable weekly auto-send" in Settings when ready.

## Out of scope (YAGNI)

- Stripe / real payment processing (mark-paid stays a manual self-report).
- Per-client auto-send toggle (global only).
- Partial payments, dunning/reminders, multi-currency conversion, email open tracking,
  custom PDF/email theming.

## Assumptions (flag if wrong)

- (a) The cron auto-sends the **previous completed week**; the adjust window is "before
  the daily run fires."
- (b) Unbilled one-off charges are **included** on cron-issued invoices.
- The hours adjustment is billed at the client's **default** hourly rate (not a
  per-folder blend).
- A public-link holder is trusted to view and mark the invoice paid.
