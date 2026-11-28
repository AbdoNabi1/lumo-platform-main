import type { Database } from "../client";
import type { TransactionClient } from "../transaction";

/**
 * Runs `fn` in a transaction on which row-level security REALLY applies.
 *
 * Why this exists: PostgreSQL never applies RLS to a superuser or to a role with BYPASSRLS — not even to a
 * table with `FORCE ROW LEVEL SECURITY`. The test database's connection role (the `POSTGRES_USER` of the CI
 * service, `lumo`) is a superuser, so a test that writes a row for the wrong tenant over that connection
 * succeeds and proves nothing about the policy. (ADR-0014 point 6 records the same fact for the production
 * connection role.) This helper therefore sets `app.tenant_id` and then `SET LOCAL ROLE` to a throwaway
 * NOLOGIN, NOBYPASSRLS role that is granted only DML on the named tables, so the `tenant_isolation` policy
 * (`USING` and `WITH CHECK`) is what decides — and a failure of the policy shows up as a refusal that is not a
 * missing privilege (the grants are in place).
 *
 * Only for a throwaway test database (it creates the role). `SET LOCAL` ends with the transaction.
 */
const PROBE_ROLE = "rls_probe";

export async function runWithRlsEnforced<T>(
  prisma: Database,
  tenantId: string,
  tables: readonly { readonly schema: string; readonly table: string }[],
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  // Idempotent and safe to race with a parallel suite: a lost CREATE is a duplicate, which is fine.
  await prisma.$executeRawUnsafe(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PROBE_ROLE}') THEN
         CREATE ROLE ${PROBE_ROLE} NOLOGIN NOBYPASSRLS;
       END IF;
     EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
     END $$`,
  );
  for (const { schema, table } of tables) {
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO ${PROBE_ROLE}`);
    await prisma.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON "${schema}"."${table}" TO ${PROBE_ROLE}`,
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${PROBE_ROLE}`);
    return fn(tx);
  });
}
