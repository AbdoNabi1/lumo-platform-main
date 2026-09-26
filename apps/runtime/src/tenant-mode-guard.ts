import type { RuntimeConfig } from "./config";

/**
 * T10.4: what replaced the flat `TENANT_MODE=multi` refusal in `buildRuntimeCore`.
 *
 * Two halves, because the runtime has two kinds of process:
 *
 *  - The API process resolves the tenant per HTTP request. Its guard is
 *    `assertMultiTenantReady` (apps/admin/src/tenant-mode-guard.ts), run inside
 *    `createAdminHttpApi`, because that is where the real resolver chain and the composed graph exist.
 *  - The worker process has no request. Its Kafka consumers used to be pinned to
 *    `TENANT_DEFAULT_ID` at builder time (T10.7 class D / G-64), so under multi mode tenant B's
 *    events would have been consumed into the default tenant's rows. **G-64 closed that:** the event
 *    envelope now carries a required `tenantId` and every consumer routes by it, so
 *    `EVENT_PATH_TENANT_PINS` is empty.
 *
 * The worker guard is honest rather than removed. It still refuses multi mode for whatever in the
 * worker is genuinely still bound to one tenant, and names exactly that:
 *
 *  - `EVENT_PATH_TENANT_PINS` — any consumer that takes its tenant from `TENANT_DEFAULT_ID`. Empty now;
 *    a test requires it to equal the table's `event-path-pin` class, so a new pin cannot be classified
 *    without the guard refusing, and the guard cannot claim a site is fixed while the table lists it.
 *  - `BOOT_TENANT_PINS` — a boot-time site bound to the one deployment tenant, blocking only while
 *    its feature is on. **Empty since T10.6.** The one entry it used to hold was `bootstrapSecurity`:
 *    the baseline roles/policy the principal-provisioning consumers assign FROM existed only for the
 *    deployment tenant, so every other tenant's provisioning failed. Tenant provisioning now runs that
 *    baseline for the tenant it creates (`TenantProvisioner`, apps/admin), so nothing the consumers need
 *    is missing for a provisioned tenant. The boot call that remains is the PLATFORM tenant's own
 *    baseline (that tenant is not created through the lifecycle), classified `platform-boot`. A tenant
 *    that exists but was never provisioned still cannot be assigned roles — its
 *    `GET /tenants/:id/provisioning` says so, and the consumers fail closed to the DLQ.
 *
 * This is NOT an exemption from the API assertion; it is a separate check.
 */

export interface EventPathTenantPin {
  readonly file: string;
  readonly what: string;
}

/** Every event-path (non-request) site that still sources its tenant from `TENANT_DEFAULT_ID`. */
export const EVENT_PATH_TENANT_PINS: readonly EventPathTenantPin[] = Object.freeze([]);

/** Boot-time sites bound to the one deployment tenant; each blocks only while its feature is on. */
export const BOOT_TENANT_PINS: readonly EventPathTenantPin[] = Object.freeze([]);

export function assertWorkerTenantModeSupported(
  mode: RuntimeConfig["TENANT_MODE"],
  features: Pick<RuntimeConfig, "SECURITY_PRINCIPAL_PROVISIONING">,
  eventPathPins: readonly EventPathTenantPin[] = EVENT_PATH_TENANT_PINS,
  bootTenantPins: readonly EventPathTenantPin[] = BOOT_TENANT_PINS,
): void {
  if (mode !== "multi") return;
  const bootPins = features.SECURITY_PRINCIPAL_PROVISIONING ? bootTenantPins : [];
  if (eventPathPins.length === 0 && bootPins.length === 0) return;
  const lines: string[] = [];
  if (eventPathPins.length > 0) {
    lines.push(
      "these event consumers still take their tenant from TENANT_DEFAULT_ID at construction " +
        "(T10.7 class D, G-64) and would write every tenant's events into the default tenant's rows:",
      ...eventPathPins.map((pin, index) => `${index + 1}. ${pin.file} — ${pin.what}`),
    );
  }
  if (bootPins.length > 0) {
    lines.push(
      "these boot-time sites are still bound to the one deployment tenant:",
      ...bootPins.map((pin, index) => `${index + 1}. ${pin.file} — ${pin.what}`),
    );
  }
  throw new Error(
    "worker: refusing to boot with TENANT_MODE=multi — " +
      lines.join("\n\n").replace(/\n\n(\d\.)/g, "\n$1"),
  );
}

export type TenantDefaultIdClass =
  | "request-path"
  | "event-path-pin"
  | "boot-script"
  | "boot-pin"
  | "platform-boot"
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
 * Every non-test, non-comment `TENANT_DEFAULT_ID` reference under apps/ services/ packages/ (8 code
 * sites after G-64 removed the six event-path pins; comment-only mentions are prose, not references). A count is not a classification:
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
    file: "apps/runtime/src/security/wire-security-provisioning.ts",
    line: "await bootstrapSecurity(wired.security, core.config.TENANT_DEFAULT_ID, core.logger);",
    class: "platform-boot",
    why:
      "Boot-time baseline for the PLATFORM tenant (the deployment tenant, ADR-0014 8f), which is not " +
      "created through the tenant lifecycle. Every other tenant's baseline comes from " +
      "TenantProvisioner (T10.6), so this no longer blocks the worker under multi.",
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
