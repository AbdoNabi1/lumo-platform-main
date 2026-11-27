import type { Clock } from "@platform/contracts";
import { StoreEmailDelivery } from "../application/store-email-delivery";
import type { EmailConnectionKind } from "../domain/messaging/email-connection";
import { InMemoryEmailConnectionRepository } from "../infrastructure/in-memory-messaging-repositories";
import { InMemoryStoreEmailProvider } from "../infrastructure/in-memory-store-email-provider";
import { testEmailVault } from "./email-connection-doubles";

/** A store's API key as used across the suites. */
export const STORE_KEY = "re_store_AbCdEfGhIjKlMnOpQrStUv1234";

export const FIXED_NOW = new Date("2026-11-26T10:00:00.000Z");
export const fixedClock: Clock = { now: () => FIXED_NOW };

/**
 * TEST FIXTURE: a store's email account wired over real envelope sealing, the in-memory repository
 * and the recording provider twin. `connect` seeds a connection exactly as `SaveEmailConnection`
 * would have written it.
 */
export function storeEmailFixture() {
  const connections = new InMemoryEmailConnectionRepository();
  const vault = testEmailVault();
  const provider = new InMemoryStoreEmailProvider();
  const delivery = new StoreEmailDelivery({ connections, vault, provider, clock: fixedClock });

  async function connect(
    tenantId: string,
    options: {
      readonly fromEmail?: string;
      readonly apiKey?: string;
      readonly enabled?: boolean;
      readonly status?: "connected" | "failed";
      readonly kind?: EmailConnectionKind;
    } = {},
  ): Promise<void> {
    const apiKey = options.apiKey ?? STORE_KEY;
    const kind = options.kind ?? "resend";
    await connections.save(
      tenantId,
      {
        kind,
        fromEmail: (options.fromEmail ?? "shop@nusuj.com").toLowerCase(),
        sealedCredentials: await vault.seal(tenantId, kind, { apiKey }),
        secretLast4: apiKey.slice(-4),
        enabled: options.enabled ?? true,
        status: options.status ?? "connected",
        lastError: null,
        lastErrorAt: null,
        verifiedAt: FIXED_NOW,
      },
      null,
    );
  }

  return { connections, vault, provider, delivery, connect };
}
