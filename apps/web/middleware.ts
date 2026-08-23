export { auth as middleware } from '@/lib/auth';

// Protect everything except the endpoints that carry their own authentication
// and the public surfaces: the agent's ingest + brief-sync routes (Bearer
// AGENT_TOKEN), the cron endpoint (Bearer CRON_SECRET), the auth routes, the
// public invoice pages (/i/...), the login page, and static assets.
//
// `api/agent` MUST stay excluded. The local agent authenticates with a bearer
// token and holds no session cookie, so leaving it in the matcher makes the
// middleware redirect it to /login and the milestone sync silently never runs.
export const config = {
  matcher: [
    '/((?!api/ingest|api/agent|api/auth|api/cron|i/|_next/static|_next/image|favicon.ico|login).*)',
  ],
};
