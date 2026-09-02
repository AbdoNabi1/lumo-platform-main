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
  GlobeIcon,
  LandmarkIcon,
  LanguagesIcon,
  LayoutDashboardIcon,
  LayoutTemplateIcon,
  MegaphoneIcon,
  PackageIcon,
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
  UsersIcon,
  WarehouseIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import type { Dictionary } from "@/messages/en";

/**
 * The admin navigation, defined once and consumed by both the desktop sidebar and the
 * mobile drawer — the two must never drift apart.
 */

export interface NavItem {
  readonly id: string;
  readonly label: (t: Dictionary) => string;
  readonly href: string;
  readonly Icon: LucideIcon;
  /** Count shown as a badge next to the label. */
  readonly badge?: number;
  /** Sales channels open the customer-facing surface, outside the admin app. */
  readonly external?: boolean;
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { id: "dashboard", label: (t) => t.nav.dashboard, href: "/", Icon: LayoutDashboardIcon },
  { id: "orders", label: (t) => t.nav.orders, href: "/orders", Icon: ShoppingBagIcon },
  { id: "products", label: (t) => t.nav.products, href: "/products", Icon: PackageIcon },
  {
    id: "categories",
    label: (t) => t.nav.categories,
    href: "/categories",
    Icon: FolderTreeIcon,
  },
  { id: "brands", label: (t) => t.nav.brands, href: "/brands", Icon: AwardIcon },
  { id: "inventory", label: (t) => t.nav.inventory, href: "/inventory", Icon: WarehouseIcon },
  { id: "pricing", label: (t) => t.nav.pricing, href: "/pricing", Icon: TagIcon },
  { id: "customers", label: (t) => t.nav.customers, href: "/customers", Icon: UsersIcon },
  { id: "reviews", label: (t) => t.nav.reviews, href: "/reviews", Icon: StarIcon },
  {
    id: "notifications",
    label: (t) => t.nav.notifications,
    href: "/notifications",
    Icon: BellIcon,
  },
  { id: "analytics", label: (t) => t.nav.analytics, href: "/analytics", Icon: BarChart3Icon },
  { id: "marketing", label: (t) => t.nav.marketing, href: "/marketing", Icon: MegaphoneIcon },
  { id: "discounts", label: (t) => t.nav.discounts, href: "/discounts", Icon: PercentIcon },
  { id: "promotions", label: (t) => t.nav.promotions, href: "/promotions", Icon: GiftIcon },
  { id: "content", label: (t) => t.nav.content, href: "/content", Icon: FileTextIcon },
  { id: "pages", label: (t) => t.nav.pages, href: "/pages", Icon: FileIcon },
  { id: "templates", label: (t) => t.nav.templates, href: "/templates", Icon: LayoutTemplateIcon },
  { id: "seo", label: (t) => t.nav.seo, href: "/seo/profiles", Icon: SearchIcon },
  { id: "theme", label: (t) => t.nav.theme, href: "/theme", Icon: PaletteIcon },
  {
    id: "components-library",
    label: (t) => t.nav.componentsLibrary,
    href: "/components-library",
    Icon: ComponentIcon,
  },
  { id: "locales", label: (t) => t.nav.locales, href: "/locales", Icon: GlobeIcon },
  {
    id: "translation-sets",
    label: (t) => t.nav.translationSets,
    href: "/translation-sets",
    Icon: LanguagesIcon,
  },
  { id: "automations", label: (t) => t.nav.automations, href: "/automations", Icon: WorkflowIcon },
  {
    id: "integrations",
    label: (t) => t.nav.integrations,
    href: "/integrations",
    Icon: BlocksIcon,
  },
  { id: "settings", label: (t) => t.nav.settings, href: "/settings", Icon: SettingsIcon },
  { id: "security", label: (t) => t.nav.security, href: "/security", Icon: ShieldIcon },
  { id: "finance", label: (t) => t.nav.finance, href: "/finance", Icon: LandmarkIcon },
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

/**
 * The one customer-facing surface that actually exists in this monorepo (`apps/storefront`).
 * POS and Mobile app were removed here: they had `/channels/pos` and `/channels/mobile-app`
 * hrefs pointing at pages that have never existed, so both rendered the 404 screen.
 * `NEXT_PUBLIC_*` because `sidebar-nav.tsx` renders in the browser bundle.
 */
export const SALES_CHANNEL_NAV: readonly NavItem[] = [
  {
    id: "storefront",
    label: (t) => t.nav.storefront,
    href: process.env["NEXT_PUBLIC_STOREFRONT_URL"] ?? "http://localhost:3000",
    Icon: StoreIcon,
    external: true,
  },
];
