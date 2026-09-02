import type { Clock } from "@platform/contracts";
import type { IdentifierType } from "@platform/tracking";
import type {
  GetCustomerProfile,
  GetCustomerProfileInput,
} from "../application/get-customer-profile.use-case";
import type {
  GetIdentityTimeline,
  GetIdentityTimelineInput,
} from "../application/get-identity-timeline.use-case";
import type {
  GetJourneyState,
  GetJourneyStateInput,
} from "../application/get-journey-state.use-case";
import type {
  GetJourneyTimeline,
  GetJourneyTimelineInput,
} from "../application/get-journey-timeline.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface Customer360ControllerDeps {
  readonly getCustomerProfile: GetCustomerProfile;
  readonly getIdentityTimeline: GetIdentityTimeline;
  readonly getJourneyTimeline: GetJourneyTimeline;
  readonly getJourneyState: GetJourneyState;
  readonly clock: Clock;
}

export interface GetProfileRequest {
  readonly identifierType: IdentifierType;
  readonly identifierValue: string;
  readonly expectedFields?: readonly string[];
}

export interface GetIdentifierTimelineRequest {
  readonly identifierType: IdentifierType;
  readonly identifierValue: string;
}

export interface GetVisitorJourneyRequest {
  readonly visitorId: string;
}

/**
 * Framework-agnostic interface boundary for Customer-360's read side (Profile Engine, Identity
 * Engine history, Session-Stitching journey) — the context's four existing read use-cases had no
 * `interfaces/` layer at all (Phase 6.2–6.3 exposed them only as composed use-case instances on
 * `WiredCustomer360`). This wraps them exactly like every other context's Controller (D-026/`present`
 * boundary), adding no new read logic — `now` for the profile merge comes from the injected `Clock`,
 * not the caller, so the domain stays deterministic (per `GetCustomerProfileInput`'s own contract).
 */
export class Customer360Controller {
  private readonly deps: Customer360ControllerDeps;

  constructor(deps: Customer360ControllerDeps) {
    this.deps = deps;
  }

  async getProfile(request: GetProfileRequest): Promise<ControllerResponse> {
    const input: GetCustomerProfileInput = {
      identifier: { type: request.identifierType, value: request.identifierValue },
      expectedFields: request.expectedFields,
      now: this.deps.clock.now().toISOString(),
    };
    return present(await this.deps.getCustomerProfile.execute(input), 200);
  }

  async getIdentityTimeline(request: GetIdentifierTimelineRequest): Promise<ControllerResponse> {
    const input: GetIdentityTimelineInput = {
      identifier: { type: request.identifierType, value: request.identifierValue },
    };
    return present(await this.deps.getIdentityTimeline.execute(input), 200);
  }

  async getJourneyTimeline(request: GetVisitorJourneyRequest): Promise<ControllerResponse> {
    const input: GetJourneyTimelineInput = { visitorId: request.visitorId };
    return present(await this.deps.getJourneyTimeline.execute(input), 200);
  }

  async getJourneyState(request: GetVisitorJourneyRequest): Promise<ControllerResponse> {
    const input: GetJourneyStateInput = { visitorId: request.visitorId };
    return present(await this.deps.getJourneyState.execute(input), 200);
  }
}
