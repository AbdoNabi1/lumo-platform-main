import type {
  CatalogLinkType,
  LinkTarget,
  LinkTargetChoice,
  LinkTargetMap,
  LinkTargetsPort,
} from "@platform/online-store";
import { pageHandleOfPath, pickText, type LocalizedText } from "@platform/storefront-content";

type Response = { readonly status: number; readonly body: unknown };

/** Catalog's and Pages' controller reads, as closures taking the tenant per call (ADR-0014). */
export interface LinkTargetReads {
  readonly products: (ids: readonly string[], tenantId: string) => Promise<Response>;
  readonly collections: (ids: readonly string[], tenantId: string) => Promise<Response>;
  readonly pages: (ids: readonly string[], tenantId: string) => Promise<Response>;
  readonly searchProducts: (query: string, tenantId: string) => Promise<Response>;
  readonly searchCollections: (query: string, tenantId: string) => Promise<Response>;
  readonly listPages: (tenantId: string) => Promise<Response>;
}

/** Ids per by-ids read: Catalog's and Pages' by-ids reads look up at most 100 (Ruling 7). */
export const LINK_TARGET_BATCH = 100;
/** Ids of one kind a resolve looks up at all: the shell's two menus hold at most 150 items each. */
export const LINK_TARGET_IDS_MAX = 300;
/** The link picker shows at most 20 choices (spec 2.2). */
const SEARCH_MAX = 20;

type Row = Readonly<Record<string, unknown>>;

interface Entry {
  readonly id: string;
  readonly target: LinkTarget;
}

