/**
 * The "send a test event" port (Tracking P2-D11): what the admin API asks of the runtime, in plain data.
 *
 * One synthetic purchase (`test_<uuid>`) goes to ONE ad platform so the merchant can see it arrive in Events Manager,
 * without waiting for a real order. A test event is never an event: it is not recorded, not routed through ingest and
 * not delivered by the retry machinery. The implementation lives in `apps/runtime` (it opens the sealed token and makes
 * the network call); the admin route only validates, rate limits and maps the outcome to HTTP.
 */

/** A test code is what the vendor's Test Events tab prints (`TEST12345`). Same pattern the connection stores. */
export const TEST_EVENT_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface TestEventRequest {
  readonly tenantId: string;
  /** The path's platform (`meta`, `tiktok`, `snap`, `ga4`, `google_ads`). */
  readonly platform: string;
  /** REQUEST-scoped: used for this one send only; the connection's saved code is never changed. */
  readonly testEventCode?: string;
}

export interface TestEventResult {
  readonly platform: string;
  /** `sent`: the vendor accepted it (GA4: the debug endpoint found nothing wrong). `rejected`: it did not. */
  readonly status: "sent" | "rejected";
  /** The vendor's HTTP status, when it answered. */
  readonly vendorStatus?: number;
  /** GA4 debug validation messages (`fieldPath: description`); never present for other platforms. */
  readonly messages?: readonly string[];
  /** ISO-8601 instant the request was made. */
  readonly sentAt: string;
}

export type TestEventFailureCode =
  /** No live (saved, complete, enabled) connection for the platform. */
  | "NOT_CONNECTED"
  /** Meta/TikTok with neither a code in the request nor a saved one. */
  | "TEST_CODE_REQUIRED"
  /** Snap (no test mode) and Google Ads (no server events). */
  | "TEST_NOT_SUPPORTED"
  /** The connection store could not be read. */
  | "UNAVAILABLE";

export type TestEventOutcome =
  | { readonly ok: true; readonly result: TestEventResult }
  | { readonly ok: false; readonly code: TestEventFailureCode; readonly message: string };

export interface TestEventService {
  send(request: TestEventRequest): Promise<TestEventOutcome>;
}
