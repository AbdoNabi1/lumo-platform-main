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
