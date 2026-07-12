export { auth as middleware } from '@/lib/auth';

// Protect everything except auth routes, the cron endpoint, the login page,
// and static assets.
export const config = {
  matcher: ['/((?!api/auth|api/cron|_next/static|_next/image|favicon.ico|login).*)'],
};
