/**
 * The lead a merchant is paid for (P2-D5, D9): one `form_submitted` server event per submitted lead-form.
 *
 * `dedupId: lead_<leadId>` (the id `SubmitLead` already stores as the lead's `eventId`) is what each vendor receives
 * as its dedupe id; the envelope `eventId` is the tenant-scoped UUID derived from it (`businessMessageId`), so a
 * publish retried by the sweeper is the same outbox row. Vendor names: Meta/TikTok `Lead`, Snap `SIGN_UP`,
 * GA4 `generate_lead`. The read model has no message field: free text is never forwarded.
 */

import type { TrackingEnvelope } from "../envelope/envelope";
import { businessEventId } from "../ids/event-id";
import {
  attributionContextOf,
  businessEnvelope,
  e164Of,
  identityOf,
  instantOrThrow,
  pageContextOf,
  sessionContextOf,
  technicalContextOf,
} from "./envelope-parts";
import type { BusinessEventContext, LeadTrackingReadModel } from "./order-read-model";

export function leadEnvelope(
  lead: LeadTrackingReadModel,
  context: BusinessEventContext,
): TrackingEnvelope {
  const timestamp = instantOrThrow(lead.submittedAt, "lead.submittedAt");
  const dedupId = businessEventId("lead", lead.leadId);
  const snapshot = lead.snapshot;

  const technical = technicalContextOf(snapshot);
  const session = sessionContextOf(snapshot);
  const attribution = attributionContextOf(snapshot);

  return businessEnvelope({
    tenantId: context.tenantId,
    eventName: "form_submitted",
    dedupId,
    timestamp,
    category: "marketing",
    context: {
      page: pageContextOf(snapshot, context.storeUrl, context.currency),
      ...(session === undefined ? {} : { session }),
      ...(technical === undefined ? {} : { technical }),
      ...(attribution === undefined ? {} : { attribution }),
      identity: identityOf({
        email: lead.email,
        phone: e164Of([lead.phoneE164, lead.phone], context.currency),
        name: lead.name,
        visitorId: snapshot?.visitorId,
        sessionId: snapshot?.sessionId,
      }),
    },
  });
}
