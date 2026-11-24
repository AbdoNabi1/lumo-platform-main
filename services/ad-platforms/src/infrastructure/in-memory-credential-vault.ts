import type { AdPlatform } from "../domain/connection";
import type { CredentialVaultPort } from "../application/ports";

interface StubPayload {
  readonly t: string;
  readonly p: string;
  readonly s: string;
}

/**
 * Dev/test vault. NOT ENCRYPTION: it base64-encodes the secret together with tenant and platform and checks both on
 * open, so isolation tests behave like the real envelope vault. Task 2 provides the real one.
 */
export class InMemoryCredentialVault implements CredentialVaultPort {
  readonly backing = "stub" as const;

  seal(tenantId: string, platform: AdPlatform, secret: string): Promise<string> {
    const payload: StubPayload = { t: tenantId, p: platform, s: secret };
    return Promise.resolve(Buffer.from(JSON.stringify(payload), "utf8").toString("base64"));
  }

  open(tenantId: string, platform: AdPlatform, sealed: string): Promise<string> {
    try {
      const payload = JSON.parse(
        Buffer.from(sealed, "base64").toString("utf8"),
      ) as Partial<StubPayload>;
      if (payload.t === tenantId && payload.p === platform && typeof payload.s === "string") {
        return Promise.resolve(payload.s);
      }
    } catch {
      // fall through to the generic error
    }
    return Promise.reject(new Error("Ad platform credentials could not be opened"));
  }
}
