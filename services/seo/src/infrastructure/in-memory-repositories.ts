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

export class InMemorySeoProfileRepository implements SeoProfileRepository {
  private readonly store = new Map<string, SeoProfile>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemorySeoRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(profile: SeoProfile, tx?: unknown): Promise<void> {
    this.store.set(profile.id.toString(), profile);
    await this.outbox.write(profile.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<SeoProfile | null> {
    return this.store.get(id) ?? null;
  }

  async findByPageRef(pageRef: string, _tenantId: string): Promise<SeoProfile | null> {
    for (const profile of this.store.values()) {
      if (profile.pageRef === pageRef) return profile;
    }
    return null;
  }

  async list(page: CursorPage, _tenantId: string): Promise<Paginated<SeoProfile>> {
    return paginate([...this.store.values()], page);
  }
}

export class InMemoryRedirectRepository implements RedirectRepository {
  private readonly store = new Map<string, Redirect>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemorySeoRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(redirect: Redirect, tx?: unknown): Promise<void> {
    this.store.set(redirect.id.toString(), redirect);
    await this.outbox.write(redirect.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<Redirect | null> {
    return this.store.get(id) ?? null;
  }

  async findByFromPath(fromPath: string, _tenantId: string): Promise<Redirect | null> {
    for (const redirect of this.store.values()) {
      if (redirect.fromPath === fromPath) return redirect;
    }
    return null;
  }

  async list(page: CursorPage, _tenantId: string): Promise<Paginated<Redirect>> {
    return paginate([...this.store.values()], page);
  }
}

export class InMemorySitemapRepository implements SitemapRepository {
  private readonly store = new Map<string, Sitemap>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemorySeoRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(sitemap: Sitemap, tx?: unknown): Promise<void> {
    this.store.set(sitemap.id.toString(), sitemap);
    await this.outbox.write(sitemap.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<Sitemap | null> {
    return this.store.get(id) ?? null;
  }

  async findByName(name: string, _tenantId: string): Promise<Sitemap | null> {
    for (const sitemap of this.store.values()) {
      if (sitemap.name === name) return sitemap;
    }
    return null;
  }

  async list(page: CursorPage, _tenantId: string): Promise<Paginated<Sitemap>> {
    return paginate([...this.store.values()], page);
  }
}

export class InMemoryRobotsPolicyRepository implements RobotsPolicyRepository {
  private readonly store = new Map<string, RobotsPolicy>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemorySeoRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(policy: RobotsPolicy, tx?: unknown): Promise<void> {
    this.store.set(policy.id.toString(), policy);
    await this.outbox.write(policy.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<RobotsPolicy | null> {
    return this.store.get(id) ?? null;
  }

  async findByUserAgent(userAgent: string, _tenantId: string): Promise<RobotsPolicy | null> {
    for (const policy of this.store.values()) {
      if (policy.userAgent === userAgent) return policy;
    }
    return null;
  }

  async list(page: CursorPage, _tenantId: string): Promise<Paginated<RobotsPolicy>> {
    return paginate([...this.store.values()], page);
  }
}
