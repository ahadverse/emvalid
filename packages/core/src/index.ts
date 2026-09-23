/**
 * @ev/core — the validation engine.
 *
 * No runtime dependencies: Node's own `dns` and `url` cover everything the
 * engine needs. Nothing in here touches a database, a queue or a file. That
 * boundary is what lets the same code run in an API route, in a bulk worker,
 * and in a test with a stubbed resolver.
 */

export type {
  Advice,
  DomainInfo,
  EmailFlags,
  EmailResult,
  MxProvider,
  ReasonCode,
  Status,
} from './types.ts';

export { canonicalize, normalizeAddress, splitAddress, type SplitAddress } from './normalize.ts';
export { checkSyntax, type SyntaxFailure, type SyntaxVerdict } from './syntax.ts';
export { classify, parseEmail, type ParsedEmail } from './classify.ts';
export type { SyntaxBad } from './syntax.ts';
export {
  explain,
  type Check,
  type CheckFact,
  type CheckId,
  type CheckOutcome,
} from './explain.ts';

export { DnsClient, acceptsMail, type DnsOptions } from './dns.ts';
export { DomainResolver, type DomainResolverOptions } from './domain-resolver.ts';
export {
  MemoryDomainCache,
  TieredDomainCache,
  type DomainCache,
  type MemoryCacheOptions,
} from './cache.ts';

export {
  Deduplicator,
  EmailValidator,
  type InspectedEmail,
  type ValidatorOptions,
} from './validator.ts';
export { SummaryBuilder, type JobSummary } from './summary.ts';

export { isRoleAccount } from './policy/role.ts';
export { isFreeProvider, freeProviderDomains } from './policy/free-providers.ts';
export {
  DisposableRegistry,
  disposableRegistry,
  isDisposable,
} from './policy/disposable.ts';
export { damerauLevenshtein, suggestDomain, type TypoSuggestion } from './policy/typo.ts';
export { detectMxProvider, smtpProbeIsUseless } from './policy/mx-provider.ts';
