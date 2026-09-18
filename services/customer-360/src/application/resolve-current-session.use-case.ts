import type { UseCase } from "@platform/application";
import type { IdentifierType } from "@platform/tracking";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { CustomerSession } from "../domain/customer-session";
import type { SessionStore } from "../ports/session-store";
import type { ResolveIdentity } from "./resolve-identity.use-case";

export interface ResolveCurrentSessionInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly identifier: { readonly type: IdentifierType; readonly value: string };
}

export interface ResolveCurrentSessionOutput {
  /** `null` when the identifier resolves to no `visitor_id` with any open session. */
  readonly session: CustomerSession | null;
  /** Every `visitor_id` considered — just the seed's own value when it resolves to no cluster and
   * is itself a `visitor_id`; empty otherwise. */
  readonly consideredVisitorIds: readonly string[];
}

export interface ResolveCurrentSessionDeps {
  readonly sessions: SessionStore;
  /** Reused, not reimplemented — same "never duplicate Identity Graph" rule `GetCustomerProfile`
   * already follows: cross-device "current session" resolution goes through Identity Engine's own
   * `ResolveIdentity`, never a second identity-stitching implementation. */
  readonly resolveIdentity: ResolveIdentity;
}

/**
 * Resolves a customer's presently active session across every device/browser their identity
 * resolves to — the "Current Session" read model. `SessionStore` is keyed by `visitorId`
 * (`listOpenForVisitor`), so this walks every `visitor_id` in the seed identifier's resolved
 * cluster and picks the most recently active open session among them; a seed that is itself a
 * `visitor_id` with no cluster at all still resolves against its own value.
 */
export class ResolveCurrentSession implements UseCase<
  ResolveCurrentSessionInput,
  ResolveCurrentSessionOutput,
  DomainError
> {
  private readonly deps: ResolveCurrentSessionDeps;

  constructor(deps: ResolveCurrentSessionDeps) {
    this.deps = deps;
  }

  async execute(
    input: ResolveCurrentSessionInput,
  ): Promise<Result<ResolveCurrentSessionOutput, DomainError>> {
    const resolved = await this.deps.resolveIdentity.execute({
      tenantId: input.tenantId,
      ...input.identifier,
    });
    if (!resolved.ok) return resolved;

    const visitorIds: readonly string[] =
      resolved.value.cluster === null
        ? input.identifier.type === "visitor_id"
          ? [input.identifier.value]
          : []
        : resolved.value.cluster.resolved.members
            .filter((member) => member.type === "visitor_id")
            .map((member) => member.value);

    if (visitorIds.length === 0) {
      return ok({ session: null, consideredVisitorIds: [] });
    }

    let current: CustomerSession | null = null;
    for (const visitorId of visitorIds) {
      const open = await this.deps.sessions.listOpenForVisitor(visitorId, input.tenantId);
      for (const session of open) {
        if (current === null || session.lastActivityAt > current.lastActivityAt) {
          current = session;
        }
      }
    }

    return ok({ session: current, consideredVisitorIds: visitorIds });
  }
}
