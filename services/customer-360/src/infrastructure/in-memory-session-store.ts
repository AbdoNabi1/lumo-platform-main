import type { CustomerSession } from "../domain/customer-session";
import type { SessionStore } from "../ports/session-store";
import { bucket } from "./tenant-seed";

/** In-memory adapter — dev/test only. No outbox dependency: like `InMemoryProfileStore`, this store
 * never publishes an event of its own — the event always travels with the paired
 * `SessionHistoryStore.append` call instead, so it is published exactly once. */
export class InMemorySessionStore implements SessionStore {
  private readonly tenants = new Map<string, Map<string, CustomerSession>>();

  private current(tenantId: string): Map<string, CustomerSession> {
    return bucket(this.tenants, tenantId, () => new Map<string, CustomerSession>());
  }

  async getCurrent(sessionId: string, tenantId: string): Promise<CustomerSession | null> {
    return this.current(tenantId).get(sessionId) ?? null;
  }

  async saveCurrent(session: CustomerSession, tenantId: string): Promise<void> {
    this.current(tenantId).set(session.sessionId, session);
  }

  async listOpenForVisitor(
    visitorId: string,
    tenantId: string,
  ): Promise<readonly CustomerSession[]> {
    return [...this.current(tenantId).values()].filter(
      (session) => session.visitorId === visitorId && session.status === "open",
    );
  }

  async listForVisitor(visitorId: string, tenantId: string): Promise<readonly CustomerSession[]> {
    return [...this.current(tenantId).values()].filter(
      (session) => session.visitorId === visitorId,
    );
  }

  async listSessionIds(tenantId: string): Promise<readonly string[]> {
    return [...this.current(tenantId).keys()];
  }
}
