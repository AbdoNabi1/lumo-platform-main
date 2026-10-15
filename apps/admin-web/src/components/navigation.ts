import {
  AwardIcon,
  BarChart3Icon,
  BellIcon,
  BlocksIcon,
  ComponentIcon,
  FileIcon,
  FileTextIcon,
  FlaskConicalIcon,
  FolderTreeIcon,
  GiftIcon,
  HouseIcon,
  LandmarkIcon,
  LanguagesIcon,
  LayoutTemplateIcon,
  MegaphoneIcon,
  PaletteIcon,
  PercentIcon,
  PuzzleIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  ShoppingBagIcon,
  StarIcon,
  StoreIcon,
  TagIcon,
  ToggleLeftIcon,
  UserIcon,
  WarehouseIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import type { Dictionary } from "@/messages/en";

/**
 * The admin navigation, defined once and consumed by the desktop sidebar, the mobile drawer and
 * the global search — they must never drift apart.
 *
 * Laid out like Shopify's: a short list of sections, each opening its own sub-pages underneath
 * while one of them is the current page, then the Online Store sales channel, then Settings pinned
 * at the bottom. The platform's own engineering screens (feature flags, experiments, security…)
 * are not a merchant's concern and only appear under "Platform tools" when the deployment turns
 * them on (`ADMIN_PLATFORM_TOOLS`); their routes stay reachable either way.
 */

export interface NavItem {
  /** Matches the `activeNavId` a page passes to `AppShell`. */
  readonly id: string;
  readonly label: (t: Dictionary) => string;
  readonly href: string;
  /** Shown on top-level items and in the search; sub-items in the sidebar show none, as in Shopify. */
  readonly Icon: LucideIcon;
  /** Count shown as a badge next to the label. */
  readonly badge?: number;
  /** Opens a surface outside the admin app, in a new tab. */
  readonly external?: boolean;
  /** Sub-pages, listed under the item while its section is open. */
  readonly children?: readonly NavItem[];
  /** Other pages that belong to this section without being listed under it. */
  readonly sectionIds?: readonly string[];
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { id: "dashboard", label: (t) => t.nav.dashboard, href: "/", Icon: HouseIcon },
  { id: "orders", label: (t) => t.nav.orders, href: "/orders", Icon: ShoppingBagIcon },
  {
    id: "products",
    label: (t) => t.nav.products,
    href: "/products",
    Icon: TagIcon,
    children: [
      {
        id: "categories",
        label: (t) => t.nav.categories,
        href: "/categories",
        Icon: FolderTreeIcon,
      },
      {
        id: "inventory",
        label: (t) => t.nav.inventory,
        href: "/inventory",
        Icon: WarehouseIcon,
      },
      { id: "brands", label: (t) => t.nav.brands, href: "/brands", Icon: AwardIcon },
      { id: "reviews", label: (t) => t.nav.reviews, href: "/reviews", Icon: StarIcon },
    ],
    // Plan 2C-1: Pricing is off the menu — the variant on the product is the only price source.
    sectionIds: ["pricing"],
  },
  { id: "customers", label: (t) => t.nav.customers, href: "/customers", Icon: UserIcon },
  {
    id: "marketing",
    label: (t) => t.nav.marketing,
    href: "/marketing",
    Icon: MegaphoneIcon,
    children: [
      {
        id: "automations",
        label: (t) => t.nav.automations,
        href: "/automations",
        Icon: WorkflowIcon,
      },
    ],
  },
  {
    id: "discounts",
    label: (t) => t.nav.discounts,
    href: "/discounts",
    Icon: PercentIcon,
    children: [
      {
        id: "promotions",
        label: (t) => t.nav.promotions,
        href: "/promotions",
        Icon: GiftIcon,
      },
    ],
  },
  { id: "content", label: (t) => t.nav.content, href: "/content", Icon: FileTextIcon },
  { id: "finance", label: (t) => t.nav.finance, href: "/finance", Icon: LandmarkIcon },
  { id: "analytics", label: (t) => t.nav.analytics, href: "/analytics", Icon: BarChart3Icon },
];

/** Shopify's "Online Store" sales channel: the theme, the store's pages and its search listing. */
export const ONLINE_STORE_NAV: NavItem = {
  id: "online-store",
  label: (t) => t.nav.onlineStore,
  href: "/theme",
  Icon: StoreIcon,
  children: [
    { id: "theme", label: (t) => t.nav.theme, href: "/theme", Icon: PaletteIcon },
    { id: "pages", label: (t) => t.nav.pages, href: "/pages", Icon: FileIcon },
    { id: "seo", label: (t) => t.nav.seo, href: "/seo/profiles", Icon: SearchIcon },
  ],
};

/** Pinned to the bottom of the sidebar. Languages live inside Settings, as they do in Shopify. */
export const SETTINGS_NAV: NavItem = {
  id: "settings",
  label: (t) => t.nav.settings,
  href: "/settings",
  Icon: SettingsIcon,
  sectionIds: ["locales"],
};

/** The platform's engineering screens — listed only when `ADMIN_PLATFORM_TOOLS` is on. */
export const PLATFORM_TOOLS_NAV: readonly NavItem[] = [
  {
    id: "notifications",
    label: (t) => t.nav.notifications,
    href: "/notifications",
    Icon: BellIcon,
  },
  { id: "templates", label: (t) => t.nav.templates, href: "/templates", Icon: LayoutTemplateIcon },
  {
    id: "components-library",
    label: (t) => t.nav.componentsLibrary,
    href: "/components-library",
    Icon: ComponentIcon,
  },
  {
    id: "translation-sets",
    label: (t) => t.nav.translationSets,
    href: "/translation-sets",
    Icon: LanguagesIcon,
  },
  {
    id: "integrations",
    label: (t) => t.nav.integrations,
    href: "/integrations",
    Icon: BlocksIcon,
  },
  { id: "security", label: (t) => t.nav.security, href: "/security", Icon: ShieldIcon },
  {
    id: "feature-registry",
    label: (t) => t.nav.featureRegistry,
    href: "/feature-registry",
    Icon: PuzzleIcon,
  },
  {
    id: "feature-flags",
    label: (t) => t.nav.featureFlags,
    href: "/feature-flags",
    Icon: ToggleLeftIcon,
  },
  {
    id: "experiments",
    label: (t) => t.nav.experiments,
    href: "/experiments",
    Icon: FlaskConicalIcon,
  },
];

/** True when `activeId` is the item itself, one of its sub-pages, or a page of its section. */
export function isInSection(item: NavItem, activeId: string): boolean {
  return (
    item.id === activeId ||
    (item.children ?? []).some((child) => child.id === activeId) ||
    (item.sectionIds ?? []).includes(activeId)
  );
}

/**
 * The storefront address, from the runtime `STOREFRONT_URL` (read by the server shell at request
 * time, Plan 3C — `NEXT_PUBLIC_*` would be frozen at build time). Unset or blank means no "View
 * your store" link at all — never a localhost guess.
 */
export function storefrontHref(storefrontUrl: string | null | undefined): string | null {
  const href = storefrontUrl?.trim();
  return href === undefined || href === "" ? null : href;
}

/**
 * Whether the deployment lists the platform's engineering screens in the menu. Read on the server,
 * per request, for the same reason as `STOREFRONT_URL`.
 */
export function platformToolsEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}
