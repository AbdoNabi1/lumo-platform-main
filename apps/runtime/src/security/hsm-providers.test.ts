import { createSign, createVerify, generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CloudHsmProvider,
  Pkcs11HsmProvider,
  YubiHsmProvider,
  type Pkcs11Session,
} from "./hsm-providers";

/**
 * A faithful in-test {@link Pkcs11Session} — real EC keys generated inside the "device" and referenced by
 * handle. Private keys are stored in a closure and are **never** returned by any method: there is no
 * export/getPrivateKey seam, mirroring the keys-never-leave-the-HSM guarantee. In production this seam is a
 * native PKCS#11 module (CloudHSM / YubiHSM).
 */
function testSession(): Pkcs11Session {
  const store = new Map<
    string,
    { readonly privateKey: KeyObject; readonly publicKey: KeyObject }
  >();
  let counter = 0;
  const session: Pkcs11Session = {
    async generateKeyPair({ label }) {
      const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      const handle = `hsm-object://${label}/${(counter += 1)}`;
      store.set(handle, { privateKey, publicKey });
      return { handle };
    },
    async getPublicKey(handle) {
      const entry = store.get(handle);
      if (entry === undefined) throw new Error("no such handle");
      return entry.publicKey.export({ type: "spki", format: "pem" }).toString();
    },
    async sign(handle, data) {
      const entry = store.get(handle);
      if (entry === undefined) throw new Error("no such handle");
      return createSign("SHA256").update(data).sign(entry.privateKey);
    },
    async verify(handle, data, signature) {
      const entry = store.get(handle);
      if (entry === undefined) throw new Error("no such handle");
      return createVerify("SHA256").update(data).verify(entry.publicKey, signature);
    },
  };
  return session;
}

describe("Pkcs11HsmProvider", () => {
  it("generates a key, exposes only the public key, and signs/verifies via handles", async () => {
    const hsm = new Pkcs11HsmProvider({ session: testSession() });

    const ref = await hsm.generateKey({ label: "signing", algorithm: "ecdsa-p256" });
    expect(ref.algorithm).toBe("ecdsa-p256");
    expect(ref.keyRef).toContain("hsm-object://signing");

    const publicKey = await hsm.getPublicKey(ref.keyRef);
    expect(publicKey).toContain("PUBLIC KEY");
    expect(publicKey).not.toContain("PRIVATE KEY");

    const signature = await hsm.sign(ref.keyRef, "attestation");
    expect(await hsm.verify(ref.keyRef, "attestation", signature)).toBe(true);
    expect(await hsm.verify(ref.keyRef, "tampered", signature)).toBe(false);
  });

  it("exposes no key-export surface (keys never leave the HSM boundary)", () => {
    const hsm = new Pkcs11HsmProvider({ session: testSession() });
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(hsm));
    expect(surface).not.toContain("export");
    expect(surface).not.toContain("getPrivateKey");
    expect(surface.filter((m) => m !== "constructor").sort()).toEqual([
      "generateKey",
      "getPublicKey",
      "sign",
      "verify",
    ]);
  });
});

describe("CloudHsmProvider / YubiHsmProvider", () => {
  it("carry their provider names and share the PKCS#11 behaviour", async () => {
    const cloud = new CloudHsmProvider(testSession());
    const yubi = new YubiHsmProvider(testSession());
    expect(cloud.name).toBe("cloudhsm");
    expect(yubi.name).toBe("yubihsm");

    const ref = await yubi.generateKey({ label: "y", algorithm: "ecdsa-p256" });
    const sig = await yubi.sign(ref.keyRef, "x");
    expect(await yubi.verify(ref.keyRef, "x", sig)).toBe(true);
  });
});
