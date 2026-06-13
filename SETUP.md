# Setup

One-time setup for the hybrid deployment: a **Vercel dashboard** + a **local agent**. Plan on
~20 minutes. You'll create a Google OAuth client, a Neon database, and a Vercel project.

The code is already pushed to https://github.com/BuilderBenv1/claude-invoicer.

---

## 1. Generate the shared secrets

You need two random secrets. Generate them now and keep them handy:

```bash
# Auth.js session secret
npx auth secret        # prints AUTH_SECRET, or: openssl rand -base64 32

# Agent device token (any long random string)
openssl rand -hex 32
```

- `AUTH_SECRET` → encrypts your login session.
- `AGENT_TOKEN` → the password the local agent uses to upload. Must match on both sides.

---

## 2. Google OAuth client (for sign-in)

1. Go to https://console.cloud.google.com/apis/credentials (use your **new Google account**).
2. **Create credentials → OAuth client ID → Web application.**
3. Add **Authorized redirect URIs** (add the Vercel one after step 4 if you don't know the URL yet):
   - `http://localhost:3000/api/auth/callback/google`
   - `https://YOUR-APP.vercel.app/api/auth/callback/google`
4. Copy the **Client ID** → `AUTH_GOOGLE_ID` and **Client secret** → `AUTH_GOOGLE_SECRET`.

---

## 3. Vercel project + Neon database

1. https://vercel.com → **Add New → Project** → import `BuilderBenv1/claude-invoicer`.
2. **Root Directory: `apps/web`** (important — it's a monorepo). Framework auto-detects Next.js.
3. In **Project Settings → General**, set **Node.js Version to 22.x or 24.x**
   (the database driver needs a global `WebSocket`, which Node ≥ 21 provides).
4. **Storage → Create / Connect → Neon (Postgres)** from the Marketplace. This injects
   `DATABASE_URL` automatically.
5. **Settings → Environment Variables** — add the rest:

   | Name | Value |
   |------|-------|
   | `AUTH_SECRET` | from step 1 |
   | `AUTH_GOOGLE_ID` | from step 2 |
   | `AUTH_GOOGLE_SECRET` | from step 2 |
   | `OWNER_EMAIL` | your Google email (only this account can sign in) |
   | `AGENT_TOKEN` | from step 1 |

6. **Deploy.** Note your URL, e.g. `https://claude-invoicer.vercel.app`, and make sure that
   exact callback URL is in the Google client (step 2.3).

---

## 4. Create the database tables

Pull the production env locally and run the migration once:

```bash
npm i -g vercel          # if you don't have it
vercel link              # link this folder to the Vercel project
vercel env pull apps/web/.env.local
npm --prefix apps/web run db:migrate
```

(Or just `npm --prefix apps/web run db:push` to push the schema directly.)

---

## 5. Install the local agent (the part that does the tracking)

In an **elevated PowerShell** (Run as Administrator), from the repo root:

```powershell
./apps/agent/scripts/install-task.ps1 -ApiUrl "https://YOUR-APP.vercel.app" -Token "YOUR-AGENT_TOKEN"
```

This:
- writes `C:\Users\<you>\.claude-invoicer\agent.json` (your URL + token),
- registers a **hidden Scheduled Task** that starts at logon and self-restarts, and
- starts it immediately.

It scans every 5 minutes and uploads new activity. Verify a scan locally any time with:

```bash
npm run once --workspace @claude-invoicer/agent
```

To remove it later: `./apps/agent/scripts/uninstall-task.ps1`.

---

## 6. Use it

1. Open your Vercel URL and **Sign in with Google** (only `OWNER_EMAIL` is allowed).
2. **Settings** → set your business name/address/tax ID, currency, and timezone
   (e.g. `Asia/Jerusalem`).
3. **Overview** → under *Unassigned folders*, assign your client folders (assigning a top folder
   captures all its subfolders). Leave your own projects unassigned — they're never billed.
4. Set each client's **hourly rate** on their page.
5. When ready, **Issue invoice** → download the PDF → send it. When paid, **Mark paid &
   issue receipt** → download the receipt. Issuing resets that client's clock.

---

## Changing the idle cap

The idle cap is applied by the agent when it computes time. To change it:

```powershell
# edit C:\Users\<you>\.claude-invoicer\agent.json  -> "idleCapMin": 10
npm run resync --workspace @claude-invoicer/agent   # recompute all transcripts + replace server data
```

## Troubleshooting

- **No data on the dashboard** → run `npm run once --workspace @claude-invoicer/agent` and check
  for errors; confirm `apiBaseUrl`/`deviceToken` in `agent.json` match Vercel's `AGENT_TOKEN`.
- **Can't sign in** → the email must equal `OWNER_EMAIL`; the Google redirect URI must match
  your deployed URL exactly.
- **DB/transaction errors** → ensure the Vercel project's Node.js version is 22.x or newer.
- **Agent not running after reboot** → `Get-ScheduledTask ClaudeInvoicerAgent` to check status.
