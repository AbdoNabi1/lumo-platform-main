import {
  isPolicyType,
  POLICY_TITLES,
  type LinkRef,
  type Locale,
} from "@platform/storefront-content";
import type { Dictionary } from "@/messages/en";

/**
 * The menu screens' copy for API and validator codes, and the names of link targets. Client-safe
 * (no `lib/api` value import), shared by the server actions' error mapping and the editor's own
 * checks, so a code reads the same whether the browser or the server found it.
 */

/** Item, handle and title codes from `validateMenuItems` and the menu use cases. */
export function menuCodeCopy(t: Dictionary): Readonly<Record<string, string>> {
  const n = t.onlineStoreNavigation;
  return {
    LABEL_REQUIRED: n.labelRequired,
    MENU_TOO_DEEP: n.tooDeep,
    TOO_MANY_ITEMS: n.tooMany,
    DUPLICATE_ITEM_ID: n.duplicateItem,
    INVALID_LINK: n.invalidLink,
    MENU_TOO_LARGE: n.tooLarge,
    INVALID_HANDLE: n.handleError,
    TITLE_REQUIRED: n.titleRequired,
    TOO_LONG: t.onlineStorePreferences.tooLong,
  };
}

/** A menu item's web address (`items.0.link.url`, `items.0.children.1.link.url`). */
export function isMenuUrlField(field: string): boolean {
  return /^items\.\d+(\.children\.\d+)?\.link\.url$/.test(field);
}

/** One issue as copy: a menu web address has its own wording for INVALID_URL. */
export function menuIssueCopy(t: Dictionary, code: string, field: string): string {
  if (code === "INVALID_URL" && isMenuUrlField(field)) return t.onlineStoreNavigation.urlError;
  return menuCodeCopy(t)[code] ?? t.formErrors.invalid;
}

/**
 * What a link points at, in the admin's language (F25). Never the API's raw `targetTitle` for a
 * policy (it is the type, `terms`) nor for home and search (null): those are named here.
 */
export function linkTargetText(
  t: Dictionary,
  locale: Locale,
  link: LinkRef,
  targetTitle: string | null | undefined,
): string {
  const kinds = t.onlineStoreNavigation.kinds;
  switch (link.type) {
    case "home":
    case "search":
      return kinds[link.type];
    case "policy":
      return isPolicyType(link.policy) ? POLICY_TITLES[link.policy][locale] : kinds.policy;
    case "url":
      return link.url;
    default:
      return targetTitle !== null && targetTitle !== undefined && targetTitle !== ""
        ? targetTitle
        : kinds[link.type];
  }
}

/** A default menu never saved has no title of its own yet: it is named in the admin's language. */
export function menuDisplayTitle(
  t: Dictionary,
  menu: { readonly id: string | null; readonly handle: string; readonly title: string },
): string {
  if (menu.id === null && menu.handle === "main-menu") return t.onlineStoreNavigation.defaultMain;
  if (menu.id === null && menu.handle === "footer") return t.onlineStoreNavigation.defaultFooter;
  return menu.title;
}
