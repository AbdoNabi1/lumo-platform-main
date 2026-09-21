import { describe, expect, it } from "vitest";
import type { IntegrationEvent } from "@platform/domain-events";
import type { Logger } from "@platform/utils";
import type { RelationshipSyncPort } from "../application/authz-ports";
import type { SessionRevocationPort } from "../application/ports";
import type { RelationTupleProps } from "../domain/relationship";
import {
  RelationDeletedConsumer,
  RelationWrittenConsumer,
  type SecurityRelationPayload,
} from "./relation-sync.consumer";
import {
  SessionRevokedAllConsumer,
  type SessionRevokedAllPayload,
} from "./session-revoked-all.consumer";

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

function relEvent(
  key: string,
  tenantId: string | null = "tenant-a", // null = an envelope with no tenant
): IntegrationEvent<SecurityRelationPayload> {
  return {
    messageId: "m",
    type: "security.relation.written",
    eventVersion: 1,
    aggregateId: "t1",
    aggregateType: "relation",
    occurredAt: "2026-07-18T00:00:00.000Z",
    correlationId: "c",
    causationId: "c",
    ...(tenantId !== null ? { tenantId } : {}),
    payload: { key },
    metadata: {},
  };
}
function sessionEvent(key: string): IntegrationEvent<SessionRevokedAllPayload> {
  return {
    messageId: "m",
    type: "security.session.revoked_all",
    eventVersion: 1,
    aggregateId: "p1",
    aggregateType: "session",
    occurredAt: "2026-07-18T00:00:00.000Z",
    correlationId: "c",
    causationId: "c",
    payload: { key, status: "revoked" },
    metadata: {},
  };
}

function recordingSync(): RelationshipSyncPort & {
  writes: RelationTupleProps[];
  deletes: RelationTupleProps[];
} {
  const writes: RelationTupleProps[] = [];
  const deletes: RelationTupleProps[] = [];
  return {
    writes,
    deletes,
    write: async (t) => void writes.push(t),
    delete: async (t) => void deletes.push(t),
  };
}

function capturingLogger(): Logger & {
  warns: { message: string }[];
  errors: { message: string }[];
} {
  const warns: { message: string }[] = [];
  const errors: { message: string }[] = [];
  return {
    ...silent,
    warns,
    errors,
    warn: (message: string) => void warns.push({ message }),
    error: (message: string) => void errors.push({ message }),
  };
}

