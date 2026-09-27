import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

let dbInstance: PostgresJsDatabase<typeof schema> | null = null;

/**
 * Lazily create the Drizzle client over Supabase's transaction pooler (port
 * 6543). The pooler hands each transaction to whichever server connection is
 * free, so prepared statements can't survive between queries — `prepare: false`
 * is required, not an optimisation. Interactive transactions and row locks
 * still work: a transaction holds one connection until it commits.
 * Reads DATABASE_URL at call time so the module can be imported during build.
 */
export function getDb(): PostgresJsDatabase<typeof schema> {
  if (dbInstance) return dbInstance;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = postgres(url, { prepare: false });
  dbInstance = drizzle(client, { schema });
  return dbInstance;
}

export { schema };

/** The Drizzle client. */
export type Db = PostgresJsDatabase<typeof schema>;
/** A Drizzle transaction handle, as passed to `db.transaction(tx => ...)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/**
 * Either handle. Helpers that read rows take this so they can be called from
 * inside a transaction without loading a second connection's view of the data.
 */
export type DbOrTx = Db | Tx;
