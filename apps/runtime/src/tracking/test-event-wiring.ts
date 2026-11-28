/**
 * Production wiring of the ad platform test event sender (Tracking P2-D11).
 *
 * The sender exists exactly when the connection reader does (`AD_PLATFORM_CREDENTIALS_KEK_REF` set): without the
 * vault no token can be saved, so there is nothing to test. It reads the same sealed connections the delivery path
 * does, resolves the store address through the same cached resolver the business events use, and talks to the
 * vendors through the same `fetch` transport. It writes nothing anywhere.
 */

import { randomUUID } from "node:crypto";

import type { ConnectionsForDelivery } from "@platform/ad-platforms";
import type { Clock } from "@platform/contracts";
import type { Database } from "@platform/db";
import type { TestEventService } from "@platform/tracking";
import type { Logger } from "@platform/utils";

import { PrismaStoreUrlResolver } from "./prisma-store-url-resolver";
import { AdPlatformTestEventSender } from "./test-event-sender";
import { FetchHttpTransport } from "./tracking-adapters";

export function buildTestEventSender(input: {
  readonly connections: ConnectionsForDelivery | undefined;
  readonly prisma: Database;
  readonly platformTenantId: string;
  readonly storefrontPublicUrl: string | undefined;
  readonly clock: Clock;
  readonly logger: Logger;
}): TestEventService | undefined {
  if (input.connections === undefined) return undefined;
  return new AdPlatformTestEventSender({
    connections: input.connections,
    transport: new FetchHttpTransport(),
    storeUrls: new PrismaStoreUrlResolver({
      db: input.prisma,
      platformTenantId: input.platformTenantId,
      ...(input.storefrontPublicUrl === undefined
        ? {}
        : { fallbackUrl: input.storefrontPublicUrl }),
      clock: input.clock,
    }),
    clock: input.clock,
    newId: () => randomUUID(),
    logger: input.logger,
  });
}
