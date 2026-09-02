import type { CryptoPort } from "@platform/security";
import type { JsonHttpClient } from "./http-transport";
import { b64decode, b64encode, KmsCryptoProvider, safeKeyName } from "./kms-base";

/**
 * **HashiCorp Vault Transit** provider (H-3 / G-SEC-2) — a production `KmsPort` + `CryptoPort` backed by
 * Vault's Transit secrets engine over its REST API (no `node-vault` SDK; injected {@link JsonHttpClient},
 * the same primitives-not-SDKs discipline as the Ory clients). Key material is created and used **inside
 * Vault**; only ciphertext/signatures cross the wire (`encrypt`/`decrypt`/`sign`/`verify`/`datakey`), and
 * rotation is Vault-native. The Vault token authenticates every call and is never logged.
 */

interface VaultKeyRead {
  readonly data?: { readonly latest_version?: number };
}
interface VaultEncrypt {
  readonly data?: { readonly ciphertext?: string };
}
interface VaultDecrypt {
  readonly data?: { readonly plaintext?: string };
}
interface VaultSign {
  readonly data?: { readonly signature?: string };
}
interface VaultVerify {
  readonly data?: { readonly valid?: boolean };
}

const REF_PREFIX = "transit://";

export interface VaultTransitOptions {
  readonly http: JsonHttpClient;
  /** Vault base address, e.g. `https://vault.internal:8200`. */
  readonly address: string;
  /** Vault token (authenticates every request). */
  readonly token: string;
  /** Transit mount path (default `transit`). */
  readonly mount?: string;
  /** Optional Vault Enterprise namespace. */
  readonly namespace?: string;
  /** Transit key type provisioned by `generateKeyRef` (default `aes256-gcm96`). */
  readonly keyType?: string;
  /** Local provider for non-key ops (hash/verifyHash/randomToken) — reuse `NodeCrypto`, never duplicated. */
  readonly localCrypto: CryptoPort;
}

export class VaultTransitProvider extends KmsCryptoProvider {
  readonly name = "vault";
  private readonly http: JsonHttpClient;
  private readonly address: string;
  private readonly token: string;
  private readonly mount: string;
  private readonly namespace: string | undefined;
  private readonly keyType: string;

  constructor(options: VaultTransitOptions) {
    super(options.localCrypto);
    this.http = options.http;
    this.address = options.address.replace(/\/$/, "");
    this.token = options.token;
    this.mount = options.mount ?? "transit";
    this.namespace = options.namespace;
    this.keyType = options.keyType ?? "aes256-gcm96";
  }

  private headers(): Record<string, string> {
    return {
      "X-Vault-Token": this.token,
      ...(this.namespace !== undefined ? { "X-Vault-Namespace": this.namespace } : {}),
    };
  }
  private url(path: string): string {
    return `${this.address}/v1/${this.mount}/${path}`;
  }
  private keyName(ref: string): string {
    const withoutPrefix = ref.startsWith(REF_PREFIX) ? ref.slice(REF_PREFIX.length) : ref;
    const hashIndex = withoutPrefix.indexOf("#");
    return hashIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, hashIndex);
  }

  async generateKeyRef(purpose: string): Promise<string> {
    const name = safeKeyName(purpose);
    // Creating an existing key is a safe no-op update in Vault, so this is idempotent.
    await this.http.postJson(this.url(`keys/${name}`), { type: this.keyType }, this.headers());
    return `${REF_PREFIX}${name}#v1`;
  }

  async rotate(keyRef: string): Promise<string> {
    const name = this.keyName(keyRef);
    await this.http.postJson(this.url(`keys/${name}/rotate`), {}, this.headers());
    const read = (await this.http.getJson(
      this.url(`keys/${name}`),
      this.headers(),
    )) as VaultKeyRead;
    const version = read.data?.latest_version ?? 1;
    return `${REF_PREFIX}${name}#v${version}`;
  }

  async encrypt(plaintext: string, keyRef: string): Promise<string> {
    const res = (await this.http.postJson(
      this.url(`encrypt/${this.keyName(keyRef)}`),
      { plaintext: b64encode(plaintext) },
      this.headers(),
    )) as VaultEncrypt;
    const ciphertext = res.data?.ciphertext;
    if (ciphertext === undefined) throw new Error("vault transit encrypt returned no ciphertext");
    return ciphertext;
  }

  async decrypt(ciphertext: string, keyRef: string): Promise<string> {
    const res = (await this.http.postJson(
      this.url(`decrypt/${this.keyName(keyRef)}`),
      { ciphertext },
      this.headers(),
    )) as VaultDecrypt;
    const plaintext = res.data?.plaintext;
    if (plaintext === undefined) throw new Error("vault transit decrypt returned no plaintext");
    return b64decode(plaintext);
  }

  async sign(payload: string, keyRef: string): Promise<string> {
    const res = (await this.http.postJson(
      this.url(`sign/${this.keyName(keyRef)}`),
      { input: b64encode(payload) },
      this.headers(),
    )) as VaultSign;
    const signature = res.data?.signature;
    if (signature === undefined) throw new Error("vault transit sign returned no signature");
    return signature;
  }

  async verify(payload: string, signature: string, keyRef: string): Promise<boolean> {
    const res = (await this.http.postJson(
      this.url(`verify/${this.keyName(keyRef)}`),
      { input: b64encode(payload), signature },
      this.headers(),
    )) as VaultVerify;
    return res.data?.valid === true;
  }
}
