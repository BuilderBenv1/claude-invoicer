import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { settings, type Settings } from './db/schema';

/** Read the singleton settings row, creating it with defaults if absent. */
export async function getSettings(): Promise<Settings> {
  const db = getDb();
  const existing = await db.select().from(settings).where(eq(settings.id, 1));
  if (existing[0]) return existing[0];
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  const created = await db.select().from(settings).where(eq(settings.id, 1));
  if (!created[0]) throw new Error('Failed to initialize settings');
  return created[0];
}
