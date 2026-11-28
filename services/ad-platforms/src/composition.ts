import type { Clock, IdGenerator } from "@platform/contracts";
import type { Database } from "@platform/db";
import type { Logger } from "@platform/utils";
import {
  GetLiveConnections,
  GetPublicAdPlatforms,
  ListConnections,
  OpenConnectionSecret,
  SaveConnection,
  type LiveConnection,
} from "./application/connections.use-cases";
import type { CredentialPolicy, CredentialVaultPort, DeliverySyncPort } from "./application/ports";
import type { AdPlatform } from "./domain/connection";
import type { ConnectionRepository } from "./domain/connection-repository";
import { InMemoryConnectionRepository } from "./infrastructure/in-memory-connection-repository";
import { InMemoryCredentialVault } from "./infrastructure/in-memory-credential-vault";
import { PrismaConnectionRepository } from "./infrastructure/prisma-connection-repository";
import { ConnectionsController } from "./interfaces/connections.controller";

export interface AdPlatformsWiringDeps {
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  /** Absent ⇒ `InMemoryCredentialVault` (`backing: "stub"`, NOT encryption). */
  readonly vault?: CredentialVaultPort;
  readonly deliverySync?: DeliverySyncPort;
  readonly logger?: Logger;
  /**
   * Default `allow_stub` for the in-memory branch; the Prisma branch defaults to `require_real_vault` (no
   * environment check anywhere: a stub vault never stores a secret next to a real database).
   */
  readonly credentialPolicy?: CredentialPolicy;
  /**
   * Production persistence. Present ⇒ the Prisma repository; absent ⇒ in-memory. ADR-0014: the repository
   * built here is a tenant-agnostic singleton.
   */
  readonly prisma?: Database;
}

export interface WiredAdPlatforms {
  readonly controller: ConnectionsController;
  readonly internal: {
    readonly getLiveConnections: GetLiveConnections;
    readonly openSecret: OpenConnectionSecret;
  };
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Composition root for the Ad platforms context. It publishes no events, so there is no outbox to drain. */
export function wireAdPlatforms(deps: AdPlatformsWiringDeps): WiredAdPlatforms {
  const connections: ConnectionRepository =
    deps.prisma !== undefined
      ? new PrismaConnectionRepository({ prisma: deps.prisma })
      : new InMemoryConnectionRepository();
  const vault = deps.vault ?? new InMemoryCredentialVault();
  const getLiveConnections = new GetLiveConnections({ connections, vault });
  const openSecret = new OpenConnectionSecret({ connections, vault });
  return {
    controller: new ConnectionsController({
      listConnections: new ListConnections({ connections }),
      saveConnection: new SaveConnection({
        connections,
        vault,
        clock: deps.clock,
        idGenerator: deps.idGenerator,
        credentialPolicy:
          deps.credentialPolicy ??
          (deps.prisma !== undefined ? "require_real_vault" : "allow_stub"),
        deliverySync: deps.deliverySync,
        logger: deps.logger,
      }),
      getPublicAdPlatforms: new GetPublicAdPlatforms({ connections }),
    }),
    internal: { getLiveConnections, openSecret },
    drainOutbox: () => Promise.resolve(0),
    deliveredEventTypes: [],
  };
}

/** The delivery-side view of the connections (Task 4 consumes it). */
export interface ConnectionsForDelivery {
  listLive(tenantId: string): Promise<readonly LiveConnection[]>;
  openSecret(tenantId: string, platform: AdPlatform): Promise<string | null>;
}

const UNAVAILABLE_MESSAGE = "ad platform connections unavailable";

export function connectionsForDelivery(
  internal: WiredAdPlatforms["internal"],
): ConnectionsForDelivery {
  return {
    async listLive(tenantId) {
      let result: Awaited<ReturnType<GetLiveConnections["execute"]>>;
      try {
        result = await internal.getLiveConnections.execute({ tenantId });
      } catch {
        throw new Error(UNAVAILABLE_MESSAGE);
      }
      if (result.ok) return result.value;
      throw new Error(UNAVAILABLE_MESSAGE);
    },
    async openSecret(tenantId, platform) {
      let result: Awaited<ReturnType<OpenConnectionSecret["execute"]>>;
      try {
        result = await internal.openSecret.execute({ tenantId, platform });
      } catch {
        throw new Error(UNAVAILABLE_MESSAGE);
      }
      if (result.ok) return result.value;
      if (result.error.code === "NOT_FOUND") return null;
      throw new Error(UNAVAILABLE_MESSAGE);
    },
  };
}
