# Claude Invoicer — Design Spec

**Date:** 2026-06-13
**Status:** Approved
**Repo:** https://github.com/BuilderBenv1/claude-invoicer

## Problem

Freelance work happens across many local folders driven by Claude Code sessions. There is
no reliable record of how much time was spent per client. We need to (1) measure real time
spent per project from Claude session transcripts, (2) attribute folders to clients, (3) turn
unbilled time into invoices, (4) reset the per-client clock on invoice issue, and (5) issue
receipts + mark invoices paid. Own/non-client projects must never be billed.

## Key insight: where the data lives

Every Claude Code session writes a transcript at:

```
~/.claude/projects/<encoded-folder>/<sessionId>.jsonl
```

Each message line is a JSON record containing, among other fields:

- `cwd` — the **real absolute working directory** (e.g. `C:\Users\theka\OneDrive\Desktop\bromley-scraper`).
  This is unambiguous; the dashed directory name is lossy and is NOT used.
- `timestamp` — millisecond-precision ISO-8601 on every `user`/`assistant`/`attachment` event.
- `sessionId`, `type`, `gitBranch`, etc.

The transcripts are the **immutable source of truth**. Time is always *recomputed* from them,
never guessed or hand-edited.

## Architecture (Hybrid: cloud dashboard + local agent)

Vercel (or any cloud) cannot read the local filesystem, so the timing MUST run locally. The
dashboard lives in the cloud for remote access and durable storage.

```
┌─────────────────────────── your PC ───────────────────────────┐
│  ~/.claude/projects/*/*.jsonl                                   │
│            │ (read-only scan, incremental)                      │
│            ▼                                                    │
│  apps/agent  ── Time Engine (packages/core) ──► activity rows   │
│            │  auto-started by Windows Scheduled Task at logon   │
└────────────┼───────────────────────────────────────────────────┘
             │ HTTPS POST /api/ingest   (device token; paths+durations only)
             ▼
┌─────────────────────────── Vercel ────────────────────────────┐
│  apps/web (Next.js App Router)                                  │
│   • Auth.js Google sign-in (single-email allowlist)            │
│   • Neon Postgres (Drizzle ORM)                                │
│   • Matcher + Billing (packages/core)                          │
│   • PDF (@react-pdf/renderer) → Vercel Blob (private)          │
└────────────────────────────────────────────────────────────────┘
```

### Monorepo layout (npm workspaces)

- `packages/core` — framework-free, unit-tested logic shared by agent + web.
- `apps/agent` — local scanner/uploader + Windows auto-start script.
- `apps/web` — Vercel dashboard.

## packages/core

### Time Engine (`time-engine.ts`)
- Input: a stream of `{ sessionId, cwd, timestampMs }` events.
- Group by `sessionId`; sort each group's events by time; merge concurrent subagent events
  into one timeline (dedupe → no double counting).
- **Active time** = sum of gaps between consecutive events, with any gap `> idleCapMs`
  treated as idle and contributing 0.
- If `cwd` changes mid-session, each gap is attributed to the `cwd` of its **earlier** event.
- Output: `ActivityInterval[]` = `{ sessionId, cwd, startMs, endMs, activeMs }`, one per
  contiguous run within a (session, cwd). A run ends at an idle gap or a cwd change.

