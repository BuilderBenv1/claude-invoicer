import './globals.css';
import type { Metadata } from 'next';
import { Nav } from '@/components/nav';
import { getSettings, localeOf } from '@/lib/settings';
import { dir } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'ניהול שעות ומשרד · Time & Practice',
  description: 'מדידת זמן לפי לקוח, תיק ומשימה — עם דוחות בעברית.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const s = await getSettings().catch(() => null);
  const locale = s ? localeOf(s) : 'he';
  return (
    <html lang={locale} dir={dir(locale)}>
      <body>
        <div className="min-h-screen flex">
          <Nav />
          <main className="flex-1 px-6 py-8">
            <div className="mx-auto w-full max-w-5xl">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
