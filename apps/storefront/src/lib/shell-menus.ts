import {
  pickText,
  POLICY_TITLES,
  policyPath,
  type Locale,
  type PolicyType,
  type ResolvedMenuItem,
} from "@platform/storefront-content";

/** A menu item ready to render: its label in the request locale (or the other one). */
export interface MenuEntry {
  readonly label: string;
  readonly href: string;
  readonly external: boolean;
  readonly children: readonly MenuEntry[];
}

/** Spec 2.8: labels through `pickText`; an item with no label in either locale is skipped. */
export function menuEntries(menu: readonly ResolvedMenuItem[], locale: Locale): MenuEntry[] {
  return menu.flatMap((item) => {
    const label = pickText(item.label, locale);
    if (label === null) return [];
    return [
      {
        label,
        href: item.href,
        external: item.external,
        children: menuEntries(item.children, locale),
      },
    ];
  });
}

/**
 * Spec 2.8: each top-level item with children is a column titled by it, holding its children; the
 * childless items gather in one trailing column titled `linksTitle`.
 */
export function footerColumns(
  menu: readonly ResolvedMenuItem[],
  locale: Locale,
  linksTitle: string,
): { readonly title: string; readonly links: readonly MenuEntry[] }[] {
  const columns: { title: string; links: readonly MenuEntry[] }[] = [];
  const loose: MenuEntry[] = [];
  for (const entry of menuEntries(menu, locale)) {
    if (entry.children.length > 0) columns.push({ title: entry.label, links: entry.children });
    else loose.push(entry);
  }
  if (loose.length > 0) columns.push({ title: linksTitle, links: loose });
  return columns;
}

/**
 * Ruling 12: the footer's policy row, titled from `POLICY_TITLES`, without a policy whose page the
 * footer menu already links at either level.
 */
export function footerPolicyLinks(
  policies: readonly PolicyType[],
  menu: readonly ResolvedMenuItem[],
  locale: Locale,
): MenuEntry[] {
  const linked = new Set(menu.flatMap((item) => [item.href, ...item.children.map((c) => c.href)]));
  return policies
    .filter((type) => !linked.has(policyPath(type)))
    .map((type) => ({
      label: POLICY_TITLES[type][locale],
      href: policyPath(type),
      external: false,
      children: [],
    }));
}
