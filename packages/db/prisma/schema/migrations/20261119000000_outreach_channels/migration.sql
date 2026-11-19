-- Outreach Part 1. Written by hand, NOT applied by the agent; the owner deploys it
-- BEFORE the release that reads it. Additive only.
CREATE SCHEMA IF NOT EXISTS "outreach";

CREATE TABLE "outreach"."whatsapp_connections" (
  "tenant_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "waba_id" TEXT NOT NULL,
  "phone_number_id" TEXT NOT NULL,
  "display_phone_number" TEXT,
  "verified_name" TEXT,
  "quality_rating" TEXT,
  "messaging_limit_tier" TEXT,
  "sealed_credentials" TEXT NOT NULL,
  "connected_at" TIMESTAMP(3),
  "disconnected_at" TIMESTAMP(3),
  "last_status_sync_at" TIMESTAMP(3),
  "last_error" TEXT,
  "onboarding_attempt_id" UUID,
  "onboarding_stage" TEXT,
  "onboarding_failure" TEXT,
  "onboarding_lease_owner" UUID,
  "onboarding_lease_until" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_connections_pkey" PRIMARY KEY ("tenant_id")
);


ALTER TABLE "outreach"."whatsapp_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach"."whatsapp_connections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "outreach"."whatsapp_connections";
CREATE POLICY tenant_isolation ON "outreach"."whatsapp_connections" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "outreach"."whatsapp_phone_directory" (
  "tenant_id" TEXT NOT NULL,
  "phone_number_id" TEXT NOT NULL,
  "shop_tenant_id" TEXT NOT NULL,
  "waba_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_phone_directory_pkey" PRIMARY KEY ("phone_number_id")
);

CREATE UNIQUE INDEX "whatsapp_phone_directory_0_key" ON "outreach"."whatsapp_phone_directory"("tenant_id", "waba_id");
CREATE UNIQUE INDEX "whatsapp_phone_directory_1_key" ON "outreach"."whatsapp_phone_directory"("tenant_id", "shop_tenant_id");
CREATE INDEX "whatsapp_phone_directory_2_idx" ON "outreach"."whatsapp_phone_directory"("shop_tenant_id");

