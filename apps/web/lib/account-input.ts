/**
 * Validation for the two forms that create or open an account.
 *
 * No `server-only` and no imports that reach a database: the signup page runs
 * the same checks in the browser so a typo is caught before a round trip, and
 * the routes run them again because a browser check is a courtesy, never a
 * control.
 */

export interface Fields {
  email: string;
  password: string;
  name?: string;
}

export type FieldName = 'email' | 'password' | 'name';

export interface FieldProblem {
  field: FieldName;
  message: string;
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;
export const NAME_MAX_LENGTH = 80;
export const EMAIL_MAX_LENGTH = 254;

/**
 * Deliberately permissive.
 *
 * This is a login field, not the product. The engine in @ev/core does real RFC
 * 5322 validation for addresses a customer is *paying* us to judge; rejecting
 * somebody's own working address at the door because our regex is stricter
 * than their mail provider is a lost account, not a caught mistake.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function emailProblem(raw: string): string | null {
  const email = raw.trim();
  if (email.length === 0) return 'Enter your email address.';
  if (email.length > EMAIL_MAX_LENGTH) return 'That address is too long.';
  if (!EMAIL_SHAPE.test(email)) return 'That does not look like an email address.';
  return null;
}

/**
 * Length only, plus the handful of passwords that are genuinely everybody's.
 *
 * No character-class rules. "One uppercase, one digit, one symbol" pushes
 * people to `Password1!` and is weaker than a longer passphrase, which is why
 * NIST withdrew that advice. The ceiling exists because the KDF hashes
 * whatever it is given and a 10 MB "password" is a free denial of service.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'That password is on every breach list there is. Pick another.';
  }
  return null;
}

export function nameProblem(name: string): string | null {
  if (name.trim().length > NAME_MAX_LENGTH) return `Use at most ${NAME_MAX_LENGTH} characters.`;
  return null;
}

/** Every problem at once, so a form reports all of them in one pass. */
export function signupProblems(fields: Fields): FieldProblem[] {
  const problems: FieldProblem[] = [];

  const email = emailProblem(fields.email);
  if (email !== null) problems.push({ field: 'email', message: email });

  const password = passwordProblem(fields.password);
  if (password !== null) problems.push({ field: 'password', message: password });

  const name = nameProblem(fields.name ?? '');
  if (name !== null) problems.push({ field: 'name', message: name });

  return problems;
}

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd123',
  '1234567890',
  '12345678910',
  'qwertyuiop',
  'iloveyou123',
  'letmein123',
  'admin12345',
  'welcome123',
  'abc123456789',
]);
