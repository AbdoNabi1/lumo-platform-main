import { describe, expect, it } from "vitest";
import { NodeCrypto } from "@platform/security";
import {
  JsonHttpClient,
  type HttpFetch,
  type HttpRequestInit,
  type HttpResponse,
} from "./http-transport";
import { VaultTransitProvider } from "./kms-vault";
import { AwsKmsProvider } from "./kms-aws";
import { AzureKeyVaultProvider, GcpKmsProvider } from "./kms-cloud";
import { StaticBearerTokenProvider } from "./oauth-token";

interface Recorded {
  readonly url: string;
  readonly init: HttpRequestInit | undefined;
}
type Route = (url: string, init: HttpRequestInit | undefined) => { status: number; body?: unknown };

/** A recording fetch double dispatching on the (method, url) via a caller-supplied route function. */
function mockHttp(route: Route): { http: JsonHttpClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchFn: HttpFetch = async (url, init) => {
    calls.push({ url, init });
    const { status, body } = route(url, init);
    const text = body === undefined ? "" : JSON.stringify(body);
    const response: HttpResponse = { status, text: async () => text, json: async () => body };
    return response;
  };
  return { http: new JsonHttpClient({ fetch: fetchFn }), calls };
}

const local = new NodeCrypto();
const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

describe("VaultTransitProvider", () => {
  it("creates keys, encrypts/decrypts, signs/verifies, and rotates via the Transit REST API", async () => {
    const { http, calls } = mockHttp((url, init) => {
      if (url.endsWith("/keys/creds") && init?.method === "GET")
        return { status: 200, body: { data: { latest_version: 4 } } };
      if (url.includes("/keys/creds/rotate")) return { status: 204 };
      if (url.includes("/keys/creds")) return { status: 204 };
      if (url.includes("/encrypt/creds"))
        return { status: 200, body: { data: { ciphertext: "vault:v1:abc" } } };
      if (url.includes("/decrypt/creds"))
        return { status: 200, body: { data: { plaintext: b64("hello") } } };
      if (url.includes("/sign/creds"))
        return { status: 200, body: { data: { signature: "vault:v1:sig" } } };
      if (url.includes("/verify/creds")) return { status: 200, body: { data: { valid: true } } };
      return { status: 404 };
    });
    const provider = new VaultTransitProvider({
      http,
      address: "https://vault.test:8200/",
      token: "s.tok",
      localCrypto: local,
    });

    expect(await provider.generateKeyRef("creds")).toBe("transit://creds#v1");
    expect(await provider.encrypt("hello", "transit://creds#v1")).toBe("vault:v1:abc");
    expect(await provider.decrypt("vault:v1:abc", "transit://creds")).toBe("hello");
    expect(await provider.sign("payload", "transit://creds")).toBe("vault:v1:sig");
    expect(await provider.verify("payload", "vault:v1:sig", "transit://creds")).toBe(true);
    expect(await provider.rotate("transit://creds#v1")).toBe("transit://creds#v4");

    const encryptCall = calls.find((c) => c.url.includes("/encrypt/creds"));
    expect(encryptCall?.init?.headers?.["X-Vault-Token"]).toBe("s.tok");
    expect(JSON.parse(encryptCall?.init?.body ?? "{}")).toEqual({ plaintext: b64("hello") });
  });

  it("delegates non-key ops to node:crypto (fingerprint is non-reversible)", async () => {
    const { http } = mockHttp(() => ({ status: 404 }));
    const provider = new VaultTransitProvider({
      http,
      address: "https://vault.test",
      token: "t",
      localCrypto: local,
    });
    const fp = await provider.fingerprint("material");
    expect(fp.startsWith("fp_")).toBe(true);
    expect(fp).not.toContain("material");
    expect((await provider.randomToken(8)).length).toBe(16);
  });
});

