-- A.21 schema drift reconciliation
-- Brings the applied-migration-derived schema in line with packages/db/prisma/schema/*.prisma
-- source files. Root cause: 20260804000000_sprint5x_schema_reconciliation (commit 7925d2b,
-- 2026-08-04) was hand-authored with no reachable database (G-41) and did not exactly match
-- the column/index names in the schema.prisma files it was meant to reconcile against.
-- Verified via `prisma migrate diff --from-migrations --to-schema-datamodel` against a disposable
-- shadow database. All 61 affected tables hold zero rows in both `lumo` and `lumo_test` at the
-- time of authoring (verified via pg_stat_user_tables) -- this migration is purely additive/
-- corrective, not a data migration.

-- DropIndex
DROP INDEX "automation"."automation_workflows_tenant_id_key_key";

-- DropIndex
DROP INDEX "automation"."automation_workflows_tenant_id_status_idx";

-- DropIndex
DROP INDEX "components"."component_definitions_tenant_category_idx";

-- DropIndex
DROP INDEX "components"."component_definitions_tenant_status_idx";

-- DropIndex
DROP INDEX "content"."content_blocks_tenant_key_key";

-- DropIndex
DROP INDEX "content"."content_blocks_tenant_kind_idx";

-- DropIndex
DROP INDEX "content"."content_blocks_tenant_status_idx";

-- DropIndex
DROP INDEX "experience"."experiences_tenant_key_key";

-- DropIndex
DROP INDEX "experience"."experiences_tenant_status_idx";

-- DropIndex
DROP INDEX "experience"."experiences_tenant_type_idx";

-- DropIndex
DROP INDEX "experiment"."experiments_tenant_id_key_key";

-- DropIndex
DROP INDEX "experiment"."experiments_tenant_id_status_idx";

-- DropIndex
DROP INDEX "feature_flags"."feature_flags_tenant_id_status_idx";

-- DropIndex
DROP INDEX "licensing"."credits_lookup_idx";

-- DropIndex
DROP INDEX "licensing"."credits_tenant_key_key";

-- DropIndex
DROP INDEX "licensing"."invoices_lookup_idx";

-- DropIndex
DROP INDEX "licensing"."invoices_tenant_number_key";

-- DropIndex
DROP INDEX "licensing"."merchant_capabilities_lookup_idx";

-- DropIndex
DROP INDEX "licensing"."merchant_capabilities_tenant_key_key";

-- DropIndex
DROP INDEX "licensing"."overrides_lookup_idx";

-- DropIndex
DROP INDEX "licensing"."overrides_tenant_key_key";

-- DropIndex
DROP INDEX "licensing"."plans_tenant_tier_idx";

-- DropIndex
DROP INDEX "licensing"."subscriptions_tenant_state_idx";

-- DropIndex
DROP INDEX "licensing"."usage_counters_lookup_idx";

-- DropIndex
DROP INDEX "licensing"."usage_counters_tenant_key_key";

-- DropIndex
DROP INDEX "localization"."locales_tenant_status_idx";

-- DropIndex
DROP INDEX "localization"."translation_sets_tenant_key_key";

-- DropIndex
DROP INDEX "media"."media_assets_tenant_folder_idx";

-- DropIndex
DROP INDEX "media"."media_assets_tenant_key_key";

-- DropIndex
DROP INDEX "media"."media_assets_tenant_status_idx";

-- DropIndex
DROP INDEX "media"."media_assets_tenant_type_idx";

-- DropIndex
DROP INDEX "pages"."pages_tenant_key_key";

-- DropIndex
DROP INDEX "pages"."pages_tenant_kind_idx";

-- DropIndex
DROP INDEX "pages"."pages_tenant_path_locale_key";

-- DropIndex
DROP INDEX "pages"."pages_tenant_status_idx";

-- DropIndex
DROP INDEX "promotions"."promotions_tenant_id_type_idx";

-- DropIndex
DROP INDEX "recommendations"."recommendation_models_tenant_id_model_key_key";

-- DropIndex
DROP INDEX "recommendations"."recommendation_models_tenant_id_strategy_idx";

-- DropIndex
DROP INDEX "reporting"."dashboards_tenant_id_key_key";

-- DropIndex
DROP INDEX "reporting"."dashboards_tenant_id_status_idx";

-- DropIndex
DROP INDEX "reporting"."report_definitions_tenant_id_key_key";

-- DropIndex
DROP INDEX "reporting"."report_definitions_tenant_id_status_idx";

-- DropIndex
DROP INDEX "search"."search_indexes_tenant_id_index_key_key";

-- DropIndex
DROP INDEX "search"."search_indexes_tenant_id_status_idx";

-- DropIndex
DROP INDEX "seo"."redirects_tenant_status_idx";

-- DropIndex
DROP INDEX "seo"."robots_policies_tenant_key_key";

-- DropIndex
DROP INDEX "seo"."seo_profiles_tenant_status_idx";

-- DropIndex
DROP INDEX "seo"."seo_profiles_tenant_target_key";

-- DropIndex
DROP INDEX "seo"."sitemaps_tenant_key_key";

-- DropIndex
DROP INDEX "tenancy"."tenants_tenant_status_idx";

-- DropIndex
DROP INDEX "tenancy"."workspaces_tenant_key_key";

-- DropIndex
DROP INDEX "tenancy"."workspaces_tenant_ref_idx";

-- DropIndex
DROP INDEX "theme"."themes_tenant_key_key";

-- DropIndex
DROP INDEX "theme"."themes_tenant_status_idx";

-- DropIndex
DROP INDEX "wishlist"."wishlists_tenant_id_customer_ref_idx";

-- DropIndex
DROP INDEX "wishlist"."wishlists_tenant_id_status_idx";

-- AlterTable
ALTER TABLE "automation"."automation_workflows" DROP COLUMN "key",
DROP COLUMN "max_attempts",
DROP COLUMN "trigger",
ADD COLUMN     "cron_expression" TEXT,
ADD COLUMN     "event_type" TEXT,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "trigger_type" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "catalog"."products" ALTER COLUMN "category_refs" DROP DEFAULT;

-- AlterTable
ALTER TABLE "components"."component_definitions" DROP COLUMN "category",
DROP COLUMN "contract",
DROP COLUMN "schema",
DROP COLUMN "schema_version",
DROP COLUMN "source",
ADD COLUMN     "defaults" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "events" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "feature_flag_key" TEXT,
ADD COLUMN     "permission" TEXT,
ADD COLUMN     "properties" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "responsive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slots" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "content"."content_blocks" DROP COLUMN "data",
DROP COLUMN "key",
DROP COLUMN "kind",
DROP COLUMN "locale_ref",
DROP COLUMN "metadata",
DROP COLUMN "published_version",
DROP COLUMN "source",
DROP COLUMN "title",
ADD COLUMN     "block_type" TEXT NOT NULL,
ADD COLUMN     "content" TEXT NOT NULL,
ADD COLUMN     "format" TEXT NOT NULL,
ADD COLUMN     "locale" TEXT,
ADD COLUMN     "name" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "coupons"."coupons" DROP COLUMN "scope",
DROP COLUMN "type",
ADD COLUMN     "multi_use" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "experience"."experiences" DROP COLUMN "canvas",
DROP COLUMN "key",
DROP COLUMN "metadata",
DROP COLUMN "published_version",
DROP COLUMN "scheduled_at",
DROP COLUMN "source",
DROP COLUMN "theme_ref",
ADD COLUMN     "sections" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "experiment"."experiments" DROP COLUMN "audience",
DROP COLUMN "goal_ref",
DROP COLUMN "key",
DROP COLUMN "type",
DROP COLUMN "winner_variant",
ADD COLUMN     "audience_percentage" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "audience_segment_refs" JSONB,
ADD COLUMN     "goal_metric_ref" TEXT NOT NULL,
ADD COLUMN     "hypothesis" TEXT,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "winner_variant_key" TEXT;

-- AlterTable
ALTER TABLE "feature_flags"."feature_flags" ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "rollout_percentage" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "description" DROP NOT NULL,
ALTER COLUMN "description" DROP DEFAULT;

-- AlterTable
ALTER TABLE "licensing"."credits" DROP COLUMN "expires_at",
DROP COLUMN "key",
DROP COLUMN "remaining",
DROP COLUMN "resource",
ALTER COLUMN "reason" DROP DEFAULT;

-- AlterTable
ALTER TABLE "licensing"."invoices" DROP COLUMN "due_at",
DROP COLUMN "lines",
DROP COLUMN "number",
DROP COLUMN "payment_ref",
ADD COLUMN     "line_items" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "payment_reference" TEXT;

-- AlterTable
ALTER TABLE "licensing"."merchant_capabilities" DROP COLUMN "active",
DROP COLUMN "effect",
DROP COLUMN "expires_at",
DROP COLUMN "feature_key",
DROP COLUMN "history",
DROP COLUMN "key",
DROP COLUMN "notes",
DROP COLUMN "reason",
DROP COLUMN "source",
ADD COLUMN     "audit_history" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "grants" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "licensing"."merchant_feature_overrides" DROP COLUMN "active",
DROP COLUMN "effect",
DROP COLUMN "key",
DROP COLUMN "level",
DROP COLUMN "note",
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "state" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "licensing"."plans" DROP COLUMN "published_version_number",
ADD COLUMN     "published_version_id" TEXT;

-- AlterTable
ALTER TABLE "licensing"."subscriptions" DROP COLUMN "current_period_end",
DROP COLUMN "paused",
DROP COLUMN "plan_key",
DROP COLUMN "plan_version_number",
DROP COLUMN "resume_at",
DROP COLUMN "state",
DROP COLUMN "trial_ends_at",
ADD COLUMN     "paused_until" TIMESTAMP(3),
ADD COLUMN     "plan_version_ref" TEXT NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL,
DROP COLUMN "renewal_schedule",
ADD COLUMN     "renewal_schedule" JSONB,
DROP COLUMN "retry_policy",
ADD COLUMN     "retry_policy" JSONB;

-- AlterTable
ALTER TABLE "licensing"."usage_counters" DROP COLUMN "current",
DROP COLUMN "key",
DROP COLUMN "limit",
DROP COLUMN "period",
ADD COLUMN     "amount" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "last_recorded_at" TIMESTAMP(3),
ADD COLUMN     "unit" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "localization"."locales" DROP COLUMN "direction",
ADD COLUMN     "fallback_locale_ref" TEXT;

-- AlterTable
ALTER TABLE "localization"."translation_sets" DROP COLUMN "default_locale_ref",
DROP COLUMN "fallback_chain",
DROP COLUMN "key",
ADD COLUMN     "locale_ref" TEXT NOT NULL,
ADD COLUMN     "namespace" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "loyalty"."loyalty_accounts" DROP COLUMN "lifetime_earned",
DROP COLUMN "tier",
ADD COLUMN     "tier_name" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "media"."folders" RENAME CONSTRAINT "media_folders_pkey" TO "folders_pkey";

-- AlterTable
ALTER TABLE "media"."media_assets" DROP COLUMN "asset_type",
DROP COLUMN "collections",
DROP COLUMN "content_type",
DROP COLUMN "key",
DROP COLUMN "metadata",
DROP COLUMN "presets",
DROP COLUMN "tags",
DROP COLUMN "usages",
DROP COLUMN "variants",
ADD COLUMN     "name" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "pages"."pages" DROP COLUMN "key",
DROP COLUMN "kind",
DROP COLUMN "path",
DROP COLUMN "seo_ref",
DROP COLUMN "source",
DROP COLUMN "theme_ref",
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "route_path" TEXT NOT NULL,
ADD COLUMN     "seo_profile_ref" TEXT;

-- AlterTable
ALTER TABLE "pages"."templates" RENAME CONSTRAINT "page_templates_pkey" TO "templates_pkey";

-- AlterTable
ALTER TABLE "promotions"."promotions" DROP COLUMN "campaign",
DROP COLUMN "eligibility",
DROP COLUMN "rules",
DROP COLUMN "schedule",
DROP COLUMN "type",
ADD COLUMN     "campaign_ref" TEXT,
ADD COLUMN     "customer_refs" JSONB,
ADD COLUMN     "ends_at" TIMESTAMP(3),
ADD COLUMN     "minimum_quantity" INTEGER,
ADD COLUMN     "minimum_subtotal_amount_minor" INTEGER,
ADD COLUMN     "reward" JSONB NOT NULL,
ADD COLUMN     "rule_type" TEXT NOT NULL,
ADD COLUMN     "scope" TEXT NOT NULL,
ADD COLUMN     "segment_refs" JSONB,
ADD COLUMN     "starts_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "target_refs" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "recommendations"."recommendation_models" DROP COLUMN "model_key",
ADD COLUMN     "name" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "reporting"."dashboards" DROP COLUMN "key",
DROP COLUMN "tiles",
ADD COLUMN     "tile_refs" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "reporting"."report_definitions" DROP COLUMN "cron",
DROP COLUMN "key",
DROP COLUMN "report_type",
DROP COLUMN "runs",
ADD COLUMN     "cron_expression" TEXT,
ADD COLUMN     "type" TEXT NOT NULL,
ALTER COLUMN "filters" SET DEFAULT '[]';

-- AlterTable
ALTER TABLE "reviews"."reviews" DROP COLUMN "body",
DROP COLUMN "media",
DROP COLUMN "response",
DROP COLUMN "title",
ADD COLUMN     "asset_refs" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "body_text" TEXT NOT NULL,
ADD COLUMN     "merchant_response" TEXT,
ADD COLUMN     "report_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "search"."search_indexes" DROP COLUMN "index_key",
ADD COLUMN     "name" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "seo"."redirects" DROP COLUMN "kind",
DROP COLUMN "status",
ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "status_code" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "seo"."robots_policies" DROP COLUMN "key",
DROP COLUMN "sitemap_url",
ADD COLUMN     "user_agent" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "seo"."seo_profiles" DROP COLUMN "json_ld",
DROP COLUMN "locale_ref",
DROP COLUMN "open_graph",
DROP COLUMN "robots_follow",
DROP COLUMN "robots_index",
DROP COLUMN "status",
DROP COLUMN "target_ref",
DROP COLUMN "twitter",
ADD COLUMN     "og_image_ref" TEXT,
ADD COLUMN     "page_ref" TEXT NOT NULL,
ALTER COLUMN "title" DROP NOT NULL,
ALTER COLUMN "description" DROP NOT NULL;

-- AlterTable
ALTER TABLE "seo"."sitemaps" DROP COLUMN "entries",
DROP COLUMN "key",
DROP COLUMN "locale_ref",
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "urls" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "tenancy"."workspaces" DROP COLUMN "key";

-- AlterTable
ALTER TABLE "theme"."themes" DROP COLUMN "base_theme_ref",
DROP COLUMN "key",
DROP COLUMN "mode",
DROP COLUMN "published_version",
DROP COLUMN "source",
DROP COLUMN "variables",
ADD COLUMN     "colors" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "spacing" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "typography" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "wishlist"."wishlists" DROP COLUMN "name",
DROP COLUMN "share_token",
DROP COLUMN "shared";

-- CreateIndex
CREATE UNIQUE INDEX "automation_workflows_tenant_id_name_key" ON "automation"."automation_workflows"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "content_blocks_tenant_id_name_key" ON "content"."content_blocks"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "experiences_tenant_id_name_key" ON "experience"."experiences"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "experiments_tenant_id_name_key" ON "experiment"."experiments"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_capabilities_tenant_id_tenant_ref_key" ON "licensing"."merchant_capabilities"("tenant_id", "tenant_ref");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_feature_overrides_tenant_id_tenant_ref_feature_key_key" ON "licensing"."merchant_feature_overrides"("tenant_id", "tenant_ref", "feature_key");

-- CreateIndex
CREATE UNIQUE INDEX "usage_counters_tenant_id_tenant_ref_resource_key" ON "licensing"."usage_counters"("tenant_id", "tenant_ref", "resource");

-- CreateIndex
CREATE UNIQUE INDEX "translation_sets_tenant_id_locale_ref_namespace_key" ON "localization"."translation_sets"("tenant_id", "locale_ref", "namespace");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_tenant_id_storage_key_key" ON "media"."media_assets"("tenant_id", "storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "pages_tenant_id_route_path_key" ON "pages"."pages"("tenant_id", "route_path");

-- CreateIndex
CREATE INDEX "promotions_tenant_id_campaign_ref_idx" ON "promotions"."promotions"("tenant_id", "campaign_ref");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_models_tenant_id_name_key" ON "recommendations"."recommendation_models"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "dashboards_tenant_id_name_key" ON "reporting"."dashboards"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "report_definitions_tenant_id_name_key" ON "reporting"."report_definitions"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_tenant_id_customer_ref_product_ref_key" ON "reviews"."reviews"("tenant_id", "customer_ref", "product_ref");

-- CreateIndex
CREATE UNIQUE INDEX "search_indexes_tenant_id_name_key" ON "search"."search_indexes"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "robots_policies_tenant_id_user_agent_key" ON "seo"."robots_policies"("tenant_id", "user_agent");

-- CreateIndex
CREATE UNIQUE INDEX "seo_profiles_tenant_id_page_ref_key" ON "seo"."seo_profiles"("tenant_id", "page_ref");

-- CreateIndex
CREATE UNIQUE INDEX "sitemaps_tenant_id_name_key" ON "seo"."sitemaps"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_tenant_id_tenant_ref_name_key" ON "tenancy"."workspaces"("tenant_id", "tenant_ref", "name");

-- CreateIndex
CREATE UNIQUE INDEX "themes_tenant_id_name_key" ON "theme"."themes"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "wishlists_tenant_id_customer_ref_key" ON "wishlist"."wishlists"("tenant_id", "customer_ref");

-- RenameIndex
ALTER INDEX "components"."component_definitions_tenant_key_key" RENAME TO "component_definitions_tenant_id_key_key";

-- RenameIndex
ALTER INDEX "feature_registry"."feature_bundles_status_idx" RENAME TO "feature_bundles_tenant_id_status_idx";

-- RenameIndex
ALTER INDEX "feature_registry"."feature_bundles_tenant_key_key" RENAME TO "feature_bundles_tenant_id_key_key";

-- RenameIndex
ALTER INDEX "feature_registry"."feature_definitions_category_idx" RENAME TO "feature_definitions_tenant_id_category_idx";

-- RenameIndex
ALTER INDEX "feature_registry"."feature_definitions_lifecycle_idx" RENAME TO "feature_definitions_tenant_id_lifecycle_idx";

-- RenameIndex
ALTER INDEX "feature_registry"."feature_definitions_tenant_key_key" RENAME TO "feature_definitions_tenant_id_key_key";

-- RenameIndex
ALTER INDEX "finance"."exchange_rates_tenant_id_base_currency_quote_currency_effe_idx" RENAME TO "exchange_rates_tenant_id_base_currency_quote_currency_effec_idx";

-- RenameIndex
ALTER INDEX "fulfillment"."processed_carrier_webhooks_tenant_id_carrier_webhook_event_key" RENAME TO "processed_carrier_webhooks_tenant_id_carrier_webhook_event__key";

-- RenameIndex
ALTER INDEX "licensing"."plans_tenant_key_key" RENAME TO "plans_tenant_id_key_key";

-- RenameIndex
ALTER INDEX "licensing"."subscriptions_tenant_ref_key" RENAME TO "subscriptions_tenant_id_tenant_ref_key";

-- RenameIndex
ALTER INDEX "localization"."locales_tenant_code_key" RENAME TO "locales_tenant_id_code_key";

-- RenameIndex
ALTER INDEX "notifications"."notifications_processed_callbacks_tenant_id_provider_callback_k" RENAME TO "processed_callbacks_tenant_id_provider_callback_id_key";

-- RenameIndex
ALTER INDEX "security"."ai_governance_principal_key" RENAME TO "ai_governance_profiles_tenant_id_principal_ref_key";

-- RenameIndex
ALTER INDEX "security"."audit_records_seq_idx" RENAME TO "audit_records_tenant_id_tenant_scope_sequence_idx";

-- RenameIndex
ALTER INDEX "security"."audit_records_seq_key" RENAME TO "audit_records_tenant_id_tenant_scope_sequence_key";

-- RenameIndex
ALTER INDEX "security"."consent_projection_subject_idx" RENAME TO "consent_projection_tenant_id_subject_ref_idx";

-- RenameIndex
ALTER INDEX "security"."consent_projection_subject_purpose_key" RENAME TO "consent_projection_tenant_id_subject_ref_purpose_key";

-- RenameIndex
ALTER INDEX "security"."credentials_principal_idx" RENAME TO "credentials_tenant_id_principal_ref_idx";

-- RenameIndex
ALTER INDEX "security"."credentials_rotation_idx" RENAME TO "credentials_tenant_id_status_rotation_due_at_idx";

-- RenameIndex
ALTER INDEX "security"."delegations_delegate_idx" RENAME TO "delegations_tenant_id_delegate_ref_idx";

-- RenameIndex
ALTER INDEX "security"."delegations_delegator_idx" RENAME TO "delegations_tenant_id_delegator_ref_idx";

-- RenameIndex
ALTER INDEX "security"."devices_principal_idx" RENAME TO "devices_tenant_id_principal_ref_idx";

-- RenameIndex
ALTER INDEX "security"."devices_tenant_fingerprint_key" RENAME TO "devices_tenant_id_fingerprint_key";

-- RenameIndex
ALTER INDEX "security"."devices_trust_idx" RENAME TO "devices_tenant_id_trust_level_idx";

-- RenameIndex
ALTER INDEX "security"."identity_membership_projection_membership_key" RENAME TO "identity_membership_projection_tenant_id_membership_id_key";

-- RenameIndex
ALTER INDEX "security"."identity_membership_projection_user_idx" RENAME TO "identity_membership_projection_tenant_id_user_id_idx";

-- RenameIndex
ALTER INDEX "security"."identity_organization_projection_org_key" RENAME TO "identity_organization_projection_tenant_id_organization_id_key";

-- RenameIndex
ALTER INDEX "security"."identity_user_projection_user_key" RENAME TO "identity_user_projection_tenant_id_user_id_key";

-- RenameIndex
ALTER INDEX "security"."incidents_severity_idx" RENAME TO "incidents_tenant_id_severity_idx";

-- RenameIndex
ALTER INDEX "security"."incidents_status_idx" RENAME TO "incidents_tenant_id_status_idx";

-- RenameIndex
ALTER INDEX "security"."incidents_tenant_reference_key" RENAME TO "incidents_tenant_id_reference_key";

-- RenameIndex
ALTER INDEX "security"."machine_identities_principal_key" RENAME TO "machine_identities_tenant_id_principal_ref_key";

-- RenameIndex
ALTER INDEX "security"."mfa_enrollments_principal_idx" RENAME TO "mfa_enrollments_tenant_id_principal_ref_idx";

-- RenameIndex
ALTER INDEX "security"."policies_status_idx" RENAME TO "policies_tenant_id_status_idx";

-- RenameIndex
ALTER INDEX "security"."policies_tenant_key_key" RENAME TO "policies_tenant_id_key_key";

-- RenameIndex
ALTER INDEX "security"."principals_kind_idx" RENAME TO "principals_tenant_id_kind_idx";

-- RenameIndex
ALTER INDEX "security"."principals_subject_idx" RENAME TO "principals_tenant_id_subject_ref_idx";

-- RenameIndex
ALTER INDEX "security"."principals_tenant_external_key" RENAME TO "principals_tenant_id_external_id_key";

-- RenameIndex
ALTER INDEX "security"."relation_tuples_lookup_idx" RENAME TO "relation_tuples_tenant_id_namespace_object_relation_idx";

-- RenameIndex
ALTER INDEX "security"."relation_tuples_tenant_key_key" RENAME TO "relation_tuples_tenant_id_tuple_key_key";

-- RenameIndex
ALTER INDEX "security"."role_assignments_principal_idx" RENAME TO "role_assignments_tenant_id_principal_ref_idx";

-- RenameIndex
ALTER INDEX "security"."role_assignments_role_idx" RENAME TO "role_assignments_tenant_id_role_key_idx";

-- RenameIndex
ALTER INDEX "security"."roles_status_idx" RENAME TO "roles_tenant_id_status_idx";

-- RenameIndex
ALTER INDEX "security"."roles_tenant_key_key" RENAME TO "roles_tenant_id_key_key";

-- RenameIndex
ALTER INDEX "security"."sessions_external_ref_idx" RENAME TO "sessions_tenant_id_external_ref_idx";

-- RenameIndex
ALTER INDEX "security"."sessions_principal_idx" RENAME TO "sessions_tenant_id_principal_ref_idx";

-- RenameIndex
ALTER INDEX "security"."sessions_status_idx" RENAME TO "sessions_tenant_id_status_idx";

-- RenameIndex
ALTER INDEX "security"."tenant_profiles_tenant_ref_key" RENAME TO "tenant_profiles_tenant_id_tenant_ref_key";

-- RenameIndex
ALTER INDEX "seo"."redirects_tenant_from_key" RENAME TO "redirects_tenant_id_from_path_key";

-- RenameIndex
ALTER INDEX "shipping"."shipping_processed_webhooks_tenant_id_carrier_webhook_event_key" RENAME TO "processed_webhooks_tenant_id_carrier_webhook_event_id_key";

-- RenameIndex
ALTER INDEX "tenancy"."tenants_tenant_slug_key" RENAME TO "tenants_tenant_id_slug_key";
