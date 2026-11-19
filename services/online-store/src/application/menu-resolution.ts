import {
  linkRefTargetsOf,
  policyPath,
  safeHref,
  type LinkRef,
  type LocalizedText,
  type MenuItem,
  type PolicyType,
  type PublicLink,
  type ResolvedMenuItem,
} from "@platform/storefront-content";
import type { OnlineStoreDeps } from "./deps";
import type { CatalogLinkType, LinkTarget, LinkTargetMap } from "./ports";

/** The admin's view of an item: the stored item, plus whether it is live now and what it names. */
export interface MenuItemView extends Omit<MenuItem, "children"> {
  readonly broken: boolean;
  readonly targetTitle: string | null;
  readonly children: readonly MenuItemView[];
}

/** No targets at all: every catalogue and page link is missing (the shell's degraded answer). */
export function emptyTargets(): LinkTargetMap {
  return {
    collection: Object.create(null) as Record<string, LinkTarget>,
    product: Object.create(null) as Record<string, LinkTarget>,
    page: Object.create(null) as Record<string, LinkTarget>,
  };
}

/**
 * One batched `resolve` for every catalogue and page id the items name (both levels, distinct).
 * No call at all when they name none. A failure is the caller's to handle: the admin reads let it
 * surface, the shell degrades (Ruling 26).
 */
export async function loadTargets(
  deps: Pick<OnlineStoreDeps, "linkTargets">,
  items: readonly MenuItem[],
  tenantId: string,
): Promise<LinkTargetMap> {
  const ids = linkRefTargetsOf(items);
  if (ids.collection.length + ids.product.length + ids.page.length === 0) return emptyTargets();
  return deps.linkTargets.resolve(ids, tenantId);
}

/** An OWN entry only: a link id may be `__proto__` or `constructor` (preflight 12). */
export function targetOf(
  targets: LinkTargetMap,
  kind: CatalogLinkType,
  id: string,
): LinkTarget | null {
  const byId = targets[kind];
  return Object.hasOwn(byId, id) ? (byId[id] ?? null) : null;
}

interface ResolvedLink {
  /** A canonical safe href, or null when the link has nowhere safe to go. */
  readonly href: string | null;
  readonly external: boolean;
  readonly title: string | null;
  /** Shown on the storefront now (Ruling 11). */
  readonly live: boolean;
}

type RawLink = Omit<ResolvedLink, "external">;

function rawLink(
  link: LinkRef,
  targets: LinkTargetMap,
  setPolicies: ReadonlySet<PolicyType>,
): RawLink {
  switch (link.type) {
    case "home":
      return { href: "/", title: null, live: true };
    case "search":
      return { href: "/search", title: null, live: true };
    case "url":
      return { href: link.url, title: link.url, live: true };
    case "policy":
      return {
        href: policyPath(link.policy),
        title: link.policy,
        live: setPolicies.has(link.policy),
      };
    default: {
      const target = targetOf(targets, link.type, link.id);
      return target === null
        ? { href: null, title: null, live: false }
        : { href: target.href, title: target.title, live: target.published };
    }
  }
}

function resolveLink(
  link: LinkRef,
  targets: LinkTargetMap,
  setPolicies: ReadonlySet<PolicyType>,
): ResolvedLink {
  const raw = rawLink(link, targets, setPolicies);
  // Task 1's canonical safe href: whatever a target map holds, only a safe link is ever served.
  const safe = raw.href === null ? null : safeHref(raw.href);
  return {
    href: safe?.href ?? null,
    external: safe?.external ?? false,
    title: raw.title,
    live: raw.live && safe !== null,
  };
}

/**
 * The storefront's form of one link (Part 3 sections): the live, canonical safe `{ href, external }`,
 * else null. The menus' own resolution, narrowed: one link rule for menus and sections alike.
 */
export function resolveLinkRef(
  link: LinkRef,
  targets: LinkTargetMap,
  setPolicies: ReadonlySet<PolicyType>,
): PublicLink | null {
  const resolved = resolveLink(link, targets, setPolicies);
  return resolved.live && resolved.href !== null
    ? { href: resolved.href, external: resolved.external }
    : null;
}

/** The label's two locales, copied field by field; null when neither has text. */
function labelOf(label: LocalizedText): LocalizedText | null {
  const ar = label.ar !== undefined && label.ar.length > 0 ? label.ar : undefined;
  const en = label.en !== undefined && label.en.length > 0 ? label.en : undefined;
  if (ar === undefined && en === undefined) return null;
  return { ...(ar === undefined ? {} : { ar }), ...(en === undefined ? {} : { en }) };
}

function resolveLevel(
  items: readonly MenuItem[],
  targets: LinkTargetMap,
  setPolicies: ReadonlySet<PolicyType>,
  depth: 1 | 2,
): ResolvedMenuItem[] {
  const out: ResolvedMenuItem[] = [];
  for (const item of items) {
    const link = resolveLink(item.link, targets, setPolicies);
    const label = labelOf(item.label);
    if (!link.live || link.href === null || label === null) continue; // its children go with it
    out.push({
      label,
      href: link.href,
      external: link.external,
      children: depth === 1 ? resolveLevel(item.children, targets, setPolicies, 2) : [],
    });
  }
  return out;
}

/**
 * The storefront's menu: live items only, display fields and safe hrefs only (no ids). A broken
 * or unpublished item is dropped together with its children; grandchildren are never served.
 */
export function resolveItems(
  items: readonly MenuItem[],
  targets: LinkTargetMap,
  setPolicies: ReadonlySet<PolicyType>,
): ResolvedMenuItem[] {
  return resolveLevel(items, targets, setPolicies, 1);
}

/** The admin's menu: every stored item, each flagged `broken` when the storefront would drop it. */
export function itemViews(
  items: readonly MenuItem[],
  targets: LinkTargetMap,
  setPolicies: ReadonlySet<PolicyType>,
): MenuItemView[] {
  return items.map((item) => {
    const link = resolveLink(item.link, targets, setPolicies);
    return {
      id: item.id,
      label: item.label,
      link: item.link,
      broken: !link.live,
      targetTitle: link.title,
      children: itemViews(item.children, targets, setPolicies),
    };
  });
}