interface PageEntry extends Entry {
  /** At `/pages/<handle>`: the only pages the storefront can link to. */
  readonly linkable: boolean;
  /** What the picker's query matches: the name, both titles and the route path. */
  readonly searchText: string;
}

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function textAt(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

/** A value object's string (`UniqueEntityId`, `Slug`, `RoutePath`, `PublishState`), or a string. */
function valueAt(row: Row, key: string): string | null {
  const value = row[key];
  if (typeof value === "string") return value;
  if (!isRow(value)) return null;
  const inner = (value as { value?: unknown }).value;
  return typeof inner === "string" ? inner : null;
}

const segment = (value: string): string => encodeURIComponent(value);

/** Ruling 11: a product is live when published or unlisted (reachable by its link). */
function productEntry(raw: unknown): Entry | null {
  if (!isRow(raw)) return null;
  const [id, name, slug, status] = [
    valueAt(raw, "id"),
    textAt(raw, "name"),
    valueAt(raw, "slug"),
    valueAt(raw, "status"),
  ];
  if (id === null || name === null || slug === null) return null;
  const published = status === "published" || status === "unlisted";
  return {
    id,
    target: { href: `/products/${segment(slug)}`, title: name, published },
  };
}

/** Ruling 11: a collection is live when published. */
function collectionEntry(raw: unknown): Entry | null {
  if (!isRow(raw)) return null;
  const [id, name, slug, status] = [
    valueAt(raw, "id"),
    textAt(raw, "name"),
    valueAt(raw, "slug"),
    valueAt(raw, "status"),
  ];
  if (id === null || name === null || slug === null) return null;
  return {
    id,
    target: {
      href: `/collections/${segment(slug)}`,
      title: name,
      published: status === "published",
    },
  };
}

function localizedAt(row: Row, key: string): LocalizedText {
  const value = row[key];
  if (!isRow(value)) return {};
  const ar = textAt(value, "ar");
  const en = textAt(value, "en");
  return { ...(ar === null ? {} : { ar }), ...(en === null ? {} : { en }) };
}

/**
 * Ruling 11: a page is live when published at `/pages/<handle>`. A page at any other route can
 * never be linked from the storefront, so it is never live (and the picker does not offer it).
 */
function pageEntry(raw: unknown): PageEntry | null {
  if (!isRow(raw)) return null;
  const [id, name, routePath, status] = [
    valueAt(raw, "id"),
    textAt(raw, "name"),
    valueAt(raw, "routePath"),
    valueAt(raw, "status"),
  ];
  if (id === null || name === null || routePath === null) return null;
  const handle = pageHandleOfPath(routePath);
  const title = localizedAt(raw, "title");
  return {
    id,
    linkable: handle !== null,
    target: {
      href: handle === null ? routePath : `/pages/${segment(handle)}`,
      title: pickText(title, "en") ?? name,
      published: handle !== null && status === "published",
    },
    searchText: [name, title.ar ?? "", title.en ?? "", routePath].join("\n"),
  };
}

function rowsOf(res: Response, what: string): readonly unknown[] {
  if (res.status !== 200) throw new Error(`link targets: the ${what} read failed (${res.status})`);
  const body = res.body;
  if (Array.isArray(body)) return body;
  if (isRow(body) && Array.isArray(body["items"])) return body["items"] as readonly unknown[];
  throw new Error(`link targets: the ${what} read answered an unexpected body`);
}

function chunks(ids: readonly string[]): string[][] {
  const distinct = [...new Set(ids)].slice(0, LINK_TARGET_IDS_MAX);
  const out: string[][] = [];
  for (let at = 0; at < distinct.length; at += LINK_TARGET_BATCH) {
    out.push(distinct.slice(at, at + LINK_TARGET_BATCH));
  }
  return out;
}

/** A null-prototype map: `map["constructor"]` is undefined, never Object's (preflight 12). */
function emptyMap(): Record<string, LinkTarget> {
  return Object.create(null) as Record<string, LinkTarget>;
}

const KINDS: readonly {
  readonly kind: CatalogLinkType;
  readonly read: keyof Pick<LinkTargetReads, "products" | "collections" | "pages">;
  readonly entry: (raw: unknown) => Entry | null;
}[] = [
  { kind: "product", read: "products", entry: productEntry },
  { kind: "collection", read: "collections", entry: collectionEntry },
  { kind: "page", read: "pages", entry: pageEntry },
];

/**
 * Online Store's menu link targets over Catalog and Pages. An object literal of closures only
 * (Ruling 13 of Part 1): no controller hangs off the port, so the tenant-mode guard has nothing
 * to walk into. A non-200 answer throws; the shell degrades, the admin reads surface it.
 */
export function onlineStoreLinkTargets(reads: LinkTargetReads): LinkTargetsPort {
  return {
    resolve: async (ids, tenantId) => {
      const map = { product: emptyMap(), collection: emptyMap(), page: emptyMap() };
      await Promise.all(
        KINDS.map(async ({ kind, read, entry }) => {
          // Only the kinds with ids are read; a large kind is split into bounded batches.
          const batches = chunks(ids[kind]);
          const answers = await Promise.all(batches.map((batch) => reads[read](batch, tenantId)));
          for (const res of answers) {
            for (const raw of rowsOf(res, read)) {
              const found = entry(raw);
              if (found !== null) map[kind][found.id] = found.target;
            }
          }
        }),
      );
      return map satisfies LinkTargetMap;
    },
    search: async (type, query, tenantId) => {
      let entries: Entry[];
      if (type === "page") {
        const needle = query.toLowerCase();
        entries = rowsOf(await reads.listPages(tenantId), "pages")
          .map(pageEntry)
          .filter((page): page is PageEntry => page !== null && page.linkable)
          .filter((page) => page.searchText.toLowerCase().includes(needle));
      } else {
        const [read, entry] =
          type === "product"
            ? [reads.searchProducts, productEntry]
            : [reads.searchCollections, collectionEntry];
        entries = rowsOf(await read(query, tenantId), `${type} search`)
          .map(entry)
          .filter((found): found is Entry => found !== null);
      }
      return entries.slice(0, SEARCH_MAX).map((found): LinkTargetChoice => ({
        id: found.id,
        title: found.target.title,
        subtitle: found.target.href,
      }));
    },
  };
}