describe("relationship synchronization (H-2)", () => {
  it("parses the tuple key and writes ONLY the tenant-qualified tuple (G-70, contracted)", async () => {
    const sync = recordingSync();
    await new RelationWrittenConsumer({ sync, logger: silent }).handle(
      relEvent("permissions:doc:1#viewer@principal:a"),
    );
    expect(sync.writes).toEqual([
      {
        namespace: "permissions",
        object: "tenant/tenant-a/doc:1",
        relation: "viewer",
        subject: "principal:a",
      },
    ]);
  });

  it("round-trips a subject-set subject through the key", async () => {
    const sync = recordingSync();
    await new RelationWrittenConsumer({ sync, logger: silent }).handle(
      relEvent("permissions:doc:1#viewer@group:eng#member"),
    );
    expect(sync.writes).toEqual([
      {
        namespace: "permissions",
        object: "tenant/tenant-a/doc:1",
        relation: "viewer",
        subject: "group:eng#member",
      },
    ]);
  });

  it("qualifies with the ENVELOPE's tenant, not a fixed one", async () => {
    const sync = recordingSync();
    await new RelationWrittenConsumer({ sync, logger: silent }).handle(
      relEvent("permissions:orders:refund#granted@user-1", "tenant-b"),
    );
    expect(sync.writes.map((t) => t.object)).toEqual(["tenant/tenant-b/orders:refund"]);
  });

  it("revokes the qualified tuple first, then sweeps any stray bare one", async () => {
    const sync = recordingSync();
    await new RelationDeletedConsumer({ sync, logger: silent }).handle(
      relEvent("permissions:doc:1#viewer@principal:a"),
    );
    expect(sync.deletes.map((t) => t.object)).toEqual(["tenant/tenant-a/doc:1", "doc:1"]);
  });

  it("skips (does not throw) on an unparseable key", async () => {
    const sync = recordingSync();
    await expect(
      new RelationWrittenConsumer({ sync, logger: silent }).handle(relEvent("not-a-tuple")),
    ).resolves.toBeUndefined();
    expect(sync.writes).toHaveLength(0);
  });

  describe("an envelope with no tenant (IntegrationEvent.tenantId is optional)", () => {
    it("write: writes NOTHING — no bare tuple either — and warns", async () => {
      const sync = recordingSync();
      const logger = capturingLogger();
      await expect(
        new RelationWrittenConsumer({ sync, logger }).handle(
          relEvent("permissions:orders:refund#granted@user-1", null),
        ),
      ).resolves.toBeUndefined();
      expect(sync.writes).toEqual([]);
      expect(logger.warns).toHaveLength(1);
      expect(logger.warns[0]?.message).toMatch(/no tenant/);
    });

    it("write: an empty-string tenant is treated as absent", async () => {
      const sync = recordingSync();
      await new RelationWrittenConsumer({ sync, logger: silent }).handle(
        relEvent("permissions:orders:refund#granted@user-1", ""),
      );
      expect(sync.writes).toEqual([]);
    });

    it("delete: THROWS (to retry/DLQ) rather than acknowledge a revocation it cannot apply", async () => {
      // A skipped write denies; a skipped delete ALLOWS. So this must not be a quiet warn-and-ack.
      const sync = recordingSync();
      const logger = capturingLogger();
      await expect(
        new RelationDeletedConsumer({ sync, logger }).handle(
          relEvent("permissions:orders:refund#granted@user-1", null),
        ),
      ).rejects.toThrow(/cannot be revoked/);
      expect(sync.deletes).toEqual([]);
      expect(logger.errors[0]?.message).toMatch(/revocation was NOT applied/);
    });

    it("delete: an empty-string tenant is treated as absent too", async () => {
      const sync = recordingSync();
      await expect(
        new RelationDeletedConsumer({ sync, logger: silent }).handle(
          relEvent("permissions:orders:refund#granted@user-1", ""),
        ),
      ).rejects.toThrow(/cannot be revoked/);
      expect(sync.deletes).toEqual([]);
    });
  });
});

describe("session synchronization (H-2)", () => {
  it("propagates revoke_all to the session-revocation port keyed by identity id", async () => {
    const revoked: string[] = [];
    const port: SessionRevocationPort = {
      revokeAllForIdentity: async (id) => void revoked.push(id),
    };
    await new SessionRevokedAllConsumer({ sessionRevocation: port, logger: silent }).handle(
      sessionEvent("kratos-identity-9"),
    );
    expect(revoked).toEqual(["kratos-identity-9"]);
  });

  it("re-throws a Kratos failure so the retry/DLQ pipeline re-drives it", async () => {
    const port: SessionRevocationPort = {
      revokeAllForIdentity: async () => {
        throw new Error("kratos down");
      },
    };
    await expect(
      new SessionRevokedAllConsumer({ sessionRevocation: port, logger: silent }).handle(
        sessionEvent("id"),
      ),
    ).rejects.toThrow(/kratos down/);
  });

  it("skips an event with no identity id", async () => {
    const revoked: string[] = [];
    const port: SessionRevocationPort = {
      revokeAllForIdentity: async (id) => void revoked.push(id),
    };
    await new SessionRevokedAllConsumer({ sessionRevocation: port, logger: silent }).handle(
      sessionEvent(""),
    );
    expect(revoked).toHaveLength(0);
  });
});
