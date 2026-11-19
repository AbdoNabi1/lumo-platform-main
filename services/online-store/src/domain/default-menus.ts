import {
  POLICY_TITLES,
  POLICY_TYPES,
  type DefaultMenuHandle,
  type MenuItem,
  type PolicyType,
} from "@platform/storefront-content";
import { Menu } from "./menu";

/** Fixed ids so a virtual default menu is stable between reads (Ruling 12). */
export const DEFAULT_ITEM_IDS = Object.freeze({
  home: "00000000-0000-4000-8000-000000000001",
  search: "00000000-0000-4000-8000-000000000002",
  refund: "00000000-0000-4000-8000-000000000101",
  shipping: "00000000-0000-4000-8000-000000000102",
  privacy: "00000000-0000-4000-8000-000000000103",
  terms: "00000000-0000-4000-8000-000000000104",
  contact: "00000000-0000-4000-8000-000000000105",
} as const);

export const DEFAULT_MENU_TITLES: Readonly<Record<DefaultMenuHandle, string>> = Object.freeze({
  "main-menu": "Main menu",
  footer: "Footer menu",
});

const HOME: MenuItem = {
  id: DEFAULT_ITEM_IDS.home,
  label: { ar: "الرئيسية", en: "Home" },
  link: { type: "home" },
  children: [],
};

const SEARCH: MenuItem = {
  id: DEFAULT_ITEM_IDS.search,
  label: { ar: "البحث", en: "Search" },
  link: { type: "search" },
  children: [],
};

/**
 * What a shop shows before it saves a default menu: Home and Search in the main menu; Search and
 * one link per SET policy (in policy order) in the footer. Never persisted by a read.
 */
export function virtualDefaultMenu(
  handle: DefaultMenuHandle,
  setPolicies: readonly PolicyType[],
): Menu {
  const items: MenuItem[] =
    handle === "main-menu"
      ? [HOME, SEARCH]
      : [
          SEARCH,
          ...POLICY_TYPES.filter((type) => setPolicies.includes(type)).map((type): MenuItem => ({
            id: DEFAULT_ITEM_IDS[type],
            label: { ar: POLICY_TITLES[type].ar, en: POLICY_TITLES[type].en },
            link: { type: "policy", policy: type },
            children: [],
          })),
        ];
  return Menu.reconstitute({
    id: null,
    handle,
    title: DEFAULT_MENU_TITLES[handle],
    items: items.map((item) => ({ ...item, label: { ...item.label }, link: { ...item.link } })),
    version: 0,
    updatedAt: null,
    persisted: false,
  });
}
