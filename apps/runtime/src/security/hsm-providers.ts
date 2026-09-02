import type { HsmKeyAlgorithm, HsmKeyRef, HsmProviderPort } from "@platform/security";

/**
 * **HSM providers** (H-3 / G-SEC-2) built on **PKCS#11**, the vendor-neutral HSM standard. AWS CloudHSM
 * and YubiHSM both ship PKCS#11 modules, so one real adapter unifies all three targets — differing only in
 * which {@link Pkcs11Session} the deployment injects (the native module lives in the runtime image, never
 * bundled in the repo, exactly as the Ory clients take an injected fetch, honouring the dependency freeze).
 *
 * **Keys never leave the HSM boundary:** the port exposes only `generateKey` / `getPublicKey` (public
 * material) / `sign` / `verify`. There is deliberately no export/getPrivateKey path — private keys are
 * created inside the device and only ever referenced by their non-exportable handle.
 */

/**
 * The injected PKCS#11 session — the thin seam over a concrete `#pkcs11` / CloudHSM / YubiHSM module. It
 * operates on opaque object handles; it can generate a key pair, read a **public** key, and sign/verify.
 * It exposes no primitive that could export a private key.
 */
export interface Pkcs11Session {
  generateKeyPair(input: {
    readonly label: string;
    readonly algorithm: HsmKeyAlgorithm;
  }): Promise<{ readonly handle: string }>;
  /** Returns the SPKI/PEM-encoded public key for a handle. */
  getPublicKey(handle: string): Promise<string>;
  sign(handle: string, data: Buffer): Promise<Buffer>;
  verify(handle: string, data: Buffer, signature: Buffer): Promise<boolean>;
}

export interface Pkcs11HsmOptions {
  readonly session: Pkcs11Session;
  /** Adapter name for audit/registry/telemetry (default `pkcs11`). */
  readonly name?: string;
}

/** PKCS#11 HSM adapter — the base for every hardware-backed provider. */
export class Pkcs11HsmProvider implements HsmProviderPort {
  readonly name: string;
  private readonly session: Pkcs11Session;

  constructor(options: Pkcs11HsmOptions) {
    this.session = options.session;
    this.name = options.name ?? "pkcs11";
  }

  async generateKey(input: {
    readonly label: string;
    readonly algorithm: HsmKeyAlgorithm;
  }): Promise<HsmKeyRef> {
    const { handle } = await this.session.generateKeyPair(input);
    return { keyRef: handle, algorithm: input.algorithm };
  }
  getPublicKey(keyRef: string): Promise<string> {
    return this.session.getPublicKey(keyRef);
  }
  async sign(keyRef: string, payload: string): Promise<string> {
    const signature = await this.session.sign(keyRef, Buffer.from(payload, "utf8"));
    return signature.toString("base64");
  }
  verify(keyRef: string, payload: string, signature: string): Promise<boolean> {
    return this.session.verify(
      keyRef,
      Buffer.from(payload, "utf8"),
      Buffer.from(signature, "base64"),
    );
  }
}

/**
 * **AWS CloudHSM** adapter — CloudHSM is FIPS 140-2 Level 3 hardware exposed through its own PKCS#11
 * module; the deployment injects a session bound to the CloudHSM cluster. Behaviour is the PKCS#11
 * standard; only the provider name differs (for audit/registry).
 */
export class CloudHsmProvider extends Pkcs11HsmProvider {
  constructor(session: Pkcs11Session) {
    super({ session, name: "cloudhsm" });
  }
}

/**
 * **YubiHSM 2** adapter — YubiHSM ships a PKCS#11 module (yubihsm_pkcs11 over the connector); the
 * deployment injects a session bound to it. Same standard operations; private keys stay on the device.
 */
export class YubiHsmProvider extends Pkcs11HsmProvider {
  constructor(session: Pkcs11Session) {
    super({ session, name: "yubihsm" });
  }
}
