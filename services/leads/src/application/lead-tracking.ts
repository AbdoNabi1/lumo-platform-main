import type { Lead } from "../domain/lead";
import type { LeadTrackingSubject } from "./ports";

/**
 * The one place a stored lead becomes what leaves the context for tracking. An explicit pick, not a spread: a field
 * added to the aggregate later is NOT forwarded until someone decides it should be, and `message` (free text the
 * visitor wrote to the merchant) is never among them.
 */
export function trackingSubjectOf(tenantId: string, lead: Lead): LeadTrackingSubject {
  const p = lead.props;
  return {
    tenantId,
    leadId: p.id,
    name: p.name,
    phone: p.phone,
    phoneE164: p.phoneE164,
    email: p.email,
    sessionId: p.sessionId,
    submittedAt: p.createdAt,
    attribution: p.attribution,
  };
}
