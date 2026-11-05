import { describe, it } from "vitest";
import type { TransactionClient } from "@platform/db";
import { createFakePrisma } from "@platform/db/testing";
import { tenantRowIsolationCases, type TenantRowStore } from "@platform/messaging/testing";
import { DEFAULT_THEME_DOCUMENT, POLICY_TYPES } from "@platform/storefront-content";
import { Menu } from "../domain/menu";
import type {
  AccessRepository,
  MenuRepository,
  PolicyRepository,
  PreferencesRepository,
  PreviewTokenRepository,
  ThemeReleaseRepository,
  ThemeRepository,
} from "../domain/repositories";
import {
  InMemoryAccessRepository,
  InMemoryMenuRepository,
  InMemoryPolicyRepository,
  InMemoryPreferencesRepository,
  InMemoryPreviewTokenRepository,
  InMemoryThemeReleaseRepository,
  InMemoryThemeRepository,
} from "./in-memory-repositories";
import {
  PrismaAccessRepository,
  PrismaMenuRepository,
  PrismaPolicyRepository,
  PrismaPreferencesRepository,
  PrismaPreviewTokenRepository,
  PrismaThemeReleaseRepository,
  PrismaThemeRepository,
} from "./prisma-repositories";

const now = new Date("2026-10-27T10:00:00.000Z");
const later = new Date("2026-10-27T11:00:00.000Z");

type Layer = { name: string; make: () => { tx: unknown; repos: Repos } };
interface Repos {
  preferences: PreferencesRepository;
  access: AccessRepository;
  themes: ThemeRepository;
  releases: ThemeReleaseRepository;
  tokens: PreviewTokenRepository;
  menus: MenuRepository;
  policies: PolicyRepository;
}

const layers: Layer[] = [
  {
    name: "in-memory",
    make: () => ({
      tx: undefined,
      repos: {
        preferences: new InMemoryPreferencesRepository(),
        access: new InMemoryAccessRepository(),
        themes: new InMemoryThemeRepository(),
        releases: new InMemoryThemeReleaseRepository(),
        tokens: new InMemoryPreviewTokenRepository(),
        menus: new InMemoryMenuRepository(),
        policies: new InMemoryPolicyRepository(),
      },
    }),
  },
  {
    name: "prisma (fake client)",
    make: () => {
      const fake = createFakePrisma();
      const deps = { prisma: fake.database };
      return {
        tx: fake.database as unknown as TransactionClient,
        repos: {
          preferences: new PrismaPreferencesRepository(deps),
          access: new PrismaAccessRepository(deps),
          themes: new PrismaThemeRepository(deps),
          releases: new PrismaThemeReleaseRepository(deps),
          tokens: new PrismaPreviewTokenRepository(deps),
          menus: new PrismaMenuRepository(deps),
          policies: new PrismaPolicyRepository(deps),
        },
      };
    },
  },
];

/** One row per shop: the "key" is the shop's row, the marker lives in a text field. */
function preferencesStore({ tx, repos }: ReturnType<Layer["make"]>): TenantRowStore {
  const find = async (tenantId: string) => {
    const s = (await repos.preferences.get(tenantId)).snapshot();
    return s.persisted ? (s.homeTitle.en ?? null) : null;
  };
  const write = async (tenantId: string, marker: string) => {
    const p = await repos.preferences.get(tenantId, tx);
    p.update(
      {
        homeTitle: { en: marker },
        homeMetaDescription: {},
        shareImageRef: null,
        defaultLocale: "ar",
      },
      now,
    );
    await repos.preferences.save(p, tenantId, tx);
  };
  return {
    insert: (t, _k, m) => write(t, m),
    find: (t) => find(t),
    list: async (t) => {
      const m = await find(t);
      return m === null ? [] : [m];
    },
    update: (t, _k, m) => write(t, m),
  };
}

function accessStore({ tx, repos }: ReturnType<Layer["make"]>): TenantRowStore {
  const find = async (tenantId: string) => {
    const s = (await repos.access.get(tenantId)).snapshot();
    return s.persisted ? s.passwordHash : null;
  };
  const write = async (tenantId: string, marker: string) => {
    const a = await repos.access.get(tenantId, tx);
    a.apply({ locked: false, newPasswordHash: marker, message: {}, now });
    await repos.access.save(a, tenantId, tx);
  };
  return {
    insert: (t, _k, m) => write(t, m),
    find: (t) => find(t),
    list: async (t) => {
      const m = await find(t);
      return m === null ? [] : [m];
    },
    update: (t, _k, m) => write(t, m),
  };
}

function themeStore({ tx, repos }: ReturnType<Layer["make"]>): TenantRowStore {
  const find = async (tenantId: string) => {
    const s = (await repos.themes.get(tenantId)).snapshot();
    return s.persisted ? (s.draft.footer.note.en ?? null) : null;
  };
  const write = async (tenantId: string, marker: string) => {
    const theme = await repos.themes.get(tenantId, tx);
    theme.saveDraft(
      {
        ...DEFAULT_THEME_DOCUMENT,
        footer: { ...DEFAULT_THEME_DOCUMENT.footer, note: { en: marker } },
      },
      now,
    );
    await repos.themes.save(theme, tenantId, tx);
  };
  return {
    insert: (t, _k, m) => write(t, m),
    find: (t) => find(t),
    list: async (t) => {
      const m = await find(t);
      return m === null ? [] : [m];
    },
    update: (t, _k, m) => write(t, m),
  };
}

