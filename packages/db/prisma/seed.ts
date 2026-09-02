import { PrismaClient } from "@prisma/client";
import { logger } from "@platform/utils";

/** Empty seed infrastructure (Sprint 0.2). No business data is seeded. */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    logger.info("seed: connected; no data to seed (infrastructure only)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  logger.error("seed failed", { error: String(error) });
  process.exitCode = 1;
});
