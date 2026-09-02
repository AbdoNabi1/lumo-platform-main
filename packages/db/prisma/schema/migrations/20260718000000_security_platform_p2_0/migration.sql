-- Phase-2 hardening G-SEC-1 — Security Platform durable persistence (services/security, ADR-0023).
-- Additive: a new `security` schema + its tables; nothing existing is dropped or renamed. Conventions:
-- UUID PKs, tenant_id on every row, version optimistic lock (except the append-only WORM ledger + relation
-- tuples), JSONB for value-objects/collections, no cross-context FKs.

CREATE SCHEMA IF NOT EXISTS "security";

-- ── Identity ──────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "security"."principals" (
  "id"           UUID PRIMARY KEY,
  "tenant_id"    TEXT NOT NULL,
  "external_id"  TEXT NOT NULL,
  "kind"         TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "subject_ref"  TEXT,
  "tenant_ref"   TEXT,
  "status"       TEXT NOT NULL,
  "attributes"   JSONB NOT NULL DEFAULT '{}',
  "version"      INTEGER NOT NULL DEFAULT 0,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "principals_tenant_external_key" ON "security"."principals" ("tenant_id", "external_id");
CREATE INDEX "principals_kind_idx" ON "security"."principals" ("tenant_id", "kind");
CREATE INDEX "principals_subject_idx" ON "security"."principals" ("tenant_id", "subject_ref");

CREATE TABLE "security"."credentials" (
  "id"              UUID PRIMARY KEY,
  "tenant_id"       TEXT NOT NULL,
  "principal_ref"   TEXT NOT NULL,
  "kind"            TEXT NOT NULL,
  "fingerprint"     TEXT NOT NULL,
  "kms_key_ref"     TEXT,
  "status"          TEXT NOT NULL,
  "supersedes_ref"  TEXT,
  "issued_at"       TIMESTAMP(3) NOT NULL,
  "expires_at"      TIMESTAMP(3),
  "rotation_policy" JSONB,
  "rotation_due_at" TIMESTAMP(3),
  "grace_until"     TIMESTAMP(3),
  "version"         INTEGER NOT NULL DEFAULT 0,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL
);
CREATE INDEX "credentials_principal_idx" ON "security"."credentials" ("tenant_id", "principal_ref");
CREATE INDEX "credentials_rotation_idx" ON "security"."credentials" ("tenant_id", "status", "rotation_due_at");

CREATE TABLE "security"."sessions" (
  "id"                 UUID PRIMARY KEY,
  "tenant_id"          TEXT NOT NULL,
  "principal_ref"      TEXT NOT NULL,
  "status"             TEXT NOT NULL,
  "device_ref"         TEXT,
  "refresh_fingerprint" TEXT NOT NULL,
  "refresh_count"      INTEGER NOT NULL DEFAULT 0,
  "risk_at_last_eval"  INTEGER NOT NULL DEFAULT 0,
  "impersonated_by"    TEXT,
  "delegation_ref"     TEXT,
  "established_at"     TIMESTAMP(3) NOT NULL,
  "last_seen_at"       TIMESTAMP(3) NOT NULL,
  "expires_at"         TIMESTAMP(3) NOT NULL,
  "version"            INTEGER NOT NULL DEFAULT 0,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL
);
CREATE INDEX "sessions_principal_idx" ON "security"."sessions" ("tenant_id", "principal_ref");
CREATE INDEX "sessions_status_idx" ON "security"."sessions" ("tenant_id", "status");

CREATE TABLE "security"."devices" (
  "id"            UUID PRIMARY KEY,
  "tenant_id"     TEXT NOT NULL,
  "fingerprint"   TEXT NOT NULL,
  "principal_ref" TEXT,
  "tenant_ref"    TEXT,
  "trust_level"   TEXT NOT NULL,
  "reputation"    INTEGER NOT NULL DEFAULT 50,
  "metadata"      JSONB NOT NULL DEFAULT '{}',
  "signals"       JSONB NOT NULL DEFAULT '[]',
  "anomaly_count" INTEGER NOT NULL DEFAULT 0,
  "first_seen_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at"  TIMESTAMP(3) NOT NULL,
  "version"       INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "devices_tenant_fingerprint_key" ON "security"."devices" ("tenant_id", "fingerprint");
CREATE INDEX "devices_principal_idx" ON "security"."devices" ("tenant_id", "principal_ref");
CREATE INDEX "devices_trust_idx" ON "security"."devices" ("tenant_id", "trust_level");

CREATE TABLE "security"."mfa_enrollments" (
  "id"                 UUID PRIMARY KEY,
  "tenant_id"          TEXT NOT NULL,
  "principal_ref"      TEXT NOT NULL,
  "method"             TEXT NOT NULL,
  "status"             TEXT NOT NULL,
  "secret_ref"         TEXT,
  "backup_code_hashes" JSONB NOT NULL DEFAULT '[]',
  "device_ref"         TEXT,
  "activated_at"       TIMESTAMP(3),
  "created_at_domain"  TIMESTAMP(3) NOT NULL,
  "version"            INTEGER NOT NULL DEFAULT 0,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL
);
CREATE INDEX "mfa_enrollments_principal_idx" ON "security"."mfa_enrollments" ("tenant_id", "principal_ref");

-- ── Authorization ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "security"."roles" (
  "id"          UUID PRIMARY KEY,
  "tenant_id"   TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "scope"       JSONB NOT NULL DEFAULT '{}',
  "permissions" JSONB NOT NULL DEFAULT '[]',
  "parent_key"  TEXT,
  "is_template" BOOLEAN NOT NULL DEFAULT FALSE,
  "status"      TEXT NOT NULL,
  "version"     INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "roles_tenant_key_key" ON "security"."roles" ("tenant_id", "key");
CREATE INDEX "roles_status_idx" ON "security"."roles" ("tenant_id", "status");

CREATE TABLE "security"."role_assignments" (
  "id"            UUID PRIMARY KEY,
  "tenant_id"     TEXT NOT NULL,
  "principal_ref" TEXT NOT NULL,
  "role_key"      TEXT NOT NULL,
  "scope"         JSONB NOT NULL DEFAULT '{}',
  "granted_by"    TEXT NOT NULL,
  "status"        TEXT NOT NULL,
  "expires_at"    TIMESTAMP(3),
  "reason"        TEXT,
  "granted_at"    TIMESTAMP(3) NOT NULL,
  "version"       INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL
);
CREATE INDEX "role_assignments_principal_idx" ON "security"."role_assignments" ("tenant_id", "principal_ref");
CREATE INDEX "role_assignments_role_idx" ON "security"."role_assignments" ("tenant_id", "role_key");

CREATE TABLE "security"."relation_tuples" (
  "id"         UUID PRIMARY KEY,
  "tenant_id"  TEXT NOT NULL,
  "namespace"  TEXT NOT NULL,
  "object"     TEXT NOT NULL,
  "relation"   TEXT NOT NULL,
  "subject"    TEXT NOT NULL,
  "tuple_key"  TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "relation_tuples_tenant_key_key" ON "security"."relation_tuples" ("tenant_id", "tuple_key");
CREATE INDEX "relation_tuples_lookup_idx" ON "security"."relation_tuples" ("tenant_id", "namespace", "object", "relation");

-- ── Policy + delegation ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "security"."policies" (
  "id"             UUID PRIMARY KEY,
  "tenant_id"      TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "mode"           TEXT NOT NULL,
  "status"         TEXT NOT NULL,
  "versions"       JSONB NOT NULL DEFAULT '[]',
  "active_version" INTEGER,
  "version"        INTEGER NOT NULL DEFAULT 0,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "policies_tenant_key_key" ON "security"."policies" ("tenant_id", "key");
CREATE INDEX "policies_status_idx" ON "security"."policies" ("tenant_id", "status");

CREATE TABLE "security"."delegations" (
  "id"            UUID PRIMARY KEY,
  "tenant_id"     TEXT NOT NULL,
  "delegator_ref" TEXT NOT NULL,
  "delegate_ref"  TEXT NOT NULL,
  "scope"         JSONB NOT NULL DEFAULT '{}',
  "permissions"   JSONB NOT NULL DEFAULT '[]',
  "status"        TEXT NOT NULL,
  "expires_at"    TIMESTAMP(3),
  "reason"        TEXT,
  "granted_at"    TIMESTAMP(3) NOT NULL,
  "version"       INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL
);
CREATE INDEX "delegations_delegate_idx" ON "security"."delegations" ("tenant_id", "delegate_ref");
CREATE INDEX "delegations_delegator_idx" ON "security"."delegations" ("tenant_id", "delegator_ref");

-- ── Tenant + machine + AI governance ─────────────────────────────────────────────────────────────
CREATE TABLE "security"."tenant_profiles" (
  "id"                  UUID PRIMARY KEY,
  "tenant_id"           TEXT NOT NULL,
  "tenant_ref"          TEXT NOT NULL,
  "isolation_tier"      TEXT NOT NULL,
  "residency_region"    TEXT NOT NULL,
  "security_mode"       TEXT NOT NULL,
  "mfa_required"        BOOLEAN NOT NULL DEFAULT FALSE,
  "allowed_auth_methods" JSONB NOT NULL DEFAULT '[]',
  "default_policy_key"  TEXT,
  "version"             INTEGER NOT NULL DEFAULT 0,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "tenant_profiles_tenant_ref_key" ON "security"."tenant_profiles" ("tenant_id", "tenant_ref");

CREATE TABLE "security"."machine_identities" (
  "id"                       UUID PRIMARY KEY,
  "tenant_id"                TEXT NOT NULL,
  "principal_ref"            TEXT NOT NULL,
  "owner"                    TEXT NOT NULL,
  "purpose"                  TEXT NOT NULL,
  "allowed_environments"     JSONB NOT NULL DEFAULT '[]',
  "max_credential_ttl_seconds" INTEGER,
  "rotation_interval_days"   INTEGER,
  "allowed_scopes"           JSONB NOT NULL DEFAULT '[]',
  "status"                   TEXT NOT NULL,
  "version"                  INTEGER NOT NULL DEFAULT 0,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "machine_identities_principal_key" ON "security"."machine_identities" ("tenant_id", "principal_ref");

CREATE TABLE "security"."ai_governance_profiles" (
  "id"                UUID PRIMARY KEY,
  "tenant_id"         TEXT NOT NULL,
  "principal_ref"     TEXT NOT NULL,
  "token_budget"      INTEGER,
  "call_quota"        INTEGER,
  "window_seconds"    INTEGER NOT NULL,
  "tokens_consumed"   INTEGER NOT NULL DEFAULT 0,
  "calls_consumed"    INTEGER NOT NULL DEFAULT 0,
  "window_reset_at"   TIMESTAMP(3) NOT NULL,
  "allowed_tools"     JSONB NOT NULL DEFAULT '[]',
  "allowed_resources" JSONB NOT NULL DEFAULT '[]',
  "isolation_level"   TEXT NOT NULL,
  "status"            TEXT NOT NULL,
  "version"           INTEGER NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ai_governance_principal_key" ON "security"."ai_governance_profiles" ("tenant_id", "principal_ref");

-- ── Incidents ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "security"."incidents" (
  "id"          UUID PRIMARY KEY,
  "tenant_id"   TEXT NOT NULL,
  "reference"   TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "severity"    TEXT NOT NULL,
  "status"      TEXT NOT NULL,
  "category"    TEXT NOT NULL,
  "tenant_ref"  TEXT,
  "assignee"    TEXT,
  "resolution"  TEXT,
  "timeline"    JSONB NOT NULL DEFAULT '[]',
  "evidence"    JSONB NOT NULL DEFAULT '[]',
  "detected_at" TIMESTAMP(3) NOT NULL,
  "version"     INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "incidents_tenant_reference_key" ON "security"."incidents" ("tenant_id", "reference");
CREATE INDEX "incidents_status_idx" ON "security"."incidents" ("tenant_id", "status");
CREATE INDEX "incidents_severity_idx" ON "security"."incidents" ("tenant_id", "severity");

-- ── WORM audit ledger — append-only, hash-chained (no version/updated_at). ─────────────────────────
CREATE TABLE "security"."audit_records" (
  "id"            UUID PRIMARY KEY,
  "tenant_id"     TEXT NOT NULL,
  "tenant_scope"  TEXT,
  "sequence"      INTEGER NOT NULL,
  "principal_ref" TEXT NOT NULL,
  "action"        TEXT NOT NULL,
  "decision"      TEXT NOT NULL,
  "resource"      TEXT,
  "occurred_at"   TEXT NOT NULL,
  "metadata"      JSONB NOT NULL DEFAULT '{}',
  "prev_hash"     TEXT NOT NULL,
  "hash"          TEXT NOT NULL,
  "signature"     TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "audit_records_seq_key" ON "security"."audit_records" ("tenant_id", "tenant_scope", "sequence");
CREATE INDEX "audit_records_seq_idx" ON "security"."audit_records" ("tenant_id", "tenant_scope", "sequence");

-- WORM enforcement (defense in depth): the hash chain provides tamper-EVIDENCE; this trigger provides
-- tamper-PREVENTION — the audit ledger is INSERT-only at the database level. UPDATE/DELETE raise. This is
-- a Postgres extra Prisma cannot express (per main.prisma header) and lives only in the migration.
CREATE OR REPLACE FUNCTION "security".reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'security.audit_records is append-only (WORM): % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_records_worm_guard"
  BEFORE UPDATE OR DELETE ON "security"."audit_records"
  FOR EACH ROW EXECUTE FUNCTION "security".reject_audit_mutation();
