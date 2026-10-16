import { describe, expect, it } from "vitest";
import { openSession } from "../domain/customer-session";
import { InMemorySessionStore } from "./in-memory-session-store";
import { runSessionStoreContractTests } from "./session-store.contract";
import { TENANT_A } from "../test-support/tenants";

describe("InMemorySessionStore", () => {
  runSessionStoreContractTests("in-memory", () => new InMemorySessionStore());

  it("listSessionIds reports every saved session exactly once, even after a re-save", async () => {
    const store = new InMemorySessionStore();
    await store.saveCurrent(
      openSession({ sessionId: "s1", visitorId: "v1", startedAt: "t0" }),
      TENANT_A,
    );
    await store.saveCurrent(
      openSession({ sessionId: "s2", visitorId: "v1", startedAt: "t0" }),
      TENANT_A,
    );
    await store.saveCurrent(
      openSession({ sessionId: "s1", visitorId: "v1", startedAt: "t1" }),
      TENANT_A,
    );

    expect([...(await store.listSessionIds(TENANT_A))].sort()).toEqual(["s1", "s2"]);
  });
});
