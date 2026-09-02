-- P2.0.3 external session federation (ADR-0031) — the Security session gains an optional mirror of the
-- upstream identity provider's session id (Kratos/OIDC `sid`), so a request carrying an IdP session can
-- resolve its Security session. Additive and backward compatible: the column is nullable, every existing
-- row stays a Security-native session (external_ref IS NULL), and no existing lookup changes.
--
-- The index is deliberately NON-unique: an upstream id is unique per live session, but a mirror is never
-- deleted (sessions are append-only history — revoked/expired rows are retained for audit), so a re-login
-- reusing an upstream id must be able to coexist with its retired predecessors. The federation lookup
-- resolves the most recently established match (ORDER BY established_at DESC).

ALTER TABLE "security"."sessions" ADD COLUMN "external_ref" TEXT;

CREATE INDEX "sessions_external_ref_idx" ON "security"."sessions" ("tenant_id", "external_ref");