/** The same key always maps to the same release number, under every shop (identical keys on purpose). */
function releaseStore({ tx, repos }: ReturnType<Layer["make"]>): TenantRowStore {
  const numbers = new Map<string, number>();
  const numberOf = (key: string): number => {
    const known = numbers.get(key);
    if (known !== undefined) return known;
    numbers.set(key, numbers.size + 1);
    return numbers.size;
  };
  return {
    insert: (t, k, m) =>
      repos.releases.append(
        {
          id: `${t}-${k}`,
          releaseNumber: numberOf(k),
          document: DEFAULT_THEME_DOCUMENT,
          publishedAt: now,
          publishedBy: m,
        },
        t,
        tx,
      ),
    find: async (t, k) => (await repos.releases.get(numberOf(k), t))?.publishedBy ?? null,
    list: async (t) => (await repos.releases.list(t, 20)).map((r) => r.publishedBy),
    update: async () => undefined, // releases are append-only
    remove: async (t) => void (await repos.releases.pruneBeyond(0, t, tx)),
  };
}

/** Tokens have no list read; `list` probes every key ever inserted, through the tenant-scoped lookup. */
function tokenStore({ tx, repos }: ReturnType<Layer["make"]>): TenantRowStore {
  const keys = new Set<string>();
  const find = async (t: string, k: string) =>
    (await repos.tokens.findActive(k, t, now))?.createdBy ?? null;
  return {
    insert: async (t, k, m) => {
      keys.add(k);
      await repos.tokens.insert(
        { id: `${t}-${k}`, tokenHash: k, expiresAt: later, createdBy: m, createdAt: now },
        t,
        tx,
      );
    },
    find,
    list: async (t) =>
      (await Promise.all([...keys].map((k) => find(t, k)))).filter((m): m is string => m !== null),
    update: async () => undefined, // tokens are immutable
    remove: async (t) =>
      void (await repos.tokens.deleteExpired(t, new Date(later.getTime() + 1), tx)),
  };
}

/** The same key always maps to the same handle, under every shop (identical keys on purpose). */
function menuStore({ tx, repos }: ReturnType<Layer["make"]>): TenantRowStore {
  const handles = new Map<string, string>();
  const handleOf = (key: string): string => {
    const known = handles.get(key);
    if (known !== undefined) return known;
    const handle = `m-${handles.size + 1}`;
    handles.set(key, handle);
    return handle;
  };
  const ids = new Map<string, string>();
  const idOf = (tenantId: string, key: string): string => {
    const id = `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, "0")}`;
    return ids.get(`${tenantId}|${key}`) ?? (ids.set(`${tenantId}|${key}`, id), id);
  };
  return {
    insert: (t, k, m) =>
      repos.menus.save(
        Menu.create({ id: idOf(t, k), handle: handleOf(k), title: m, items: [], now }),
        t,
        tx,
      ),
    find: async (t, k) => (await repos.menus.get(handleOf(k), t))?.snapshot().title ?? null,
    list: async (t) => (await repos.menus.list(t)).map((menu) => menu.snapshot().title),
    update: async (t, k, m) => {
      const menu = await repos.menus.get(handleOf(k), t);
      if (menu === null) return;
      menu.update(m, [], later);
      await repos.menus.save(menu, t, tx);
    },
    remove: async (t, k) => void (await repos.menus.remove(handleOf(k), t, tx)),
  };
}

/** The same key always maps to the same policy type (the next unused one), under every shop. */
function policyStore({ tx, repos }: ReturnType<Layer["make"]>): TenantRowStore {
  const types = new Map<string, (typeof POLICY_TYPES)[number]>();
  const typeOf = (key: string): (typeof POLICY_TYPES)[number] => {
    const known = types.get(key);
    if (known !== undefined) return known;
    const type = POLICY_TYPES[types.size % POLICY_TYPES.length] ?? "refund";
    types.set(key, type);
    return type;
  };
  const find = async (t: string, k: string) => {
    const s = (await repos.policies.get(typeOf(k), t)).snapshot();
    return s.persisted ? (s.body.en ?? null) : null;
  };
  const write = async (t: string, k: string, m: string) => {
    const policy = await repos.policies.get(typeOf(k), t, tx);
    policy.update({ en: m }, "staff", now);
    await repos.policies.save(policy, t, tx);
  };
  return {
    insert: write,
    find,
    list: async (t) =>
      (await repos.policies.list(t))
        .map((p) => p.snapshot())
        .filter((s) => s.persisted)
        .map((s) => s.body.en ?? ""),
    update: write,
  };
}

/**
 * Single-row-per-shop tables cannot hold three rows for one shop, so the shared "cannot count"
 * case (three inserts under A) does not apply to them; the other cases do, unchanged.
 */
const SINGLE_ROW = new Set(["preferences", "access", "theme"]);

for (const layer of layers) {
  describe(`online-store tenant isolation — ${layer.name} (ADR-0014)`, () => {
    for (const [name, build] of [
      ["preferences", preferencesStore],
      ["access", accessStore],
      ["theme", themeStore],
      ["theme releases", releaseStore],
      ["preview tokens", tokenStore],
      ["menus", menuStore],
      ["policies", policyStore],
    ] as const) {
      const cases = tenantRowIsolationCases({
        context: `online-store/${name}`,
        layer: layer.name,
        make: () => build(layer.make()),
      }).filter((c) => !(SINGLE_ROW.has(name) && c.name.includes("cannot count")));
      for (const c of cases) {
        it(c.name, c.run);
      }
    }
  });
}
