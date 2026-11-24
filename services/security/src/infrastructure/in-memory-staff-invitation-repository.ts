import { UniqueEntityId } from "@platform/domain";
import { ConcurrencyError, ConflictError } from "@platform/utils";
import type { StaffInvitationRepository } from "../domain/repositories";
import type { StaffRole } from "../domain/staff";
import { StaffInvitation, type StaffInvitationStatus } from "../domain/staff-invitation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Immutable plain snapshot — what the table would hold. Aggregates are rebuilt fresh on every read. */
interface Snapshot {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly principalExternalId: string;
  readonly roleKey: StaffRole;
  readonly invitedBy: string;
  readonly tokenHash: string;
  readonly status: StaffInvitationStatus;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const copy = (date: Date | null): Date | null => (date === null ? null : new Date(date));

function hydrate(s: Snapshot): StaffInvitation {
  return StaffInvitation.reconstitute(UniqueEntityId.from(s.id), {
    tenantId: s.tenantId,
    email: s.email,
    principalExternalId: s.principalExternalId,
    roleKey: s.roleKey,
    invitedBy: s.invitedBy,
    tokenHash: s.tokenHash,
    status: s.status,
    expiresAt: new Date(s.expiresAt),
    acceptedAt: copy(s.acceptedAt),
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
    version: s.version,
  });
}

/**
 * In-memory twin of `PrismaStaffInvitationRepository`: same compare-and-swap, the same
 * one-pending-per-(tenant, email) and unique-token-hash rules, tenant-scoped reads, `tx` ignored.
 */
export class InMemoryStaffInvitationRepository implements StaffInvitationRepository {
  private readonly rows = new Map<string, Snapshot>();

  async save(invitation: StaffInvitation, _tx?: unknown): Promise<number> {
    const id = invitation.id.toString().toLowerCase();
    const tenantId = invitation.tenantId;
    const existing = this.rows.get(id);
    if (invitation.version === 0) {
      if (existing !== undefined) throw new ConflictError("This invitation already exists");
    } else if (
      existing === undefined ||
      existing.tenantId !== tenantId ||
      existing.version !== invitation.version
    ) {
      throw new ConcurrencyError(
        `StaffInvitation ${id} was modified concurrently (expected version ${invitation.version})`,
      );
    }
    for (const other of this.rows.values()) {
      if (other.id === id) continue;
      if (other.tokenHash === invitation.tokenHash)
        throw new ConflictError("This invitation token is already in use");
      if (
        invitation.status === "pending" &&
        other.status === "pending" &&
        other.tenantId === tenantId &&
        other.email === invitation.email
      )
        throw new ConflictError("This email already has a pending invitation");
    }
    const version = invitation.version + 1;
    this.rows.set(id, {
      id,
      tenantId,
      email: invitation.email,
      principalExternalId: invitation.principalExternalId,
      roleKey: invitation.roleKey,
      invitedBy: invitation.invitedBy,
      tokenHash: invitation.tokenHash,
      status: invitation.status,
      expiresAt: new Date(invitation.expiresAt),
      acceptedAt: copy(invitation.acceptedAt),
      version,
      createdAt: new Date(invitation.createdAt),
      updatedAt: new Date(invitation.updatedAt),
    });
    return version;
  }

  async findById(tenantId: string, id: string, _tx?: unknown): Promise<StaffInvitation | null> {
    if (!UUID.test(id)) return null;
    const row = this.rows.get(id.toLowerCase());
    return row !== undefined && row.tenantId === tenantId ? hydrate(row) : null;
  }

  async findPendingByEmail(
    tenantId: string,
    email: string,
    _tx?: unknown,
  ): Promise<StaffInvitation | null> {
    for (const row of this.rows.values())
      if (row.tenantId === tenantId && row.email === email && row.status === "pending")
        return hydrate(row);
    return null;
  }

  async findByTokenHash(
    tenantId: string,
    tokenHash: string,
    _tx?: unknown,
  ): Promise<StaffInvitation | null> {
    for (const row of this.rows.values())
      if (row.tenantId === tenantId && row.tokenHash === tokenHash) return hydrate(row);
    return null;
  }

  async listPending(tenantId: string, _tx?: unknown): Promise<readonly StaffInvitation[]> {
    return [...this.rows.values()]
      .filter((row) => row.tenantId === tenantId && row.status === "pending")
      .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0))
      .map(hydrate);
  }
}
