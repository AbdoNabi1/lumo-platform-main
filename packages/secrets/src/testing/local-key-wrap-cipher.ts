import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { KeyWrapCipher } from "../envelope";

/**
 * TEST DOUBLE ONLY (`@platform/secrets/testing`). A real AES-256-GCM {@link KeyWrapCipher}, so tests
 * exercise genuine encryption rather than a base64 stand-in, whose key is derived from the key ref
 * like the runtime's `NodeCrypto`. Production composes `@platform/security`'s crypto (or a KMS
 * provider) instead. It lives here, behind a test-only subpath, so every service's credential
 * vault tests share one cipher instead of each keeping a copy (a service may not import another
 * service's internals). Nothing outside a test may import it.
 */
export class LocalKeyWrapCipher implements KeyWrapCipher {
  private key(ref: string): Buffer {
    return scryptSync(ref, "platform-secrets-test", 32);
  }

  encrypt(plaintext: string, keyRef: string): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(keyRef), iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Promise.resolve(
      `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`,
    );
  }

  decrypt(ciphertext: string, keyRef: string): Promise<string> {
    const [iv, tag, ct] = ciphertext.split(":");
    if (iv === undefined || tag === undefined || ct === undefined) {
      return Promise.reject(new Error("malformed ciphertext"));
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key(keyRef), Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Promise.resolve(
        Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString(
          "utf8",
        ),
      );
    } catch (error) {
      // A wrong key or a tampered tag throws synchronously; surface it as a rejection like a real
      // async KMS call would.
      return Promise.reject(error instanceof Error ? error : new Error("decryption failed"));
    }
  }

  wrapKey(keyMaterial: string, kekRef: string): Promise<string> {
    return this.encrypt(keyMaterial, kekRef);
  }

  unwrapKey(wrapped: string, kekRef: string): Promise<string> {
    return this.decrypt(wrapped, kekRef);
  }

  randomToken(bytes = 24): Promise<string> {
    return Promise.resolve(randomBytes(bytes).toString("hex"));
  }
}
