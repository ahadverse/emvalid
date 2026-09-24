import 'server-only';

/**
 * The guarded door onto lib/password-scrypt.ts.
 *
 * Application code imports *this* module, and the `server-only` marker above
 * makes a build fail loudly the moment a client component reaches for password
 * hashing — which is the mistake worth catching, because it would ship the
 * verification logic to the browser.
 *
 * The implementation itself sits next door without the marker for one reason:
 * `server-only` throws in plain Node, and scripts/account.ts is plain Node. A
 * bootstrap CLI that cannot create the first admin because of a bundler hint
 * is a guard protecting nothing at the cost of the thing it guards.
 *
 * That file is not unprotected either — it imports `node:crypto`, which no
 * browser bundle can resolve.
 */
export { hashPassword, needsRehash, verifyPassword } from './password-scrypt';
