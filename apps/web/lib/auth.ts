import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

/**
 * Single-user Google auth. Only OWNER_EMAIL may sign in; everyone else is
 * rejected at the signIn callback. JWT sessions (no DB adapter needed).
 *
 * Required env: AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, OWNER_EMAIL.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Vercel sets the host; trust it so the callback URL resolves correctly.
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  callbacks: {
    signIn({ profile }) {
      const owner = process.env.OWNER_EMAIL?.toLowerCase().trim();
      if (!owner) return true; // not configured -> allow (local/dev)
      const email = profile?.email?.toLowerCase().trim();
      return email === owner;
    },
    authorized({ auth: session }) {
      return !!session?.user;
    },
  },
});
