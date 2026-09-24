import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/**
 * Next only reads `.env` from this app's own directory, but the worker and the
 * web app must agree on DATABASE_URL and DATA_DIR — two copies of that pair is
 * exactly how a download ends up looking in the wrong directory. So the
 * repo-root file is loaded here, and anything already in the environment wins
 * over it (which is what `loadEnvFile` does).
 */
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

try {
  process.loadEnvFile(`${repoRoot}.env`);
} catch {
  // No root .env — fine in production, where the platform supplies the values.
}

/**
 * Absolutised here, in the one file that is loaded from its real location
 * rather than from a bundle, so both processes land on the same directory
 * whatever they were started from.
 */
if (process.env.DATA_DIR !== undefined && !isAbsolute(process.env.DATA_DIR)) {
  process.env.DATA_DIR = resolve(repoRoot, process.env.DATA_DIR);
}

/**
 * Upload never goes through a Server Action — a 600 MB action payload is
 * buffered before the handler sees it. `app/api/upload/route.ts` reads the
 * request body as a stream instead, which is why no body size limit is
 * configured here: there is nothing to raise.
 */
const config: NextConfig = {
  // The workspace packages ship TypeScript source, not a build. Next has to
  // compile them itself.
  transpilePackages: ['@ev/core', '@ev/db'],

  // pnpm workspaces put node_modules above the app; without this Next guesses
  // the wrong root and traces the wrong files into the standalone output.
  // fileURLToPath rather than `.pathname` — the latter yields "/E:/A%20B" on
  // Windows, which is not a path anything can open.
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),

  // @ev/db holds a connection pool keyed on globalThis. Bundling `pg` would
  // give each bundle chunk its own copy of the driver and defeat that.
  serverExternalPackages: ['pg'],
};

export default config;
