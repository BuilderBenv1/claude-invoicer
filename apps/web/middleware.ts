export { auth as middleware } from '@/lib/auth';

// Protect everything except the agent ingest endpoint, the cron endpoint, the
// auth routes, the public invoice pages (/i/...), the login page, and static assets.
export const config = {
  matcher: ['/((?!api/ingest|api/auth|api/cron|i/|_next/static|_next/image|favicon.ico|login).*)'],
};
