/**
 * Account administration from the command line.
 *
 * The bootstrap problem this exists to solve: the admin area is admin-only,
 * and a fresh database has no admin anybody can log in as. The 0003 migration
 * promotes the v1 seed owner to admin but leaves its password null on purpose
 * — an account with a default password is worse than one nobody can use. So
 * the first real admin is made here, from a shell on the server.
 *
 * Usage, from apps/web:
 *
 *   node --env-file-if-exists=../../.env scripts/account.ts create-admin <email> <password>
 *   node --env-file-if-exists=../../.env scripts/account.ts promote      <email>
 *   node --env-file-if-exists=../../.env scripts/account.ts set-password <email> <password>
 *   node --env-file-if-exists=../../.env scripts/account.ts grant        <email> <credits>
 *   node --env-file-if-exists=../../.env scripts/account.ts show         <email>
 *
 * A password on a command line lands in the shell history. For anything but a
 * first bootstrap, set a throwaway here and change it from the app.
 */

import {
  closeDatabase,
  createUser,
  creditBalance,
  EmailTakenError,
  findSubscription,
  findUserByEmail,
  grantCredits,
  setPasswordHash,
  setUserRole,
} from '@ev/db';
import { hashPassword } from '../lib/password-scrypt.ts';
import { passwordProblem } from '../lib/account-input.ts';

const [command, ...args] = process.argv.slice(2);

function die(message: string): never {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

async function main(): Promise<void> {
  switch (command) {
    case 'create-admin': {
      const [email, password] = args;
      if (email === undefined || password === undefined) {
        die('Usage: create-admin <email> <password>');
      }

      const problem = passwordProblem(password);
      if (problem !== null) die(problem);

      try {
        const user = await createUser({
          email,
          passwordHash: await hashPassword(password),
          role: 'admin',
          signupCredits: 0,
        });
        console.log(`✓ Created admin ${user.email} (${user.id})`);
      } catch (error) {
        if (error instanceof EmailTakenError) {
          die(`${email} already exists. Use "promote" and "set-password" instead.`);
        }
        throw error;
      }
      break;
    }

    case 'promote': {
      const [email] = args;
      if (email === undefined) die('Usage: promote <email>');

      const user = await findUserByEmail(email);
      if (user === null) die(`No account for ${email}.`);

      await setUserRole(user.id, 'admin');
      console.log(`✓ ${user.email} is now an admin`);
      break;
    }

    case 'set-password': {
      const [email, password] = args;
      if (email === undefined || password === undefined) {
        die('Usage: set-password <email> <password>');
      }

      const problem = passwordProblem(password);
      if (problem !== null) die(problem);

      const user = await findUserByEmail(email);
      if (user === null) die(`No account for ${email}.`);

      await setPasswordHash(user.id, await hashPassword(password));
      console.log(`✓ Password set for ${user.email}`);
      break;
    }

    case 'grant': {
      const [email, amount] = args;
      if (email === undefined || amount === undefined) die('Usage: grant <email> <credits>');

      const credits = Number(amount);
      if (!Number.isInteger(credits) || credits <= 0) die('Credits must be a whole number > 0.');

      const user = await findUserByEmail(email);
      if (user === null) die(`No account for ${email}.`);

      const balance = await grantCredits(user.id, credits, {
        reason: 'admin_adjustment',
        note: 'Granted from the command line',
      });
      console.log(`✓ ${user.email} now holds ${balance.toLocaleString('en-US')} credits`);
      break;
    }

    case 'show': {
      const [email] = args;
      if (email === undefined) die('Usage: show <email>');

      const user = await findUserByEmail(email);
      if (user === null) die(`No account for ${email}.`);

      const [balance, subscription] = await Promise.all([
        creditBalance(user.id),
        findSubscription(user.id),
      ]);

      console.log(
        JSON.stringify(
          {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            status: user.status,
            hasPassword: user.passwordHash !== null,
            credits: balance,
            plan: subscription?.planId ?? null,
            planStatus: subscription?.status ?? null,
            periodEnd: subscription?.currentPeriodEnd ?? null,
          },
          null,
          2,
        ),
      );
      break;
    }

    default:
      console.error(
        [
          'Commands:',
          '  create-admin <email> <password>',
          '  promote      <email>',
          '  set-password <email> <password>',
          '  grant        <email> <credits>',
          '  show         <email>',
        ].join('\n'),
      );
      process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  await closeDatabase();
}
