import type { RuntimeConfig } from "./config";

/**
 * T10.4: what replaced the flat `TENANT_MODE=multi` refusal in `buildRuntimeCore`.
 *
 * Two halves, because the runtime has two kinds of process:
 *
 *  - The API process resolves the tenant per HTTP request. Its guard is
 *    `assertMultiTenantReady` (apps/admin/src/tenant-mode-guard.ts), run inside
 *    `createAdminHttpApi`, because that is where the real resolver chain and the composed graph exist.
 *  - The worker process has no request. Its Kafka consumers are pinned to `TENANT_DEFAULT_ID` at
 *    builder time (T10.7 class D / G-64): the event envelope does not yet carry a required
 *    `tenantId`, so there is no per-message tenant to hand them. Under multi mode that would consume
 *    tenant B's events into the default tenant's rows — the exact silent-defaulting bug T10.4 exists
 *    to prevent. So the worker still refuses multi mode, now naming precisely what blocks it.
 *
 * This is NOT an exemption from the API assertion; it is a separate check that stays failing until
 * G-64 lands (a required envelope `tenantId`, a contract change).
 */

export interface EventPathTenantPin {
  readonly file: string;
  readonly what: string;
}

/** Every event-path (non-request) site that still sources its tenant from `TENANT_DEFAULT_ID`. */
export const EVENT_PATH_TENANT_PINS: readonly EventPathTenantPin[] = Object.freeze([
  {
    file: "apps/runtime/src/consumers/orders-paid.consumers.ts",
    what: "orders.order.paid consumers (loyalty, customer-360, notifications, …)",
  },
  {
    file: "apps/runtime/src/consumers/finance-settlement.consumers.ts",
    what: "finance settlement consumers",
  },
  {
    file: "apps/runtime/src/composition.ts",
    what: "payments.payment_intent.captured consumer and tracking-ingest runtime",
  },
  {
    file: "apps/runtime/src/security/wire-security-identity.ts",
    what: "consent-changed and Identity-projection consumers",
  },
  {
    file: "apps/runtime/src/security/wire-security-provisioning.ts",
    what: "security provisioning consumers",
  },
]);

export function assertWorkerTenantModeSupported(mode: RuntimeConfig["TENANT_MODE"]): void {
  if (mode !== "multi") return;
  throw new Error(
    "worker: refusing to boot with TENANT_MODE=multi — these event consumers still take their " +
      "tenant from TENANT_DEFAULT_ID at construction (T10.7 class D, G-64: the event envelope has " +
      "no required tenantId yet, so there is no per-message tenant), and would write every " +
      "tenant's events into the default tenant's rows:\n\n" +
      EVENT_PATH_TENANT_PINS.map((pin, index) => `${index + 1}. ${pin.file} — ${pin.what}`).join(
        "\n",
      ),
  );
}

export type TenantDefaultIdClass =
  | "request-path"
  | "event-path-pin"
  | "boot-script"
  | "boot-provisioning"
  | "definition"
  | "client-header-source"
  | "test-support";

export interface TenantDefaultIdSite {
  readonly file: string;
  /** The trimmed source line — stable under line-number drift, unlike `file:line`. */
  readonly line: string;
  readonly class: TenantDefaultIdClass;
  readonly why: string;
}

/**
 * Every non-test, non-comment `TENANT_DEFAULT_ID` reference under apps/ services/ packages/ (14 code
 * sites; the 14 comment-only mentions are prose, not references). A count is not a classification:
 * `tenant-mode-guard.test.ts` diffs this table against the source tree, so a new reference — or a
 * moved one — fails the build until someone classifies it here.
 *
 * `request-path` is the only class that can put a tenant on a request. There is exactly one.
 */
