import type { AuditEvent, AuditTrail, IdGenerator } from "@platform/contracts";
import type { Database } from "../client";

/**
 * Production `AuditTrail` (ADR-0009) on `platform.audit_events`. Append-only by contract — this
 * adapter only ever INSERTs; there is deliberately no update/delete path (SOC2 CC7 / PCI DSS 10.x).
 * A failure to record propagates to the caller so the guard fails the action (an unauditable
 * mutation is worse than a rejected one — see the `AuditTrail` port contract). Mirrors the existing
 * `platform`-schema stores (`PrismaOutboxStore`/`PrismaDeadLetterStore`): no business logic, pure
 * persistence of the contract shape.
 */
export class PrismaAuditTrail implements AuditTrail {
  private readonly prisma: Database;
  private readonly idGenerator: IdGenerator;

  constructor(prisma: Database, idGenerator: IdGenerator) {
    this.prisma = prisma;
    this.idGenerator = idGenerator;
  }

  async record(event: AuditEvent): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        id: this.idGenerator.generate(),
        principalId: event.principalId,
        principalKind: event.principalKind,
        permission: event.permission,
        decision: event.decision,
        occurredAt: new Date(event.occurredAt),
        ...(event.tenantId !== undefined ? { tenantId: event.tenantId } : {}),
        ...(event.metadata !== undefined ? { metadata: { ...event.metadata } } : {}),
      },
    });
  }
}
