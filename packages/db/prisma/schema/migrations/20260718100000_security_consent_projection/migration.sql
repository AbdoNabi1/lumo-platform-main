-- Phase-2 hardening H-2 (G-SEC-4) — Security consent projection. Additive: a single new table in the
-- existing `security` schema. Identity owns consent; this is Security's read-optimised copy, kept current
-- by the `identity.customer.consent_changed` consumer (last-writer-wins by occurred_at). No cross-context
-- FKs; tenant_id on every row (ADR-0008).

CREATE TABLE "security"."consent_projection" (
  "id"          UUID PRIMARY KEY,
  "tenant_id"   TEXT NOT NULL,
  "subject_ref" TEXT NOT NULL,
  "purpose"     TEXT NOT NULL,
  "granted"     BOOLEAN NOT NULL,
  "occurred_at" TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "consent_projection_subject_purpose_key" ON "security"."consent_projection" ("tenant_id", "subject_ref", "purpose");
CREATE INDEX "consent_projection_subject_idx" ON "security"."consent_projection" ("tenant_id", "subject_ref");
