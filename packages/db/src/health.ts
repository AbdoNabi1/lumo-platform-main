import type { PrismaClient } from "@prisma/client";
import type { HealthCheck } from "@platform/health";

/** Database health probe: a trivial round-trip query. */
export function createDatabaseHealthCheck(prisma: PrismaClient): HealthCheck {
  return {
    name: "database",
    async probe(): Promise<void> {
      await prisma.$queryRaw`SELECT 1`;
    },
  };
}
