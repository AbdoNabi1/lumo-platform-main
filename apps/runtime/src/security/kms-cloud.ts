import { createHash } from "node:crypto";
import type { CryptoPort } from "@platform/security";
import type { JsonHttpClient } from "./http-transport";
import { b64decode, b64encode, KmsCryptoProvider } from "./kms-base";

/**
 * **Google Cloud KMS** and **Azure Key Vault** providers (H-3 / G-SEC-2) — production `KmsPort` +
 * `CryptoPort` over each cloud's REST API. Neither bundles a cloud SDK (dependency freeze): the OAuth
 * bearer token is supplied by an injected {@link BearerTokenProvider}, exactly as the Ory clients take an
 * injected fetch. Key material stays inside the cloud KMS; only ciphertext/signatures cross the wire.
 */

/** Supplies a short-lived OAuth bearer token (workload identity / metadata server / client-credentials). */
export interface BearerTokenProvider {
  getToken(): Promise<string>;
}

// ── Google Cloud KMS ──────────────────────────────────────────────────────────────────────────────

interface GcpEncrypt {
  readonly ciphertext?: string;
}
interface GcpDecrypt {
  readonly plaintext?: string;
}
interface GcpMacSign {
  readonly mac?: string;
}
interface GcpMacVerify {
  readonly success?: boolean;
}

const GCP_PREFIX = "gcp-kms://";

export interface GcpKmsOptions {
  readonly http: JsonHttpClient;
  readonly tokenProvider: BearerTokenProvider;
  /** API host (default `https://cloudkms.googleapis.com`). */
  readonly apiBase?: string;
  /** Default cryptoKey resource for `generateKeyRef` (`projects/…/cryptoKeys/…`). */
  readonly defaultKeyResource: string;
  readonly localCrypto: CryptoPort;
}

export class GcpKmsProvider extends KmsCryptoProvider {
  readonly name = "gcp";
  private readonly http: JsonHttpClient;
  private readonly tokenProvider: BearerTokenProvider;
  private readonly apiBase: string;
  private readonly defaultKeyResource: string;

  constructor(options: GcpKmsOptions) {
    super(options.localCrypto);
    this.http = options.http;
    this.tokenProvider = options.tokenProvider;
    this.apiBase = (options.apiBase ?? "https://cloudkms.googleapis.com").replace(/\/$/, "");
    this.defaultKeyResource = options.defaultKeyResource;
  }

  private resource(ref: string): string {
    const rest = ref.startsWith(GCP_PREFIX) ? ref.slice(GCP_PREFIX.length) : ref;
    const hashIndex = rest.indexOf("#");
    return hashIndex === -1 ? rest : rest.slice(0, hashIndex);
  }
  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.tokenProvider.getToken()}` };
  }
  private async post(
    resource: string,
    verb: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return this.http.postJson(
      `${this.apiBase}/v1/${resource}:${verb}`,
      payload,
      await this.authHeaders(),
    );
  }

  generateKeyRef(purpose: string): Promise<string> {
    return Promise.resolve(
      `${GCP_PREFIX}${this.defaultKeyResource}#v1:${encodeURIComponent(purpose)}`,
    );
  }
  async rotate(keyRef: string): Promise<string> {
    const resource = this.resource(keyRef);
    await this.http.postJson(
      `${this.apiBase}/v1/${resource}/cryptoKeyVersions`,
      {},
      await this.authHeaders(),
    );
    const match = /#v(\d+)/.exec(keyRef);
    const next = (match !== null ? Number.parseInt(match[1] ?? "1", 10) : 1) + 1;
    return `${GCP_PREFIX}${resource}#v${next}`;
  }
  async encrypt(plaintext: string, keyRef: string): Promise<string> {
    const res = (await this.post(this.resource(keyRef), "encrypt", {
      plaintext: b64encode(plaintext),
    })) as GcpEncrypt;
    if (res.ciphertext === undefined) throw new Error("gcp kms encrypt returned no ciphertext");
    return res.ciphertext;
  }
  async decrypt(ciphertext: string, keyRef: string): Promise<string> {
    const res = (await this.post(this.resource(keyRef), "decrypt", { ciphertext })) as GcpDecrypt;
    if (res.plaintext === undefined) throw new Error("gcp kms decrypt returned no plaintext");
    return b64decode(res.plaintext);
  }
  async sign(payload: string, keyRef: string): Promise<string> {
    const res = (await this.post(this.resource(keyRef), "macSign", {
      data: b64encode(payload),
    })) as GcpMacSign;
    if (res.mac === undefined) throw new Error("gcp kms macSign returned no mac");
    return res.mac;
  }
  async verify(payload: string, signature: string, keyRef: string): Promise<boolean> {
    const res = (await this.post(this.resource(keyRef), "macVerify", {
      data: b64encode(payload),
      mac: signature,
    })) as GcpMacVerify;
    return res.success === true;
  }
}

// ── Azure Key Vault ───────────────────────────────────────────────────────────────────────────────

interface AzureKeyRead {
  readonly key?: { readonly kid?: string };
}
interface AzureCrypto {
  readonly value?: string;
}
interface AzureVerify {
  readonly value?: boolean;
}