### Matcher (`matcher.ts`)
- `normalizePath`: lowercases (Windows is case-insensitive), converts `\` → `/`, strips
  trailing slash. Drive letters normalized.
- `matchClient(cwd, mappings)`: longest-prefix match where `cwd === folder` OR
  `cwd` starts with `folder + "/"`. Returns the client id or `null` (unassigned → never billed).

### Billing (`billing.ts`)
- `weekKey(ms, tz)`: ISO week bucket (Mon–Sun) in the user's timezone.
- `aggregate(intervals, mappings, opts)`: returns per-client:
  - `byWeek`: map of weekKey → activeMs
  - `unbilledMs`: sum of activeMs for intervals with `startMs > billedThroughMs`
  - intervals straddling `billedThroughMs` are split exactly at the cutoff.
- `buildInvoiceLines(intervals, opts)`: groups unbilled time per project (or per week),
  rounds each line's hours **up** to `roundIncrementMin`, multiplies by `ratePerHour`.

## apps/agent

- `config.ts` — reads `~/.claude-invoicer/agent.json`: `{ apiBaseUrl, deviceToken, idleCapMin, scanIntervalMin }`.
- `cursor.ts` — persists per-file `{ size, mtimeMs, byteOffset }` to `~/.claude-invoicer/cursor.json`
  so each scan only reads appended bytes. If a file shrank/rotated, re-read from 0.
- `scanner.ts` — walks `~/.claude/projects/*/*.jsonl`, parses new lines (skips malformed,
  counts errors), emits events to the Time Engine.
- `uploader.ts` — batches `ActivityInterval[]`, POSTs to `/api/ingest` with
  `Authorization: Bearer <deviceToken>`. Idempotent: server upserts on `(sessionId, startMs)`.
- Resync: if the server responds `{ resync: true }` (idle cap changed), the agent clears the
  cursor and recomputes from all transcripts.
- `scripts/install-task.ps1` — registers a hidden Scheduled Task that runs the agent at logon
  and keeps it alive; `uninstall-task.ps1` removes it.

## apps/web

### Data model (Drizzle / Postgres)
- `clients` — id, name, hourlyRate, currency, billing details (your business identity is in `settings`).
- `folder_mappings` — id, clientId, normalizedPath, label.
- `activity_intervals` — sessionId, cwd, startMs, endMs, activeMs (upsert key `(sessionId, startMs)`).
- `invoices` — id, number, clientId, periodStart, periodEnd, billedThroughMs, status
  (`unpaid`/`paid`), subtotal, currency, pdfBlobKey, issuedAt, paidAt.
- `invoice_lines` — invoiceId, label, hours, rate, amount.
- `receipts` — id, invoiceId, number, pdfBlobKey, issuedAt.
- `client_billing_state` — clientId, billedThroughMs (the reset mark; = max(invoice.billedThroughMs)).
- `settings` — singleton: business name/address/logo/taxId, default idleCapMin (5),
  default roundIncrementMin (15), default currency (USD), timezone.

### Auth
- Auth.js v5 with Google provider. `signIn` callback rejects any email not equal to
  `OWNER_EMAIL` env. Single-user.

### API
- `POST /api/ingest` — Bearer device-token auth (`AGENT_TOKEN` env). Validates + upserts
  intervals. Returns `{ ok, resync }`.

### Pages
- **Overview** — client cards (this-week active time, unbilled balance, rate, amount owed) +
  Unassigned-folders panel with one-click assign-to-client.
- **Client detail** — sessions/intervals breakdown, week chart, per-client settings
  (rate, currency, folders, optional idle/rounding overrides).
- **Create invoice** — preview lines from unbilled balance → issue → PDF + status `unpaid` +
  advance `billedThroughMs`.
- **Invoices** — list + status; **Mark paid** → receipt PDF + status `paid`.
- **Settings** — business identity + defaults.

### PDFs
- `@react-pdf/renderer` renders invoice + receipt; stored privately in Vercel Blob; key in DB.

## Billing/reset semantics (precise)
- A client's **billed_through** mark starts at 0 (epoch).
- Issuing an invoice covers intervals in `(billed_through, cutoff]` where `cutoff = now` (or last
  event time). It snapshots lines and sets `billed_through = cutoff`. Idempotent and exact even
  as the agent appends new intervals later. "This week" is a *view filter*, not the billing basis.

## Defaults (all editable in Settings)
- Idle cap: 5 min · Rounding: 15 min (round up) · Currency: USD.

## Error handling & edges
- Malformed JSONL lines skipped + counted, surfaced in agent logs.
- Missing `~/.claude/projects` → agent no-ops with a warning; dashboard shows empty state.
- All times stored as epoch ms (UTC); displayed/bucketed in `settings.timezone`.
- Sessions straddling a billing cutoff are split exactly at the cutoff.
- Privacy: only folder paths + durations leave the machine — never transcript contents.

## Testing
- Vitest in `packages/core`: idle cap, concurrency dedupe, mid-session cwd change, cutoff split,
  rounding, week bucketing, longest-prefix Windows-path matching, multi-invoice reset.

## Manual setup (one-time, by the user)
1. Create Vercel project from the GitHub repo (root `apps/web`).
2. Add Neon Postgres from Vercel Marketplace (provides `DATABASE_URL`).
3. Create a Vercel Blob store (provides `BLOB_READ_WRITE_TOKEN`).
4. Create Google OAuth client; set `AUTH_GOOGLE_ID/SECRET`, `OWNER_EMAIL`, `AUTH_SECRET`.
5. Set `AGENT_TOKEN` (shared secret) in Vercel + local `agent.json`.
6. Run agent installer `scripts/install-task.ps1` to auto-start on logon.

Details in `SETUP.md`.
