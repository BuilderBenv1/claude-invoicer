import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { settings, type Settings } from './db/schema';
import type { Locale } from './i18n';

/** Fetch the singleton settings row, creating it with defaults on first use. */
export async function getSettings(): Promise<Settings> {
  const db = getDb();
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (row) return row;
  const [created] = await db.insert(settings).values({ id: 1 }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await db.select().from(settings).where(eq(settings.id, 1));
  return again!;
}

export function localeOf(s: Settings): Locale {
  return s.locale === 'en' ? 'en' : 'he';
}