const AZURE_PREFIX = "azure-kv://";

export interface AzureKeyVaultOptions {
  readonly http: JsonHttpClient;
  readonly tokenProvider: BearerTokenProvider;
  /** Vault base URL, e.g. `https://myvault.vault.azure.net`. */
  readonly vaultUrl: string;
  /** Key name used by `generateKeyRef`. */
  readonly defaultKeyName: string;
  /** REST API version (default `7.4`). */
  readonly apiVersion?: string;
  /** Encrypt algorithm (default `RSA-OAEP-256`) and sign algorithm (default `RS256`). */
  readonly encryptAlgorithm?: string;
  readonly signAlgorithm?: string;
  readonly localCrypto: CryptoPort;
}

export class AzureKeyVaultProvider extends KmsCryptoProvider {
  readonly name = "azure";
  private readonly http: JsonHttpClient;
  private readonly tokenProvider: BearerTokenProvider;
  private readonly vaultUrl: string;
  private readonly apiVersion: string;
  private readonly defaultKeyName: string;
  private readonly encryptAlgorithm: string;
  private readonly signAlgorithm: string;

  constructor(options: AzureKeyVaultOptions) {
    super(options.localCrypto);
    this.http = options.http;
    this.tokenProvider = options.tokenProvider;
    this.vaultUrl = options.vaultUrl.replace(/\/$/, "");
    this.apiVersion = options.apiVersion ?? "7.4";
    this.defaultKeyName = options.defaultKeyName;
    this.encryptAlgorithm = options.encryptAlgorithm ?? "RSA-OAEP-256";
    this.signAlgorithm = options.signAlgorithm ?? "RS256";
  }

  /** Parses `azure-kv://{name}/{version}#vN` into the vault path segment `{name}/{version}`. */
  private keyPath(ref: string): string {
    const rest = ref.startsWith(AZURE_PREFIX) ? ref.slice(AZURE_PREFIX.length) : ref;
    const hashIndex = rest.indexOf("#");
    return hashIndex === -1 ? rest : rest.slice(0, hashIndex);
  }
  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.tokenProvider.getToken()}` };
  }
  private async op(ref: string, verb: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.http.postJson(
      `${this.vaultUrl}/keys/${this.keyPath(ref)}/${verb}?api-version=${this.apiVersion}`,
      payload,
      await this.authHeaders(),
    );
  }
  /** Resolves the current version of a key name from its `kid`. */
  private async currentVersion(name: string): Promise<string> {
    const read = (await this.http.getJson(
      `${this.vaultUrl}/keys/${name}?api-version=${this.apiVersion}`,
      await this.authHeaders(),
    )) as AzureKeyRead;
    const kid = read.key?.kid ?? "";
    return kid.split("/").pop() ?? "";
  }

  async generateKeyRef(purpose: string): Promise<string> {
    const version = await this.currentVersion(this.defaultKeyName);
    return `${AZURE_PREFIX}${this.defaultKeyName}/${version}#v1:${encodeURIComponent(purpose)}`;
  }
  async rotate(keyRef: string): Promise<string> {
    const name = this.keyPath(keyRef).split("/")[0] ?? this.defaultKeyName;
    await this.http.postJson(
      `${this.vaultUrl}/keys/${name}/rotate?api-version=${this.apiVersion}`,
      {},
      await this.authHeaders(),
    );
    const version = await this.currentVersion(name);
    const match = /#v(\d+)/.exec(keyRef);
    const next = (match !== null ? Number.parseInt(match[1] ?? "1", 10) : 1) + 1;
    return `${AZURE_PREFIX}${name}/${version}#v${next}`;
  }
  async encrypt(plaintext: string, keyRef: string): Promise<string> {
    const res = (await this.op(keyRef, "encrypt", {
      alg: this.encryptAlgorithm,
      value: Buffer.from(plaintext, "utf8").toString("base64url"),
    })) as AzureCrypto;
    if (res.value === undefined) throw new Error("azure key vault encrypt returned no value");
    return res.value;
  }
  async decrypt(ciphertext: string, keyRef: string): Promise<string> {
    const res = (await this.op(keyRef, "decrypt", {
      alg: this.encryptAlgorithm,
      value: ciphertext,
    })) as AzureCrypto;
    if (res.value === undefined) throw new Error("azure key vault decrypt returned no value");
    return Buffer.from(res.value, "base64url").toString("utf8");
  }
  async sign(payload: string, keyRef: string): Promise<string> {
    const digest = createHash("sha256").update(payload, "utf8").digest("base64url");
    const res = (await this.op(keyRef, "sign", {
      alg: this.signAlgorithm,
      value: digest,
    })) as AzureCrypto;
    if (res.value === undefined) throw new Error("azure key vault sign returned no value");
    return res.value;
  }
  async verify(payload: string, signature: string, keyRef: string): Promise<boolean> {
    const digest = createHash("sha256").update(payload, "utf8").digest("base64url");
    const res = (await this.op(keyRef, "verify", {
      alg: this.signAlgorithm,
      digest,
      value: signature,
    })) as AzureVerify;
    return res.value === true;
  }
}
