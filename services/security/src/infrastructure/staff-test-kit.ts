import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Principal } from "../domain/principal";
import type { StaffMutationLock } from "../domain/repositories";
import { RoleAssignment } from "../domain/role-assignment";
import { Session } from "../domain/session";
import { InMemoryPasswordCredentialStore } from "./in-memory-password-credential-store";
import { InMemorySecurityTelemetry } from "./in-memory-adapters";
import {
  InMemoryAuditLedgerRepository,
  InMemoryPrincipalRepository,
  InMemoryRoleAssignmentRepository,
  InMemoryRoleRepository,
  InMemorySessionRepository,
} from "./in-memory-repositories";
import { InMemoryStaffInvitationRepository } from "./in-memory-staff-invitation-repository";
import { InMemoryStaffMutationLock } from "./in-memory-staff-mutation-lock";
import { InMemoryUnitOfWork } from "./in-memory-unit-of-work";
import { SecurityEventTranslator } from "./security-event-translator";
import { AuditChain } from "../domain/audit-chain";
import type { StaffDeps } from "../application/deps";

/** A clock tests advance by hand. */
export class TestClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  set(next: Date): void {
    this.current = next;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export interface StaffKitOptions {
  readonly lock?: StaffMutationLock;
  readonly start?: Date;
  /** Stand-in for scrypt: the tests assert on its output, not on hash quality. */
  readonly hasher?: { hash(password: string): Promise<string> };
}

export interface SeedStaffInput {
  readonly externalId: string;
  readonly email: string;
  /** Active role keys to assign (e.g. `["admin"]`, `["platform-admin"]`). */
  readonly roles: readonly string[];
  readonly status?: "active" | "suspended";
  /** Defaults to true: an accepted staff member owns a `staff:<email>` credential. */
  readonly credential?: boolean;
}

/**
 * The staff use cases' dependency slice backed by the real in-memory adapters (no rollback, shared
 * aggregates — exactly what the validate-before-write discipline has to survive), plus seeding and a
 * byte-level snapshot of everything a staff command may touch.
 */
export function buildStaffKit(options: StaffKitOptions = {}) {
  const clock = new TestClock(options.start ?? new Date("2026-11-27T10:00:00.000Z"));
  let counter = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((counter += 1)).padStart(12, "0")}`,
  };
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new SecurityEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "security",
  });
  const rd = { outbox, context: rootEventContext(idGenerator) };
  const principals = new InMemoryPrincipalRepository(rd);
  const assignments = new InMemoryRoleAssignmentRepository(rd);
  const sessions = new InMemorySessionRepository(rd);
  const roles = new InMemoryRoleRepository(rd);
  const auditLedger = new InMemoryAuditLedgerRepository();
  const staffInvitations = new InMemoryStaffInvitationRepository();
  const staffCredentials = new InMemoryPasswordCredentialStore();
  const deps: StaffDeps = {
    principals,
    principalReader: principals,
    assignments,
    roles,
    sessions,
    staffInvitations,
    staffMutationLock: options.lock ?? new InMemoryStaffMutationLock(),
    staffCredentials,
    passwordHasher: options.hasher ?? { hash: (p) => Promise.resolve(`hashed:${p}`) },
    unitOfWork: new InMemoryUnitOfWork(),
    auditLedger,
    auditChain: new AuditChain(),
    outbox: {
      publish: (events, tenantId, tx) => outbox.write(events, { ...rd.context, tenantId }, tx),
    },
    idGenerator,
    clock,
    telemetry: new InMemorySecurityTelemetry(),
  };

  const id = (): UniqueEntityId => UniqueEntityId.from(idGenerator.generate());

  async function seedStaff(tenantId: string, input: SeedStaffInput): Promise<string> {
    const principal = Principal.register(
      id(),
      {
        externalId: input.externalId,
        kind: "human",
        displayName: input.email,
        subjectRef: input.externalId,
        tenantRef: tenantId,
      },
      idGenerator.generate(),
      clock.now(),
    );
    if (input.status === "suspended") principal.suspend(idGenerator.generate(), clock.now());
    await principals.save(principal, tenantId);
    for (const roleKey of input.roles) {
      await assignments.save(
        RoleAssignment.grant(
          id(),
          { principalRef: principal.id.toString(), roleKey, grantedBy: "seed" },
          idGenerator.generate(),
          clock.now(),
        ),
        tenantId,
      );
    }
    if (input.credential !== false) {
      await staffCredentials.save({
        tenantId,
        identifier: `staff:${input.email}`,
        principalExternalId: input.externalId,
        passwordHash: "seed-hash",
      });
    }
    return principal.id.toString();
  }

  async function seedSession(
    tenantId: string,
    principalInternalId: string,
    establishedAt: Date,
  ): Promise<void> {
    await sessions.save(
      Session.establish(
        id(),
        {
          principalRef: principalInternalId,
          refreshFingerprint: `fp-${idGenerator.generate()}`,
          expiresAt: new Date(establishedAt.getTime() + 3600_000),
        },
        idGenerator.generate(),
        establishedAt,
      ),
      tenantId,
    );
  }

  /**
   * Everything a staff command may write, as one JSON string: principals (status, version),
   * assignments (status, version), roles, sessions, invitations (given ids + the pending ones),
   * the staff credentials (identifier → owner → hash) and the audit ledger. Compare before/after.
   */
  async function snapshot(
    tenantId: string,
    invitationIds: readonly string[] = [],
  ): Promise<string> {
    const summaries = [...(await principals.listSummaries(tenantId))].sort((a, b) =>
      a.externalId < b.externalId ? -1 : 1,
    );
    const principalState = [];
    for (const s of summaries) {
      const p = await principals.findByExternalId(s.externalId, tenantId);
      const rows = (await assignments.listByPrincipal(s.id, tenantId))
        .map((a) => ({
          roleKey: a.roleKey,
          status: a.status,
          version: a.version,
          grantedBy: a.grantedBy,
        }))
        .sort((a, b) => (a.roleKey + a.status < b.roleKey + b.status ? -1 : 1));
      const sess = (await sessions.listByPrincipal(s.id, tenantId))
        .map((x) => ({ status: x.status, version: x.version }))
        .sort((a, b) => (a.status < b.status ? -1 : 1));
      principalState.push({
        externalId: s.externalId,
        status: p?.status,
        version: p?.version,
        createdAt: s.createdAt.toISOString(),
        assignments: rows,
        sessions: sess,
      });
    }
    const invitations = [];
    const seen = new Set<string>();
    for (const inv of await staffInvitations.listPending(tenantId)) seen.add(inv.id.toString());
    for (const invitationId of [...seen, ...invitationIds]) {
      const inv = await staffInvitations.findById(tenantId, invitationId);
      if (inv === null) continue;
      invitations.push({
        id: inv.id.toString(),
        email: inv.email,
        status: inv.status,
        version: inv.version,
        tokenHash: inv.tokenHash,
        expiresAt: inv.expiresAt.toISOString(),
        acceptedAt: inv.acceptedAt?.toISOString() ?? null,
      });
    }
    invitations.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const credentials = [];
    for (const owner of await staffCredentials.listByPrefix(tenantId, "")) {
      const full = await staffCredentials.find(tenantId, owner.identifier);
      credentials.push(full === null ? owner : { ...owner, hash: full.passwordHash });
    }
    const roleRows = (await roles.listAll(tenantId)).map((r) => r.key).sort();
    const audit = (await auditLedger.list(null, tenantId)).map((r) => ({
      action: r.content.action,
      principalRef: r.content.principalRef,
      metadata: r.content.metadata,
    }));
    return JSON.stringify({ principalState, invitations, credentials, roleRows, audit });
  }

  return {
    deps,
    clock,
    id,
    seedStaff,
    seedSession,
    snapshot,
    principals,
    assignments,
    staffInvitations,
    staffCredentials,
    sessions,
  };
}

export type StaffKit = ReturnType<typeof buildStaffKit>;
