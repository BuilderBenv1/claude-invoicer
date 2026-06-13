export { auth as middleware } from '@/lib/auth';

// Protect everything except the agent ingest endpoint, the auth routes,
// the login page, and Next static assets.
export const config = {
  matcher: ['/((?!api/ingest|api/auth|_next/static|_next/image|favicon.ico|login).*)'],
};
