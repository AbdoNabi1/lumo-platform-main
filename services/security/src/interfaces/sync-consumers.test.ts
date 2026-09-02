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

function relEvent(key: string): IntegrationEvent<SecurityRelationPayload> {
  return {
    messageId: "m",
    type: "security.relation.written",
    eventVersion: 1,
    aggregateId: "t1",
    aggregateType: "relation",
    occurredAt: "2026-07-18T00:00:00.000Z",
    correlationId: "c",
    causationId: "c",
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

describe("relationship synchronization (H-2)", () => {
  it("parses the tuple key and writes it to the sync port", async () => {
    const sync = recordingSync();
    await new RelationWrittenConsumer({ sync, logger: silent }).handle(
      relEvent("permissions:doc:1#viewer@principal:a"),
    );
    expect(sync.writes).toEqual([
      { namespace: "permissions", object: "doc:1", relation: "viewer", subject: "principal:a" },
    ]);
  });

  it("round-trips a subject-set subject through the key", async () => {
    const sync = recordingSync();
    await new RelationWrittenConsumer({ sync, logger: silent }).handle(
      relEvent("permissions:doc:1#viewer@group:eng#member"),
    );
    expect(sync.writes[0]).toEqual({
      namespace: "permissions",
      object: "doc:1",
      relation: "viewer",
      subject: "group:eng#member",
    });
  });

  it("deletes the enforcement tuple on relation.deleted", async () => {
    const sync = recordingSync();
    await new RelationDeletedConsumer({ sync, logger: silent }).handle(
      relEvent("permissions:doc:1#viewer@principal:a"),
    );
    expect(sync.deletes).toHaveLength(1);
  });

  it("skips (does not throw) on an unparseable key", async () => {
    const sync = recordingSync();
    await expect(
      new RelationWrittenConsumer({ sync, logger: silent }).handle(relEvent("not-a-tuple")),
    ).resolves.toBeUndefined();
    expect(sync.writes).toHaveLength(0);
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
