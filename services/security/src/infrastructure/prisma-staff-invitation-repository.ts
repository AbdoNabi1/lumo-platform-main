import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import { UniqueEntityId } from "@platform/domain";
import { ConcurrencyError, ConflictError, UnexpectedError } from "@platform/utils";
import type { StaffInvitationRepository } from "../domain/repositories";
import { STAFF_ROLES, type StaffRole } from "../domain/staff";
import {
  STAFF_INVITATION_STATUSES,
  StaffInvitation,
  type StaffInvitationStatus,
} from "../domain/staff-invitation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly principalExternalId: string;
  readonly roleKey: string;
  readonly invitedBy: string;
  readonly tokenHash: string;
  readonly status: string;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function hydrate(row: Row): StaffInvitation {
  const roleKey = STAFF_ROLES.find((r): r is StaffRole => r === row.roleKey);
  const status = STAFF_INVITATION_STATUSES.find(
    (s): s is StaffInvitationStatus => s === row.status,
  );
  if (roleKey === undefined || status === undefined)
    throw new UnexpectedError("Corrupt security row: invalid staff invitation role or status");
  return StaffInvitation.reconstitute(UniqueEntityId.from(row.id), {
    tenantId: row.tenantId,
    email: row.email,
    principalExternalId: row.principalExternalId,
    roleKey,
    invitedBy: row.invitedBy,
    tokenHash: row.tokenHash,
    status,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });
}

function uniqueViolation(error: unknown): ConflictError | null {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002")
    return null;
  const meta = "meta" in error ? error.meta : undefined;
  const target = JSON.stringify(
    typeof meta === "object" && meta !== null && "target" in meta ? meta.target : "",
  );
  if (target.includes("token_hash") || target.includes("tokenHash"))
    return new ConflictError("This invitation token is already in use", { cause: error });
  if (target.includes("pkey"))
    return new ConflictError("This invitation already exists", { cause: error });
  return new ConflictError("This email already has a pending invitation", { cause: error });
}

/**
 * `security.staff_invitations`. Writes REQUIRE the unit of work's transaction client (the same tx as
 * the principal, assignment and audit writes of the command); reads reuse a given tx or are tenant
 * scoped through `runReadScoped`. Every `where` carries `tenantId`.
 */
export class PrismaStaffInvitationRepository implements StaffInvitationRepository {
  constructor(private readonly deps: { readonly prisma: Database }) {}

  private required(tx: unknown, method: string): TransactionClient {
    if (tx === undefined || tx === null)
      throw new Error(
        `PrismaStaffInvitationRepository.${method} requires the unit of work's transaction client (ADR-0003).`,
      );
    return tx as TransactionClient;
  }

  private read<T>(
    tenantId: string,
    tx: unknown,
    run: (client: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return tx === undefined || tx === null
      ? runReadScoped(this.deps.prisma, tenantId, run)
      : run(tx as TransactionClient);
  }

  async save(invitation: StaffInvitation, tx?: unknown): Promise<number> {
    const client = this.required(tx, "save");
    const tenantId = invitation.tenantId;
    const id = invitation.id.toString();
    try {
      if (invitation.version === 0) {
        await client.securityStaffInvitation.create({
          data: {
            id,
            tenantId,
            email: invitation.email,
            principalExternalId: invitation.principalExternalId,
            roleKey: invitation.roleKey,
            invitedBy: invitation.invitedBy,
            tokenHash: invitation.tokenHash,
            status: invitation.status,
            expiresAt: invitation.expiresAt,
            acceptedAt: invitation.acceptedAt,
            version: 1,
            createdAt: invitation.createdAt,
            updatedAt: invitation.updatedAt,
          },
        });
        return 1;
      }
      const result = await client.securityStaffInvitation.updateMany({
        where: { id, tenantId, version: invitation.version },
        data: {
          tokenHash: invitation.tokenHash,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          acceptedAt: invitation.acceptedAt,
          updatedAt: invitation.updatedAt,
          version: { increment: 1 },
        },
      });
      if (result.count === 0)
        throw new ConcurrencyError(
          `StaffInvitation ${id} was modified concurrently (expected version ${invitation.version})`,
        );
      return invitation.version + 1;
    } catch (error) {
      throw uniqueViolation(error) ?? error;
    }
  }

  async findById(tenantId: string, id: string, tx?: unknown): Promise<StaffInvitation | null> {
    if (!UUID.test(id)) return null;
    const row = await this.read(tenantId, tx, (c) =>
      c.securityStaffInvitation.findFirst({ where: { id, tenantId } }),
    );
    return row === null ? null : hydrate(row);
  }

  async findPendingByEmail(
    tenantId: string,
    email: string,
    tx?: unknown,
  ): Promise<StaffInvitation | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityStaffInvitation.findFirst({ where: { tenantId, email, status: "pending" } }),
    );
    return row === null ? null : hydrate(row);
  }

  async findByTokenHash(
    tenantId: string,
    tokenHash: string,
    tx?: unknown,
  ): Promise<StaffInvitation | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityStaffInvitation.findFirst({ where: { tenantId, tokenHash } }),
    );
    return row === null ? null : hydrate(row);
  }

  async listPending(tenantId: string, tx?: unknown): Promise<readonly StaffInvitation[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityStaffInvitation.findMany({
        where: { tenantId, status: "pending" },
        orderBy: { email: "asc" },
      }),
    );
    return rows.map(hydrate);
  }
}
