import Link from 'next/link';
import { auth, signOut } from '@/lib/auth';

const links = [
  { href: '/', label: 'Overview' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/settings', label: 'Settings' },
];

export async function Nav() {
  const session = await auth();
  const user = session?.user;

  return (
    <aside className="w-56 shrink-0 border-r border-slate-800 bg-panel/40 p-5 flex flex-col">
      <div className="mb-8">
        <div className="text-lg font-semibold">Claude Invoicer</div>
        <div className="text-xs text-slate-500">session time → invoices</div>
      </div>

      {user ? (
        <>
          <nav className="flex flex-col gap-1">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/60">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto pt-6 text-xs text-slate-500">
            <div className="truncate mb-2">{user.email}</div>
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/login' });
              }}
            >
              <button className="btn-ghost w-full" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </>
      ) : (
        <div className="text-xs text-slate-500">Not signed in</div>
      )}
    </aside>
  );
}
