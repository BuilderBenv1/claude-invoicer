import Link from 'next/link';
import { auth, signOut } from '@/lib/auth';
import { getSettings, localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';

export async function Nav() {
  const session = await auth();
  const user = session?.user;
  const s = await getSettings().catch(() => null);
  const locale = s ? localeOf(s) : 'he';

  const links = [
    { href: '/', label: t(locale, 'dashboard') },
    { href: '/clients', label: t(locale, 'clients') },
    { href: '/invoices', label: t(locale, 'invoices') },
    { href: '/reports', label: t(locale, 'reports') },
    { href: '/settings', label: t(locale, 'settings') },
  ];

  return (
    <aside className="w-56 shrink-0 border-e border-slate-800 bg-panel/40 p-5 flex flex-col">
      <div className="mb-8">
        <div className="text-lg font-semibold">{s?.firmName || t(locale, 'appName')}</div>
        <div className="text-xs text-slate-500">{t(locale, 'tagline')}</div>
      </div>

      {user ? (
        <>
          <nav className="flex flex-col gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/60"
              >
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
                {t(locale, 'signOut')}
              </button>
            </form>
          </div>
        </>
      ) : (
        <div className="text-xs text-slate-500">{t(locale, 'notSignedIn')}</div>
      )}
    </aside>
  );
}
