import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit is here to *generate* SQL from schema changes, not to apply it.
 * Applying is `src/migrate.ts`, which takes an advisory lock — several
 * processes boot at once on a single VPS and would otherwise race.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/email_validator',
  },
  strict: true,
  verbose: true,
});
