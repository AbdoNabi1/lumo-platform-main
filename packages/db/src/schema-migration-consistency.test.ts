import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase A.7 regression test — proves the `payments.refunds.status` schema/migration drift found
 * during the PostgreSQL production audit (`prisma.Refund.status` was declared required since the
 * Phase A.4 refund-concurrency remediation, but no migration ever created the column; see
 * `packages/db/prisma/schema/migrations/20260811010000_payments_refund_status_column`).
 *
 * `prisma validate` and `prisma migrate status` cannot catch this class of bug: `validate` only
 * checks the schema is internally well-formed, and `migrate status`/`migrate diff --exit-code`
 * need a live Postgres (shadow database) to compute drift — unavailable in this sandbox and not
 * exercised by any test in `services/payments` (unlike `services/orders`, payments has no
 * `DATABASE_URL_TEST`-gated repository test). This test statically replays every migration's DDL
 * against the `payments` schema's tables and asserts every non-optional scalar column the current
 * Prisma models expect was actually created by some migration. It would have failed before the
 * `20260811010000_payments_refund_status_column` migration was added, and passes after.
 */

const migrationsDir = join(import.meta.dirname, "..", "prisma", "schema", "migrations");

function columnsEverAddedTo(schema: string, table: string, sql: string): Set<string> {
  const columns = new Set<string>();
  const qualified = `"${schema}"."${table}"`;

  const createMatch = new RegExp(`CREATE TABLE ${qualified} \\(([\\s\\S]*?)\\n\\);`, "m").exec(sql);
  const createBody = createMatch?.[1];
  if (createBody !== undefined) {
    for (const line of createBody.split("\n")) {
      const columnMatch = /^\s*"(\w+)"\s+\S/.exec(line);
      const columnName = columnMatch?.[1];
      if (columnName !== undefined && !/^\s*CONSTRAINT\b/.test(line)) {
        columns.add(columnName);
      }
    }
  }

  // `ALTER TABLE <table> ADD COLUMN "a" ..., ADD COLUMN "b" ...;` — one statement can add several
  // columns across multiple lines, so capture the whole statement body up to its terminating `;`
  // and pull every `ADD COLUMN "x"` out of it, rather than anchoring on a single adjacent match.
  const alterStatementRegex = new RegExp(`ALTER TABLE ${qualified}\\s*\\n?([\\s\\S]*?);`, "g");
  for (const statement of sql.matchAll(alterStatementRegex)) {
    const body = statement[1];
    if (body === undefined) continue;
    for (const addColumn of body.matchAll(/ADD COLUMN\s+"(\w+)"/g)) {
      const columnName = addColumn[1];
      if (columnName !== undefined) columns.add(columnName);
    }
  }

  return columns;
}

describe("payments schema — migration history matches the Prisma model's required columns", () => {
  const migrationDirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const allMigrationSql = migrationDirs
    .map((dir) => readFileSync(join(migrationsDir, dir, "migration.sql"), "utf-8"))
    .join("\n");

  // Non-optional scalar columns declared on each `payments` schema model (packages/db/prisma/schema/payments.prisma),
  // mapped to their `@map`-ped column names. Relation fields and nullable (`?`) fields are excluded.
  const expectedColumns: Record<string, readonly string[]> = {
    payment_intents: [
      "id",
      "tenant_id",
      "order_ref",
      "amount_minor",
      "currency",
      "status",
      "payment_method",
      "version",
      "created_at",
      "updated_at",
    ],
    payment_attempts: ["id", "tenant_id", "intent_id", "kind", "outcome", "occurred_at"],
    processed_webhooks: ["id", "tenant_id", "provider", "event_id", "received_at"],
    charges: ["id", "tenant_id", "intent_id", "psp_token", "amount_minor", "occurred_at"],
    refunds: ["id", "tenant_id", "intent_id", "amount_minor", "status", "occurred_at"],
  };

  for (const [table, columns] of Object.entries(expectedColumns)) {
    it(`"payments"."${table}" — every required column was created by some migration`, () => {
      const actual = columnsEverAddedTo("payments", table, allMigrationSql);
      for (const column of columns) {
        expect(actual.has(column), `expected "payments"."${table}"."${column}" to exist`).toBe(
          true,
        );
      }
    });
  }
});

/**
 * The same static replay for `platform.outbox`. The Postgres event transport added `attempts`
 * (required) and `available_at` to the model; the generated client names them whenever it reads the
 * table, so a schema change with no migration behind it would break every outbox read in a
 * deployment while every test stayed green.
 */
describe("platform.outbox — migration history matches the Prisma model's columns", () => {
  const allMigrationSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((dir) => readFileSync(join(migrationsDir, dir, "migration.sql"), "utf-8"))
    .join("\n");

  /** Every scalar field on `OutboxEntry` (packages/db/prisma/schema/platform.prisma), by column name. */
  function modelColumns(): string[] {
    const schema = readFileSync(
      join(import.meta.dirname, "..", "prisma", "schema", "platform.prisma"),
      "utf-8",
    );
    const body = /model OutboxEntry \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    const columns: string[] = [];
    for (const line of body.split("\n")) {
      const field = /^\s+(\w+)\s+\w+[?]?(\s|$)/.exec(line);
      if (field?.[1] === undefined) continue;
      columns.push(/@map\("(\w+)"\)/.exec(line)?.[1] ?? field[1]);
    }
    return columns;
  }

  it("reads the model's fields (guards the parser above against matching nothing)", () => {
    expect(modelColumns()).toEqual(
      expect.arrayContaining(["id", "topic", "payload", "status", "attempts", "available_at"]),
    );
  });

  it("every column the model declares was created by some migration", () => {
    const actual = columnsEverAddedTo("platform", "outbox", allMigrationSql);
    for (const column of modelColumns()) {
      expect(actual.has(column), `expected "platform"."outbox"."${column}" to exist`).toBe(true);
    }
  });
});

describe("tenancy.shop_domains — migration history matches the Prisma model (Plan 1A)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf-8"))
    .join("\n");

  it("every required column was created by some migration", () => {
    const actual = columnsEverAddedTo("tenancy", "shop_domains", allSql);
    for (const column of [
      "id",
      "tenant_id",
      "shop_ref",
      "hostname",
      "kind",
      "status",
      "is_primary",
      "version",
      "created_at",
      "updated_at",
    ]) {
      expect(actual.has(column), `expected "tenancy"."shop_domains"."${column}"`).toBe(true);
    }
  });

  it("is RLS-forced with the tenant_isolation policy and one primary per shop", () => {
    expect(allSql).toContain('ALTER TABLE "tenancy"."shop_domains" FORCE ROW LEVEL SECURITY;');
    expect(allSql).toContain('CREATE POLICY tenant_isolation ON "tenancy"."shop_domains"');
    expect(allSql).toContain('CREATE UNIQUE INDEX "shop_domains_one_primary_per_shop"');
    expect(allSql).toContain('CREATE UNIQUE INDEX "shop_domains_hostname_key"');
  });
});

describe("security.password_credentials — migration history matches the Prisma model (Plan 1B-1)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf-8"))
    .join("\n");

  it("every required column was created by some migration", () => {
    const actual = columnsEverAddedTo("security", "password_credentials", allSql);
    for (const column of [
      "id",
      "tenant_id",
      "identifier",
      "principal_external_id",
      "password_hash",
      "failed_attempts",
      "version",
      "created_at",
      "updated_at",
    ]) {
      expect(actual.has(column), `expected "security"."password_credentials"."${column}"`).toBe(
        true,
      );
    }
  });

  it("is RLS-forced and unique per (tenant, identifier)", () => {
    expect(allSql).toContain(
      'ALTER TABLE "security"."password_credentials" FORCE ROW LEVEL SECURITY;',
    );
    expect(allSql).toContain('CREATE POLICY tenant_isolation ON "security"."password_credentials"');
    expect(allSql).toContain('CREATE UNIQUE INDEX "password_credentials_tenant_id_identifier_key"');
  });
});

describe("security.password_reset_tokens — migration history matches the Prisma model (Plan 1C)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf-8"))
    .join("\n");

  it("every required column was created by some migration", () => {
    const actual = columnsEverAddedTo("security", "password_reset_tokens", allSql);
    for (const column of [
      "id",
      "tenant_id",
      "token_hash",
      "identifier",
      "expires_at",
      "used_at",
      "created_at",
    ]) {
      expect(actual.has(column), `expected "security"."password_reset_tokens"."${column}"`).toBe(
        true,
      );
    }
  });

  it("is RLS-forced and unique per (tenant, token hash)", () => {
    expect(allSql).toContain(
      'ALTER TABLE "security"."password_reset_tokens" FORCE ROW LEVEL SECURITY;',
    );
    expect(allSql).toContain(
      'CREATE POLICY tenant_isolation ON "security"."password_reset_tokens"',
    );
    expect(allSql).toContain(
      'CREATE UNIQUE INDEX "password_reset_tokens_tenant_id_token_hash_key"',
    );
  });
});

describe("cart.cart_items and orders.order_items — variant lines (Plan 2A)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf-8"))
    .join("\n");

  it("cart_items gained the nullable variant snapshot columns", () => {
    const actual = columnsEverAddedTo("cart", "cart_items", allSql);
    for (const column of ["variant_ref", "sku", "title", "variant_title"]) {
      expect(actual.has(column), `expected "cart"."cart_items"."${column}"`).toBe(true);
    }
  });

  it("order_items gained the nullable variant snapshot columns", () => {
    const actual = columnsEverAddedTo("orders", "order_items", allSql);
    for (const column of ["variant_ref", "sku", "variant_title"]) {
      expect(actual.has(column), `expected "orders"."order_items"."${column}"`).toBe(true);
    }
  });

  it("widens cart line uniqueness to (cart, product, variant) keeping legacy lines unique", () => {
    expect(allSql).toContain('DROP INDEX IF EXISTS "cart"."cart_items_cart_id_product_ref_key";');
    expect(allSql).toContain("NULLS NOT DISTINCT");
  });
});

describe("catalog.products and catalog.product_variants — product details (Plan 2C-1)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf-8"))
    .join("\n");

  it("products gained description, product_type and tags", () => {
    const actual = columnsEverAddedTo("catalog", "products", allSql);
    for (const column of ["description", "product_type", "tags"]) {
      expect(actual.has(column), `expected "catalog"."products"."${column}"`).toBe(true);
    }
  });

  it("product_variants gained the Shopify variant attributes", () => {
    const actual = columnsEverAddedTo("catalog", "product_variants", allSql);
    for (const column of [
      "compare_at_amount_minor",
      "cost_amount_minor",
      "barcode",
      "weight_grams",
      "requires_shipping",
      "taxable",
    ]) {
      expect(actual.has(column), `expected "catalog"."product_variants"."${column}"`).toBe(true);
    }
  });
});

