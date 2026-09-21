import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { EventSerializer, IntegrationEvent } from "@platform/domain-events";
import type { Logger } from "@platform/utils";
import { wireSecurity } from "./composition";
import { InMemoryConsentProjectionStore } from "./infrastructure/consent-projection";
import { RecordingSessionRevocation } from "./infrastructure/in-memory-adapters";
import {
  ConsentChangedConsumer,
  type ConsentChangedPayload,
} from "./interfaces/consent-changed.consumer";
import {
  RelationWrittenConsumer,
  type SecurityRelationPayload,
} from "./interfaces/relation-sync.consumer";
import {
  SessionRevokedAllConsumer,
  type SessionRevokedAllPayload,
} from "./interfaces/session-revoked-all.consumer";
import type { RelationshipSyncPort } from "./application/authz-ports";
import type { RelationTupleProps } from "./domain/relationship";

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-07-18T00:00:00.000Z") };
const body = <T>(r: { body: unknown }): T => r.body as T;

/**
 * H-2 (G-SEC-4) end-to-end — the live identity seams exercised through the WIRED context with the same
 * consumers production runs (the Ory adapters are contract-tested in packages/auth; the runtime binds
 * them). Consent read is driven from an Identity event; session + relationship sync are driven from
 * Security's own outbox events into the enforcement ports.
 */
describe("H-2 live identity binding (end to end)", () => {
  it("projects consent from an Identity event and answers checkConsent", async () => {
    const consentStore = new InMemoryConsentProjectionStore();
    const app = wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      consentStore,
    });
    const consumer = new ConsentChangedConsumer({
      tenantId: "tenant-a",
      store: consentStore,
      logger: silent,
    });

    const grant: IntegrationEvent<ConsentChangedPayload> = {
      messageId: "e1",
      type: "identity.customer.consent_changed",
      eventVersion: 1,
      aggregateId: "cust-7",
      aggregateType: "customer",
      occurredAt: "2026-07-18T00:00:00.000Z",
      correlationId: "c",
      causationId: "c",
      payload: { scope: "marketing", granted: true },
      metadata: {},
    };
    await consumer.handle(grant);

    const decision = body<{ granted: boolean }>(
      await app.security.checkConsent({
        tenantId: "tenant-a",
        subjectRef: "cust-7",
        purpose: "marketing",
      }),
    );
    expect(decision.granted).toBe(true);
    const none = body<{ granted: boolean }>(
      await app.security.checkConsent({
        tenantId: "tenant-a",
        subjectRef: "cust-7",
        purpose: "analytics",
      }),
    );
    expect(none.granted).toBe(false);
  });

  it("emits security.session.revoked_all on revoke-all and syncs it to the session enforcement point", async () => {
    const sessionRevocation = new RecordingSessionRevocation();
    const app = wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      knownSubjects: ["kratos-7"],
      clock,
      sessionRevocation,
    });

    await app.security.registerPrincipal({
      tenantId: "tenant-a",
      externalId: "admin-1",
      kind: "human",
      displayName: "Admin",
      subjectRef: "kratos-7",
      tenantRef: "t1",
    });
    await app.security.establishSession({
      tenantId: "tenant-a",
      principalExternalId: "admin-1",
      refreshFingerprint: "rt-a",
      ttlSeconds: 3600,
    });
    await app.security.establishSession({
      tenantId: "tenant-a",
      principalExternalId: "admin-1",
      refreshFingerprint: "rt-b",
      ttlSeconds: 3600,
    });

    const revoked = body<{ revoked: number }>(
      await app.security.revokeAllSessions({
        tenantId: "tenant-a",
        principalExternalId: "admin-1",
      }),
    );
    expect(revoked.revoked).toBe(2);

    await app.drainOutbox();
    expect(app.deliveredEventTypes).toContain("security.session.revoked_all");

    // The runtime's session-sync consumer drives the revocation into Kratos (here: the recorder). The
    // event is keyed by the identity's external subjectRef so no lookup is needed.
    const evt: IntegrationEvent<SessionRevokedAllPayload> = {
      messageId: "s1",
      type: "security.session.revoked_all",
      eventVersion: 1,
      aggregateId: "id-1",
      aggregateType: "session",
      occurredAt: "2026-07-18T00:00:00.000Z",
      correlationId: "c",
      causationId: "c",
      payload: { key: "kratos-7", status: "revoked" },
      metadata: {},
    };
    await new SessionRevokedAllConsumer({ sessionRevocation, logger: silent }).handle(evt);
    expect(sessionRevocation.revokedIdentities()).toContain("kratos-7");
  });

  it("emits security.relation.written WITH the tenant and syncs the tenant-qualified tuple to the enforcement point", async () => {
    // Record every envelope the outbox serializes, so the consumer below is fed the REAL emitted event
    // (not a hand-built one) — that is what proves `event.tenantId` reaches the consumer (G-70).
    const inner = new InMemoryEventSerializer();
    const emitted: IntegrationEvent<unknown>[] = [];
    const serializer: EventSerializer = {
      contentType: inner.contentType,
      serialize: (event) => {
        emitted.push(event);
        return inner.serialize(event);
      },
      deserialize: (serialized) => inner.deserialize(serialized),
    };
    const app = wireSecurity({ serializer, idGenerator: sequentialIds(), clock });
    await app.security.writeRelationTuple({
      tenantId: "tenant-a",
      namespace: "permissions",
      object: "doc:1",
      relation: "viewer",
      subject: "principal:a",
    });
    await app.drainOutbox();
    expect(app.deliveredEventTypes).toContain("security.relation.written");

    const evt = emitted.find((e) => e.type === "security.relation.written") as
      IntegrationEvent<SecurityRelationPayload> | undefined;
    expect(evt?.tenantId).toBe("tenant-a");

    const writes: RelationTupleProps[] = [];
    const sync: RelationshipSyncPort = {
      write: async (t) => void writes.push(t),
      delete: async () => undefined,
    };
    await new RelationWrittenConsumer({ sync, logger: silent }).handle(evt!);
    expect(writes).toEqual([
      {
        namespace: "permissions",
        object: "tenant/tenant-a/doc:1",
        relation: "viewer",
        subject: "principal:a",
      },
    ]);
  });
});
