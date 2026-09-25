-- Feature 66: parked domain detection.
--
-- Nullable, no default. A row written before this migration has no opinion
-- on whether its domain was parked — it was never checked, which is not the
-- same claim as "not parked" — so it must come back NULL, not false.
-- `rowToDomainInfo` in domain-cache.ts reads that NULL straight through to
-- `DomainInfo.parked`, where `null` already means exactly this.

ALTER TABLE domain_cache
  ADD COLUMN parked boolean;
