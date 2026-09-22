import { z } from "zod";

/**
 * Typed runtime configuration (Sprint 2.9). The ONLY place `process.env` is read — every
 * entrypoint calls `loadRuntimeConfig()` once and injects values downward. Extends the
 * infrastructure groups already validated by `@platform/config` with the runtime-only groups
 * (Kafka/Temporal/Ory/tenancy). Secrets support `*_FILE` variants upstream (doc 14).
 */
const schema = z
  .object({
    APP_ENV: z.enum(["local", "development", "staging", "production"]).default("local"),
    PORT: z.coerce.number().int().positive().default(3080),

    DATABASE_URL: z.string().min(1),
    // Phase A.13 (Task 1/2): mirrors @platform/config/server's serverEnvSchema field names/defaults
    // exactly (packages/config/src/server/env.ts) — this runtime entrypoint validates its OWN config
    // (loadRuntimeConfig is "the ONLY place process.env is read", per this file's own header comment)
    // rather than depending on @platform/config/server, so these three were previously simply absent
    // here: `buildRuntimeCore` (composition.ts) constructed its PrismaClient from an object missing
    // `poolMax`/`connectTimeoutMs` entirely (silenced only by an unsafe `as` cast), so pool sizing and
    // connect-timeout were never configurable for the actual production runtime, only for the unrelated
    // per-service composition roots that DO use `@platform/config/server`.
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),
    REDIS_URL: z.string().min(1),
    REDIS_KEY_PREFIX: z.string().default("morbeh:"),

    KAFKA_BROKERS: z.string().min(1).default("localhost:19092"),
    KAFKA_CLIENT_ID: z.string().default("morbeh-runtime"),

    // ── Phase A.23: CDC (Debezium/Kafka Connect) watchdog ──
    /**
     * Kafka Connect REST base URL (e.g. `http://localhost:8083` in compose, `http://debezium-connect:8083`
     * in k8s — matches `infrastructure/docker/debezium/register-connector.sh` / `infrastructure/k8s/
     * 70-debezium.yaml`). Absent ⇒ the watchdog job no-ops (same present/absent convention as S3/Stripe
     * above) — local/tests never require Kafka Connect to be reachable.
     */
    KAFKA_CONNECT_URL: z.string().url().optional(),
    /** Comma-separated connector names the watchdog polls. Matches the one production connector today. */
    KAFKA_CONNECT_CDC_CONNECTORS: z.string().default("lumo-outbox"),
    /** Watchdog poll interval (A.22 §4b: a ~45s+ Postgres outage reliably produces a terminal FAILED task). */
    CDC_WATCHDOG_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
    /** Restart-loop guard (Task 4 Case D): max automatic restarts per connector+task inside the rolling window. */
    CDC_WATCHDOG_MAX_RESTARTS: z.coerce.number().int().positive().default(5),
    /** Rolling window (ms) the restart cap above applies over. */
    CDC_WATCHDOG_RESTART_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 1000),

    TEMPORAL_ADDRESS: z.string().default("localhost:7233"),

    AUTH_ISSUER_URL: z.string().url().optional(),
    AUTH_JWKS_URL: z.string().url().optional(),
    AUTH_AUDIENCE: z.string().default("morbeh-admin"),
    KETO_READ_URL: z.string().url().optional(),
    /** Ory Keto write-API base (relation-tuple sync); required outside `local` (H-2, superRefine). */
    KETO_WRITE_URL: z.string().url().optional(),
    /** Ory Kratos public-API base (session whoami); required outside `local` (H-2, superRefine). */
    KRATOS_PUBLIC_URL: z.string().url().optional(),
    /** Ory Kratos admin-API base (identity lookup + session revocation); required outside `local` (H-2). */
    KRATOS_ADMIN_URL: z.string().url().optional(),
    /**
     * The storefront's public origin (G-72) — used to build the signup-completion link
     * (`${STOREFRONT_PUBLIC_URL}/account/signup/complete?token=...`). Absent ⇒
     * `http://localhost:3000`, matching the storefront's own `RUNTIME_API_URL` local-default
     * convention (`apps/storefront/src/lib/runtime-api.ts`).
     */
    STOREFRONT_PUBLIC_URL: z.string().url().optional(),
    /**
     * Ory Network project API key (`ory_pat_...`), attached to Ory's permission/identity APIs by
     * `createOryFetch` (`./ory-fetch.ts`). Absent ⇒ the self-hosted Hydra/Kratos/Keto topology in
     * `infrastructure/docker/docker-compose.yml`, which authenticates none of these calls. Same
     * present/absent convention as S3/Stripe below — not required outside `local`, because
     * self-hosted Ory remains a legitimate production topology (`infrastructure/k8s/` deploys it).
     */
    ORY_API_KEY: z.string().optional(),

    TENANT_MODE: z.enum(["single", "multi"]).default("single"),
    TENANT_DEFAULT_ID: z.string().default("tenant-local"),

    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
    OUTBOX_RETENTION_DAYS: z.coerce.number().int().positive().default(7),

    /** C-8: publish platform.outbox rows from the worker on a timer instead of via Debezium CDC. */
    OUTBOX_RELAY_ENABLED: z
      .string()
      .default("false")
      .transform((v) => v.toLowerCase() === "true"),
    /** Poll interval. Lower means fresher events and more database load. */
    OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
    /** Rows published per tick. */
    OUTBOX_RELAY_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(200),

    // ── Object storage (S3-compatible / MinIO) — M2-2. Same field names as
    // @platform/config/server's serverEnvSchema. Absent ⇒ Media's InMemoryObjectStorage; present ⇒
    // the real StorageServiceObjectStorage. Optional (unlike @platform/config/server, where these
    // are required) because this graph must stay buildable without Docker/MinIO in `local`/tests.
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default("us-east-1"),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z
      .string()
      .default("true")
      .transform((v) => v.toLowerCase() === "true"),
    S3_BUCKET_MEDIA: z.string().default("media"),

    // ── Stripe PSP adapter (C2-2) — same present/absent-optionality convention as S3 above. Absent
    // ⇒ Payments' InMemoryPaymentProvider; present (both keys) ⇒ the real StripePaymentProvider.
    /** Stripe secret key (`sk_test_...` / `sk_live_...`). */
    STRIPE_SECRET_KEY: z.string().optional(),
    /** Webhook signing secret (`whsec_...`) for this endpoint, from the Stripe Dashboard/CLI. */
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    /** Override for sandbox/testing; defaults to Stripe's production API. */
    STRIPE_API_BASE: z.string().url().default("https://api.stripe.com"),

    // ── Tracking ingest (P1.3 / C-07) ──
    /**
     * Mounts the `tracking.event.captured.v1` consumer in the worker. Default `off`: the collector
     * publishes regardless, and a runtime whose tracking registry has not been seeded would refuse
     * every event at `loadTrackingRegistry` rather than start. Turn on once the registry is seeded.
     */
    TRACKING_INGEST_ENABLED: z
      .string()
      .default("off")
      .transform((v) => v.toLowerCase() === "on" || v.toLowerCase() === "true"),
    /**
     * Registry key of the routing rule set the ingest pipeline resolves against. Configuration,
     * never a compiled-in default (`IngestRuntimeDeps.ruleSetKey`) — a wrong key refuses every event
     * with `rule_set_unavailable` rather than silently routing to nothing. The default matches
     * `DEFAULT_RULE_SET_KEY` in `tracking/tracking-registry-seed.ts`, so a seeded registry works
     * without extra configuration.
     */
    TRACKING_RULE_SET_KEY: z.string().default("tracking.routing.default"),
    /** Registry hot-reload poll interval (`TrackingRegistryWatcher`). */
    TRACKING_REGISTRY_POLL_MS: z.coerce.number().int().positive().default(30_000),

    // ── H-3 (G-SEC-2) cloud KMS / HSM / Vault + threat-intel provider selection ──
    /** Which KMS/crypto provider backs Security's key operations (default `local` = node:crypto). */
    SECURITY_KMS_PROVIDER: z.enum(["local", "vault", "aws", "gcp", "azure"]).default("local"),
    /** Comma-separated threat-intel feeds to fan out (empty ⇒ the offline reference feed only). */
    SECURITY_THREAT_PROVIDERS: z.string().default(""),
    /** Optional HSM provider for hardware-backed signing (`none` disables it). */
    SECURITY_HSM_PROVIDER: z.enum(["none", "pkcs11", "cloudhsm", "yubihsm"]).default("none"),

    /** HashiCorp Vault Transit. */
    VAULT_ADDR: z.string().url().optional(),
    VAULT_TOKEN: z.string().optional(),
    VAULT_TRANSIT_MOUNT: z.string().default("transit"),
    VAULT_NAMESPACE: z.string().optional(),

    /** AWS KMS (SigV4). */
    AWS_REGION: z.string().optional(),
    AWS_KMS_KEY_ID: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_SESSION_TOKEN: z.string().optional(),

    /** Google Cloud KMS (bearer token via workload identity). */
    GCP_KMS_KEY_RESOURCE: z.string().optional(),
    GCP_KMS_ACCESS_TOKEN: z.string().optional(),

    /** Azure Key Vault (OAuth2 client-credentials). */
    AZURE_KEYVAULT_URL: z.string().url().optional(),
    AZURE_KEYVAULT_KEY_NAME: z.string().optional(),
    AZURE_OAUTH_TOKEN_URL: z.string().url().optional(),
    AZURE_OAUTH_CLIENT_ID: z.string().optional(),
    AZURE_OAUTH_CLIENT_SECRET: z.string().optional(),
    AZURE_OAUTH_SCOPE: z.string().default("https://vault.azure.net/.default"),

    /** Threat-intel feed credentials (each consumed only when the feed is selected). */
    THREAT_ABUSEIPDB_API_KEY: z.string().optional(),
    THREAT_VIRUSTOTAL_API_KEY: z.string().optional(),
    THREAT_OTX_API_KEY: z.string().optional(),
    THREAT_CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
    THREAT_CLOUDFLARE_API_TOKEN: z.string().optional(),
    THREAT_CROWDSTRIKE_TOKEN_URL: z.string().url().optional(),
    THREAT_CROWDSTRIKE_CLIENT_ID: z.string().optional(),
    THREAT_CROWDSTRIKE_CLIENT_SECRET: z.string().optional(),
    THREAT_CROWDSTRIKE_API_BASE: z.string().url().default("https://api.crowdstrike.com"),
    THREAT_DEFENDER_TOKEN_URL: z.string().url().optional(),
    THREAT_DEFENDER_CLIENT_ID: z.string().optional(),
    THREAT_DEFENDER_CLIENT_SECRET: z.string().optional(),
    THREAT_DEFENDER_SCOPE: z.string().optional(),
    THREAT_DEFENDER_API_BASE: z.string().url().optional(),

    /** HSM (PKCS#11 module path + per-target config; the native module lives in the deployment image). */
    HSM_PKCS11_MODULE: z.string().optional(),
    HSM_CLOUDHSM_CLUSTER_ID: z.string().optional(),
    HSM_YUBIHSM_CONNECTOR_URL: z.string().url().optional(),

    // ── P2.0.2 runtime security completion — provisioning + zero-trust enforcement activation ──
    /**
     * Activates the Security runtime provisioning fleet (P2.0.2/A,D,E): the principal-provisioning
     * consumer (Identity events → `RegisterPrincipal`/`AssignRole`) and the startup policy/role/tenant
     * bootstrap (B). Default `off` ⇒ zero behaviour change. Enable this FIRST so the Security store is
     * populated before enforcement (below) is switched on — enforcement fails closed against an empty store.
     */
    SECURITY_PRINCIPAL_PROVISIONING: z
      .string()
      .default("off")
      .transform((v) => v.toLowerCase() === "on" || v.toLowerCase() === "true"),
    /**
     * Mounts `SecurityPermissionGuard` as the HTTP authorization point (P2.0.2/C): every protected
     * request runs `EvaluateAccess` (authn → threat → risk → device → policy → RBAC/ABAC → step-up →
     * WORM audit). Default `off` ⇒ the existing `AdminGuard` + Keto path stays the enforcement point, so
     * production is never bricked. When `on`, the runtime REQUIRES the Prisma-backed Security context to
     * build (fail-closed at boot; never falls open). Enable only after provisioning has seeded the store.
     */
    SECURITY_ZERO_TRUST_ENFORCEMENT: z
      .string()
      .default("off")
      .transform((v) => v.toLowerCase() === "on" || v.toLowerCase() === "true"),
    /**
     * Lifetime (seconds) of a **federated session mirror** — the Security session established on first
     * sight of an upstream IdP session id (ADR-0031, P2.0.3). Keep it at or below the Kratos session
     * lifetime: the mirror expiring only forces a re-federation on the next request, whereas a mirror
     * outliving its upstream session would keep honouring a login the IdP has already ended.
     */
    SECURITY_SESSION_MIRROR_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

    // ── OpenTelemetry (P2.0.1 runtime activation of the existing @platform/observability SDK) ──
    /** Base OTel service name; each entrypoint suffixes its role (`-api`/`-worker`/`-scheduler`). */
    OTEL_SERVICE_NAME: z.string().default("morbeh-runtime"),
    /** OTLP collector endpoint; when set, traces/metrics export there (else the SDK's own default). */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    /** Enable trace export. Off by default so local/tests never attempt to reach a collector. */
    OTEL_TRACES_ENABLED: z
      .string()
      .default("false")
      .transform((v) => v.toLowerCase() === "true"),
    /** Enable metric export (feeds the OTel-sourced security dashboards). Off by default. */
    OTEL_METRICS_ENABLED: z
      .string()
      .default("false")
      .transform((v) => v.toLowerCase() === "true"),
  })
  .superRefine((cfg, ctx) => {
    // H-2 (G-SEC-4): live identity binding (Keto relation-tuple sync + Kratos identity/session) is
    // mandatory outside `local` — the security enforcement sync must not silently no-op in production.
    for (const key of ["KETO_WRITE_URL", "KRATOS_PUBLIC_URL", "KRATOS_ADMIN_URL"] as const) {
      if (cfg.APP_ENV !== "local" && cfg[key] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required unless APP_ENV=local (Ory identity binding, H-2).`,
        });
      }
    }
    // P2.0.2 (C): zero-trust HTTP enforcement fails closed against an unpopulated Security store, so it
    // must not be enabled without the provisioning fleet that seeds principals/roles/policies (A,B,D,E).
    if (cfg.SECURITY_ZERO_TRUST_ENFORCEMENT && !cfg.SECURITY_PRINCIPAL_PROVISIONING) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SECURITY_ZERO_TRUST_ENFORCEMENT"],
        message:
          "SECURITY_ZERO_TRUST_ENFORCEMENT requires SECURITY_PRINCIPAL_PROVISIONING=on (enforcement fails closed against an unprovisioned store).",
      });
    }
    // H-01: `buildSecurityHttpGuard` (apps/runtime/src/security/wire-security-runtime.ts) is not called
    // by any entrypoint — api.ts still authorizes every request through AdminGuard + Keto. Accepting this
    // flag would tell an operator that zero-trust enforcement ("authn → threat → risk → device → policy →
    // RBAC/ABAC → step-up → WORM audit") is active when nothing has changed. Refuse it until the guard is
    // actually mounted in an entrypoint, converting silent no-op into an explicit boot error. Remove this
    // clause in the sprint that mounts the guard.
    if (cfg.SECURITY_ZERO_TRUST_ENFORCEMENT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SECURITY_ZERO_TRUST_ENFORCEMENT"],
        message:
          "SECURITY_ZERO_TRUST_ENFORCEMENT=on is not supported yet: buildSecurityHttpGuard is not " +
          "mounted in any entrypoint (apps/runtime/src/{api,worker,scheduler}.ts). Enabling it has no " +
          "effect on request authorization today; AdminGuard + Keto remains the enforcement point.",
      });
    }
    // H-3 (G-SEC-2): the selected cloud KMS / HSM / threat providers must be fully configured — a
    // half-configured provider fails closed at startup rather than silently degrading cryptography.
    const requireKeys = (keys: readonly (keyof typeof cfg)[], why: string): void => {
      for (const key of keys) {
        if (cfg[key] === undefined || cfg[key] === "") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${String(key)} is required when ${why}.`,
          });
        }
      }
    };
    const kmsRequired: Record<string, readonly (keyof typeof cfg)[]> = {
      vault: ["VAULT_ADDR", "VAULT_TOKEN"],
      aws: ["AWS_REGION", "AWS_KMS_KEY_ID", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
      gcp: ["GCP_KMS_KEY_RESOURCE", "GCP_KMS_ACCESS_TOKEN"],
      azure: [
        "AZURE_KEYVAULT_URL",
        "AZURE_KEYVAULT_KEY_NAME",
        "AZURE_OAUTH_TOKEN_URL",
        "AZURE_OAUTH_CLIENT_ID",
        "AZURE_OAUTH_CLIENT_SECRET",
      ],
    };
    if (cfg.SECURITY_KMS_PROVIDER !== "local")
      requireKeys(
        kmsRequired[cfg.SECURITY_KMS_PROVIDER] ?? [],
        `SECURITY_KMS_PROVIDER=${cfg.SECURITY_KMS_PROVIDER}`,
      );

    const threatRequired: Record<string, readonly (keyof typeof cfg)[]> = {
      abuseipdb: ["THREAT_ABUSEIPDB_API_KEY"],
      virustotal: ["THREAT_VIRUSTOTAL_API_KEY"],
      "alienvault-otx": ["THREAT_OTX_API_KEY"],
      cloudflare: ["THREAT_CLOUDFLARE_ACCOUNT_ID", "THREAT_CLOUDFLARE_API_TOKEN"],
      crowdstrike: [
        "THREAT_CROWDSTRIKE_TOKEN_URL",
        "THREAT_CROWDSTRIKE_CLIENT_ID",
        "THREAT_CROWDSTRIKE_CLIENT_SECRET",
      ],
      "microsoft-defender": [
        "THREAT_DEFENDER_TOKEN_URL",
        "THREAT_DEFENDER_CLIENT_ID",
        "THREAT_DEFENDER_CLIENT_SECRET",
        "THREAT_DEFENDER_API_BASE",
      ],
    };
    for (const feed of cfg.SECURITY_THREAT_PROVIDERS.split(",")
      .map((f) => f.trim())
      .filter((f) => f.length > 0)) {
      if (!(feed in threatRequired)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SECURITY_THREAT_PROVIDERS"],
          message: `unknown threat provider '${feed}'.`,
        });
        continue;
      }
      requireKeys(threatRequired[feed] ?? [], `SECURITY_THREAT_PROVIDERS includes '${feed}'`);
    }

    if (cfg.SECURITY_HSM_PROVIDER !== "none") {
      requireKeys(["HSM_PKCS11_MODULE"], `SECURITY_HSM_PROVIDER=${cfg.SECURITY_HSM_PROVIDER}`);
      if (cfg.SECURITY_HSM_PROVIDER === "cloudhsm")
        requireKeys(["HSM_CLOUDHSM_CLUSTER_ID"], "SECURITY_HSM_PROVIDER=cloudhsm");
      if (cfg.SECURITY_HSM_PROVIDER === "yubihsm")
        requireKeys(["HSM_YUBIHSM_CONNECTOR_URL"], "SECURITY_HSM_PROVIDER=yubihsm");
    }
  });

export type RuntimeConfig = z.infer<typeof schema>;

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid runtime configuration: ${issues}`);
  }
  return parsed.data;
}
