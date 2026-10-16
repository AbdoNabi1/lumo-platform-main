import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { FinanceEventTranslator, PrismaJournalRepository } from "@platform/finance";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { logger } from "@platform/utils";
import { backfillFinanceSettlement } from "./backfill/finance-settlement-backfill";
import { PrismaPaymentSettlementSource } from "./backfill/prisma-payment-settlement-source";
import { buildRuntimeCore } from "./composition";
import { loadRuntimeConfig } from "./config";
import { DEFAULT_FINANCE_POSTING_ACCOUNTS } from "./consumers/orders-paid.consumers";

/**
 * WP-11 (T11.3) one-off backfill: posts the fee/contra entries every already-captured payment and
 * already-issued refund is missing, from before `PaymentsCapturedConsumer`/`RefundsIssuedConsumer`
 * were registered (T11.1). Idempotent and re-runnable — see `backfill/finance-settlement-
 * backfill.ts`'s doc comment for exactly how; safe to run more than once, including after T11.1's
 * live consumers have already covered some orders.
 *
 * Run with: `pnpm --filter @platform/runtime exec tsx src/backfill-finance-settlement.ts`
 * (same invocation shape as `seed.ts`/`seed-demo.ts` — a real Postgres via `DATABASE_URL` is
 * required; this was NOT run against one in the authoring session, see
 * `prisma-payment-settlement-source.ts`'s own doc comment).
 */
async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  const core = buildRuntimeCore(config);
  const tenantId = core.config.TENANT_DEFAULT_ID;

  const journals = new PrismaJournalRepository({
    prisma: core.prisma,
    outbox: new OutboxWriter({
      store: new PrismaOutboxStore(core.prisma),
      translator: new FinanceEventTranslator(),
      serializer: core.serializer,
      clock: core.clock,
      producer: "finance",
    }),
    context: rootEventContext(core.idGenerator, tenantId),
  });

  const result = await backfillFinanceSettlement({
    source: new PrismaPaymentSettlementSource(core.prisma, tenantId),
    journals,
    postingAccounts: DEFAULT_FINANCE_POSTING_ACCOUNTS,
    idGenerator: core.idGenerator,
    clock: core.clock,
    unitOfWork: new PrismaUnitOfWork(core.prisma),
    logger: core.logger,
    tenantId,
  });

  logger.info("backfill-finance-settlement: done", { ...result });
  await core.prisma.$disconnect();
}

if (
  process.argv[1]?.endsWith("backfill-finance-settlement.ts") ||
  process.argv[1]?.endsWith("backfill-finance-settlement.js")
) {
  main().catch((error: unknown) => {
    logger.error("backfill-finance-settlement failed", { error: String(error) });
    process.exitCode = 1;
  });
}
