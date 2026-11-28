/**
 * The runtime adapter of the leads service's `LeadTrackingPort` (Tracking P2-D9, survey §3 option A): a saved lead
 * becomes one server `form_submitted` event (Meta/TikTok `Lead`, Snap `SIGN_UP`, GA4 `generate_lead`).
 *
 * What it does with one lead: maps the lead's own attribution onto the shared `BusinessAttributionSnapshot`, builds the
 * envelope with the pure `leadEnvelope` mapper (`dedupId: lead_<id>`, derived UUID `eventId`, raw identity block, consent
 * stamped later by the store's policy at ingest), resolves the store's address for the `event_source_url` of a lead that
 * has no page url, and hands it to the outbox through the SAME publish routine the order consumers use
 * (`publishTrackingEnvelope`). Nothing else leaves: the port has no `message`, and the mapper has no field for one.
 *
 * Idempotent by construction (`skipDuplicates` on the derived message id), which is what lets both the request path and
 * the sweeper call it for the same lead. It throws when the event could not be handed over — the caller keeps the lead
 * `pending`. A malformed lead id is a `RangeError` (bad forever); the sweeper keeps counting it as an error and the lead
 * ages out after seven days.
 */

import type { EventSerializer } from "@platform/domain-events";
import type { EventPublisher } from "@platform/messaging";
import type { BusinessAttributionSnapshot, LeadTrackingReadModel } from "@platform/tracking";
import { leadEnvelope } from "@platform/tracking";
import type { LeadTrackingPort, LeadTrackingSubject } from "@platform/admin";

import type { StoreUrlResolver } from "./prisma-store-url-resolver";
import { publishTrackingEnvelope, StoreUrlUnavailableError } from "./publish-tracking-envelope";

export type LeadTrackingSubjectLike = LeadTrackingSubject;

/** The producer name stamped on the published lead events. */
const PRODUCER = "tracking-lead";

export interface LeadTrackingEmitterDeps {
  readonly storeUrls: StoreUrlResolver;
  /** The Postgres outbox publisher (P2-D6). */
  readonly publisher: Pick<EventPublisher, "publish">;
  readonly serializer: EventSerializer;
  readonly clock: { now(): Date };
}

const present = (value: string | null | undefined): string | undefined =>
  value === null || value === undefined || value === "" ? undefined : value;

/** The lead's stored attribution as the shared snapshot shape (absent pieces stay absent). */
export function snapshotOfLead(subject: LeadTrackingSubject): BusinessAttributionSnapshot {
  const a = subject.attribution;
  const cookies = Object.fromEntries(
    Object.entries(a.cookies).filter(([, value]) => typeof value === "string" && value !== ""),
  ) as NonNullable<BusinessAttributionSnapshot["cookies"]>;
  const ip = present(a.ip);
  const userAgent = present(a.userAgent);
  const pageUrl = present(a.pageUrl);
  const referrer = present(a.referrer);
  return {
    // the lead's session id is the visitor's `morbeh_sid` (the same id the once-per-session claim used)
    sessionId: subject.sessionId,
    ...(a.visitorId === undefined ? {} : { visitorId: a.visitorId }),
    ...(ip === undefined ? {} : { ip }),
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(pageUrl === undefined ? {} : { pageUrl }),
    ...(referrer === undefined ? {} : { referrer }),
    ...(Object.keys(cookies).length === 0 ? {} : { cookies }),
    ...(a.clickIds === undefined || a.clickIds.length === 0 ? {} : { clickIds: a.clickIds }),
    ...(a.utm === undefined || Object.keys(a.utm).length === 0 ? {} : { utm: a.utm }),
  };
}

export class OutboxLeadTrackingEmitter implements LeadTrackingPort {
  constructor(private readonly deps: LeadTrackingEmitterDeps) {}

  async emit(subject: LeadTrackingSubject): Promise<void> {
    // An explicit pick: whatever else a caller hands over (a `message`, say) is not read.
    const snapshot = snapshotOfLead(subject);
    const email = present(subject.email);
    const phone = present(subject.phone);
    const phoneE164 = present(subject.phoneE164);
    const lead: LeadTrackingReadModel = {
      leadId: subject.leadId,
      name: subject.name,
      ...(phone === undefined ? {} : { phone }),
      ...(phoneE164 === undefined ? {} : { phoneE164 }),
      ...(email === undefined ? {} : { email }),
      submittedAt: subject.submittedAt.toISOString(),
      snapshot,
    };

    // The lead's own page is the best source url; the store's address only when it has none. Resolved lazily so a lead
    // with a page never depends on the domain table being readable.
    const storeUrl =
      snapshot.pageUrl ?? (await this.deps.storeUrls.storeUrlOf(subject.tenantId)) ?? undefined;
    if (storeUrl === undefined || storeUrl === "") throw new StoreUrlUnavailableError();

    const envelope = leadEnvelope(lead, { tenantId: subject.tenantId, storeUrl });
    await publishTrackingEnvelope(this.deps, {
      tenantId: subject.tenantId,
      envelope,
      producer: PRODUCER,
      // a lead has no upstream bus message: it is its own correlation and cause
      correlationId: subject.leadId,
      causationId: subject.leadId,
    });
  }
}
