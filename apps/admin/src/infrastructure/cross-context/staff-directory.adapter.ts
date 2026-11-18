import { runReadScoped, type Database } from "@platform/db";
import type { StaffDirectoryPort } from "@platform/orders";

export interface PrismaStaffDirectoryAdapterDeps {
  readonly prisma: Database;
}

/**
 * Order operations Part 2 (spec §2.2): a timeline line's author name, read from Security's
 * `principals.display_name` by `external_id` (what a staff `Principal.id` carries). One tenant-scoped
 * row, read once per action and snapshotted onto the line. Read-only; Orders never writes Security.
 */
export class PrismaStaffDirectoryAdapter implements StaffDirectoryPort {
  private readonly deps: PrismaStaffDirectoryAdapterDeps;

  constructor(deps: PrismaStaffDirectoryAdapterDeps) {
    this.deps = deps;
  }

  async displayNameOf(principalId: string, tenantId: string): Promise<string | null> {
    const row = await runReadScoped(this.deps.prisma, tenantId, (client) =>
      client.securityPrincipal.findFirst({
        where: { tenantId, externalId: principalId },
        select: { displayName: true },
      }),
    );
    return row?.displayName ?? null;
  }
}
