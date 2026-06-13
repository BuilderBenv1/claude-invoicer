# Claude Invoicer

Turn the time you spend in Claude Code into client invoices — automatically.

Every Claude Code session writes a transcript to `~/.claude/projects/<folder>/<id>.jsonl`,
and every message records the **real working directory** (`cwd`) and a millisecond
**timestamp**. Claude Invoicer reads those transcripts, reconstructs how long you actually
worked in each folder, maps folders to clients, and lets you issue invoices + receipts from a
dashboard. Your own projects stay unassigned and are never billed.

> Validated on a real machine: **427 transcripts → 85h of idle-capped active time across 26
> folders, 0 bad lines.**

## How it works

```
┌───────────────────────── your PC ──────────────────────────┐
│  ~/.claude/projects/*/*.jsonl                               │
│        │  (read-only, incremental)                          │
│        ▼                                                    │
│  apps/agent  ──Time Engine──►  activity intervals           │
│        │   hidden Scheduled Task, auto-starts at logon      │
└────────┼────────────────────────────────────────────────────┘
         │  HTTPS POST /api/ingest  (device token; paths + durations only)
         ▼
┌───────────────────────── Vercel ───────────────────────────┐
│  apps/web (Next.js)                                         │
│   Google sign-in · Neon Postgres · invoices/receipts (PDF) │
└─────────────────────────────────────────────────────────────┘
```

**Time is measured, not guessed.** Active time = the sum of gaps between session events, with
any gap longer than the idle cap (default 5 min) treated as a break and excluded. Invoice lines
round each project up to the nearest increment (default 15 min) × the client's hourly rate.
Issuing an invoice advances the client's `billed_through` mark — that's the "reset the clock".

**Privacy:** the agent only ever uploads folder paths + durations. Transcript contents never
leave your machine.

## Repo layout

| Path | What |
|------|------|
| `packages/core` | Framework-free Time Engine, folder Matcher, Billing. 29 unit tests. |
| `apps/agent` | Local scanner/uploader + Windows auto-start scripts. |
| `apps/web` | Next.js dashboard deployed to Vercel. |
| `docs/specs/` | The design spec. |

## Quick start

```bash
npm install
npm test                                   # core unit tests (no setup needed)
npm run dry-run --workspace @claude-invoicer/agent   # preview your tracked time, uploads nothing
```

The dry run prints active time per folder straight from your transcripts — try it first, it
needs no accounts.

To run the full system (dashboard + syncing agent), follow **[SETUP.md](./SETUP.md)**:
deploy to Vercel, add Neon Postgres + Google sign-in, then install the local agent.

## Common commands

```bash
# Agent (local)
npm run dry-run  --workspace @claude-invoicer/agent   # preview, no upload
npm run once     --workspace @claude-invoicer/agent   # one scan + upload
npm run start    --workspace @claude-invoicer/agent   # continuous loop
npm run resync   --workspace @claude-invoicer/agent   # recompute everything + replace server data

# Web (in apps/web)
npm run dev          # local dashboard
npm run build        # production build
npm run db:migrate   # apply migrations to DATABASE_URL
```

## Defaults (editable)

Idle cap **5 min** (agent) · rounding **15 min** (per invoice line) · currency **USD**.