describe("inventory.inventory_items and catalog.product_variants — stock per variant (Plan 2B-1)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf-8"))
    .join("\n");

  it("inventory_items gained variant_ref", () => {
    expect(columnsEverAddedTo("inventory", "inventory_items", allSql).has("variant_ref")).toBe(
      true,
    );
  });

  it("widens the stock key to (tenant, product, variant, warehouse), legacy rows still unique", () => {
    expect(allSql).toContain(
      'DROP INDEX IF EXISTS "inventory"."inventory_items_tenant_id_product_ref_warehouse_id_key";',
    );
    expect(allSql).toMatch(
      /inventory_items_tenant_id_product_ref_variant_ref_warehouse_id_key[\s\S]*NULLS NOT DISTINCT/,
    );
  });

  it("product_variants gained the two inventory switches", () => {
    const actual = columnsEverAddedTo("catalog", "product_variants", allSql);
    expect(actual.has("tracks_inventory")).toBe(true);
    expect(actual.has("inventory_policy")).toBe(true);
  });
});

describe("shipping.merchant_carrier_settings — migration history matches the Prisma model (Project 5)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf-8"))
    .join("\n");

  it("every column was created by some migration", () => {
    const actual = columnsEverAddedTo("shipping", "merchant_carrier_settings", allSql);
    for (const column of [
      "tenant_id",
      "enabled_carriers",
      "carrier_settings",
      "version",
      "created_at",
      "updated_at",
    ]) {
      expect(
        actual.has(column),
        `expected "shipping"."merchant_carrier_settings"."${column}"`,
      ).toBe(true);
    }
  });

  it("is RLS-enabled and forced with the tenant_isolation policy (G-63)", () => {
    expect(allSql).toContain(
      'ALTER TABLE "shipping"."merchant_carrier_settings" ENABLE ROW LEVEL SECURITY;',
    );
    expect(allSql).toContain(
      'ALTER TABLE "shipping"."merchant_carrier_settings" FORCE ROW LEVEL SECURITY;',
    );
    expect(allSql).toContain(
      'CREATE POLICY tenant_isolation ON "shipping"."merchant_carrier_settings"',
    );
  });

  it("indexes shipments by (tenant, carrier, tracking number) for webhook lookups", () => {
    expect(allSql).toMatch(
      /CREATE INDEX "shipments_tenant_id_carrier_tracking_number_idx"\s+ON "shipping"\."shipments"\("tenant_id", "carrier", "tracking_number"\);/,
    );
  });
});
describe("identity customer segments (20261125000000)", () => {
  const migration = join(migrationsDir, "20261125000000_customer_segments", "migration.sql");

  it("defines segment columns, types, defaults, key and indexes", () => {
    const sql = readFileSync(migration, "utf-8");
    expect([...columnsEverAddedTo("identity", "customer_segments", sql)].sort()).toEqual([
      "conditions",
      "created_at",
      "created_by",
      "id",
      "name",
      "name_key",
      "tenant_id",
      "updated_at",
      "version",
    ]);
    for (const definition of [
      '"id" UUID NOT NULL',
      '"tenant_id" TEXT NOT NULL',
      '"name" TEXT NOT NULL',
      '"name_key" TEXT NOT NULL',
      '"conditions" JSONB NOT NULL',
      '"version" INTEGER NOT NULL DEFAULT 1',
      '"created_by" TEXT',
      '"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
      '"updated_at" TIMESTAMP(3) NOT NULL',
      'CONSTRAINT "customer_segments_pkey" PRIMARY KEY ("id")',
      'CREATE UNIQUE INDEX "customer_segments_tenant_id_name_key_key" ON "identity"."customer_segments"("tenant_id", "name_key");',
      'CREATE INDEX "customer_segments_tenant_id_created_at_idx" ON "identity"."customer_segments"("tenant_id", "created_at");',
    ])
      expect(sql).toContain(definition);
  });

  it("forces tenant isolation on segment reads and writes", () => {
    const sql = readFileSync(migration, "utf-8");
    expect(sql).toContain('ALTER TABLE "identity"."customer_segments" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "identity"."customer_segments" FORCE ROW LEVEL SECURITY;');
    expect(sql).toContain(
      'DROP POLICY IF EXISTS tenant_isolation ON "identity"."customer_segments";',
    );
    expect(sql).toContain(
      'CREATE POLICY tenant_isolation ON "identity"."customer_segments" FOR ALL',
    );
    expect(sql).toContain("USING (tenant_id = current_setting('app.tenant_id', true))");
    expect(sql).toContain("WITH CHECK (tenant_id = current_setting('app.tenant_id', true))");
  });
});

describe("security staff invitations (20261126000000)", () => {
  const migration = join(migrationsDir, "20261126000000_staff_invitations", "migration.sql");

  it("defines invitation columns, types, defaults and key", () => {
    const sql = readFileSync(migration, "utf-8");
    expect([...columnsEverAddedTo("security", "staff_invitations", sql)].sort()).toEqual([
      "accepted_at",
      "created_at",
      "email",
      "expires_at",
      "id",
      "invited_by",
      "principal_external_id",
      "role_key",
      "status",
      "tenant_id",
      "token_hash",
      "updated_at",
      "version",
    ]);
    for (const definition of [
      '"id" UUID NOT NULL',
      '"tenant_id" TEXT NOT NULL',
      '"email" TEXT NOT NULL',
      '"principal_external_id" TEXT NOT NULL',
      '"role_key" TEXT NOT NULL',
      '"invited_by" TEXT NOT NULL',
      '"token_hash" TEXT NOT NULL',
      '"status" TEXT NOT NULL',
      '"expires_at" TIMESTAMP(3) NOT NULL',
      '"accepted_at" TIMESTAMP(3),',
      '"version" INTEGER NOT NULL DEFAULT 1',
      '"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
      '"updated_at" TIMESTAMP(3) NOT NULL',
      'CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id")',
    ])
      expect(sql).toContain(definition);
  });

  it("constrains email normalisation, role key and status", () => {
    const sql = readFileSync(migration, "utf-8");
    expect(sql).toContain(
      `CONSTRAINT "staff_invitations_email_normalized" CHECK ("email" = lower(btrim("email")) AND "email" <> '')`,
    );
    expect(sql).toContain(
      `CONSTRAINT "staff_invitations_role_key_check" CHECK ("role_key" IN ('admin','operator','viewer'))`,
    );
    expect(sql).toContain(
      `CONSTRAINT "staff_invitations_status_check" CHECK ("status" IN ('pending','accepted','revoked'))`,
    );
  });

  it("allows one pending invitation per email, a unique token hash and a status index", () => {
    const sql = readFileSync(migration, "utf-8");
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "staff_invitations_one_pending_per_email" ON "security"."staff_invitations"("tenant_id", "email") WHERE "status" = 'pending';`,
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "staff_invitations_token_hash_key" ON "security"."staff_invitations"("token_hash");',
    );
    expect(sql).toContain(
      'CREATE INDEX "staff_invitations_tenant_id_status_idx" ON "security"."staff_invitations"("tenant_id", "status");',
    );
  });

  it("forces tenant isolation on invitation reads and writes", () => {
    const sql = readFileSync(migration, "utf-8");
    expect(sql).toContain('ALTER TABLE "security"."staff_invitations" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "security"."staff_invitations" FORCE ROW LEVEL SECURITY;');
    expect(sql).toContain(
      'DROP POLICY IF EXISTS tenant_isolation ON "security"."staff_invitations";',
    );
    expect(sql).toContain(
      'CREATE POLICY tenant_isolation ON "security"."staff_invitations" FOR ALL',
    );
    expect(sql).toContain("USING (tenant_id = current_setting('app.tenant_id', true))");
    expect(sql).toContain("WITH CHECK (tenant_id = current_setting('app.tenant_id', true))");
  });

  it("is purely additive", () => {
    const sql = readFileSync(migration, "utf-8");
    expect(sql).not.toMatch(/\b(DROP TABLE|DROP COLUMN|ALTER COLUMN|TRUNCATE|DELETE FROM)\b/i);
  });
});

describe("identity customer profile and tags (20261124000000)", () => {
  const migration = join(migrationsDir, "20261124000000_customer_profile_tags", "migration.sql");

  it("adds nullable customer profile columns and constrains language", () => {
    const sql = readFileSync(migration, "utf-8");
    for (const column of ["phone", "language", "note"]) {
      expect(sql).toContain(`ALTER TABLE "identity"."customers" ADD COLUMN "${column}" TEXT;`);
    }
    expect(sql).toContain(`CHECK ("language" IS NULL OR "language" IN ('en','ar'))`);
  });

  it("defines customer tags with types, defaults, key, tenant index and cascading foreign key", () => {
    const sql = readFileSync(migration, "utf-8");
    expect([...columnsEverAddedTo("identity", "customer_tags", sql)].sort()).toEqual([
      "created_at",
      "customer_id",
      "tag",
      "tag_key",
      "tenant_id",
    ]);
    for (const definition of [
      '"tenant_id" TEXT NOT NULL',
      '"customer_id" UUID NOT NULL',
      '"tag" TEXT NOT NULL',
      '"tag_key" TEXT NOT NULL',
      '"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
      'CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("customer_id", "tag_key")',
      'CREATE INDEX "customer_tags_tenant_id_tag_key_idx" ON "identity"."customer_tags"("tenant_id", "tag_key");',
      'FOREIGN KEY ("customer_id") REFERENCES "identity"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
    ])
      expect(sql).toContain(definition);
  });

  it("forces tenant isolation on customer tags for reads and writes", () => {
    const sql = readFileSync(migration, "utf-8");
    expect(sql).toContain('ALTER TABLE "identity"."customer_tags" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "identity"."customer_tags" FORCE ROW LEVEL SECURITY;');
    expect(sql).toContain('CREATE POLICY tenant_isolation ON "identity"."customer_tags" FOR ALL');
    expect(sql).toContain("USING (tenant_id = current_setting('app.tenant_id', true))");
    expect(sql).toContain("WITH CHECK (tenant_id = current_setting('app.tenant_id', true))");
  });
});

describe("orders schema — order archive (order operations Part 1)", () => {
  it("a migration adds orders.orders.archived_at", () => {
    const sql = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf-8"))
      .join("\n");
    expect(columnsEverAddedTo("orders", "orders", sql).has("archived_at")).toBe(true);
  });
});

describe("orders schema — notes, tags and timeline (order operations Part 2)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((dir) => readFileSync(join(migrationsDir, dir, "migration.sql"), "utf-8"))
    .join("\n");

  it("a migration adds orders.orders.note", () => {
    expect(columnsEverAddedTo("orders", "orders", allSql).has("note")).toBe(true);
  });

  it("order_tags has the model's columns, its (order, tag_key) key, the tenant tag index and the FK", () => {
    expect([...columnsEverAddedTo("orders", "order_tags", allSql)].sort()).toEqual([
      "created_at",
      "order_id",
      "tag",
      "tag_key",
      "tenant_id",
    ]);
    expect(allSql).toContain('CONSTRAINT "order_tags_pkey" PRIMARY KEY ("order_id", "tag_key")');
    expect(allSql).toContain(
      'CREATE INDEX "order_tags_tenant_id_tag_key_idx" ON "orders"."order_tags"("tenant_id", "tag_key");',
    );
    expect(allSql).toContain(
      'ADD CONSTRAINT "order_tags_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;',
    );
  });

  it("order_timeline_entries has the model's columns and accepts exactly the seven kinds", () => {
    expect([...columnsEverAddedTo("orders", "order_timeline_entries", allSql)].sort()).toEqual([
      "author_name",
      "author_ref",
      "body",
      "created_at",
      "data",
      "deleted_at",
      "edited_at",
      "id",
      "kind",
      "order_id",
      "tenant_id",
    ]);
    expect(allSql).toContain(
      `CHECK ("kind" IN ('comment','archived','unarchived','note_changed','tags_added','tags_removed','created_from_draft'))`,
    );
    expect(allSql).toContain(
      'CREATE INDEX "order_timeline_entries_order_id_created_at_idx" ON "orders"."order_timeline_entries"("order_id", "created_at");',
    );
  });

  it.each(["order_tags", "order_timeline_entries"])(
    "%s is RLS-forced with the tenant_isolation policy",
    (table) => {
      expect(allSql).toContain(`ALTER TABLE "orders"."${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(allSql).toContain(`ALTER TABLE "orders"."${table}" FORCE ROW LEVEL SECURITY;`);
      expect(allSql).toContain(`DROP POLICY IF EXISTS tenant_isolation ON "orders"."${table}";`);
      expect(allSql).toContain(`CREATE POLICY tenant_isolation ON "orders"."${table}" FOR ALL`);
    },
  );
});

