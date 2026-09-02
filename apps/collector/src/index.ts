/**
 * `@platform/collector` — the public tracking collector (P0-1).
 *
 * The first-party HTTP entrance for browser-emitted events, and the only producer of
 * `tracking.event.captured.v1`:
 *
 * ```
 * Browser → Collector → tracking.event.captured.v1 → Tracking Runtime → Pipeline → Router → Delivery
 * ```
 *
 * It parses, validates, resolves client context (cookies, click ids, session, user agent, client IP)
 * and publishes exactly one event. It **never executes the pipeline** — this app has no dependency
 * on `apps/runtime`, and `receiveAndDeliver` is internal to the Tracking Runtime (FF-ARCH-09), so
 * the separation is structural rather than a matter of discipline.
 */

export { CollectorEndpoint } from "./collector-endpoint";
export type {
  CollectorEndpointDeps,
  CollectorCounters,
  EndpointResponse,
} from "./collector-endpoint";

export { createCollectorServer } from "./server";
export type { CollectorServerDeps } from "./server";

export { WriteKeyRegistry, parseWriteKeyBindings } from "./write-key-registry";
export type { WriteKeyBinding } from "./write-key-registry";
