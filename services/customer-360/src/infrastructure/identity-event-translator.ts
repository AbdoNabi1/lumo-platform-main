import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { IdentityLinkObserved } from "../events/identity-link-observed.event";
import { IdentityMerged } from "../events/identity-merged.event";
import { IdentitySplit } from "../events/identity-split.event";
import { ProfileCreated } from "../events/profile-created.event";
import { ProfileUpdated } from "../events/profile-updated.event";
import { ProfileRebuilt } from "../events/profile-rebuilt.event";
import { SessionStarted } from "../events/session-started.event";
import { SessionUpdated } from "../events/session-updated.event";
import { SessionClosed } from "../events/session-closed.event";
import { SessionMerged } from "../events/session-merged.event";
import { SessionSplit } from "../events/session-split.event";
import { AttributeCreated } from "../events/attribute-created.event";
import { AttributeUpdated } from "../events/attribute-updated.event";
import { AttributeRebuilt } from "../events/attribute-rebuilt.event";
import { SegmentCreated } from "../events/segment-created.event";
import { SegmentUpdated } from "../events/segment-updated.event";
import { SegmentDeleted } from "../events/segment-deleted.event";
import { CustomerEnteredSegment } from "../events/customer-entered-segment.event";
import { CustomerExitedSegment } from "../events/customer-exited-segment.event";
import { MembershipRebuilt } from "../events/membership-rebuilt.event";

/** Maps Customer 360's domain events to `customer360.identity.*` / `customer360.profile.*` /
 * `customer360.session.*` integration events (docs/architecture/20 §1.1). One translator for the
 * whole context, covering the Identity Engine (Phase 6.1), the Profile Engine (Phase 6.2), the
 * Session Stitching Engine (Phase 6.3), the Computed Attributes Engine (Phase 6.4) and the
 * Segmentation Engine (Phase 6.5) — matches the established one-translator-per-context convention
 * (e.g. Security's single translator spans all of its sub-areas), not a translator per capability. */
export class IdentityEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof IdentityLinkObserved) {
      return {
        type: "customer360.identity.link_observed",
        eventVersion: 1,
        aggregateType: "identity",
        payload: { ...event.data },
      };
    }
    if (event instanceof IdentityMerged) {
      return {
        type: "customer360.identity.merged",
        eventVersion: 1,
        aggregateType: "identity",
        payload: { ...event.data },
      };
    }
    if (event instanceof IdentitySplit) {
      return {
        type: "customer360.identity.split",
        eventVersion: 1,
        aggregateType: "identity",
        payload: { ...event.data },
      };
    }
    if (event instanceof ProfileCreated) {
      return {
        type: "customer360.profile.created",
        eventVersion: 1,
        aggregateType: "profile",
        payload: { ...event.data },
      };
    }
    if (event instanceof ProfileUpdated) {
      return {
        type: "customer360.profile.updated",
        eventVersion: 1,
        aggregateType: "profile",
        payload: { ...event.data },
      };
    }
    if (event instanceof ProfileRebuilt) {
      return {
        type: "customer360.profile.rebuilt",
        eventVersion: 1,
        aggregateType: "profile",
        payload: { ...event.data },
      };
    }
    if (event instanceof SessionStarted) {
      return {
        type: "customer360.session.started",
        eventVersion: 1,
        aggregateType: "session",
        payload: { ...event.data },
      };
    }
    if (event instanceof SessionUpdated) {
      return {
        type: "customer360.session.updated",
        eventVersion: 1,
        aggregateType: "session",
        payload: { ...event.data },
      };
    }
    if (event instanceof SessionClosed) {
      return {
        type: "customer360.session.closed",
        eventVersion: 1,
        aggregateType: "session",
        payload: { ...event.data },
      };
    }
    if (event instanceof SessionMerged) {
      return {
        type: "customer360.session.merged",
        eventVersion: 1,
        aggregateType: "session",
        payload: { ...event.data },
      };
    }
    if (event instanceof SessionSplit) {
      return {
        type: "customer360.session.split",
        eventVersion: 1,
        aggregateType: "session",
        payload: { ...event.data },
      };
    }
    if (event instanceof AttributeCreated) {
      return {
        type: "customer360.attribute.created",
        eventVersion: 1,
        aggregateType: "attribute",
        payload: { ...event.data },
      };
    }
    if (event instanceof AttributeUpdated) {
      return {
        type: "customer360.attribute.updated",
        eventVersion: 1,
        aggregateType: "attribute",
        payload: { ...event.data },
      };
    }
    if (event instanceof AttributeRebuilt) {
      return {
        type: "customer360.attribute.rebuilt",
        eventVersion: 1,
        aggregateType: "attribute",
        payload: { ...event.data },
      };
    }
    if (event instanceof SegmentCreated) {
      return {
        type: "customer360.segment.created",
        eventVersion: 1,
        aggregateType: "segment",
        payload: { ...event.data },
      };
    }
    if (event instanceof SegmentUpdated) {
      return {
        type: "customer360.segment.updated",
        eventVersion: 1,
        aggregateType: "segment",
        payload: { ...event.data },
      };
    }
    if (event instanceof SegmentDeleted) {
      return {
        type: "customer360.segment.deleted",
        eventVersion: 1,
        aggregateType: "segment",
        payload: { ...event.data },
      };
    }
    if (event instanceof CustomerEnteredSegment) {
      return {
        type: "customer360.segment_membership.entered",
        eventVersion: 1,
        aggregateType: "segment_membership",
        payload: { ...event.data },
      };
    }
    if (event instanceof CustomerExitedSegment) {
      return {
        type: "customer360.segment_membership.exited",
        eventVersion: 1,
        aggregateType: "segment_membership",
        payload: { ...event.data },
      };
    }
    if (event instanceof MembershipRebuilt) {
      return {
        type: "customer360.segment_membership.rebuilt",
        eventVersion: 1,
        aggregateType: "segment_membership",
        payload: { ...event.data },
      };
    }
    return undefined;
  }
}

export const CUSTOMER360_PUBLISHED_EVENTS = [
  "customer360.identity.link_observed",
  "customer360.identity.merged",
  "customer360.identity.split",
  "customer360.profile.created",
  "customer360.profile.updated",
  "customer360.profile.rebuilt",
  "customer360.session.started",
  "customer360.session.updated",
  "customer360.session.closed",
  "customer360.session.merged",
  "customer360.session.split",
  "customer360.attribute.created",
  "customer360.attribute.updated",
  "customer360.attribute.rebuilt",
  "customer360.segment.created",
  "customer360.segment.updated",
  "customer360.segment.deleted",
  "customer360.segment_membership.entered",
  "customer360.segment_membership.exited",
  "customer360.segment_membership.rebuilt",
] as const;
