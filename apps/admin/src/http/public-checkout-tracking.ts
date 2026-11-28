import { z } from "zod";
import type { Clock } from "@platform/contracts";
import {
  recordAttributionSnapshot,
  type AttributionSnapshotInput,
  type AttributionSnapshotStore,
} from "@platform/tracking";
import { logger } from "@platform/utils";

/**
 * Tracking P2-D8: the optional `tracking` object of `POST /public/checkouts/:id/complete`.
 *
 * What the visitor's browser carried when they placed the order. The STOREFRONT SERVER fills it from its own
 * HttpOnly/first-party cookie jar and request headers (never from anything the page's JavaScript sent); this route
 * still treats it as untrusted: `.strict()` (an unknown key is a 422, not silently kept), every string capped (a
 * value over its cap is refused, never truncated — a cut identifier matches nothing), at most 10 click ids. The
 * semantic checks (shapes, the click-id platform windows, a valid IP) are the sanitiser's, in `@platform/tracking`,
 * and DROP what is not valid instead of failing the checkout.
 *
 * The object is optional: a storefront that does not send it (an older deploy, a draft flow) completes exactly as
 * before.
 */
const text = (max: number) => z.string().max(max);

export const checkoutTrackingBody = z
  .object({
    visitorId: text(48).optional(),
    sessionId: text(64).optional(),
    ip: text(64).nullable().optional(),
    userAgent: text(512).nullable().optional(),
    pageUrl: text(2048).nullable().optional(),
    referrer: text(2048).nullable().optional(),
    cookies: z
      .object({
        fbp: text(512).optional(),
        fbc: text(512).optional(),
        ttp: text(512).optional(),
        scid: text(512).optional(),
        ga: text(512).optional(),
      })
      .strict()
      .optional(),
    clickIds: z
      .array(z.object({ name: text(32), value: text(1000), capturedAt: text(40) }).strict())
      .max(10)
      .optional(),
    utm: z
      .object({
        source: text(200).optional(),
        medium: text(200).optional(),
        campaign: text(200).optional(),
        content: text(200).optional(),
        term: text(200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CheckoutTrackingBody = z.infer<typeof checkoutTrackingBody>;

/** What the `complete` route needs to keep a snapshot. Absent ⇒ the `tracking` object is accepted and ignored. */
export interface CheckoutSnapshotRecorder {
  record(input: {
    readonly tenantId: string;
    readonly checkoutSessionId: string;
    readonly tracking: AttributionSnapshotInput;
  }): Promise<"created" | "exists" | "empty">;
}

export function checkoutSnapshotRecorder(
  store: Pick<AttributionSnapshotStore, "putIfAbsent">,
  clock: Clock,
): CheckoutSnapshotRecorder {
  return {
    record: ({ tenantId, checkoutSessionId, tracking }) =>
      recordAttributionSnapshot({
        store,
        now: clock.now(),
        tenantId,
        subjectKind: "checkout",
        subjectRef: checkoutSessionId,
        input: tracking,
      }),
  };
}

/**
 * Stores the snapshot BEFORE the order exists. A failure here must never cost the shop an order: it is logged by
 * error name only and the checkout goes on (the Purchase is then an identity-only event, still sent).
 */
export async function recordCheckoutSnapshot(
  recorder: CheckoutSnapshotRecorder | undefined,
  tenantId: string,
  checkoutSessionId: string,
  tracking: CheckoutTrackingBody | undefined,
): Promise<void> {
  if (recorder === undefined || tracking === undefined) return;
  try {
    await recorder.record({ tenantId, checkoutSessionId, tracking });
  } catch (error) {
    logger.warn("checkout attribution snapshot not stored", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
