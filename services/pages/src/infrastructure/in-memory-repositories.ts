import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import { Page } from "../domain/page";
import { pageHandleOf } from "../domain/page-content";
import type { PageRepository, TemplateRepository } from "../domain/repositories";
import type { Template } from "../domain/template";

/**
 * Runs `fn` and settles the returned promise with its result or its thrown error, exactly as an
 * `async` method would, without an `async` function that has no `await` (`require-await`, see
 * `scripts/ops/check-lint-warnings.mjs`).
 */
const settle = <T>(fn: () => T): Promise<T> =>
  new Promise<T>((resolve) => {
    resolve(fn());
  });

/** A detached copy at `version`, so callers never mutate stored state before saving (like a row). */
function copyOf(page: Page, version: number): Page {
  return Page.reconstitute(
    page.id,
    page.name,
    page.routePath,
    page.status,
    version,
    {
      templateRef: page.templateRef,
      experienceRef: page.experienceRef,
      seoProfileRef: page.seoProfileRef,
      localeRef: page.localeRef,
    },
    {
      content: { title: page.title, body: page.body, metaDescription: page.metaDescription },
      publishedAt: page.publishedAt,
      updatedAt: page.updatedAt,
    },
  );
}

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

/** Orders by route path, code-unit wise, the way a database `ORDER BY` on ASCII paths does. */
function compareRoutePaths(a: Page, b: Page): number {
  const x = a.routePath.value;
  const y = b.routePath.value;
  return x < y ? -1 : x > y ? 1 : 0;
}

export interface InMemoryPagesRepositoriesDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `PageRepository`. ADR-0014 (WP-10, T10.5): keyed by `(tenantId, pageId)` — `Page`
 * carries no `tenantId` of its own, so the store must key on it explicitly or a cross-tenant leak
 * here would be invisible to every isolation test.
 */
export class InMemoryPageRepository implements PageRepository {
  private readonly store = new Map<string, { readonly tenantId: string; readonly page: Page }>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryPagesRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(page: Page, tenantId: string, tx?: unknown): Promise<void> {
    // Versions like Prisma (Ruling 18): a new page is stored at 1, a later save needs the stored
    // version and stores +1, and a stale version is a lost race.
    const key = page.id.toString();
    const stored = this.store.get(key);
    let next = 1;
    if (page.version !== 0) {
      if (
        stored === undefined ||
        stored.tenantId !== tenantId ||
        stored.page.version !== page.version
      ) {
        throw new ConcurrencyError(
          `Page ${key} was modified concurrently (expected version ${page.version})`,
        );
      }
      next = page.version + 1;
    }
    this.store.set(key, { tenantId, page: copyOf(page, next) });
    await this.outbox.write(page.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Page | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId
      ? copyOf(entry.page, entry.page.version)
      : null;
  }

  async findByRoutePath(routePath: string, tenantId: string): Promise<Page | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.page.routePath.value === routePath) {
        return copyOf(entry.page, entry.page.version);
      }
    }
    return null;
  }

  findByIds(ids: readonly string[], tenantId: string): Promise<readonly Page[]> {
    return settle(() => {
      const found: Page[] = [];
      for (const id of new Set(ids)) {
        const entry = this.store.get(id);
        if (entry !== undefined && entry.tenantId === tenantId) {
          found.push(copyOf(entry.page, entry.page.version));
        }
      }
      return found;
    });
  }

  listPublished(tenantId: string, limit: number): Promise<readonly Page[]> {
    return settle(() => {
      return [...this.store.values()]
        .filter(
          (entry) =>
            entry.tenantId === tenantId &&
            entry.page.status === "published" &&
            pageHandleOf(entry.page.routePath.value) !== null,
        )
        .map((entry) => copyOf(entry.page, entry.page.version))
        .sort((a, b) => compareRoutePaths(a, b))
        .slice(0, limit);
    });
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Page>> {
    const rows = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => copyOf(entry.page, entry.page.version));
    return paginate(rows, page);
  }
}

/**
 * In-memory `TemplateRepository`. ADR-0014 (WP-10, T10.5): keyed by `(tenantId, templateId)` for
 * the same reason as {@link InMemoryPageRepository}.
 */
export class InMemoryTemplateRepository implements TemplateRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly template: Template }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryPagesRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(template: Template, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(template.id.toString(), { tenantId, template });
    await this.outbox.write(template.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Template | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.template : null;
  }

  async findByName(name: string, tenantId: string): Promise<Template | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.template.name === name) return entry.template;
    }
    return null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Template>> {
    const rows = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.template);
    return paginate(rows, page);
  }
}
