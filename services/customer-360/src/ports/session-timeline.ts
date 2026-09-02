import type { SessionCloseReason } from "../domain/session-boundary";
import type { SessionTransitionKind } from "../domain/session-transition";

/**
 * One chronological entry in a visitor's session/journey provenance history — a session lifecycle
 * event (started/activity/closed) or a journey transition (organic or explicit). Mirrors
 * `IdentityTimelineEntry`'s "kind describes provenance" shape. Read-only projection; never
 * persisted as its own row — `GetJourneyTimeline` assembles it fresh from `SessionHistoryStore` +
 * `JourneyStore` on every read, the same way `GetIdentityTimeline` assembles its own entries from
 * `IdentityGraphStore` + `IdentityDecisionStore`.
 *
 * This is distinct from the cross-domain **Customer Timeline** (Phase 6.8), which will additionally
 * interleave commerce, marketing, consent and identity history; this timeline is session/journey
 * provenance only, one of that future timeline's inputs — same relationship
 * `GetIdentityTimeline`/`ProfileHistoryStore`'s own timelines already have to it.
 */
export type SessionTimelineEntry =
  | {
      readonly kind: "session_started" | "session_activity" | "session_closed";
      readonly occurredAt: string;
      readonly sessionId: string;
      readonly closeReason?: SessionCloseReason;
    }
  | {
      readonly kind: "transition";
      readonly occurredAt: string;
      readonly transitionId: string;
      readonly transitionKind: SessionTransitionKind;
      readonly fromSessionId?: string;
      readonly toSessionId?: string;
      readonly reason?: string;
      readonly actor?: string;
    };
