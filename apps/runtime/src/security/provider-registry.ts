import { Registry, type RegistryEntry } from "@platform/registry";

/**
 * The Security context's **provider registry** (H-3 / G-SEC-2) — a catalog of the KMS, threat-intel, and
 * HSM providers the runtime can select, built on the shared **Registry Engine** (`@platform/registry`),
 * not a bespoke registry (reuse rule). Registering a provider makes it discoverable + config-selectable;
 * selection in the wiring layer validates the chosen provider name against this catalog and fails closed
 * on an unknown name, so a typo can never silently disable cryptography or threat intel.
 */

export type ProviderKind = "kms" | "threat" | "hsm";

export interface ProviderDescriptor {
  readonly name: string;
  readonly kind: ProviderKind;
  readonly description: string;
  /** Config keys the provider requires to be wired (documented + enforced by the wiring layer). */
  readonly requiredConfig: readonly string[];
}

/** The built-in providers implemented in H-3 (all real adapters; `local` is the offline default). */
export const BUILTIN_PROVIDERS: readonly ProviderDescriptor[] = [
  {
    name: "local",
    kind: "kms",
    description: "node:crypto reference KMS/crypto (offline default)",
    requiredConfig: [],
  },
  {
    name: "vault",
    kind: "kms",
    description: "HashiCorp Vault Transit",
    requiredConfig: ["VAULT_ADDR", "VAULT_TOKEN"],
  },
  {
    name: "aws",
    kind: "kms",
    description: "AWS KMS (SigV4)",
    requiredConfig: ["AWS_REGION", "AWS_KMS_KEY_ID", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  },
  {
    name: "gcp",
    kind: "kms",
    description: "Google Cloud KMS",
    requiredConfig: ["GCP_KMS_KEY_RESOURCE"],
  },
  {
    name: "azure",
    kind: "kms",
    description: "Azure Key Vault",
    requiredConfig: ["AZURE_KEYVAULT_URL", "AZURE_KEYVAULT_KEY_NAME"],
  },
  {
    name: "abuseipdb",
    kind: "threat",
    description: "AbuseIPDB reputation",
    requiredConfig: ["THREAT_ABUSEIPDB_API_KEY"],
  },
  {
    name: "virustotal",
    kind: "threat",
    description: "VirusTotal v3",
    requiredConfig: ["THREAT_VIRUSTOTAL_API_KEY"],
  },
  {
    name: "alienvault-otx",
    kind: "threat",
    description: "AlienVault OTX",
    requiredConfig: ["THREAT_OTX_API_KEY"],
  },
  {
    name: "cloudflare",
    kind: "threat",
    description: "Cloudflare Intel",
    requiredConfig: ["THREAT_CLOUDFLARE_ACCOUNT_ID", "THREAT_CLOUDFLARE_API_TOKEN"],
  },
  {
    name: "crowdstrike",
    kind: "threat",
    description: "CrowdStrike Falcon Intel",
    requiredConfig: ["THREAT_CROWDSTRIKE_TOKEN_URL"],
  },
  {
    name: "microsoft-defender",
    kind: "threat",
    description: "Microsoft Defender TI",
    requiredConfig: ["THREAT_DEFENDER_API_BASE"],
  },
  {
    name: "pkcs11",
    kind: "hsm",
    description: "PKCS#11 HSM",
    requiredConfig: ["HSM_PKCS11_MODULE"],
  },
  {
    name: "cloudhsm",
    kind: "hsm",
    description: "AWS CloudHSM (PKCS#11)",
    requiredConfig: ["HSM_PKCS11_MODULE", "HSM_CLOUDHSM_CLUSTER_ID"],
  },
  {
    name: "yubihsm",
    kind: "hsm",
    description: "YubiHSM 2 (PKCS#11)",
    requiredConfig: ["HSM_PKCS11_MODULE", "HSM_YUBIHSM_CONNECTOR_URL"],
  },
];

export class SecurityProviderRegistry {
  private readonly registry: Registry<ProviderDescriptor>;

  constructor(
    now: () => Date = () => new Date(),
    providers: readonly ProviderDescriptor[] = BUILTIN_PROVIDERS,
  ) {
    this.registry = new Registry<ProviderDescriptor>({ name: "security-providers", now });
    for (const provider of providers) this.register(provider);
  }

  /** Registers a provider descriptor; throws on a rejected registration (no silent failure). */
  register(descriptor: ProviderDescriptor): void {
    const result = this.registry.register({
      key: `${descriptor.kind}:${descriptor.name}`,
      value: descriptor,
      tags: [descriptor.kind],
    });
    if (!result.ok)
      throw new Error(
        `failed to register provider ${descriptor.kind}:${descriptor.name}: ${result.error.message}`,
      );
  }

  has(kind: ProviderKind, name: string): boolean {
    return this.registry.has(`${kind}:${name}`);
  }

  get(kind: ProviderKind, name: string): ProviderDescriptor | null {
    return this.registry.get(`${kind}:${name}`)?.value ?? null;
  }

  list(kind: ProviderKind): readonly ProviderDescriptor[] {
    return this.registry
      .list({ tag: kind })
      .map((entry: RegistryEntry<ProviderDescriptor>) => entry.value);
  }

  /** Resolves a provider by name or throws with the catalog of valid names (fail-closed selection). */
  require(kind: ProviderKind, name: string): ProviderDescriptor {
    const descriptor = this.get(kind, name);
    if (descriptor === null) {
      const valid = this.list(kind)
        .map((d) => d.name)
        .join(", ");
      throw new Error(`unknown ${kind} provider '${name}' — valid: ${valid}`);
    }
    return descriptor;
  }
}
