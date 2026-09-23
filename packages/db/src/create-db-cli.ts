import { Client } from 'pg';

/**
 * `pnpm --filter @ev/db db:create`
 *
 * Creates the database named in DATABASE_URL, connecting to the server's
 * default `postgres` database to do it. `CREATE DATABASE` cannot run inside a
 * transaction or from a connection to the database being created, which is why
 * this is a separate step from `db:migrate` rather than part of it.
 */

const url = process.env.DATABASE_URL;
if (url === undefined || url.trim() === '') {
  console.error('DATABASE_URL is not set.');
  process.exit(2);
}

const parsed = new URL(url);
const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
if (name === '') {
  console.error(`No database name in DATABASE_URL: ${parsed.protocol}//…/`);
  process.exit(2);
}

const admin = new Client({
  host: parsed.hostname,
  port: parsed.port === '' ? 5432 : Number(parsed.port),
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: 'postgres',
  connectionTimeoutMillis: 8000,
});

await admin.connect();

const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);

if (rows.length > 0) {
  console.log(`Database "${name}" already exists.`);
} else {
  // The name comes from our own connection string, but it still goes through
  // an identifier quote rather than string interpolation.
  await admin.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
  console.log(`Created database "${name}".`);
}

await admin.end();
