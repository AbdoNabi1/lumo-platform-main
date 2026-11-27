/**
 * Resolves `conn://<tenantId>/<platform>` credential references (Lead Site Part D1, Task 4).
 *
 * A shop's ad platform destination holds only that reference. At send time the secret is opened from the
 * sealed vault for exactly that tenant and platform and handed to the HTTP adapter, which presents it the way
 * the vendor expects and keeps it out of the recorded request. Any other reference (`vault://…`) goes to the
 * existing resolver untouched.
 *
 * Failure policy: a missing or disabled connection resolves to `null` (the adapter records a permanent
 * "credential … unresolved" failure — retrying cannot conjure a token). The connection reader throws only a
 * generic "unavailable" error; it is mapped to the same `null` here and never echoed, logged or rethrown, so
 * nothing about the vault or the row can surface.
 */

import type { ConnectionsForDelivery } from "@platform/ad-platforms";
import type { CredentialResolverPort } from "@platform/tracking";

import { SERVER_PLATFORM_KEYS, type ServerPlatform } from "./ad-platform-destinations";

const CONNECTION_REF = new RegExp(`^conn://([^/]+)/(${SERVER_PLATFORM_KEYS.join("|")})$`);

export class ConnectionCredentialResolver implements CredentialResolverPort {
  constructor(
    private readonly deps: {
      readonly connections: Pick<ConnectionsForDelivery, "openSecret">;
      /** Everything that is not a `conn://` reference (the `vault://` secret provider). */
      readonly fallback: CredentialResolverPort;
    },
  ) {}

  async resolve(ref: string): Promise<string | null> {
    const match = CONNECTION_REF.exec(ref);
    if (match === null) return this.deps.fallback.resolve(ref);
    const tenantId = match[1];
    const platform = match[2] as ServerPlatform | undefined;
    if (tenantId === undefined || platform === undefined) return null;
    try {
      const secret = await this.deps.connections.openSecret(tenantId, platform);
      return secret === null || secret === "" ? null : secret;
    } catch {
      return null;
    }
  }
}
