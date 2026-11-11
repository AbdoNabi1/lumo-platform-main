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
import { documentOf } from "../infrastructure/rows";
import { StorefrontTheme } from "../domain/storefront-theme";

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
  // `writes()` counts the use cases' theme saves; `seedThemeRow` writes past the counter.
  const themes = new InMemoryThemeRepository();
  const storeTheme = themes.save.bind(themes);
  let themeWrites = 0;
  themes.save = (theme, tenantId) => {
    themeWrites += 1;
    return storeTheme(theme, tenantId);
  };
  const repos: OnlineStoreRepos = {
    preferences: new InMemoryPreferencesRepository(),
    access: new InMemoryAccessRepository(),
    themes,
    releases: new InMemoryThemeReleaseRepository(),
    previewTokens: new InMemoryPreviewTokenRepository(),
    policies: new InMemoryPolicyRepository(),
    menus: new InMemoryMenuRepository(),
  };
  const resolveCalls: number[] = [];
  // Copied per shop on write, so `deleteTarget` never edits the caller's object; the `...Fails`
  // flag stays a getter, read per call like the others.
  const targets: Record<string, ShopTargets[string]> = { ...options.targets };
  const linkTargets = fakeLinkTargets(
    {
      targets,
      get linkTargetsFail() {
        return options.linkTargetsFail;
      },
    },
    resolveCalls,
  );
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
    /** Saves `t-1`'s theme draft through the controller. */
    save: (document: unknown, expectedVersion: number) =>
      controller.saveThemeDraft({ tenantId: HARNESS_TENANT, document, expectedVersion }),
    /** How many times a use case wrote the theme row (`seedThemeRow` is not counted). */
    writes: () => themeWrites,
    /** Removes one of `t-1`'s link targets, as if the merchant deleted it after linking it. */
    deleteTarget: (kind: CatalogLinkType, targetId: string) => {
      const shop = targets[HARNESS_TENANT] ?? {};
      const remaining = Object.fromEntries(
        Object.entries(shop[kind] ?? {}).filter(([key]) => key !== targetId),
      );
      targets[HARNESS_TENANT] = { ...shop, [kind]: remaining };
    },
    /**
     * Stores `t-1`'s theme row as Prisma reads it back: each document through `documentOf` (the
     * v1 → v2 upgrade), at `version`. A non-null `published` is release 1 of draft revision 1.
     */
    seedThemeRow: async (row: {
      readonly draft: unknown;
      readonly published: unknown;
      readonly version: number;
    }) => {
      const at = new Date("2026-10-01T10:00:00.000Z");
      const published = row.published === null ? null : documentOf(row.published);
      const stored = {
        draft: documentOf(row.draft),
        draftRevision: 1,
        draftSavedAt: at,
        published,
        publishedDraftRevision: published === null ? null : 1,
        releaseNumber: published === null ? 0 : 1,
        publishedAt: published === null ? null : at,
        publishedBy: published === null ? null : "admin-1",
      };
      // The in-memory row is inserted at version 1 and bumped once per guarded update.
      await storeTheme(
        StorefrontTheme.reconstitute({ ...stored, version: 0, persisted: false }),
        HARNESS_TENANT,
      );
      for (let version = 1; version < row.version; version += 1) {
        await storeTheme(
          StorefrontTheme.reconstitute({ ...stored, version, persisted: true }),
          HARNESS_TENANT,
        );
      }
    },
  };
}

/** The shop the harness helpers (`save`, `deleteTarget`, `seedThemeRow`) act for. */
export const HARNESS_TENANT = "t-1";
