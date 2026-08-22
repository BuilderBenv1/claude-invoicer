import { Pool } from '@neondatabase/serverless';
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

let dbInstance: NeonDatabase<typeof schema> | null = null;

/**
 * Lazily create the Drizzle client. Uses the Neon serverless Pool (WebSocket)
 * so interactive transactions work; Node 22+/Vercel provide a global WebSocket.
 * Reads DATABASE_URL at call time so the module can be imported during build.
 */
export function getDb(): NeonDatabase<typeof schema> {
  if (dbInstance) return dbInstance;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: url });
  dbInstance = drizzle(pool, { schema });
  return dbInstance;
}

export { schema };

/** The Drizzle client. */
export type Db = NeonDatabase<typeof schema>;
/** A Drizzle transaction handle, as passed to `db.transaction(tx => ...)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/**
 * Either handle. Helpers that read rows take this so they can be called from
 * inside a transaction without loading a second connection's view of the data.
 */
export type DbOrTx = Db | Tx;
