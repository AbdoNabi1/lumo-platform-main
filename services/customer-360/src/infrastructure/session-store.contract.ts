import { describe, expect, it } from "vitest";
import { closeSession, openSession } from "../domain/customer-session";
import type { SessionStore } from "../ports/session-store";

/**
 * Repository parity contract: the same behavioral assertions run against every `SessionStore`
 * adapter, mirroring `runProfileStoreContractTests`'s shape exactly (same package, same reason —
 * proving the in-memory and Prisma implementations honor the identical port contract). Call once
 * per adapter with a fresh store factory.
 */
/**
 * Phase A.20 (Task 7): real ISO timestamps standing in for the placeholder strings `"t0"`/`"t1"`.
 * Harmless against the in-memory adapter (never parsed as a `Date`), but this suite is also run
 * against the Prisma-backed adapter, which writes them into real PostgreSQL `DateTime` columns —
 * `new Date("t0")` is Invalid Date there. See PHASE_A19_REAL_POSTGRESQL_VALIDATION_REPORT.md §10.
 */
const T0 = "2026-07-20T23:59:59.000Z";
const T1 = "2026-07-21T00:00:01.000Z";
export function runSessionStoreContractTests(
  adapterName: string,
  makeStore: () => SessionStore,
): void {
  describe(`SessionStore contract — ${adapterName}`, () => {
    it("getCurrent returns null for a session that was never saved", async () => {
      const store = makeStore();
      expect(await store.getCurrent(`contract-${adapterName}-missing`)).toBeNull();
    });

    it("saveCurrent then getCurrent round-trips status/version/pageCount", async () => {
      const store = makeStore();
      const sessionId = `contract-${adapterName}-1`;
      const session = openSession({
        sessionId,
        visitorId: "visitor-1",
        startedAt: "2026-07-21T00:00:00.000Z",
      });

      await store.saveCurrent(session);
      const loaded = await store.getCurrent(sessionId);

      expect(loaded).not.toBeNull();
      expect(loaded?.status).toBe("open");
      expect(loaded?.version).toBe(session.version);
      expect(loaded?.pageCount).toBe(session.pageCount);
    });

    it("saveCurrent upserts — a second save replaces rather than duplicates", async () => {
      const store = makeStore();
      const sessionId = `contract-${adapterName}-2`;
      const opened = openSession({ sessionId, visitorId: "visitor-1", startedAt: T0 });
      const closed = closeSession(opened, "manual_logout", T1);

      await store.saveCurrent(opened);
      await store.saveCurrent(closed);
      const loaded = await store.getCurrent(sessionId);

      expect(loaded?.status).toBe("closed");
      expect(loaded?.closeReason).toBe("manual_logout");
    });

    it("listOpenForVisitor reports only open sessions for that visitor", async () => {
      const store = makeStore();
      const visitorId = `contract-${adapterName}-visitor`;
      const open = openSession({ sessionId: `${visitorId}-open`, visitorId, startedAt: T0 });
      const closed = closeSession(
        openSession({ sessionId: `${visitorId}-closed`, visitorId, startedAt: T0 }),
        "timeout",
        T1,
      );
      const otherVisitor = openSession({
        sessionId: `${visitorId}-other`,
        visitorId: "someone-else",
        startedAt: T0,
      });

      await store.saveCurrent(open);
      await store.saveCurrent(closed);
      await store.saveCurrent(otherVisitor);

      const result = await store.listOpenForVisitor(visitorId);
      expect(result.map((s) => s.sessionId)).toEqual([open.sessionId]);
    });

    it("listForVisitor reports every session (open and closed) for that visitor", async () => {
      const store = makeStore();
      const visitorId = `contract-${adapterName}-visitor-2`;
      const open = openSession({ sessionId: `${visitorId}-open`, visitorId, startedAt: T0 });
      const closed = closeSession(
        openSession({ sessionId: `${visitorId}-closed`, visitorId, startedAt: T0 }),
        "timeout",
        T1,
      );

      await store.saveCurrent(open);
      await store.saveCurrent(closed);

      const result = await store.listForVisitor(visitorId);
      expect(result.map((s) => s.sessionId).sort()).toEqual(
        [open.sessionId, closed.sessionId].sort(),
      );
    });
  });
}
