import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Redirect } from "../domain/redirect";
import type { RobotsPolicy } from "../domain/robots-policy";
import type {
  RedirectRepository,
  RobotsPolicyRepository,
  SeoProfileRepository,
  SitemapRepository,
} from "../domain/repositories";
import type { SeoProfile } from "../domain/seo-profile";
import type { Sitemap } from "../domain/sitemap";

/** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
function paginate<T extends { readonly id: { toString(): string } }>(
  rows: readonly T[],
  page: CursorPage,
): Paginated<T> {
  const sorted = [...rows].sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
  const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
  const start = after === undefined ? 0 : sorted.findIndex((x) => x.id.toString() > after);
  const limit = normalizePageSize(page.first);
  const window = start < 0 ? [] : sorted.slice(start, start + limit + 1);
  return buildPaginatedPage(window, limit, (x) => x.id.toString());
}

export interface InMemorySeoRepositoriesDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * ADR-0014 (WP-10, T10.3): every repository below keys its store by `(tenantId, id)` — none of
 * `SeoProfile`/`Redirect`/`Sitemap`/`RobotsPolicy` carries `tenantId` of its own, so the store
 * must key on it explicitly or a cross-tenant leak here would be invisible to every isolation test.
 */
export class InMemorySeoProfileRepository implements SeoProfileRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly profile: SeoProfile }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemorySeoRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(profile: SeoProfile, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(profile.id.toString(), { tenantId, profile });
    await this.outbox.write(profile.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<SeoProfile | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.profile : null;
  }

  async findByPageRef(pageRef: string, tenantId: string): Promise<SeoProfile | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.profile.pageRef === pageRef) return entry.profile;
    }
    return null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<SeoProfile>> {
    return paginate(
      [...this.store.values()].filter((e) => e.tenantId === tenantId).map((e) => e.profile),
      page,
    );
  }
}

export class InMemoryRedirectRepository implements RedirectRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly redirect: Redirect }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemorySeoRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(redirect: Redirect, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(redirect.id.toString(), { tenantId, redirect });
    await this.outbox.write(redirect.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Redirect | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.redirect : null;
  }

  async findByFromPath(fromPath: string, tenantId: string): Promise<Redirect | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.redirect.fromPath === fromPath) {
        return entry.redirect;
      }
    }
    return null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Redirect>> {
    return paginate(
      [...this.store.values()].filter((e) => e.tenantId === tenantId).map((e) => e.redirect),
      page,
    );
  }
}

export class InMemorySitemapRepository implements SitemapRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly sitemap: Sitemap }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemorySeoRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(sitemap: Sitemap, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(sitemap.id.toString(), { tenantId, sitemap });
    await this.outbox.write(sitemap.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Sitemap | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.sitemap : null;
  }

  async findByName(name: string, tenantId: string): Promise<Sitemap | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.sitemap.name === name) return entry.sitemap;
    }
    return null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Sitemap>> {
    return paginate(
      [...this.store.values()].filter((e) => e.tenantId === tenantId).map((e) => e.sitemap),
      page,
    );
  }
}

export class InMemoryRobotsPolicyRepository implements RobotsPolicyRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly policy: RobotsPolicy }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemorySeoRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(policy: RobotsPolicy, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(policy.id.toString(), { tenantId, policy });
    await this.outbox.write(policy.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<RobotsPolicy | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.policy : null;
  }

  async findByUserAgent(userAgent: string, tenantId: string): Promise<RobotsPolicy | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.policy.userAgent === userAgent) return entry.policy;
    }
    return null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<RobotsPolicy>> {
    return paginate(
      [...this.store.values()].filter((e) => e.tenantId === tenantId).map((e) => e.policy),
      page,
    );
  }
}
