import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { journeyState, type JourneyState } from "../domain/session-views";
import type { JourneyStore } from "../ports/journey-store";
import type { SessionStore } from "../ports/session-store";

export interface GetJourneyStateInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly visitorId: string;
}

export interface GetJourneyStateOutput {
  readonly state: JourneyState;
}

export interface GetJourneyStateDeps {
  readonly sessions: SessionStore;
  readonly journey: JourneyStore;
}

/**
 * The "Journey State" read model — a visitor's current position in their own journey (session
 * count, current open session, span, identified/anonymous). A thin composition over
 * `SessionStore.listForVisitor` + `JourneyStore.listForVisitor` and the pure `journeyState` view
 * (`domain/session-views.ts`) — the same "load, then derive" shape `GetCustomerProfile` uses for its
 * own named views.
 */
export class GetJourneyState implements UseCase<
  GetJourneyStateInput,
  GetJourneyStateOutput,
  DomainError
> {
  private readonly deps: GetJourneyStateDeps;

  constructor(deps: GetJourneyStateDeps) {
    this.deps = deps;
  }

  async execute(input: GetJourneyStateInput): Promise<Result<GetJourneyStateOutput, DomainError>> {
    const [sessions, transitions] = await Promise.all([
      this.deps.sessions.listForVisitor(input.visitorId, input.tenantId),
      this.deps.journey.listForVisitor(input.visitorId, input.tenantId),
    ]);

    return ok({ state: journeyState(input.visitorId, sessions, transitions) });
  }
}
