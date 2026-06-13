import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

/**
 * Google auth gated by an email allowlist. OWNER_EMAIL is a comma-separated
 * list of allowed addresses (one for single-user, several to share). JWT
 * sessions (no DB adapter needed). Nothing personal is hardcoded — each
 * deployment sets its own OWNER_EMAIL.
 *
 * Required env: AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, OWNER_EMAIL.
 */
const allowedEmails = (process.env.OWNER_EMAIL ?? '')
  .toLowerCase()
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Vercel sets the host; trust it so the callback URL resolves correctly.
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Always show the Google account chooser instead of silently reusing
      // the last-used account.
      authorization: { params: { prompt: 'select_account' } },
    }),
  ],
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  callbacks: {
    signIn({ profile }) {
      if (allowedEmails.length === 0) return true; // not configured -> allow (local/dev)
      const email = profile?.email?.toLowerCase().trim();
      return !!email && allowedEmails.includes(email);
    },
    authorized({ auth: session }) {
      return !!session?.user;
    },
  },
});
