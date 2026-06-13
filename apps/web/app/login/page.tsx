import { signIn, auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect('/');

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card w-full max-w-sm text-center">
        <h1 className="text-2xl font-semibold mb-1">Claude Invoicer</h1>
        <p className="text-sm text-slate-400 mb-6">Sign in to manage your time and invoices.</p>
        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/' });
          }}
        >
          <button className="btn-primary w-full" type="submit">
            Sign in with Google
          </button>
        </form>
        <p className="mt-4 text-xs text-slate-500">Only the configured owner account can access this dashboard.</p>
      </div>
    </div>
  );
}