describe("AwsKmsProvider", () => {
  it("signs requests with SigV4 and maps KMS responses", async () => {
    const { http, calls } = mockHttp((_url, init) => {
      const target = init?.headers?.["X-Amz-Target"] ?? "";
      if (target.endsWith("Encrypt")) return { status: 200, body: { CiphertextBlob: "CIPHER" } };
      if (target.endsWith("Decrypt")) return { status: 200, body: { Plaintext: b64("plain") } };
      if (target.endsWith("Sign")) return { status: 200, body: { Signature: "SIG" } };
      if (target.endsWith("Verify")) return { status: 200, body: { SignatureValid: true } };
      if (target.endsWith("EnableKeyRotation")) return { status: 200, body: {} };
      return { status: 400 };
    });
    const provider = new AwsKmsProvider({
      http,
      region: "us-east-1",
      credentials: { accessKeyId: "AKID", secretAccessKey: "secret" },
      defaultKeyId: "key-1",
      now: () => new Date("2026-07-18T00:00:00Z"),
      localCrypto: local,
    });

    expect(await provider.generateKeyRef("db")).toBe("aws-kms://key-1/db#v1");
    expect(await provider.encrypt("plain", "aws-kms://key-1#v1")).toBe("CIPHER");
    expect(await provider.decrypt("CIPHER", "aws-kms://key-1#v1")).toBe("plain");
    expect(await provider.sign("p", "aws-kms://sign-key#v1")).toBe("SIG");
    expect(await provider.verify("p", "SIG", "aws-kms://sign-key#v1")).toBe(true);
    expect(await provider.rotate("aws-kms://key-1/db#v1")).toBe("aws-kms://key-1/db#v2");

    const signed = calls[0];
    expect(signed?.init?.headers?.["Authorization"]).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID/);
  });
});

describe("GcpKmsProvider", () => {
  it("encrypts/decrypts and MAC-signs with a bearer token", async () => {
    const { http, calls } = mockHttp((url) => {
      if (url.endsWith(":encrypt")) return { status: 200, body: { ciphertext: "GCIPHER" } };
      if (url.endsWith(":decrypt")) return { status: 200, body: { plaintext: b64("gplain") } };
      if (url.endsWith(":macSign")) return { status: 200, body: { mac: "GMAC" } };
      if (url.endsWith(":macVerify")) return { status: 200, body: { success: true } };
      return { status: 404 };
    });
    const provider = new GcpKmsProvider({
      http,
      tokenProvider: new StaticBearerTokenProvider("gtok"),
      defaultKeyResource: "projects/p/cryptoKeys/k",
      localCrypto: local,
    });

    expect(await provider.encrypt("gplain", "gcp-kms://projects/p/cryptoKeys/k#v1")).toBe(
      "GCIPHER",
    );
    expect(await provider.decrypt("GCIPHER", "gcp-kms://projects/p/cryptoKeys/k")).toBe("gplain");
    expect(await provider.sign("p", "gcp-kms://projects/p/cryptoKeys/k")).toBe("GMAC");
    expect(await provider.verify("p", "GMAC", "gcp-kms://projects/p/cryptoKeys/k")).toBe(true);
    expect(calls[0]?.init?.headers?.["Authorization"]).toBe("Bearer gtok");
  });
});

describe("AzureKeyVaultProvider", () => {
  it("resolves the key version, then encrypts/decrypts with base64url values", async () => {
    const { http } = mockHttp((url) => {
      if (
        url.includes("/keys/kv?") ||
        (url.includes("/keys/kv") &&
          url.includes("api-version") &&
          !url.includes("/encrypt") &&
          !url.includes("/decrypt"))
      ) {
        return { status: 200, body: { key: { kid: "https://v.vault.azure.net/keys/kv/ver123" } } };
      }
      if (url.includes("/encrypt"))
        return {
          status: 200,
          body: { value: Buffer.from("acipher", "utf8").toString("base64url") },
        };
      if (url.includes("/decrypt"))
        return {
          status: 200,
          body: { value: Buffer.from("aplain", "utf8").toString("base64url") },
        };
      return { status: 404 };
    });
    const provider = new AzureKeyVaultProvider({
      http,
      tokenProvider: new StaticBearerTokenProvider("atok"),
      vaultUrl: "https://v.vault.azure.net",
      defaultKeyName: "kv",
      localCrypto: local,
    });

    expect(await provider.generateKeyRef("p")).toBe("azure-kv://kv/ver123#v1:p");
    expect(await provider.encrypt("aplain", "azure-kv://kv/ver123#v1")).toBe(
      Buffer.from("acipher", "utf8").toString("base64url"),
    );
    expect(await provider.decrypt("x", "azure-kv://kv/ver123#v1")).toBe("aplain");
  });
});
