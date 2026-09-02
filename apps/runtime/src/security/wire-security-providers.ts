import { NodeCrypto } from "@platform/security";
import type {
  CryptoPort,
  HsmProviderPort,
  KmsPort,
  ThreatIntelProvider,
  ThreatIntelResolver,
} from "@platform/security";
import type { Logger } from "@platform/utils";
import type { RuntimeConfig } from "../config";
import { JsonHttpClient, type HttpFetch } from "./http-transport";
import { AwsKmsProvider } from "./kms-aws";
import { AzureKeyVaultProvider, GcpKmsProvider, type BearerTokenProvider } from "./kms-cloud";
import { VaultTransitProvider } from "./kms-vault";
import {
  CloudHsmProvider,
  Pkcs11HsmProvider,
  YubiHsmProvider,
  type Pkcs11Session,
} from "./hsm-providers";
import { ClientCredentialsTokenProvider, StaticBearerTokenProvider } from "./oauth-token";
import { SecurityProviderRegistry } from "./provider-registry";
import {
  AbuseIpDbProvider,
  AlienVaultOtxProvider,
  CloudflareProvider,
  CrowdStrikeProvider,
  MicrosoftDefenderProvider,
  VirusTotalProvider,
} from "./threat-providers";
import { buildResilientResolver } from "./threat-resilience";

/**
 * Composition-layer selection + construction of the Security context's **live cloud providers** (H-3 /
 * G-SEC-2): KMS/crypto (Vault / AWS / GCP / Azure), the resilient threat-intel fan-out, and the optional
 * HSM. This is the **only** place provider selection branches (no conditional provider logic leaks into
 * the context or the adapters); every choice is env-driven and validated against the provider registry,
 * so an unknown/half-configured provider fails closed here. `local` yields no overrides — the context's
 * offline `node:crypto` + reference feed stand in, exactly as the Ory binding is absent in local dev.
 */
export interface WiredSecurityProviders {
  /** Cloud KMS key-ref lifecycle (undefined ⇒ the context's in-memory KMS). */
  readonly kms: KmsPort | undefined;
  /** Cloud/Vault crypto (undefined ⇒ the context's node:crypto). Same instance as `kms` for cloud KMS. */
  readonly crypto: CryptoPort | undefined;
  /** Resilient threat-intel resolver (undefined ⇒ the context's reference feed). */
  readonly threatIntel: ThreatIntelResolver | undefined;
  /** HSM provider (undefined unless selected + a PKCS#11 session was injected). */
  readonly hsm: HsmProviderPort | undefined;
  /** Human-readable selection summary for boot logging. */
  readonly summary: readonly string[];
}

export interface WireProvidersDeps {
  readonly config: RuntimeConfig;
  readonly logger: Logger;
  /** Injected transport (default global fetch). */
  readonly fetch?: HttpFetch;
  /** Injected clock (deterministic AWS signing / token expiry in tests). */
  readonly now?: () => Date;
  /** PKCS#11 session supplied by the deployment (the native module lives in the image, never bundled). */
  readonly pkcs11Session?: Pkcs11Session;
}

/** Reads a required config value, throwing a fail-closed error if absent (validated already by the schema). */
function required(value: string | undefined, name: string): string {
  if (value === undefined || value === "")
    throw new Error(`H-3 provider wiring: ${name} is required but missing`);
  return value;
}

export function wireSecurityProviders(deps: WireProvidersDeps): WiredSecurityProviders {
  const { config } = deps;
  const registry = new SecurityProviderRegistry(deps.now);
  const fetchFn: HttpFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const http = new JsonHttpClient({ fetch: fetchFn });
  const localCrypto = new NodeCrypto();
  const summary: string[] = [];

  const kms = buildKms(config, registry, http, localCrypto, deps.now);
  if (kms !== undefined) summary.push(`kms=${config.SECURITY_KMS_PROVIDER}`);

  const threatIntel = buildThreat(config, registry, http, deps.logger, deps.now);
  const threatNames = threatProviderNames(config);
  if (threatIntel !== undefined) summary.push(`threat=[${threatNames.join(",")}]`);

  const hsm = buildHsm(config, registry, deps);
  if (hsm !== undefined) summary.push(`hsm=${config.SECURITY_HSM_PROVIDER}`);

  return { kms, crypto: kms, threatIntel, hsm, summary };
}

