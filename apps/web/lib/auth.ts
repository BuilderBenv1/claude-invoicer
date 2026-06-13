import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

/**
 * Single-user Google auth. Only OWNER_EMAIL may sign in; everyone else is
 * rejected at the signIn callback. JWT sessions (no DB adapter needed).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
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
