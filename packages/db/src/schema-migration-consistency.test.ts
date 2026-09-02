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
