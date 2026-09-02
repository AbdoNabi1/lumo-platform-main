import type { CustomerSession } from "../domain/customer-session";
import type { SessionStore } from "../ports/session-store";

/** In-memory adapter — dev/test only. No outbox dependency: like `InMemoryProfileStore`, this store
 * never publishes an event of its own — the event always travels with the paired
 * `SessionHistoryStore.append` call instead, so it is published exactly once. */
export class InMemorySessionStore implements SessionStore {
  private readonly current = new Map<string, CustomerSession>();

  async getCurrent(sessionId: string): Promise<CustomerSession | null> {
    return this.current.get(sessionId) ?? null;
  }

  async saveCurrent(session: CustomerSession): Promise<void> {
    this.current.set(session.sessionId, session);
  }

  async listOpenForVisitor(visitorId: string): Promise<readonly CustomerSession[]> {
    return [...this.current.values()].filter(
      (session) => session.visitorId === visitorId && session.status === "open",
    );
  }

  async listForVisitor(visitorId: string): Promise<readonly CustomerSession[]> {
    return [...this.current.values()].filter((session) => session.visitorId === visitorId);
  }

  async listSessionIds(): Promise<readonly string[]> {
    return [...this.current.keys()];
  }
}
