import type { Clock, IdGenerator } from "@platform/contracts";
import type {
  CatalogLinkType,
  ImageDto,
  ImageRefsPort,
  LinkTarget,
  LinkTargetChoice,
  LinkTargetsPort,
  ShopHostPort,
  StoreIdentityPort,
  StorefrontPasswordHasher,
} from "../application/ports";
import type { DomainEvent } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { buildOnlineStoreController, type OnlineStoreRepos } from "../composition";
import {
  InMemoryAccessRepository,
  InMemoryMenuRepository,
  InMemoryPolicyRepository,
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
    existingIds: (ids, tenantId) =>
      Promise.resolve(ids.filter((id) => (owned[tenantId] ?? []).includes(id))),
    resolve: (ids, tenantId) =>
      Promise.resolve(
        Object.fromEntries(
          ids.filter((id) => (owned[tenantId] ?? []).includes(id)).map((id) => [id, image(id)]),
        ),
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
    hash: (plain) => {
      hashedWithOpenUnitsOfWork.push(openUnitsOfWork());
      return Promise.resolve(`hash:${plain}`);
    },
    verify: (plain, hash) => {
      verified.push(hash);
      return Promise.resolve(hash === `hash:${plain}`);
    },
  };
}

export type ShopTargets = Readonly<
  Record<string, Partial<Record<CatalogLinkType, Readonly<Record<string, LinkTarget>>>>>
>;

const CATALOG_LINK_TYPES: readonly CatalogLinkType[] = ["collection", "product", "page"];

/**
 * Catalogue and pages fake: each shop's targets by kind and id. `resolve` copies OWN entries only
 * into plain objects (so refusing an inherited key such as `constructor` is the resolver's job)
 * and records how many ids each call asked for; `search` matches titles case-insensitively.
 */
export function fakeLinkTargets(
  options: { readonly targets?: ShopTargets; readonly linkTargetsFail?: boolean },
  resolveCalls: number[],
): LinkTargetsPort {
  return {
    resolve: (ids, tenantId) => {
      resolveCalls.push(CATALOG_LINK_TYPES.reduce((sum, kind) => sum + ids[kind].length, 0));
      if (options.linkTargetsFail === true) return Promise.reject(new Error("catalogue down"));
      const shop = options.targets?.[tenantId] ?? {};
      const pick = (kind: CatalogLinkType): Record<string, LinkTarget> => {
        const source = shop[kind] ?? {};
        const out: Record<string, LinkTarget> = {};
        for (const id of ids[kind]) {
          const target = Object.hasOwn(source, id) ? source[id] : undefined;
          if (target !== undefined) out[id] = target;
        }
        return out;
      };
      return Promise.resolve({
        collection: pick("collection"),
        product: pick("product"),
        page: pick("page"),
      });
    },
    search: (type, query, tenantId) => {
      if (options.linkTargetsFail === true) return Promise.reject(new Error("catalogue down"));
      const needle = query.toLowerCase();
      const source = options.targets?.[tenantId]?.[type] ?? {};
      return Promise.resolve(
        Object.entries(source)
          .filter(([, target]) => target.title.toLowerCase().includes(needle))
          .map(([id, target]): LinkTargetChoice => ({
            id,
            title: target.title,
            subtitle: target.href,
          })),
      );
    },
  };
}

/** The `...Fails` options are read on every call, so a test can restore a port by flipping them. */
export function harness(
  options: {
    owned?: Readonly<Record<string, readonly string[]>>;
    hosts?: Readonly<Record<string, string>>;
    names?: Readonly<Record<string, string>>;
    hostLookupFails?: boolean;
    storeNameFails?: boolean;
    imageResolveFails?: boolean;
    targets?: ShopTargets;
    linkTargetsFail?: boolean;
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
    policies: new InMemoryPolicyRepository(),
    menus: new InMemoryMenuRepository(),
  };
  const resolveCalls: number[] = [];
  const linkTargets = fakeLinkTargets(options, resolveCalls);
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
    primaryHostname: (t) =>
      options.hostLookupFails === true
        ? Promise.reject(new Error("tenancy down"))
        : Promise.resolve(options.hosts?.[t] ?? null),
  };
  const storeIdentity: StoreIdentityPort = {
    storeName: (t) =>
      options.storeNameFails === true
        ? Promise.reject(new Error("tenancy down"))
        : Promise.resolve(options.names?.[t] ?? ""),
  };
  const ownedImages = fakeImageRefs(options.owned ?? {});
  const imageRefs: ImageRefsPort = {
    existingIds: (ids, tenantId) => ownedImages.existingIds(ids, tenantId),
    resolve: (ids, tenantId) =>
      options.imageResolveFails === true
        ? Promise.reject(new Error("media down"))
        : ownedImages.resolve(ids, tenantId),
  };
  const controller = buildOnlineStoreController(
    repos,
    unitOfWork,
    {
      idGenerator,
      clock,
      imageRefs,
      passwordHasher: hasher,
      shopHost,
      storeIdentity,
      linkTargets,
    },
    {
      record: (events: readonly DomainEvent[], tenantId: string) => {
        for (const event of events)
          recorded.push({ tenantId, type: (event as { eventName: string }).eventName });
        return Promise.resolve();
      },
    },
  );
  return {
    controller,
    repos,
    hasher,
    recorded,
    resolveCalls,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}
