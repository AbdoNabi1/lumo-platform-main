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
