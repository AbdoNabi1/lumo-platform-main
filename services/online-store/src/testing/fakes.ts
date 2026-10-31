import type { Clock, IdGenerator } from "@platform/contracts";
import type {
  ImageDto,
  ImageRefsPort,
  ShopHostPort,
  StoreIdentityPort,
  StorefrontPasswordHasher,
} from "../application/ports";
import type { DomainEvent } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { buildOnlineStoreController, type OnlineStoreRepos } from "../composition";
import {
  InMemoryAccessRepository,
  InMemoryPreferencesRepository,
  InMemoryPreviewTokenRepository,
  InMemoryThemeReleaseRepository,
  InMemoryThemeRepository,
} from "../infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";

/** Media fake: each shop owns the listed ids; a foreign or unknown id resolves to nothing. */
export function fakeImageRefs(owned: Readonly<Record<string, readonly string[]>>): ImageRefsPort {
  const image = (id: string): ImageDto => ({
    url: `https://cdn.test/${id}.png`,
    alt: null,
    width: 64,
    height: 64,
  });
  return {
    existingIds: async (ids, tenantId) => ids.filter((id) => (owned[tenantId] ?? []).includes(id)),
    resolve: async (ids, tenantId) =>
      Object.fromEntries(
        ids.filter((id) => (owned[tenantId] ?? []).includes(id)).map((id) => [id, image(id)]),
      ),
  };
}

/**
 * Records every verify call so a test can see the dummy-hash path ran, and how many units of work
 * were open at each hash so a test can see scrypt runs outside the transaction (Ruling 10).
 */
export function fakeHasher(openUnitsOfWork: () => number): StorefrontPasswordHasher & {
  readonly verified: string[];
  readonly hashedWithOpenUnitsOfWork: number[];
} {
  const verified: string[] = [];
  const hashedWithOpenUnitsOfWork: number[] = [];
  return {
    verified,
    hashedWithOpenUnitsOfWork,
    hash: async (plain) => {
      hashedWithOpenUnitsOfWork.push(openUnitsOfWork());
      return `hash:${plain}`;
    },
    verify: async (plain, hash) => {
      verified.push(hash);
      return hash === `hash:${plain}`;
    },
  };
}

export function harness(
  options: {
    owned?: Readonly<Record<string, readonly string[]>>;
    hosts?: Readonly<Record<string, string>>;
    names?: Readonly<Record<string, string>>;
    hostLookupFails?: boolean;
  } = {},
) {
  let now = new Date("2026-10-27T10:00:00.000Z");
  let id = 0;
  const clock: Clock = { now: () => now };
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-7000-8000-${String((id += 1)).padStart(12, "0")}`,
  };
  const repos: OnlineStoreRepos = {
    preferences: new InMemoryPreferencesRepository(),
    access: new InMemoryAccessRepository(),
    themes: new InMemoryThemeRepository(),
    releases: new InMemoryThemeReleaseRepository(),
    previewTokens: new InMemoryPreviewTokenRepository(),
  };
  let openUnitsOfWork = 0;
  const memoryUnitOfWork = new InMemoryUnitOfWork();
  const unitOfWork: TransactionalUnitOfWork<unknown> = {
    run: async (work) => {
      openUnitsOfWork += 1;
      try {
        return await memoryUnitOfWork.run(work);
      } finally {
        openUnitsOfWork -= 1;
      }
    },
  };
  const hasher = fakeHasher(() => openUnitsOfWork);
  const recorded: { tenantId: string; type: string }[] = [];
  const shopHost: ShopHostPort = {
    primaryHostname: async (t) => {
      if (options.hostLookupFails === true) throw new Error("tenancy down");
      return options.hosts?.[t] ?? null;
    },
  };
  const storeIdentity: StoreIdentityPort = { storeName: async (t) => options.names?.[t] ?? "" };
  const controller = buildOnlineStoreController(
    repos,
    unitOfWork,
    {
      idGenerator,
      clock,
      imageRefs: fakeImageRefs(options.owned ?? {}),
      passwordHasher: hasher,
      shopHost,
      storeIdentity,
    },
    {
      record: async (events: readonly DomainEvent[], tenantId: string) => {
        for (const event of events)
          recorded.push({ tenantId, type: (event as { eventName: string }).eventName });
      },
    },
  );
  return {
    controller,
    repos,
    hasher,
    recorded,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}