ALTER TABLE "outreach"."whatsapp_phone_directory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach"."whatsapp_phone_directory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "outreach"."whatsapp_phone_directory";
CREATE POLICY tenant_isolation ON "outreach"."whatsapp_phone_directory" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "outreach"."message_templates" (
  "id" UUID NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "waba_id" TEXT NOT NULL,
  "meta_template_id" TEXT,
  "name" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "components" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "rejected_reason" TEXT,
  "quality_score" TEXT,
  "last_synced_at" TIMESTAMP(3),
  "status_event_at" TIMESTAMP(3),
  "category_event_at" TIMESTAMP(3),
  "reconciled_at" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_templates_0_key" ON "outreach"."message_templates"("tenant_id", "waba_id", "name", "language");

ALTER TABLE "outreach"."message_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach"."message_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "outreach"."message_templates";
CREATE POLICY tenant_isolation ON "outreach"."message_templates" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "outreach"."contacts" (
  "id" UUID NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "phone_e164" TEXT,
  "email" TEXT,
  "customer_ref" TEXT,
  "display_name" TEXT,
  "whatsapp_marketing" TEXT NOT NULL DEFAULT 'unknown',
  "whatsapp_transactional" TEXT NOT NULL DEFAULT 'unknown',
  "email_marketing" TEXT NOT NULL DEFAULT 'unknown',
  "last_inbound_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contacts_0_key" ON "outreach"."contacts"("tenant_id", "phone_e164");
CREATE UNIQUE INDEX "contacts_1_key" ON "outreach"."contacts"("tenant_id", "email");

ALTER TABLE "outreach"."contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach"."contacts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "outreach"."contacts";
CREATE POLICY tenant_isolation ON "outreach"."contacts" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "outreach"."consent_events" (
  "id" UUID NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "contact_id" UUID NOT NULL,
  "channel" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "evidence" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "consent_events_0_idx" ON "outreach"."consent_events"("tenant_id", "contact_id", "occurred_at");

ALTER TABLE "outreach"."consent_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach"."consent_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "outreach"."consent_events";
CREATE POLICY tenant_isolation ON "outreach"."consent_events" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "outreach"."outbound_messages" (
  "id" UUID NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "contact_id" UUID,
  "recipient" TEXT NOT NULL,
  "template_name" TEXT,
  "template_language" TEXT,
  "template_revision" INTEGER,
  "purpose" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "provider_message_id" TEXT,
  "error_code" TEXT,
  "error_message" TEXT,
  "context_ref" TEXT,
  "accepted_at" TIMESTAMP(3),
  "correlation_id" UUID NOT NULL,
  "dispatch_started_at" TIMESTAMP(3),
  "provider_idempotency_key" TEXT,
  "dispatch_phone_number_id" TEXT,
  "dispatch_waba_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outbound_messages_0_key" ON "outreach"."outbound_messages"("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "outbound_messages_1_key" ON "outreach"."outbound_messages"("tenant_id", "correlation_id");
CREATE INDEX "outbound_messages_2_idx" ON "outreach"."outbound_messages"("tenant_id", "provider_message_id");

ALTER TABLE "outreach"."outbound_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach"."outbound_messages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "outreach"."outbound_messages";
CREATE POLICY tenant_isolation ON "outreach"."outbound_messages" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "outreach"."message_status_events" (
  "id" UUID NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "outbound_message_id" UUID NOT NULL,
  "provider_event_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "raw" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_status_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_status_events_0_key" ON "outreach"."message_status_events"("tenant_id", "provider_event_id");

ALTER TABLE "outreach"."message_status_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach"."message_status_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "outreach"."message_status_events";
CREATE POLICY tenant_isolation ON "outreach"."message_status_events" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "outreach"."inbound_messages" (
  "id" UUID NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "contact_id" UUID NOT NULL,
  "provider_message_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "text" TEXT,
  "button_payload" TEXT,
  "context_provider_message_id" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inbound_messages_0_key" ON "outreach"."inbound_messages"("tenant_id", "provider_message_id");

ALTER TABLE "outreach"."inbound_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach"."inbound_messages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "outreach"."inbound_messages";
CREATE POLICY tenant_isolation ON "outreach"."inbound_messages" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "outreach"."unmatched_status_events" (
  "id" UUID NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "phone_number_id" TEXT NOT NULL,
  "provider_event_id" TEXT NOT NULL,
  "provider_message_id" TEXT NOT NULL,
  "correlation_id" TEXT,
  "status" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unmatched_status_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unmatched_status_events_0_key" ON "outreach"."unmatched_status_events"("tenant_id", "provider_event_id");
CREATE INDEX "unmatched_status_events_1_idx" ON "outreach"."unmatched_status_events"("tenant_id", "provider_message_id");
CREATE INDEX "unmatched_status_events_2_idx" ON "outreach"."unmatched_status_events"("tenant_id", "correlation_id");
CREATE INDEX "unmatched_status_events_3_idx" ON "outreach"."unmatched_status_events"("tenant_id", "phone_number_id", "provider_message_id");

ALTER TABLE "outreach"."unmatched_status_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach"."unmatched_status_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "outreach"."unmatched_status_events";
CREATE POLICY tenant_isolation ON "outreach"."unmatched_status_events" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "outreach"."email_send_counters" (
  "tenant_id" TEXT NOT NULL,
  "window_kind" TEXT NOT NULL,
  "window_start" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL,
  CONSTRAINT "email_send_counters_pkey" PRIMARY KEY ("tenant_id", "window_kind", "window_start")
);


ALTER TABLE "outreach"."email_send_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach"."email_send_counters" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "outreach"."email_send_counters";
CREATE POLICY tenant_isolation ON "outreach"."email_send_counters" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