describe("checkout schema — recovery links (order operations Part 3)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((dir) => readFileSync(join(migrationsDir, dir, "migration.sql"), "utf-8"))
    .join("\n");

  it("checkout_sessions gains the two recovery columns and the abandoned-list index", () => {
    const columns = columnsEverAddedTo("checkout", "checkout_sessions", allSql);
    expect(columns.has("recovered_from_ref")).toBe(true);
    expect(columns.has("recovered_order_ref")).toBe(true);
    expect(allSql).toContain(
      'CREATE INDEX "checkout_sessions_tenant_id_state_updated_at_idx" ON "checkout"."checkout_sessions"("tenant_id", "state", "updated_at");',
    );
  });

  it("checkout_links has the model's columns, a unique token hash, the session index and both checks", () => {
    expect([...columnsEverAddedTo("checkout", "checkout_links", allSql)].sort()).toEqual([
      "checkout_session_id",
      "claim_count",
      "created_at",
      "created_by",
      "draft_order_ref",
      "expires_at",
      "id",
      "last_claimed_at",
      "purpose",
      "result_checkout_ref",
      "revoked_at",
      "tenant_id",
      "token_hash",
    ]);
    expect(allSql).toContain(
      'CREATE UNIQUE INDEX "checkout_links_token_hash_key" ON "checkout"."checkout_links"("token_hash");',
    );
    expect(allSql).toContain(
      'CREATE INDEX "checkout_links_tenant_id_checkout_session_id_idx" ON "checkout"."checkout_links"("tenant_id", "checkout_session_id");',
    );
    expect(allSql).toContain(
      `CONSTRAINT "checkout_links_purpose_check" CHECK ("purpose" IN ('recovery','invoice'))`,
    );
    expect(allSql).toContain(`("purpose" = 'recovery' AND "checkout_session_id" IS NOT NULL) OR`);
    expect(allSql).toContain(`("purpose" = 'invoice'  AND "draft_order_ref" IS NOT NULL))`);
  });

  it("checkout_links is RLS-forced with the tenant_isolation policy", () => {
    expect(allSql).toContain('ALTER TABLE "checkout"."checkout_links" ENABLE ROW LEVEL SECURITY;');
    expect(allSql).toContain('ALTER TABLE "checkout"."checkout_links" FORCE ROW LEVEL SECURITY;');
    expect(allSql).toContain(
      'DROP POLICY IF EXISTS tenant_isolation ON "checkout"."checkout_links";',
    );
    expect(allSql).toContain(
      'CREATE POLICY tenant_isolation ON "checkout"."checkout_links" FOR ALL',
    );
  });
});

describe("orders and checkout schema — draft orders (order operations Part 4)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((dir) => readFileSync(join(migrationsDir, dir, "migration.sql"), "utf-8"))
    .join("\n");

  it("draft_orders has the model's columns, the per-shop number key, the status index and the check", () => {
    expect([...columnsEverAddedTo("orders", "draft_orders", allSql)].sort()).toEqual([
      "billing_address",
      "checkout_ref",
      "checkout_version",
      "completed_at",
      "contact_email",
      "contact_phone",
      "created_at",
      "created_by",
      "currency",
      "customer_ref",
      "deleted_at",
      "discount",
      "draft_number",
      "id",
      "invoice_sent_at",
      "lines",
      "note",
      "order_ref",
      "shipping",
      "shipping_address",
      "status",
      "tags",
      "tenant_id",
      "updated_at",
      "version",
    ]);
    expect(allSql).toContain(
      'CREATE UNIQUE INDEX "draft_orders_tenant_id_draft_number_key" ON "orders"."draft_orders"("tenant_id", "draft_number");',
    );
    expect(allSql).toContain(
      'CREATE INDEX "draft_orders_tenant_id_status_idx" ON "orders"."draft_orders"("tenant_id", "status");',
    );
    expect(allSql).toContain(
      `CONSTRAINT "draft_orders_status_check" CHECK ("status" IN ('open','invoice_sent','completed'))`,
    );
  });

  it("draft_orders is RLS-forced with the tenant_isolation policy", () => {
    expect(allSql).toContain('ALTER TABLE "orders"."draft_orders" ENABLE ROW LEVEL SECURITY;');
    expect(allSql).toContain('ALTER TABLE "orders"."draft_orders" FORCE ROW LEVEL SECURITY;');
    expect(allSql).toContain('DROP POLICY IF EXISTS tenant_isolation ON "orders"."draft_orders";');
    expect(allSql).toContain('CREATE POLICY tenant_isolation ON "orders"."draft_orders" FOR ALL');
  });

  it("the counter gains last_draft_number, sessions gain draft_terms, links get the draft index", () => {
    expect(
      columnsEverAddedTo("orders", "order_number_counters", allSql).has("last_draft_number"),
    ).toBe(true);
    expect(columnsEverAddedTo("checkout", "checkout_sessions", allSql).has("draft_terms")).toBe(
      true,
    );
    expect(allSql).toContain(
      'CREATE INDEX "checkout_links_tenant_id_draft_order_ref_idx" ON "checkout"."checkout_links"("tenant_id", "draft_order_ref");',
    );
  });
});