export const TENANT_DEFAULT_ID_SITES: readonly TenantDefaultIdSite[] = Object.freeze([
  {
    file: "apps/runtime/src/api.ts",
    line: "tenantId: runtime.config.TENANT_DEFAULT_ID,",
    class: "request-path",
    why:
      "Handed to createAdminHttpApi. Under multi it is consumed ONLY by tenancy (ADR-0014 8f " +
      "exemption; routes pinned to it, every other tenant gets 403). assertMultiTenantReady " +
      "fails boot if any other context in the composed graph carries it, and the resolver probe " +
      "fails boot if an unresolved request could resolve to it.",
  },
  {
    file: "apps/runtime/src/composition.ts",
    line: "tenantId: core.config.TENANT_DEFAULT_ID,",
    class: "event-path-pin",
    why: "PaymentCapturedConsumer deps (G-64). Worker refuses multi mode.",
  },
  {
    file: "apps/runtime/src/composition.ts",
    line: "const tenantId = core.config.TENANT_DEFAULT_ID;",
    class: "event-path-pin",
    why:
      "buildTrackingIngestRuntime: registry + watcher for one tenant. Not listed in the T10.7 " +
      "inventory before this task. Worker refuses multi mode.",
  },
  {
    file: "apps/runtime/src/consumers/orders-paid.consumers.ts",
    line: "const tenantId = core.config.TENANT_DEFAULT_ID;",
    class: "event-path-pin",
    why: "Four orders.order.paid consumers (G-64). Worker refuses multi mode.",
  },
  {
    file: "apps/runtime/src/consumers/finance-settlement.consumers.ts",
    line: "const tenantId = core.config.TENANT_DEFAULT_ID;",
    class: "event-path-pin",
    why: "Finance settlement consumers (G-64). Worker refuses multi mode.",
  },
  {
    file: "apps/runtime/src/security/wire-security-identity.ts",
    line: "const tenantId = config.TENANT_DEFAULT_ID;",
    class: "event-path-pin",
    why: "Consent-changed + Identity-projection consumers (G-64). Worker refuses multi mode.",
  },
  {
    file: "apps/runtime/src/security/wire-security-provisioning.ts",
    line: "tenantId: core.config.TENANT_DEFAULT_ID,",
    class: "event-path-pin",
    why: "Three security provisioning consumers (G-64). Worker refuses multi mode.",
  },
  {
    file: "apps/runtime/src/security/wire-security-provisioning.ts",
    line: "await bootstrapSecurity(wired.security, core.config.TENANT_DEFAULT_ID, core.logger);",
    class: "boot-provisioning",
    why:
      "Boot-time baseline roles/policy for the ONE deployment tenant; no request or envelope to " +
      "source a tenant from. Per-tenant provisioning belongs to T10.6 tenant lifecycle.",
  },
  {
    file: "apps/runtime/src/backfill-finance-settlement.ts",
    line: "const tenantId = core.config.TENANT_DEFAULT_ID;",
    class: "boot-script",
    why: "WP-11 backfill script, one tenant per invocation (ADR-0014 Amendment B). Not served.",
  },
  {
    file: "apps/runtime/src/config.ts",
    line: 'TENANT_DEFAULT_ID: z.string().default("tenant-local"),',
    class: "definition",
    why: "The config field itself. Read only by the sites in this table.",
  },
  {
    file: "apps/admin-web/src/lib/api/client.ts",
    line: 'return requireProdEnv("TENANT_DEFAULT_ID", DEFAULT_TENANT_ID);',
    class: "client-header-source",
    why:
      "Outbound x-tenant-id header from the admin-web server. The API resolves the verified claim " +
      "first under multi; the server never defaults a missing tenant. Per-user tenant here is T10.5+.",
  },
  {
    file: "apps/admin-web/src/lib/api/client.ts",
    line: 'const tenantId = requireProdEnv("TENANT_DEFAULT_ID", DEFAULT_TENANT_ID);',
    class: "client-header-source",
    why: "Same outbound header source as above.",
  },
  {
    file: "apps/storefront/src/lib/runtime-api.ts",
    line: 'const TENANT_ID = process.env.TENANT_DEFAULT_ID ?? "tenant-local";',
    class: "client-header-source",
    why:
      "Outbound x-tenant-id header from the storefront server. One storefront deployment serves " +
      "one tenant until domain resolution replaces it; the API never defaults a missing tenant.",
  },
  {
    file: "apps/e2e/tests/support/admin-api.ts",
    line: 'export const TENANT_ID = process.env["TENANT_DEFAULT_ID"] ?? "tenant-local";',
    class: "test-support",
    why: "E2E fixture; not part of any served process.",
  },
]);
