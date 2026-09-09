import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { AuthMethodKind, MfaMethodKind } from "../domain/value-objects/auth-method";
import type {
  AuthenticationProviderPort,
  AuthenticationProviderResolver,
  AuthenticationRequest,
  AuthenticationResult,
  CryptoPort,
  GeoIpPort,
  MfaProviderPort,
  MfaProviderResolver,
} from "../application/auth-ports";
import type { RiskEngineSignals } from "../domain/risk-engine";

/**
 * `node:crypto`-backed {@link CryptoPort} — the default provider (sprint P2.0-B §15). SHA-256 content
 * hashing, AES-256-GCM encryption + key wrapping (key derived from the ref via scrypt), HMAC-SHA256
 * signatures, CSPRNG tokens. Cloud KMS/HSM providers implement the same interface later (G-SEC-2).
 */
export class NodeCrypto implements CryptoPort {
  private key(ref: string): Buffer {
    return scryptSync(ref, "morbeh-security", 32);
  }

  async hash(value: string): Promise<string> {
    return createHash("sha256").update(value).digest("hex");
  }
  async verifyHash(value: string, hash: string): Promise<boolean> {
    const computed = Buffer.from(await this.hash(value), "hex");
    const expected = Buffer.from(hash, "hex");
    return computed.length === expected.length && timingSafeEqual(computed, expected);
  }
  async encrypt(plaintext: string, keyRef: string): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(keyRef), iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
  }
  async decrypt(ciphertext: string, keyRef: string): Promise<string> {
    const [iv, tag, ct] = ciphertext.split(":");
    if (iv === undefined || tag === undefined || ct === undefined)
      throw new Error("malformed ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", this.key(keyRef), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString(
      "utf8",
    );
  }
  async sign(payload: string, keyRef: string): Promise<string> {
    return createHmac("sha256", this.key(keyRef)).update(payload).digest("hex");
  }
  async verify(payload: string, signature: string, keyRef: string): Promise<boolean> {
    const expected = Buffer.from(await this.sign(payload, keyRef), "hex");
    const got = Buffer.from(signature, "hex");
    return expected.length === got.length && timingSafeEqual(expected, got);
  }
  async wrapKey(keyMaterial: string, kekRef: string): Promise<string> {
    return this.encrypt(keyMaterial, kekRef);
  }
  async unwrapKey(wrapped: string, kekRef: string): Promise<string> {
    return this.decrypt(wrapped, kekRef);
  }
  async randomToken(bytes = 24): Promise<string> {
    return randomBytes(bytes).toString("hex");
  }
}

/** Map-backed {@link AuthenticationProviderResolver} — composition registers plugins by method. */
export class MapAuthenticationProviderResolver implements AuthenticationProviderResolver {
  private readonly byMethod = new Map<AuthMethodKind, AuthenticationProviderPort>();
  constructor(providers: readonly AuthenticationProviderPort[] = []) {
    for (const p of providers) this.byMethod.set(p.method, p);
  }
  register(provider: AuthenticationProviderPort): void {
    this.byMethod.set(provider.method, provider);
  }
  get(method: AuthMethodKind): AuthenticationProviderPort | null {
    return this.byMethod.get(method) ?? null;
  }
  supportedMethods(): readonly AuthMethodKind[] {
    return [...this.byMethod.keys()];
  }
}

/** Map-backed {@link MfaProviderResolver}. */
export class MapMfaProviderResolver implements MfaProviderResolver {
  private readonly byMethod = new Map<MfaMethodKind, MfaProviderPort>();
  constructor(providers: readonly MfaProviderPort[] = []) {
    for (const p of providers) this.byMethod.set(p.method, p);
  }
  register(provider: MfaProviderPort): void {
    this.byMethod.set(provider.method, provider);
  }
  get(method: MfaMethodKind): MfaProviderPort | null {
    return this.byMethod.get(method) ?? null;
  }
  supportedMethods(): readonly MfaMethodKind[] {
    return [...this.byMethod.keys()];
  }
}

/**
 * Reference in-memory password provider (offline/tests) — a seedable identifier→credential map that
 * resolves to a principal external id. A production adapter (Kratos/OIDC/LDAP) implements the same
 * `AuthenticationProviderPort`; Security stays uncoupled.
 */
export class InMemoryPasswordAuthProvider implements AuthenticationProviderPort {
  readonly method: AuthMethodKind = "password";
  private readonly accounts = new Map<string, { password: string; principalExternalId: string }>();
  register(identifier: string, password: string, principalExternalId: string): void {
    this.accounts.set(identifier, { password, principalExternalId });
  }
  async authenticate(request: AuthenticationRequest): Promise<AuthenticationResult> {
    const account = this.accounts.get(request.identifier);
    if (account === undefined || account.password !== request.credential)
      return { ok: false, reason: "invalid credentials" };
    return { ok: true, principalExternalId: account.principalExternalId };
  }
}

/** Reference in-memory TOTP MFA provider (offline/tests). Real authenticator/WebAuthn adapters swap in. */
export class InMemoryTotpMfaProvider implements MfaProviderPort {
  readonly method: MfaMethodKind = "totp";
  constructor(private readonly validCode = "123456") {}
  async enroll(input: { principalRef: string }): Promise<{ secretRef: string }> {
    return { secretRef: `totp:${input.principalRef}` };
  }
  async issueChallenge(): Promise<{ challengeRef: string }> {
    return { challengeRef: `chal_${Date.now()}` };
  }
  async verify(input: { secretRef: string | null; code: string }): Promise<boolean> {
    return input.code === this.validCode;
  }
}

/** In-memory {@link GeoIpPort} — a seedable IP→enrichment map (offline/tests). */
export class InMemoryGeoIp implements GeoIpPort {
  private readonly table = new Map<
    string,
    Partial<RiskEngineSignals> & { country?: string; asn?: string }
  >();
  seed(ip: string, data: Partial<RiskEngineSignals> & { country?: string; asn?: string }): void {
    this.table.set(ip, data);
  }
  async lookup(
    ip: string,
  ): Promise<
    Partial<
      Pick<RiskEngineSignals, "tor" | "vpn" | "ipReputation" | "asnReputation" | "newGeo">
    > & { country?: string; asn?: string }
  > {
    return this.table.get(ip) ?? {};
  }
}
