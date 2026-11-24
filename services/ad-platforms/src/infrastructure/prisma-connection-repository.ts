import { runInTenantTransaction, runReadScoped, type Database } from "@platform/db";
import type { AdPlatform, Connection } from "../domain/connection";
import type { ConnectionRepository } from "../domain/connection-repository";
import {
  connectionToCreateData,
  connectionToUpdateData,
  rowToConnection,
} from "./connection.mapper";
import { isPlatformKeyViolation } from "./rows";

export interface PrismaConnectionRepositoryDeps {
  readonly prisma: Database;
}

/**
 * `ConnectionRepository` on Prisma. ADR-0014: a tenant-agnostic singleton — every call takes the verified
 * `tenantId`, names it in `where`, and runs inside `set_config('app.tenant_id', …)` (writes in
 * `runInTenantTransaction`, reads in `runReadScoped`), so RLS and the explicit filter agree.
 */
export class PrismaConnectionRepository implements ConnectionRepository {
  constructor(private readonly deps: PrismaConnectionRepositoryDeps) {}

  async list(tenantId: string): Promise<readonly Connection[]> {
    const rows = await runReadScoped(this.deps.prisma, tenantId, (tx) =>
      tx.adPlatformConnection.findMany({ where: { tenantId }, orderBy: { platform: "asc" } }),
    );
    return rows.map(rowToConnection);
  }

  async get(tenantId: string, platform: AdPlatform): Promise<Connection | null> {
    const row = await runReadScoped(this.deps.prisma, tenantId, (tx) =>
      tx.adPlatformConnection.findFirst({ where: { tenantId, platform } }),
    );
    return row === null ? null : rowToConnection(row);
  }

  async save(
    tenantId: string,
    connection: Connection,
    expectedVersion: number | null,
  ): Promise<boolean> {
    const { platform } = connection.props;
    if (expectedVersion === null) {
      try {
        await runInTenantTransaction(this.deps.prisma, tenantId, (tx) =>
          tx.adPlatformConnection.create({ data: connectionToCreateData(tenantId, connection) }),
        );
        return true;
      } catch (error) {
        if (isPlatformKeyViolation(error)) return false;
        throw error;
      }
    }
    const result = await runInTenantTransaction(this.deps.prisma, tenantId, (tx) =>
      tx.adPlatformConnection.updateMany({
        where: { tenantId, platform, version: expectedVersion },
        data: connectionToUpdateData(connection),
      }),
    );
    return result.count === 1;
  }
}