describe("online_store — migration history matches the Prisma models (Project 4 Part 1)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((dir) => readFileSync(join(migrationsDir, dir, "migration.sql"), "utf-8"))
    .join("\n");

  const tables: Record<string, readonly string[]> = {
    storefront_preferences: [
      "tenant_id",
      "home_title",
      "home_meta_description",
      "share_image_ref",
      "default_locale",
      "version",
      "updated_at",
    ],
    storefront_access: [
      "tenant_id",
      "locked",
      "password_hash",
      "password_updated_at",
      "message",
      "access_version",
      "version",
      "updated_at",
    ],
    storefront_themes: [
      "tenant_id",
      "draft",
      "draft_revision",
      "draft_saved_at",
      "published",
      "published_draft_revision",
      "release_number",
      "published_at",
      "published_by",
      "version",
      "created_at",
      "updated_at",
    ],
    storefront_theme_releases: [
      "id",
      "tenant_id",
      "release_number",
      "document",
      "published_at",
      "published_by",
    ],
    preview_tokens: ["id", "tenant_id", "token_hash", "expires_at", "created_by", "created_at"],
  };

  it("creates the schema before its tables", () => {
    expect(allSql).toContain('CREATE SCHEMA IF NOT EXISTS "online_store";');
  });

  for (const [table, columns] of Object.entries(tables)) {
    it(`${table} has exactly the model's columns`, () => {
      expect([...columnsEverAddedTo("online_store", table, allSql)].sort()).toEqual(
        [...columns].sort(),
      );
    });

    it(`${table} is RLS-forced with the tenant_isolation policy`, () => {
      expect(allSql).toContain(`ALTER TABLE "online_store"."${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(allSql).toContain(`ALTER TABLE "online_store"."${table}" FORCE ROW LEVEL SECURITY;`);
      expect(allSql).toContain(
        `DROP POLICY IF EXISTS tenant_isolation ON "online_store"."${table}";`,
      );
      // The whole policy, predicate included: a wrong USING or WITH CHECK must not pass.
      expect(allSql.replace(/\r\n/g, "\n")).toContain(
        `CREATE POLICY tenant_isolation ON "online_store"."${table}" FOR ALL\n` +
          `  USING (tenant_id = current_setting('app.tenant_id', true))\n` +
          `  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));`,
      );
    });
  }

  it("has the checks and indexes the spec names", () => {
    expect(allSql).toContain(
      `CONSTRAINT "storefront_preferences_default_locale_check" CHECK ("default_locale" IN ('ar', 'en'))`,
    );
    expect(allSql).toContain(
      `CONSTRAINT "storefront_access_locked_needs_password_check" CHECK (NOT "locked" OR "password_hash" IS NOT NULL)`,
    );
    expect(allSql).toContain(
      'CREATE UNIQUE INDEX "storefront_theme_releases_tenant_id_release_number_key" ON "online_store"."storefront_theme_releases" ("tenant_id", "release_number");',
    );
    expect(allSql).toContain(
      'CREATE UNIQUE INDEX "preview_tokens_token_hash_key" ON "online_store"."preview_tokens" ("token_hash");',
    );
    expect(allSql).toContain(
      'CREATE INDEX "preview_tokens_tenant_id_expires_at_idx" ON "online_store"."preview_tokens" ("tenant_id", "expires_at");',
    );
  });

  it("is registered in the datasource schemas list", () => {
    const main = readFileSync(join(migrationsDir, "..", "main.prisma"), "utf-8");
    expect(main).toMatch(/schemas\s*=\s*\[[^\]]*"online_store"/);
  });
});

describe("online_store content — menus, policies and page bodies (Project 4 Part 2)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((dir) => readFileSync(join(migrationsDir, dir, "migration.sql"), "utf-8"))
    .join("\n");
  const normalized = allSql.replace(/\r\n/g, "\n");

  const tables: Record<string, readonly string[]> = {
    menus: ["id", "tenant_id", "handle", "title", "items", "version", "created_at", "updated_at"],
    policies: ["tenant_id", "type", "body", "updated_by", "version", "updated_at"],
  };

  for (const [table, columns] of Object.entries(tables)) {
    it(`${table} has exactly the model's columns`, () => {
      expect([...columnsEverAddedTo("online_store", table, allSql)].sort()).toEqual(
        [...columns].sort(),
      );
    });
    it(`${table} is RLS-forced with the tenant_isolation policy`, () => {
      expect(allSql).toContain(`ALTER TABLE "online_store"."${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(allSql).toContain(`ALTER TABLE "online_store"."${table}" FORCE ROW LEVEL SECURITY;`);
      expect(normalized).toContain(
        `CREATE POLICY tenant_isolation ON "online_store"."${table}" FOR ALL\n` +
          `  USING (tenant_id = current_setting('app.tenant_id', true))\n` +
          `  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));`,
      );
    });
  }

  it("has the checks and indexes the spec names", () => {
    expect(allSql).toContain(
      `CONSTRAINT "menus_handle_format_check" CHECK ("handle" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`,
    );
    expect(allSql).toContain(
      'CREATE UNIQUE INDEX "menus_tenant_id_handle_key" ON "online_store"."menus" ("tenant_id", "handle");',
    );
    expect(allSql).toContain(
      `CONSTRAINT "policies_type_check" CHECK ("type" IN ('refund', 'shipping', 'privacy', 'terms', 'contact'))`,
    );
    expect(allSql).toContain(
      'CREATE INDEX "pages_tenant_id_status_idx" ON "pages"."pages" ("tenant_id", "status");',
    );
  });

  it("pages.pages gains the four content columns and keeps an explicit tenant policy", () => {
    const columns = columnsEverAddedTo("pages", "pages", allSql);
    for (const column of ["title", "body", "meta_description", "published_at"]) {
      expect(columns.has(column), column).toBe(true);
    }
    expect(normalized).toContain(
      `CREATE POLICY tenant_isolation ON "pages"."pages" FOR ALL\n` +
        `  USING (tenant_id = current_setting('app.tenant_id', true))\n` +
        `  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));`,
    );
  });
});

describe("online_store content — column types, defaults and keys (Project 4 Part 2)", () => {
  const sql = readFileSync(
    join(migrationsDir, "20261027010000_online_store_content", "migration.sql"),
    "utf-8",
  ).replace(/\r\n/g, "\n");
  const squash = (text: string) => text.replace(/[ \t]+/g, " ");
  const normalized = squash(sql);

  const lines = [
    '"id" UUID NOT NULL,',
    '"tenant_id" TEXT NOT NULL,',
    '"handle" TEXT NOT NULL,',
    '"title" TEXT NOT NULL,',
    `"items" JSONB NOT NULL DEFAULT '[]',`,
    '"version" INTEGER NOT NULL DEFAULT 0,',
    '"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,',
    '"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,',
    'CONSTRAINT "menus_pkey" PRIMARY KEY ("id"),',
    '"type" TEXT NOT NULL,',
    `"body" JSONB NOT NULL DEFAULT '{}',`,
    '"updated_by" TEXT,',
    'CONSTRAINT "policies_pkey" PRIMARY KEY ("tenant_id", "type"),',
    `ALTER TABLE "pages"."pages" ADD COLUMN "title" JSONB NOT NULL DEFAULT '{}';`,
    `ALTER TABLE "pages"."pages" ADD COLUMN "body" JSONB NOT NULL DEFAULT '{}';`,
    `ALTER TABLE "pages"."pages" ADD COLUMN "meta_description" JSONB NOT NULL DEFAULT '{}';`,
    'ALTER TABLE "pages"."pages" ADD COLUMN "published_at" TIMESTAMP(3);',
  ];
  for (const line of lines) {
    it(`declares ${line}`, () => {
      expect(normalized).toContain(line);
    });
  }
});

describe("security mfa last used step (20261127000000)", () => {
  const migration = join(migrationsDir, "20261127000000_mfa_last_used_step", "migration.sql");
  const readSql = () => readFileSync(migration, "utf-8").replace(/\r\n/g, "\n");

  it("adds exactly one column to security.mfa_enrollments", () => {
    expect([...columnsEverAddedTo("security", "mfa_enrollments", readSql())]).toEqual([
      "last_used_step",
    ]);
  });

  it("adds last_used_step as a nullable INTEGER with no default", () => {
    const statement =
      /ALTER TABLE "security"\."mfa_enrollments" ADD COLUMN "last_used_step"([^;]*);/.exec(
        readSql(),
      );
    expect(statement).not.toBeNull();
    expect(statement![1]!.trim()).toBe("INTEGER");
  });

  it("is purely additive", () => {
    const sql = readSql()
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(sql).not.toMatch(/\bDROP\b|\bUPDATE\b|\bDELETE\b|\bNOT NULL\b|\bDEFAULT\b/);
  });

  it("matches the Prisma model field", () => {
    const schema = readFileSync(
      join(import.meta.dirname, "..", "prisma", "schema", "security.prisma"),
      "utf-8",
    );
    expect(schema).toMatch(/lastUsedStep\s+Int\?\s+@map\("last_used_step"\)/);
  });
});

describe("checkout settings (20261128000000)", () => {
  const migration = join(migrationsDir, "20261128000000_checkout_settings", "migration.sql");
  const readSql = () => readFileSync(migration, "utf-8").replace(/\r\n/g, "\n");
  const code = () =>
    readSql()
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

  it("creates checkout.checkout_settings with exactly the planned columns", () => {
    expect([...columnsEverAddedTo("checkout", "checkout_settings", readSql())].sort()).toEqual([
      "accounts_mode",
      "cart_line_limit",
      "line2_mode",
      "marketing_email_prompt",
      "name_mode",
      "phone_mode",
      "require_login",
      "show_account_link",
      "tenant_id",
      "updated_at",
      "version",
    ]);
  });

  it("types every column and gives it today's behaviour as its default", () => {
    const sql = readSql();
    for (const definition of [
      '"tenant_id" TEXT NOT NULL PRIMARY KEY',
      `"name_mode" TEXT NOT NULL DEFAULT 'required' CHECK ("name_mode" IN ('required','optional'))`,
      `"phone_mode" TEXT NOT NULL DEFAULT 'required' CHECK ("phone_mode" IN ('required','optional'))`,
      `"line2_mode" TEXT NOT NULL DEFAULT 'optional' CHECK ("line2_mode" IN ('hidden','optional','required'))`,
      `"marketing_email_prompt" TEXT NOT NULL DEFAULT 'hidden' CHECK ("marketing_email_prompt" IN ('hidden','show','preselect'))`,
      '"cart_line_limit" INTEGER CHECK ("cart_line_limit" IS NULL OR "cart_line_limit" BETWEEN 1 AND 999)',
      '"require_login" BOOLEAN NOT NULL DEFAULT false',
      `"accounts_mode" TEXT NOT NULL DEFAULT 'optional' CHECK ("accounts_mode" IN ('optional','disabled'))`,
      '"show_account_link" BOOLEAN NOT NULL DEFAULT true',
      '"version" INTEGER NOT NULL DEFAULT 1',
      '"updated_at" TIMESTAMP(3) NOT NULL',
    ])
      expect(sql).toContain(definition);
  });

  it("refuses require_login while accounts are disabled", () => {
    expect(readSql()).toContain(
      `CONSTRAINT "checkout_settings_login_needs_accounts" CHECK (NOT ("require_login" AND "accounts_mode" = 'disabled'))`,
    );
  });

  it("forces tenant isolation on checkout settings for reads and writes", () => {
    const sql = readSql();
    expect(sql).toContain('ALTER TABLE "checkout"."checkout_settings" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "checkout"."checkout_settings" FORCE ROW LEVEL SECURITY;');
    expect(sql).toContain(
      'CREATE POLICY tenant_isolation ON "checkout"."checkout_settings" FOR ALL',
    );
    expect(sql).toContain("USING (tenant_id = current_setting('app.tenant_id', true))");
    expect(sql).toContain("WITH CHECK (tenant_id = current_setting('app.tenant_id', true))");
  });

  it("adds the nullable marketing_opt_in column to checkout_sessions with no default", () => {
    expect([...columnsEverAddedTo("checkout", "checkout_sessions", readSql())]).toEqual([
      "marketing_opt_in",
    ]);
    const statement =
      /ALTER TABLE "checkout"\."checkout_sessions" ADD COLUMN "marketing_opt_in"([^;]*);/.exec(
        readSql(),
      );
    expect(statement).not.toBeNull();
    expect(statement![1]!.trim()).toBe("BOOLEAN");
  });

  it("adds the nullable source column to identity.consent_records (who made the choice), nothing else", () => {
    expect([...columnsEverAddedTo("identity", "consent_records", readSql())]).toEqual(["source"]);
    const statement = /ALTER TABLE "identity"\."consent_records" ADD COLUMN "source"([^;]*);/.exec(
      readSql(),
    );
    expect(statement).not.toBeNull();
    expect(statement![1]!.trim()).toBe("TEXT");
    const identity = readFileSync(
      join(import.meta.dirname, "..", "prisma", "schema", "identity.prisma"),
      "utf-8",
    );
    const model = /model ConsentRecord \{([\s\S]*?)\n\}/.exec(identity)?.[1] ?? "";
    expect(model).toMatch(/source\s+String\?/);
  });

  it("is purely additive", () => {
    expect(code()).not.toMatch(/\bDROP TABLE\b|\bDROP COLUMN\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/);
    expect(code()).not.toMatch(/ALTER COLUMN/);
  });

  it("matches the Prisma models", () => {
    const schema = readFileSync(
      join(import.meta.dirname, "..", "prisma", "schema", "checkout.prisma"),
      "utf-8",
    );
    const model = /model CheckoutSettings \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    for (const field of [
      /tenantId\s+String\s+@id\s+@map\("tenant_id"\)/,
      /nameMode\s+String\s+@default\("required"\)\s+@map\("name_mode"\)/,
      /phoneMode\s+String\s+@default\("required"\)\s+@map\("phone_mode"\)/,
      /line2Mode\s+String\s+@default\("optional"\)\s+@map\("line2_mode"\)/,
      /marketingEmailPrompt\s+String\s+@default\("hidden"\)\s+@map\("marketing_email_prompt"\)/,
      /cartLineLimit\s+Int\?\s+@map\("cart_line_limit"\)/,
      /requireLogin\s+Boolean\s+@default\(false\)\s+@map\("require_login"\)/,
      /accountsMode\s+String\s+@default\("optional"\)\s+@map\("accounts_mode"\)/,
      /showAccountLink\s+Boolean\s+@default\(true\)\s+@map\("show_account_link"\)/,
      /version\s+Int\s+@default\(1\)/,
      /updatedAt\s+DateTime\s+@updatedAt\s+@map\("updated_at"\)/,
      /@@map\("checkout_settings"\)/,
      /@@schema\("checkout"\)/,
    ])
      expect(model).toMatch(field);
    expect(schema).toMatch(/marketingOptIn\s+Boolean\?\s+@map\("marketing_opt_in"\)/);
  });
});

describe("notification settings (20261129000000)", () => {
  const migration = join(migrationsDir, "20261129000000_notification_settings", "migration.sql");
  const readSql = () => readFileSync(migration, "utf-8").replace(/\r\n/g, "\n");
  const code = () =>
    readSql()
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
  const schema = () =>
    readFileSync(
      join(import.meta.dirname, "..", "prisma", "schema", "notifications.prisma"),
      "utf-8",
    );

  it("creates the three notifications tables with exactly the planned columns", () => {
    const sql = readSql();
    expect([...columnsEverAddedTo("notifications", "notification_settings", sql)].sort()).toEqual([
      "disabled_templates",
      "sender_email",
      "staff_recipients",
      "tenant_id",
      "updated_at",
      "version",
    ]);
    expect(
      [...columnsEverAddedTo("notifications", "notification_template_overrides", sql)].sort(),
    ).toEqual(["body", "key", "locale", "subject", "tenant_id", "updated_at"]);
    expect([...columnsEverAddedTo("notifications", "sender_domains", sql)].sort()).toEqual([
      "domain",
      "provider_domain_id",
      "records",
      "status",
      "tenant_id",
      "updated_at",
      "verified_at",
    ]);
  });

  it("types every column as planned", () => {
    const sql = readSql();
    for (const definition of [
      '"tenant_id" TEXT NOT NULL PRIMARY KEY',
      '"sender_email" TEXT,',
      `"staff_recipients" JSONB NOT NULL DEFAULT '[]'`,
      `"disabled_templates" TEXT[] NOT NULL DEFAULT '{}'`,
      '"version" INTEGER NOT NULL DEFAULT 1',
      '"updated_at" TIMESTAMP(3) NOT NULL',
      `"locale" TEXT NOT NULL CHECK ("locale" IN ('en','ar'))`,
      '"subject" TEXT NOT NULL',
      '"body" TEXT NOT NULL',
      'PRIMARY KEY ("tenant_id","key","locale")',
      '"provider_domain_id" TEXT NOT NULL',
      '"records" JSONB NOT NULL',
      '"verified_at" TIMESTAMP(3),',
      'PRIMARY KEY ("tenant_id","domain")',
    ])
      expect(sql).toContain(definition);
  });

  it("forces tenant isolation on every new table for reads and writes", () => {
    const sql = readSql();
    for (const table of [
      "notification_settings",
      "notification_template_overrides",
      "sender_domains",
    ]) {
      expect(sql).toContain(`ALTER TABLE "notifications"."${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE "notifications"."${table}" FORCE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`CREATE POLICY tenant_isolation ON "notifications"."${table}" FOR ALL`);
    }
    expect(
      sql.match(/USING \(tenant_id = current_setting\('app\.tenant_id', true\)\)/g),
    ).toHaveLength(3);
    expect(
      sql.match(/WITH CHECK \(tenant_id = current_setting\('app\.tenant_id', true\)\)/g),
    ).toHaveLength(3);
  });

  it("allows one verified owner per domain (partial unique index, SQL only)", () => {
    const sql = readSql();
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "sender_domains_verified_domain_key" ON "notifications"."sender_domains" ("domain") WHERE "status" = 'verified';`,
    );
  });

  it("is purely additive", () => {
    expect(code()).not.toMatch(/\bDROP TABLE\b|\bDROP COLUMN\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/);
    expect(code()).not.toMatch(/ALTER COLUMN/);
    expect(code()).not.toMatch(/ALTER TABLE "(?!notifications")/);
  });

  it("sorts after the checkout settings migration", () => {
    const names = readdirSync(migrationsDir)
      .filter((name) => /^\d{14}_/.test(name))
      .sort();
    expect(names.indexOf("20261129000000_notification_settings")).toBeGreaterThan(
      names.indexOf("20261128000000_checkout_settings"),
    );
  });

  it("matches the Prisma models", () => {
    const text = schema();
    const settings = /model NotificationSettings \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? "";
    for (const field of [
      /tenantId\s+String\s+@id\s+@map\("tenant_id"\)/,
      /senderEmail\s+String\?\s+@map\("sender_email"\)/,
      /staffRecipients\s+Json\s+@default\("\[\]"\)\s+@map\("staff_recipients"\)/,
      /disabledTemplates\s+String\[\]\s+@default\(\[\]\)\s+@map\("disabled_templates"\)/,
      /version\s+Int\s+@default\(1\)/,
      /updatedAt\s+DateTime\s+@updatedAt\s+@map\("updated_at"\)/,
      /@@map\("notification_settings"\)/,
      /@@schema\("notifications"\)/,
    ])
      expect(settings).toMatch(field);
    const overrides = /model NotificationTemplateOverride \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? "";
    for (const field of [
      /tenantId\s+String\s+@map\("tenant_id"\)/,
      /locale\s+String/,
      /subject\s+String/,
      /body\s+String/,
      /@@id\(\[tenantId, key, locale\]\)/,
      /@@map\("notification_template_overrides"\)/,
    ])
      expect(overrides).toMatch(field);
    // sender_domains is dropped by 20261130000000 (D50): the model is gone.
    expect(text).not.toMatch(/model SenderDomain\b/);
  });
});

describe("store email connections (20261130000000)", () => {
  const migration = join(migrationsDir, "20261130000000_store_email_connections", "migration.sql");
  const readSql = () => readFileSync(migration, "utf-8").replace(/\r\n/g, "\n");
  const code = () =>
    readSql()
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
  const schema = () =>
    readFileSync(
      join(import.meta.dirname, "..", "prisma", "schema", "notifications.prisma"),
      "utf-8",
    );

  it("creates notifications.email_connections with exactly the planned columns", () => {
    expect([...columnsEverAddedTo("notifications", "email_connections", readSql())].sort()).toEqual(
      [
        "enabled",
        "from_email",
        "kind",
        "last_error",
        "last_error_at",
        "sealed_credentials",
        "secret_last4",
        "status",
        "tenant_id",
        "updated_at",
        "verified_at",
        "version",
      ],
    );
  });

  it("types and constrains every column as planned", () => {
    const sql = readSql();
    for (const definition of [
      '"tenant_id" TEXT NOT NULL PRIMARY KEY',
      `"kind" TEXT NOT NULL CHECK ("kind" IN ('resend'))`,
      '"from_email" TEXT NOT NULL',
      '"sealed_credentials" TEXT NOT NULL',
      '"secret_last4" TEXT NOT NULL',
      '"enabled" BOOLEAN NOT NULL DEFAULT true',
      `"status" TEXT NOT NULL CHECK ("status" IN ('connected','failed'))`,
      '"last_error" TEXT,',
      '"last_error_at" TIMESTAMP(3),',
      '"verified_at" TIMESTAMP(3),',
      '"version" INTEGER NOT NULL DEFAULT 1',
      '"updated_at" TIMESTAMP(3) NOT NULL',
    ])
      expect(sql).toContain(definition);
  });

  it("forces tenant isolation for reads and writes", () => {
    const sql = readSql();
    const table = '"notifications"."email_connections"';
    expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    expect(sql).toContain(`CREATE POLICY tenant_isolation ON ${table} FOR ALL`);
    expect(
      sql.match(/USING \(tenant_id = current_setting\('app\.tenant_id', true\)\)/g),
    ).toHaveLength(1);
    expect(
      sql.match(/WITH CHECK \(tenant_id = current_setting\('app\.tenant_id', true\)\)/g),
    ).toHaveLength(1);
  });

  it("drops only the empty sender_domains table and is otherwise additive", () => {
    const sql = code();
    expect(sql.match(/\bDROP TABLE\b[^;]*;/g)).toEqual([
      'DROP TABLE IF EXISTS "notifications"."sender_domains";',
    ]);
    expect(sql).not.toMatch(/\bDROP COLUMN\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|ALTER COLUMN/);
    expect(sql).not.toMatch(/ALTER TABLE (?!"notifications"\."email_connections")/);
  });

  it("has no column for a key reference or a plain key", () => {
    const columns = [...columnsEverAddedTo("notifications", "email_connections", readSql())];
    expect(columns.filter((name) => /kek|api_key|secret_key|password/.test(name))).toEqual([]);
  });

  it("sorts after the notification settings migration", () => {
    const names = readdirSync(migrationsDir)
      .filter((name) => /^\d{14}_/.test(name))
      .sort();
    expect(names.indexOf("20261130000000_store_email_connections")).toBeGreaterThan(
      names.indexOf("20261129000000_notification_settings"),
    );
  });

  it("matches the Prisma model and no sender domain model remains", () => {
    const text = schema();
    const model = /model EmailConnection \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? "";
    for (const field of [
      /tenantId\s+String\s+@id\s+@map\("tenant_id"\)/,
      /kind\s+String/,
      /fromEmail\s+String\s+@map\("from_email"\)/,
      /sealedCredentials\s+String\s+@map\("sealed_credentials"\)/,
      /secretLast4\s+String\s+@map\("secret_last4"\)/,
      /enabled\s+Boolean\s+@default\(true\)/,
      /status\s+String/,
      /lastError\s+String\?\s+@map\("last_error"\)/,
      /lastErrorAt\s+DateTime\?\s+@map\("last_error_at"\)/,
      /verifiedAt\s+DateTime\?\s+@map\("verified_at"\)/,
      /version\s+Int\s+@default\(1\)/,
      /updatedAt\s+DateTime\s+@updatedAt\s+@map\("updated_at"\)/,
      /@@map\("email_connections"\)/,
      /@@schema\("notifications"\)/,
    ])
      expect(model).toMatch(field);
    expect(text).not.toMatch(/model SenderDomain\b/);
    expect(text).not.toMatch(/sender_domains/);
  });
});

describe("email connection SMTP kind (20261201000000)", () => {
  const name = "20261201000000_email_connection_smtp";
  const migration = join(migrationsDir, name, "migration.sql");
  const readSql = () => readFileSync(migration, "utf-8").replace(/\r\n/g, "\n");
  const code = () =>
    readSql()
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

  it("widens only the kind CHECK, by dropping and re-adding the one named constraint", () => {
    const sql = code();
    expect(sql).toContain(
      'ALTER TABLE "notifications"."email_connections"\n  DROP CONSTRAINT IF EXISTS "email_connections_kind_check";',
    );
    expect(sql).toContain(
      `ADD CONSTRAINT "email_connections_kind_check" CHECK ("kind" IN ('resend','smtp'));`,
    );
    expect(sql.match(/\bALTER TABLE\b/g)).toHaveLength(2);
    expect(sql).not.toMatch(
      /\bCREATE\b|\bDROP TABLE\b|\bDROP COLUMN\b|\bADD COLUMN\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|ALTER COLUMN|POLICY/,
    );
    expect(sql).not.toMatch(/ALTER TABLE (?!"notifications"\."email_connections")/);
  });

  it("adds no column: the mailbox details live in the sealed blob", () => {
    expect(readSql()).not.toMatch(/ADD COLUMN/i);
    const columns = [...columnsEverAddedTo("notifications", "email_connections", readSql())];
    expect(columns).toEqual([]);
  });

  it("sorts after the store email connections migration", () => {
    const names = readdirSync(migrationsDir)
      .filter((entry) => /^\d{14}_/.test(entry))
      .sort();
    expect(names.indexOf(name)).toBeGreaterThan(
      names.indexOf("20261130000000_store_email_connections"),
    );
  });

  it("the Prisma model keeps `kind` a plain string (the CHECK is the rule)", () => {
    const text = readFileSync(
      join(import.meta.dirname, "..", "prisma", "schema", "notifications.prisma"),
      "utf-8",
    );
    const model = /model EmailConnection \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? "";
    expect(model).toMatch(/kind\s+String/);
  });
});

describe("leads.leads — migration history matches the Prisma model (Lead Site Part C)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((dir) => readFileSync(join(migrationsDir, dir, "migration.sql"), "utf-8"))
    .join("\n")
    .replace(/\r\n/g, "\n");
  const model = /model Lead \{([\s\S]*?)\n\}/.exec(
    readFileSync(join(migrationsDir, "..", "leads.prisma"), "utf-8").replace(/\r\n/g, "\n"),
  )?.[1];

  // The columns come from the model itself (`@map` or the field name), so adding a field to the
  // model without a migration column fails here.
  const modelColumns = (model ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("@@"))
    .map((line) => /@map\("(\w+)"\)/.exec(line)?.[1] ?? /^(\w+)\s/.exec(line)?.[1] ?? "");

  it("reads the model's columns", () => {
    expect(modelColumns).toHaveLength(18);
    expect(modelColumns).toContain("submission_key");
    expect(modelColumns).not.toContain("");
  });

  it("creates the schema before its table", () => {
    expect(allSql).toContain('CREATE SCHEMA IF NOT EXISTS "leads";');
  });

  it("leads has exactly the model's columns", () => {
    expect([...columnsEverAddedTo("leads", "leads", allSql)].sort()).toEqual(
      [...modelColumns].sort(),
    );
  });

  it("leads is RLS-forced with the exact tenant_isolation predicate", () => {
    expect(allSql).toContain('ALTER TABLE "leads"."leads" ENABLE ROW LEVEL SECURITY;');
    expect(allSql).toContain('ALTER TABLE "leads"."leads" FORCE ROW LEVEL SECURITY;');
    expect(allSql).toContain('DROP POLICY IF EXISTS tenant_isolation ON "leads"."leads";');
    expect(allSql).toContain(
      `CREATE POLICY tenant_isolation ON "leads"."leads" FOR ALL\n` +
        `  USING (tenant_id = current_setting('app.tenant_id', true))\n` +
        `  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));`,
    );
  });

  it("has the checks, the unique submission key and the two list indexes", () => {
    expect(allSql).toContain(
      `CONSTRAINT "leads_status_check" CHECK ("status" IN ('new', 'contacted', 'qualified', 'converted', 'rejected', 'spam'))`,
    );
    expect(allSql).toContain(
      `CONSTRAINT "leads_tracking_status_check" CHECK ("tracking_status" IN ('pending', 'suppressed', 'skipped_spam', 'sent', 'failed'))`,
    );
    expect(allSql).toContain(
      `CONSTRAINT "leads_spam_reason_check" CHECK ("spam_reason" IS NULL OR "spam_reason" IN ('honeypot', 'too_fast'))`,
    );
    expect(allSql).toContain(
      'CREATE UNIQUE INDEX "leads_tenant_id_submission_key_key" ON "leads"."leads" ("tenant_id", "submission_key");',
    );
    expect(allSql).toContain(
      'CREATE INDEX "leads_tenant_id_id_idx" ON "leads"."leads" ("tenant_id", "id" DESC);',
    );
    expect(allSql).toContain(
      'CREATE INDEX "leads_tenant_id_status_id_idx" ON "leads"."leads" ("tenant_id", "status", "id" DESC);',
    );
  });

  it("is registered in the datasource schemas list", () => {
    const main = readFileSync(join(migrationsDir, "..", "main.prisma"), "utf-8");
    expect(main).toMatch(/schemas\s*=\s*\[[^\]]*"leads"/);
  });
});

describe("tracking.ad_platform_connections — migration history matches the Prisma model (Lead Site Part D1)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((dir) => readFileSync(join(migrationsDir, dir, "migration.sql"), "utf-8"))
    .join("\n")
    .replace(/\r\n/g, "\n");
  const model = /model AdPlatformConnection \{([\s\S]*?)\n\}/.exec(
    readFileSync(join(migrationsDir, "..", "tracking.prisma"), "utf-8").replace(/\r\n/g, "\n"),
  )?.[1];

  const modelColumns = (model ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("@@"))
    .map((line) => /@map\("(\w+)"\)/.exec(line)?.[1] ?? /^(\w+)\s/.exec(line)?.[1] ?? "");

  it("reads the model's columns", () => {
    expect(modelColumns).toHaveLength(11);
    expect(modelColumns).toContain("sealed_secret");
    expect(modelColumns).not.toContain("");
  });

  it("has exactly the model's columns", () => {
    expect([...columnsEverAddedTo("tracking", "ad_platform_connections", allSql)].sort()).toEqual(
      [...modelColumns].sort(),
    );
  });

  it("is RLS-forced with the exact tenant_isolation predicate", () => {
    const table = '"tracking"."ad_platform_connections"';
    expect(allSql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    expect(allSql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    expect(allSql).toContain(`DROP POLICY IF EXISTS tenant_isolation ON ${table};`);
    expect(allSql).toContain(
      `CREATE POLICY tenant_isolation ON ${table} FOR ALL\n` +
        `  USING (tenant_id = current_setting('app.tenant_id', true))\n` +
        `  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));`,
    );
  });

  it("has the platform CHECK, the no-secret-for-google-ads CHECK and the unique (tenant, platform) index", () => {
    expect(allSql).toContain(
      `CONSTRAINT "ad_platform_connections_platform_check" CHECK ("platform" IN ('meta', 'tiktok', 'snap', 'ga4', 'google_ads'))`,
    );
    expect(allSql).toContain(
      `CONSTRAINT "ad_platform_connections_google_ads_no_secret_check" CHECK ("sealed_secret" IS NULL OR "platform" <> 'google_ads')`,
    );
    expect(allSql).toContain(
      'CREATE UNIQUE INDEX "ad_platform_connections_tenant_id_platform_key" ON "tracking"."ad_platform_connections" ("tenant_id", "platform");',
    );
  });

  it("is additive: the migration only creates the table (no drop, no alter of existing objects)", () => {
    const sql = readFileSync(
      join(migrationsDir, "20261204000000_ad_platform_connections", "migration.sql"),
      "utf-8",
    ).replace(/\r\n/g, "\n");
    expect(sql).toMatch(/^SET row_security = off;$/m);
    expect(sql).toMatch(/^RESET row_security;$/m);
    expect(sql).not.toMatch(/\bDROP (TABLE|COLUMN|SCHEMA|INDEX)\b/i);
    expect(sql).not.toMatch(/\bALTER TABLE\b(?![^\n]*"ad_platform_connections")/i);
  });
});

/**
 * Tracking P1-D2: the durable delivery-retry queue. The generated client names every column of the
 * model whenever it reads the table, so a model with no migration behind it would break every sweep in
 * a deployment while the unit tests (fake-backed) stayed green.
 */
describe("tracking.delivery_retries — migration matches the Prisma model", () => {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const retrySql = readFileSync(
    join(migrationsDir, "20261205000000_tracking_delivery_retry", "migration.sql"),
    "utf-8",
  );

  function modelColumns(): string[] {
    const schema = readFileSync(
      join(import.meta.dirname, "..", "prisma", "schema", "tracking.prisma"),
      "utf-8",
    );
    const body = /model TrackingDeliveryRetry \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    const columns: string[] = [];
    for (const line of body.split("\n")) {
      const field = /^\s+(\w+)\s+\w+[?]?(\s|$)/.exec(line);
      if (field?.[1] === undefined) continue;
      columns.push(/@map\("(\w+)"\)/.exec(line)?.[1] ?? field[1]);
    }
    return columns;
  }

  it("reads the model's fields (guards the parser above against matching nothing)", () => {
    expect(modelColumns()).toEqual(
      expect.arrayContaining(["id", "tenant_id", "event_id", "destination", "next_retry_at"]),
    );
  });

  it("every column the model declares is created by the migration", () => {
    const actual = columnsEverAddedTo("tracking", "delivery_retries", retrySql);
    for (const column of modelColumns()) {
      expect(actual.has(column), `expected "tracking"."delivery_retries"."${column}"`).toBe(true);
    }
  });

  it("is RLS-forced, tenant-isolated, readable cross-tenant for the due scan, with a tenant-led unique key", () => {
    expect(retrySql).toContain(
      'ALTER TABLE "tracking"."delivery_retries" FORCE ROW LEVEL SECURITY;',
    );
    expect(retrySql).toContain(
      'CREATE POLICY tenant_isolation ON "tracking"."delivery_retries" FOR ALL',
    );
    expect(retrySql).toContain(
      'CREATE POLICY due_scan_read ON "tracking"."delivery_retries" FOR SELECT',
    );
    expect(retrySql).toContain(
      'CREATE UNIQUE INDEX "delivery_retries_tenant_id_event_id_destination_key" ON "tracking"."delivery_retries" ("tenant_id", "event_id", "destination")',
    );
    expect(retrySql).toContain("CHECK (\"status\" IN ('pending', 'delivered', 'dead_lettered'))");
  });

  it("is the only migration at 20261205000000 (the profiles migration takes the next stamp)", () => {
    expect(dirs.filter((dir) => dir.startsWith("20261205000000"))).toEqual([
      "20261205000000_tracking_delivery_retry",
    ]);
  });
});

/**
 * Tracking P1-D4: the TrackingProfile store. The generated client names every column of the model on every
 * read, so a model with no migration behind it would break each ingest in a deployment while the fake-backed unit
 * tests stayed green. Also pins the privacy shape: hashes only, tenant isolation, the retention scan policy.
 */
describe("tracking.tracking_profiles — migration matches the Prisma model", () => {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const profilesSql = readFileSync(
    join(migrationsDir, "20261206000000_tracking_profiles", "migration.sql"),
    "utf-8",
  );
  const schema = readFileSync(
    join(import.meta.dirname, "..", "prisma", "schema", "tracking.prisma"),
    "utf-8",
  );

  function modelColumns(model: string): string[] {
    const body = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(schema)?.[1] ?? "";
    const columns: string[] = [];
    for (const line of body.split("\n")) {
      const field = /^\s+(\w+)\s+[A-Za-z]+(\[\])?[?]?(\s|$)/.exec(line);
      if (field?.[1] === undefined) continue;
      columns.push(/@map\("(\w+)"\)/.exec(line)?.[1] ?? field[1]);
    }
    return columns;
  }

  it("reads the model's fields (guards the parser above against matching nothing)", () => {
    expect(modelColumns("TrackingProfile")).toEqual(
      expect.arrayContaining([
        "id",
        "tenant_id",
        "visitor_id",
        "email_std",
        "lead_ids",
        "click_ids",
      ]),
    );
  });

  it("every column the model declares is created by the migration", () => {
    const actual = columnsEverAddedTo("tracking", "tracking_profiles", profilesSql);
    for (const column of modelColumns("TrackingProfile")) {
      expect(actual.has(column), `expected "tracking"."tracking_profiles"."${column}"`).toBe(true);
    }
  });

  it("adds the redaction marker to the event records, nullable, matching the model", () => {
    const added = columnsEverAddedTo("tracking", "tracking_event_records", profilesSql);
    expect(added.has("network_redacted_at")).toBe(true);
    expect(modelColumns("TrackingEventRecord")).toContain("network_redacted_at");
    expect(profilesSql).toContain('ADD COLUMN "network_redacted_at" TIMESTAMP(3);');
    expect(profilesSql).toContain("tracking_event_records_redaction_scan_idx");
    expect(schema).toContain('map: "tracking_event_records_redaction_scan_idx"');
  });

  it("is RLS-forced and tenant-isolated; the cross-tenant scan is open only behind an explicit setting", () => {
    expect(profilesSql).toContain(
      'ALTER TABLE "tracking"."tracking_profiles" ENABLE ROW LEVEL SECURITY;',
    );
    expect(profilesSql).toContain(
      'ALTER TABLE "tracking"."tracking_profiles" FORCE ROW LEVEL SECURITY;',
    );
    expect(profilesSql).toContain(
      'CREATE POLICY tenant_isolation ON "tracking"."tracking_profiles" FOR ALL',
    );
    expect(profilesSql).toContain("current_setting('app.retention_scan', true) = 'on'");
    // never an unconditional read policy on a table of hashed identity
    expect(profilesSql).not.toMatch(/FOR SELECT\s+USING \(true\)/);
  });

  it("indexes the lookup keys tenant-first: visitor (unique), customer, email hash, phone hash", () => {
    for (const index of [
      'CREATE UNIQUE INDEX "tracking_profiles_tenant_id_visitor_id_key" ON "tracking"."tracking_profiles" ("tenant_id", "visitor_id")',
      'CREATE INDEX "tracking_profiles_tenant_id_customer_id_idx" ON "tracking"."tracking_profiles" ("tenant_id", "customer_id")',
      'CREATE INDEX "tracking_profiles_tenant_id_email_std_idx" ON "tracking"."tracking_profiles" ("tenant_id", "email_std")',
      'CREATE INDEX "tracking_profiles_tenant_id_phone_e164_idx" ON "tracking"."tracking_profiles" ("tenant_id", "phone_e164")',
    ]) {
      expect(profilesSql).toContain(index);
    }
  });

  it("stores no raw identity: no plain email / phone / name column exists", () => {
    const actual = columnsEverAddedTo("tracking", "tracking_profiles", profilesSql);
    for (const raw of ["email", "phone", "first_name", "last_name", "name", "address"]) {
      expect(actual.has(raw), `raw column "${raw}" must not exist`).toBe(false);
    }
  });

  it("is the only migration at 20261206000000 (blocked IPs take the next stamp)", () => {
    expect(dirs.filter((dir) => dir.startsWith("20261206000000"))).toEqual([
      "20261206000000_tracking_profiles",
    ]);
  });
});

/**
 * Tracking P1-D9: the per-store IP block list. A model with no migration behind it would break every read of the
 * list in a deployment while the in-memory-backed unit tests stayed green; and a tenant table without a forced,
 * tenant-scoped policy would let one merchant read (or write) another's list.
 */
describe("tracking.blocked_ips — migration matches the Prisma model", () => {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const blockedSql = readFileSync(
    join(migrationsDir, "20261207000000_tracking_blocked_ips", "migration.sql"),
    "utf-8",
  );
  const schema = readFileSync(
    join(import.meta.dirname, "..", "prisma", "schema", "tracking.prisma"),
    "utf-8",
  );

  function modelColumns(model: string): string[] {
    const body = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(schema)?.[1] ?? "";
    const columns: string[] = [];
    for (const line of body.split("\n")) {
      const field = /^\s+(\w+)\s+[A-Za-z]+(\[\])?[?]?(\s|$)/.exec(line);
      if (field?.[1] === undefined) continue;
      columns.push(/@map\("(\w+)"\)/.exec(line)?.[1] ?? field[1]);
    }
    return columns;
  }

  it("reads the model's fields (guards the parser above against matching nothing)", () => {
    expect(modelColumns("TrackingBlockedIp")).toEqual(
      expect.arrayContaining(["id", "tenant_id", "cidr", "note", "created_at", "created_by"]),
    );
  });

  it("every column the model declares is created by the migration", () => {
    const actual = columnsEverAddedTo("tracking", "blocked_ips", blockedSql);
    for (const column of modelColumns("TrackingBlockedIp")) {
      expect(actual.has(column), `expected "tracking"."blocked_ips"."${column}"`).toBe(true);
    }
  });

  it("is RLS-enabled AND forced, with a tenant_isolation policy that checks reads and writes", () => {
    expect(blockedSql).toContain('ALTER TABLE "tracking"."blocked_ips" ENABLE ROW LEVEL SECURITY;');
    expect(blockedSql).toContain('ALTER TABLE "tracking"."blocked_ips" FORCE ROW LEVEL SECURITY;');
    expect(blockedSql).toContain(
      'CREATE POLICY tenant_isolation ON "tracking"."blocked_ips" FOR ALL',
    );
    expect(blockedSql).toContain("USING (tenant_id = current_setting('app.tenant_id', true))");
    expect(blockedSql).toContain("WITH CHECK (tenant_id = current_setting('app.tenant_id', true))");
    // never an open read policy on a tenant's list
    expect(blockedSql).not.toMatch(/USING \(true\)/);
  });

  it("keeps one row per (tenant, range) — a repeat add is a unique-key no-op — and indexes tenant-first", () => {
    expect(blockedSql).toContain(
      'CREATE UNIQUE INDEX "blocked_ips_tenant_id_cidr_key" ON "tracking"."blocked_ips" ("tenant_id", "cidr")',
    );
    expect(blockedSql).toContain(
      'CREATE INDEX "blocked_ips_tenant_id_created_at_idx" ON "tracking"."blocked_ips" ("tenant_id", "created_at")',
    );
    expect(schema).toMatch(/model TrackingBlockedIp \{[\s\S]*@@unique\(\[tenantId, cidr\]\)/);
  });

  it("adds the fingerprint lookup index the model declares, and nothing else to the profiles table", () => {
    expect(blockedSql).toContain(
      'CREATE INDEX "tracking_profiles_tenant_id_fingerprint_id_idx"\n  ON "tracking"."tracking_profiles" ("tenant_id", "fingerprint_id");',
    );
    expect(schema).toContain("@@index([tenantId, fingerprintId])");
    expect(blockedSql).not.toMatch(/ALTER TABLE "tracking"\."tracking_profiles" (ADD|DROP)/);
  });

  it("is additive: nothing is dropped or rewritten", () => {
    expect(blockedSql).not.toMatch(/\bDROP (TABLE|COLUMN|INDEX|SCHEMA)\b/i);
    expect(blockedSql).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i);
  });

  it("is the only migration at 20261207000000", () => {
    expect(dirs.filter((dir) => dir.startsWith("20261207000000"))).toEqual([
      "20261207000000_tracking_blocked_ips",
    ]);
  });
});

/**
 * Tracking P2-D1: `tracking.store_tracking_settings`, hand-written and applied by the owner before the release whose
 * runtime reads it. A model without its migration would 500 the settings routes and, because the ingest runtime reads
 * the policy for every event, fall back to the default policy for every store in a deployment while the in-memory
 * tests stayed green; a tenant table without a forced, tenant-scoped policy would let one merchant read (or write)
 * another's consent policy.
 */
describe("tracking.store_tracking_settings — migration matches the Prisma model", () => {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  // hand-written files are CRLF in a Windows working tree: compare on LF
  const settingsSql = readFileSync(
    join(migrationsDir, "20261208000000_tracking_store_settings", "migration.sql"),
    "utf-8",
  ).replace(/\r\n/g, "\n");
  const schema = readFileSync(
    join(import.meta.dirname, "..", "prisma", "schema", "tracking.prisma"),
    "utf-8",
  ).replace(/\r\n/g, "\n");

  function modelColumns(model: string): string[] {
    const start = schema.indexOf(`model ${model} {`);
    const body = start < 0 ? "" : schema.slice(start, schema.indexOf("\n}", start));
    const columns: string[] = [];
    for (const line of body.split("\n")) {
      const field = /^\s+(\w+)\s+[A-Za-z]+(\[\])?[?]?(\s|$)/.exec(line);
      if (field?.[1] === undefined) continue;
      columns.push(/@map\("(\w+)"\)/.exec(line)?.[1] ?? field[1]);
    }
    return columns;
  }

  it("reads the model's fields (guards the parser above against matching nothing)", () => {
    expect(modelColumns("TrackingStoreSettings")).toEqual(
      expect.arrayContaining([
        "tenant_id",
        "consent_policy",
        "cookie_notice_enabled",
        "version",
        "updated_at",
      ]),
    );
  });

  it("every column the model declares is created by the migration", () => {
    const actual = columnsEverAddedTo("tracking", "store_tracking_settings", settingsSql);
    for (const column of modelColumns("TrackingStoreSettings")) {
      expect(actual.has(column), `expected "tracking"."store_tracking_settings"."${column}"`).toBe(
        true,
      );
    }
  });

  it("is keyed by the tenant: one row per store, tenant id as the primary key", () => {
    expect(settingsSql).toContain(
      'CONSTRAINT "store_tracking_settings_pkey" PRIMARY KEY ("tenant_id")',
    );
    expect(schema).toMatch(
      /model TrackingStoreSettings \{\s+tenantId\s+String\s+@id @map\("tenant_id"\)/,
    );
    expect(schema).toContain('@@map("store_tracking_settings")');
  });

  it("is RLS-enabled AND forced, with a tenant_isolation policy that checks reads and writes", () => {
    expect(settingsSql).toContain(
      'ALTER TABLE "tracking"."store_tracking_settings" ENABLE ROW LEVEL SECURITY;',
    );
    expect(settingsSql).toContain(
      'ALTER TABLE "tracking"."store_tracking_settings" FORCE ROW LEVEL SECURITY;',
    );
    expect(settingsSql).toContain(
      'CREATE POLICY tenant_isolation ON "tracking"."store_tracking_settings" FOR ALL',
    );
    expect(settingsSql).toContain("USING (tenant_id = current_setting('app.tenant_id', true))");
    expect(settingsSql).toContain(
      "WITH CHECK (tenant_id = current_setting('app.tenant_id', true))",
    );
    // never an open read policy on a tenant's settings
    expect(settingsSql).not.toMatch(/USING \(true\)/);
  });

  it("defaults to today's behaviour (notice_only, notice shown) and refuses any other policy", () => {
    expect(settingsSql).toContain(
      `"consent_policy"        TEXT         NOT NULL DEFAULT 'notice_only'`,
    );
    expect(settingsSql).toContain(`CHECK ("consent_policy" IN ('notice_only', 'opt_in'))`);
    expect(settingsSql).toContain(`"cookie_notice_enabled" BOOLEAN      NOT NULL DEFAULT true`);
    expect(schema).toContain('@default("notice_only") @map("consent_policy")');
    expect(schema).toContain('@default(true) @map("cookie_notice_enabled")');
  });

  it("is additive: one new table, nothing dropped or rewritten (the policy DROP is the idempotent re-create)", () => {
    expect(settingsSql).not.toMatch(/\bDROP (TABLE|COLUMN|INDEX|SCHEMA)\b/i);
    expect(settingsSql).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE)\b/i);
    expect(settingsSql.match(/CREATE TABLE/g)).toHaveLength(1);
  });

  it("is the only migration at 20261208000000", () => {
    expect(dirs.filter((dir) => dir.startsWith("20261208000000"))).toEqual([
      "20261208000000_tracking_store_settings",
    ]);
  });
});

/**
 * Tracking P2-D8: `tracking.attribution_snapshots`, hand-written and applied by the owner before the release whose
 * checkout route writes it. A model without its migration would make every `complete` call fail its (swallowed)
 * snapshot write while the in-memory tests stayed green and every Purchase would go out with no visitor; a tenant
 * table without a forced, tenant-scoped policy would let one merchant read another's visitor IPs and click ids; a
 * missing retention policy would keep IPs forever.
 */
describe("tracking.attribution_snapshots — migration matches the Prisma model", () => {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const snapshotSql = readFileSync(
    join(migrationsDir, "20261209000000_tracking_attribution_snapshots", "migration.sql"),
    "utf-8",
  ).replace(/\r\n/g, "\n");
  const schema = readFileSync(
    join(import.meta.dirname, "..", "prisma", "schema", "tracking.prisma"),
    "utf-8",
  ).replace(/\r\n/g, "\n");

  function modelColumns(model: string): string[] {
    const body = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(schema)?.[1] ?? "";
    const columns: string[] = [];
    for (const line of body.split("\n")) {
      const field = /^\s+(\w+)\s+[A-Za-z]+(\[\])?[?]?(\s|$)/.exec(line);
      if (field?.[1] === undefined) continue;
      columns.push(/@map\("(\w+)"\)/.exec(line)?.[1] ?? field[1]);
    }
    return columns;
  }

  it("reads the model's fields (guards the parser above against matching nothing)", () => {
    expect(modelColumns("TrackingAttributionSnapshot")).toEqual(
      expect.arrayContaining([
        "tenant_id",
        "subject_kind",
        "subject_ref",
        "visitor_id",
        "ip",
        "user_agent",
        "click_ids",
        "captured_at",
        "network_redacted_at",
      ]),
    );
  });

  it("every column the model declares is created by the migration", () => {
    const actual = columnsEverAddedTo("tracking", "attribution_snapshots", snapshotSql);
    for (const column of modelColumns("TrackingAttributionSnapshot")) {
      expect(actual.has(column), `expected "tracking"."attribution_snapshots"."${column}"`).toBe(
        true,
      );
    }
  });

  it("is keyed (tenant, kind, ref) so a second write for a subject is a conflict, tenant first", () => {
    expect(snapshotSql).toContain(
      'CONSTRAINT "attribution_snapshots_pkey" PRIMARY KEY ("tenant_id", "subject_kind", "subject_ref")',
    );
    expect(schema).toMatch(
      /model TrackingAttributionSnapshot \{[\s\S]*@@id\(\[tenantId, subjectKind, subjectRef\]\)/,
    );
    expect(schema).toContain('@@map("attribution_snapshots")');
    expect(snapshotSql).toContain(
      'CREATE INDEX "attribution_snapshots_tenant_id_captured_at_idx" ON "tracking"."attribution_snapshots" ("tenant_id", "captured_at")',
    );
    expect(schema).toContain("@@index([tenantId, capturedAt])");
  });

  it("limits the subject kind to checkout and lead", () => {
    expect(snapshotSql).toContain(`CHECK ("subject_kind" IN ('checkout', 'lead'))`);
  });

  it("is RLS-enabled AND forced, with a tenant_isolation policy that checks reads and writes", () => {
    expect(snapshotSql).toContain(
      'ALTER TABLE "tracking"."attribution_snapshots" ENABLE ROW LEVEL SECURITY;',
    );
    expect(snapshotSql).toContain(
      'ALTER TABLE "tracking"."attribution_snapshots" FORCE ROW LEVEL SECURITY;',
    );
    expect(snapshotSql).toContain(
      'CREATE POLICY tenant_isolation ON "tracking"."attribution_snapshots" FOR ALL',
    );
    expect(snapshotSql).toContain("USING (tenant_id = current_setting('app.tenant_id', true))");
    expect(snapshotSql).toContain(
      "WITH CHECK (tenant_id = current_setting('app.tenant_id', true))",
    );
  });

  it("the only cross-tenant read is the retention scan, behind its explicit switch, and SELECT only", () => {
    expect(snapshotSql).toContain(
      "CREATE POLICY retention_scan_read ON \"tracking\".\"attribution_snapshots\" FOR SELECT\n  USING (current_setting('app.retention_scan', true) = 'on');",
    );
    expect(snapshotSql).not.toMatch(/USING \(true\)/);
    expect(snapshotSql.match(/CREATE POLICY/g)).toHaveLength(2);
  });

  it("holds the network columns the retention nulls, and no contact data", () => {
    expect(snapshotSql).toContain('"ip"                  TEXT,');
    expect(snapshotSql).toContain('"user_agent"          TEXT,');
    expect(snapshotSql).toContain('"network_redacted_at" TIMESTAMP(3)');
    const columns = modelColumns("TrackingAttributionSnapshot");
    for (const forbidden of ["email", "phone", "name", "address"]) {
      expect(columns.filter((column) => column.includes(forbidden))).toEqual([]);
    }
  });

  it("is additive: one new table, nothing dropped or rewritten (the policy DROP is the idempotent re-create)", () => {
    expect(snapshotSql).not.toMatch(/\bDROP (TABLE|COLUMN|INDEX|SCHEMA)\b/i);
    expect(snapshotSql).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE)\b/i);
    expect(snapshotSql.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(snapshotSql).not.toMatch(
      /ALTER TABLE "tracking"\."(?!attribution_snapshots)\w+" (ADD|DROP)/,
    );
  });

  it("is the only migration at 20261209000000, and sorts after the settings migration", () => {
    expect(dirs.filter((dir) => dir.startsWith("20261209000000"))).toEqual([
      "20261209000000_tracking_attribution_snapshots",
    ]);
    expect(dirs.indexOf("20261209000000_tracking_attribution_snapshots")).toBeGreaterThan(
      dirs.indexOf("20261208000000_tracking_store_settings"),
    );
  });
});

describe("leads.leads tracking sweep — migration matches the Prisma model (P2-D9)", () => {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const sweepSql = readFileSync(
    join(migrationsDir, "20261210000000_leads_tracking_pending", "migration.sql"),
    "utf-8",
  );
  const sweep = sweepSql.replace(/\r\n/g, "\n");
  const schema = readFileSync(
    join(import.meta.dirname, "..", "prisma", "schema", "leads.prisma"),
    "utf-8",
  ).replace(/\r\n/g, "\n");

  it("is hand-written with CRLF line endings, like its neighbours", () => {
    expect(sweepSql).toContain("\r\n");
    expect(sweepSql.replace(/\r\n/g, "")).not.toMatch(/\n/);
  });

  it("creates the (tenant, tracking status, created at) index the model declares, tenant first", () => {
    expect(sweep).toContain(
      'CREATE INDEX "leads_tenant_id_tracking_status_created_at_idx" ON "leads"."leads" ("tenant_id", "tracking_status", "created_at");',
    );
    expect(schema).toContain("@@index([tenantId, trackingStatus, createdAt])");
  });

  it("keeps the table RLS-enabled and forced", () => {
    expect(sweep).toContain('ALTER TABLE "leads"."leads" ENABLE ROW LEVEL SECURITY;');
    expect(sweep).toContain('ALTER TABLE "leads"."leads" FORCE ROW LEVEL SECURITY;');
  });

  it("the only cross-tenant read is the sweep scan: SELECT only, pending rows only, behind its explicit switch", () => {
    expect(sweep).toContain(
      "CREATE POLICY tracking_sweep_read ON \"leads\".\"leads\" FOR SELECT\n  USING (current_setting('app.tracking_sweep', true) = 'on' AND tracking_status = 'pending');",
    );
    expect(sweep).not.toMatch(/USING \(true\)/);
    expect(sweep.match(/CREATE POLICY/g)).toHaveLength(1);
    // no write policy, no widening of tenant_isolation
    expect(sweep).not.toMatch(/FOR (ALL|INSERT|UPDATE|DELETE)/);
  });

  it("is additive: no column, no table, nothing dropped or rewritten (the policy DROP is the idempotent re-create)", () => {
    expect(sweep).not.toMatch(/\bDROP (TABLE|COLUMN|INDEX|SCHEMA)\b/i);
    expect(sweep).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE)\b/i);
    expect(sweep).not.toMatch(/CREATE TABLE|ADD COLUMN|ALTER COLUMN/i);
    expect(sweep.match(/CREATE (UNIQUE )?INDEX/g)).toHaveLength(1);
  });

  it("is the only migration at 20261210000000 and sorts after the snapshot migration", () => {
    expect(dirs.filter((dir) => dir.startsWith("20261210000000"))).toEqual([
      "20261210000000_leads_tracking_pending",
    ]);
    expect(dirs.indexOf("20261210000000_leads_tracking_pending")).toBeGreaterThan(
      dirs.indexOf("20261209000000_tracking_attribution_snapshots"),
    );
  });
});
