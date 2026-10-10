-- Plan 3B — short sequential order numbers (#1001, #1002, …) per shop. Written by hand, NOT applied
-- by the agent; the owner deploys it from Railway's Console BEFORE the release that allocates numbers.
SET row_security = off;

CREATE TABLE "orders"."order_number_counters" (
  "tenant_id"   TEXT NOT NULL,
  "last_number" INTEGER NOT NULL,
  CONSTRAINT "order_number_counters_pkey" PRIMARY KEY ("tenant_id")
);
ALTER TABLE "orders"."order_number_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"."order_number_counters" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "orders"."order_number_counters";
CREATE POLICY tenant_isolation ON "orders"."order_number_counters" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Existing orders: 1001, 1002, … per shop, oldest first.
UPDATE "orders"."orders" AS o
SET "order_number" = n.num::text
FROM (
  SELECT "id", 1000 + ROW_NUMBER() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") AS num
  FROM "orders"."orders"
) AS n
WHERE o."id" = n."id";

INSERT INTO "orders"."order_number_counters" ("tenant_id", "last_number")
SELECT "tenant_id", 1000 + COUNT(*) FROM "orders"."orders" GROUP BY "tenant_id";

RESET row_security;
