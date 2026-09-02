import type { CryptoPort } from "@platform/security";
import { signAwsRequest, type AwsCredentials } from "./aws-sigv4";
import type { JsonHttpClient } from "./http-transport";
import { b64decode, b64encode, KmsCryptoProvider } from "./kms-base";

/**
 * **AWS KMS** provider (H-3 / G-SEC-2) — a production `KmsPort` + `CryptoPort` over the KMS `TrentService`
 * JSON API, signed with SigV4 ({@link signAwsRequest}, `node:crypto` only, no AWS SDK). Encrypt/decrypt
 * use the configured **symmetric** CMK; sign/verify use an **asymmetric** CMK named by the key ref. The
 * CMK never leaves KMS — only ciphertext and signatures cross the wire. Credentials sign the request and
 * are never logged.
 */

interface KmsEncryptResponse {
  readonly CiphertextBlob?: string;
}
interface KmsDecryptResponse {
  readonly Plaintext?: string;
}
interface KmsSignResponse {
  readonly Signature?: string;
}
interface KmsVerifyResponse {
  readonly SignatureValid?: boolean;
}

const REF_PREFIX = "aws-kms://";

export interface AwsKmsOptions {
  readonly http: JsonHttpClient;
  readonly region: string;
  readonly credentials: AwsCredentials;
  /** The default symmetric CMK id/ARN used for envelope encrypt/decrypt. */
  readonly defaultKeyId: string;
  /** Signing algorithm for asymmetric sign/verify (default `ECDSA_SHA_256`). */
  readonly signingAlgorithm?: string;
  /** Injected clock (deterministic signing in tests). */
  readonly now?: () => Date;
  readonly localCrypto: CryptoPort;
}

export class AwsKmsProvider extends KmsCryptoProvider {
  readonly name = "aws";
  private readonly http: JsonHttpClient;
  private readonly region: string;
  private readonly host: string;
  private readonly credentials: AwsCredentials;
  private readonly defaultKeyId: string;
  private readonly signingAlgorithm: string;
  private readonly now: () => Date;

  constructor(options: AwsKmsOptions) {
    super(options.localCrypto);
    this.http = options.http;
    this.region = options.region;
    this.host = `kms.${options.region}.amazonaws.com`;
    this.credentials = options.credentials;
    this.defaultKeyId = options.defaultKeyId;
    this.signingAlgorithm = options.signingAlgorithm ?? "ECDSA_SHA_256";
    this.now = options.now ?? ((): Date => new Date());
  }

  private keyId(ref: string): string {
    if (!ref.startsWith(REF_PREFIX)) return ref;
    const rest = ref.slice(REF_PREFIX.length);
    const id = rest.split(/[/#]/)[0];
    return id === undefined || id.length === 0 ? this.defaultKeyId : id;
  }

  /** Signs + sends a `TrentService.<op>` call and returns its parsed JSON body. */
  private async call(op: string, payload: Record<string, unknown>): Promise<unknown> {
    const body = JSON.stringify(payload);
    const url = `https://${this.host}/`;
    const headers = signAwsRequest({
      method: "POST",
      host: this.host,
      path: "/",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `TrentService.${op}`,
      },
      body,
      service: "kms",
      region: this.region,
      credentials: this.credentials,
      date: this.now(),
    });
    return this.http.send(url, { method: "POST", headers, body });
  }

  generateKeyRef(purpose: string): Promise<string> {
    // The CMK is provisioned once out-of-band; a ref is a versioned logical pointer at it (envelope model).
    return Promise.resolve(`${REF_PREFIX}${this.defaultKeyId}/${encodeURIComponent(purpose)}#v1`);
  }

  async rotate(keyRef: string): Promise<string> {
    const keyId = this.keyId(keyRef);
    await this.call("EnableKeyRotation", { KeyId: keyId });
    const match = /#v(\d+)$/.exec(keyRef);
    const next = (match !== null ? Number.parseInt(match[1] ?? "1", 10) : 1) + 1;
    return `${keyRef.replace(/#v\d+$/, "")}#v${next}`;
  }

  async encrypt(plaintext: string, keyRef: string): Promise<string> {
    const res = (await this.call("Encrypt", {
      KeyId: this.keyId(keyRef),
      Plaintext: b64encode(plaintext),
    })) as KmsEncryptResponse;
    if (res.CiphertextBlob === undefined) throw new Error("aws kms encrypt returned no ciphertext");
    return res.CiphertextBlob;
  }

  async decrypt(ciphertext: string, keyRef: string): Promise<string> {
    const res = (await this.call("Decrypt", {
      CiphertextBlob: ciphertext,
      KeyId: this.keyId(keyRef),
    })) as KmsDecryptResponse;
    if (res.Plaintext === undefined) throw new Error("aws kms decrypt returned no plaintext");
    return b64decode(res.Plaintext);
  }

  async sign(payload: string, keyRef: string): Promise<string> {
    const res = (await this.call("Sign", {
      KeyId: this.keyId(keyRef),
      Message: b64encode(payload),
      MessageType: "RAW",
      SigningAlgorithm: this.signingAlgorithm,
    })) as KmsSignResponse;
    if (res.Signature === undefined) throw new Error("aws kms sign returned no signature");
    return res.Signature;
  }

  async verify(payload: string, signature: string, keyRef: string): Promise<boolean> {
    const res = (await this.call("Verify", {
      KeyId: this.keyId(keyRef),
      Message: b64encode(payload),
      MessageType: "RAW",
      Signature: signature,
      SigningAlgorithm: this.signingAlgorithm,
    })) as KmsVerifyResponse;
    return res.SignatureValid === true;
  }
}