/** The selected threat feed names (validated against the registry). */
export function threatProviderNames(config: RuntimeConfig): readonly string[] {
  return config.SECURITY_THREAT_PROVIDERS.split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

function buildKms(
  config: RuntimeConfig,
  registry: SecurityProviderRegistry,
  http: JsonHttpClient,
  localCrypto: CryptoPort,
  now?: () => Date,
): (KmsPort & CryptoPort) | undefined {
  if (config.SECURITY_KMS_PROVIDER === "local") return undefined;
  registry.require("kms", config.SECURITY_KMS_PROVIDER);
  switch (config.SECURITY_KMS_PROVIDER) {
    case "vault":
      return new VaultTransitProvider({
        http,
        address: required(config.VAULT_ADDR, "VAULT_ADDR"),
        token: required(config.VAULT_TOKEN, "VAULT_TOKEN"),
        mount: config.VAULT_TRANSIT_MOUNT,
        ...(config.VAULT_NAMESPACE !== undefined ? { namespace: config.VAULT_NAMESPACE } : {}),
        localCrypto,
      });
    case "aws":
      return new AwsKmsProvider({
        http,
        region: required(config.AWS_REGION, "AWS_REGION"),
        credentials: {
          accessKeyId: required(config.AWS_ACCESS_KEY_ID, "AWS_ACCESS_KEY_ID"),
          secretAccessKey: required(config.AWS_SECRET_ACCESS_KEY, "AWS_SECRET_ACCESS_KEY"),
          ...(config.AWS_SESSION_TOKEN !== undefined
            ? { sessionToken: config.AWS_SESSION_TOKEN }
            : {}),
        },
        defaultKeyId: required(config.AWS_KMS_KEY_ID, "AWS_KMS_KEY_ID"),
        ...(now !== undefined ? { now } : {}),
        localCrypto,
      });
    case "gcp":
      return new GcpKmsProvider({
        http,
        tokenProvider: new StaticBearerTokenProvider(
          required(config.GCP_KMS_ACCESS_TOKEN, "GCP_KMS_ACCESS_TOKEN"),
        ),
        defaultKeyResource: required(config.GCP_KMS_KEY_RESOURCE, "GCP_KMS_KEY_RESOURCE"),
        localCrypto,
      });
    case "azure":
      return new AzureKeyVaultProvider({
        http,
        tokenProvider: azureToken(config, http),
        vaultUrl: required(config.AZURE_KEYVAULT_URL, "AZURE_KEYVAULT_URL"),
        defaultKeyName: required(config.AZURE_KEYVAULT_KEY_NAME, "AZURE_KEYVAULT_KEY_NAME"),
        localCrypto,
      });
    default:
      return undefined;
  }
}

function azureToken(config: RuntimeConfig, http: JsonHttpClient): BearerTokenProvider {
  return new ClientCredentialsTokenProvider({
    http,
    tokenUrl: required(config.AZURE_OAUTH_TOKEN_URL, "AZURE_OAUTH_TOKEN_URL"),
    clientId: required(config.AZURE_OAUTH_CLIENT_ID, "AZURE_OAUTH_CLIENT_ID"),
    clientSecret: required(config.AZURE_OAUTH_CLIENT_SECRET, "AZURE_OAUTH_CLIENT_SECRET"),
    scope: config.AZURE_OAUTH_SCOPE,
  });
}

function buildThreat(
  config: RuntimeConfig,
  registry: SecurityProviderRegistry,
  http: JsonHttpClient,
  logger: Logger,
  now?: () => Date,
): ThreatIntelResolver | undefined {
  const names = threatProviderNames(config);
  if (names.length === 0) return undefined;
  const providers: ThreatIntelProvider[] = names.map((name) => {
    registry.require("threat", name);
    switch (name) {
      case "abuseipdb":
        return new AbuseIpDbProvider(
          http,
          required(config.THREAT_ABUSEIPDB_API_KEY, "THREAT_ABUSEIPDB_API_KEY"),
        );
      case "virustotal":
        return new VirusTotalProvider(
          http,
          required(config.THREAT_VIRUSTOTAL_API_KEY, "THREAT_VIRUSTOTAL_API_KEY"),
        );
      case "alienvault-otx":
        return new AlienVaultOtxProvider(
          http,
          required(config.THREAT_OTX_API_KEY, "THREAT_OTX_API_KEY"),
        );
      case "cloudflare":
        return new CloudflareProvider(
          http,
          required(config.THREAT_CLOUDFLARE_ACCOUNT_ID, "THREAT_CLOUDFLARE_ACCOUNT_ID"),
          required(config.THREAT_CLOUDFLARE_API_TOKEN, "THREAT_CLOUDFLARE_API_TOKEN"),
        );
      case "crowdstrike":
        return new CrowdStrikeProvider(
          http,
          crowdStrikeToken(config, http),
          config.THREAT_CROWDSTRIKE_API_BASE,
        );
      case "microsoft-defender":
        return new MicrosoftDefenderProvider(
          http,
          defenderToken(config, http),
          required(config.THREAT_DEFENDER_API_BASE, "THREAT_DEFENDER_API_BASE"),
        );
      default:
        throw new Error(`H-3 provider wiring: unhandled threat provider '${name}'`);
    }
  });
  return buildResilientResolver(providers, {
    logger,
    ...(now !== undefined ? { now: () => now().getTime() } : {}),
  });
}

function crowdStrikeToken(config: RuntimeConfig, http: JsonHttpClient): BearerTokenProvider {
  return new ClientCredentialsTokenProvider({
    http,
    tokenUrl: required(config.THREAT_CROWDSTRIKE_TOKEN_URL, "THREAT_CROWDSTRIKE_TOKEN_URL"),
    clientId: required(config.THREAT_CROWDSTRIKE_CLIENT_ID, "THREAT_CROWDSTRIKE_CLIENT_ID"),
    clientSecret: required(
      config.THREAT_CROWDSTRIKE_CLIENT_SECRET,
      "THREAT_CROWDSTRIKE_CLIENT_SECRET",
    ),
  });
}

function defenderToken(config: RuntimeConfig, http: JsonHttpClient): BearerTokenProvider {
  return new ClientCredentialsTokenProvider({
    http,
    tokenUrl: required(config.THREAT_DEFENDER_TOKEN_URL, "THREAT_DEFENDER_TOKEN_URL"),
    clientId: required(config.THREAT_DEFENDER_CLIENT_ID, "THREAT_DEFENDER_CLIENT_ID"),
    clientSecret: required(config.THREAT_DEFENDER_CLIENT_SECRET, "THREAT_DEFENDER_CLIENT_SECRET"),
    ...(config.THREAT_DEFENDER_SCOPE !== undefined ? { scope: config.THREAT_DEFENDER_SCOPE } : {}),
  });
}

function buildHsm(
  config: RuntimeConfig,
  registry: SecurityProviderRegistry,
  deps: WireProvidersDeps,
): HsmProviderPort | undefined {
  if (config.SECURITY_HSM_PROVIDER === "none") return undefined;
  registry.require("hsm", config.SECURITY_HSM_PROVIDER);
  const session = deps.pkcs11Session;
  if (session === undefined) {
    // The native PKCS#11 module is a deployment concern; without an injected session the HSM cannot bind.
    if (config.APP_ENV === "local") {
      deps.logger.warn(
        "HSM provider selected but no PKCS#11 session injected — skipping (APP_ENV=local)",
      );
      return undefined;
    }
    throw new Error(
      `H-3 provider wiring: SECURITY_HSM_PROVIDER=${config.SECURITY_HSM_PROVIDER} requires an injected PKCS#11 session`,
    );
  }
  switch (config.SECURITY_HSM_PROVIDER) {
    case "cloudhsm":
      return new CloudHsmProvider(session);
    case "yubihsm":
      return new YubiHsmProvider(session);
    default:
      return new Pkcs11HsmProvider({ session });
  }
}
