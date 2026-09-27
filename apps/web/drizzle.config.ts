import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // The database is shared with another project. Without this, drizzle-kit
  // treats `public` as its own and would offer to drop that project's tables.
  schemaFilter: ['invoicer'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
