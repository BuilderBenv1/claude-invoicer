# ניהול שעות ומשרד · Law-Firm Time & Billing

A focused hours-tracking and billing app for a law office, built around the way
Cake structures work — **Client → Case (project) → Task** — but trimmed to what a
small firm actually needs, with **Hebrew reports** built in.

It replaces the parts of a heavier tool you use every day:

- **Start / stop a timer** when you begin and finish a stretch of work. One timer
  runs at a time; stopping it books the time to a case (and, if you picked one, a
  task). Past work goes in as a **manual entry**.
- **Reports of how many hours went into a case / a client**, for any date range —
  viewed on screen, **exported to CSV** (opens in Excel with Hebrew intact), or
  **printed to PDF** straight from the browser (RTL Hebrew, no font hassle).
- **Automatic monthly report** emailed to an address you set — a per-client hours
  summary with a detailed CSV attached.
- **Hours alert per case**: set a threshold (e.g. 20h) and when the logged hours
  reach it, the **client is emailed automatically** — once per threshold.
- **Invoices**: create an invoice from a case's tracked billable hours for a
  period **and/or** one-off flat charges (fixed fees). Each invoice carries the
  firm **logo**, the **case number + name**, line items, and a total; print to
  PDF or email it to the client. Mark paid / unpaid.
- **Firm logo & case numbers**: upload a logo in Settings (shown on invoices and
  reports); give every case a number, a name, or both.

Everything is **RTL Hebrew by default** (switchable to English in Settings).

## How it maps to the requirements

| You asked for | Where it lives |
|---|---|
| Open a timer when I start, close it when I finish | Dashboard timer widget → `startTimer` / `stopTimer` |
| Export hours per case of a client | `/reports` → CSV / print, or per-case buttons |
| Reports in Hebrew | RTL report page + CSV with UTF-8 BOM; Hebrew emails |
| Send a report to a set email every month | Vercel cron → `/api/cron/monthly` → configured `reportEmail` |
| Alert at X hours in a case → inform client | Per-case `alertThresholdHours` → email to the client |
| Client · project · task structure | `clients` → `projects` (cases) → `tasks` |
| One-off invoices (like the Claude version) | `/invoices/new` — tracked hours and/or flat charges |
| Attach case numbers + logo | `projects.caseNumber`, `settings.logoUrl`, snapshotted onto invoices |

## Stack

Next.js 15 (App Router) · Drizzle ORM + Neon Postgres · Auth.js (Google, email
allowlist) · Resend (email) · Tailwind. Deploys to Vercel; the monthly report
runs on a daily Vercel Cron that fires once per new month.

## Data model

```
clients ──< projects (cases) ──< tasks
   └──────────< time_entries >───────┘   (denormalized client + project ids)
```

- A **time_entry** with `end_ms = NULL` is a running timer (a partial unique
  index allows only one at a time).
- **Billable hours** round each entry up to `round_increment_min` (default 6 min,
  the legal convention). Reports show both raw and billable hours.
- Rate resolution: case rate → client rate → firm default.

## Local development

```bash
npm install
npm run lawfirm            # from repo root — starts the dev server
# or, inside apps/lawfirm:
npm run dev
```

Copy `.env.example` to `.env` and fill it in (see **Setup** below). Run the
migration once against your database:

```bash
npm run db:migrate        # applies drizzle/ to DATABASE_URL
```

## Setup (deploy)

1. **Database** — create a Neon Postgres (e.g. via the Vercel Marketplace) and set
   `DATABASE_URL`. Run `npm run db:migrate`.
2. **Auth** — create a Google OAuth client; set `AUTH_SECRET`, `AUTH_GOOGLE_ID`,
   `AUTH_GOOGLE_SECRET`, and `OWNER_EMAIL` (comma-separated allowlist).
3. **Email** — add a Resend API key (`RESEND_API_KEY`) and a verified
   `EMAIL_FROM`. Set the recipient for monthly reports in **Settings → report
   email**.
4. **Cron** — set `CRON_SECRET`; `vercel.json` already schedules
   `/api/cron/monthly` daily. It sends the previous month's report on the first
   run of each new month (deduped via `last_monthly_sent_key`).

## Notes on Hebrew PDFs

PDF engines that embed only Latin fonts can't render Hebrew. Instead of fighting
font embedding, reports render as a clean **RTL HTML page** and you "Save as PDF"
from the browser — the result is a proper Hebrew document, and the same markup is
reused for the email body. CSV exports carry a UTF-8 BOM so Excel shows Hebrew
correctly.

## Common commands

```bash
npm run dev            # local dashboard
npm run build          # production build
npm run typecheck      # tsc --noEmit
npm run db:generate    # regenerate migrations from schema
npm run db:migrate     # apply migrations
```

## Defaults (editable in Settings)

Currency **ILS (₪)** · billing increment **6 min** · timezone **Asia/Jerusalem** ·
language **Hebrew**.
