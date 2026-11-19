import {
  BadgeCheckIcon,
  FoldersIcon,
  ImageIcon,
  LayoutGridIcon,
  LayoutPanelLeftIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  QuoteIcon,
  StarIcon,
  TypeIcon,
  type LucideIcon,
} from "lucide-react";
import type { SectionIcon } from "@platform/storefront-content";

/** The icon of each section type's `icon` key (the definitions carry a name, never a component). */
export const SECTION_ICON_COMPONENTS: Readonly<Record<SectionIcon, LucideIcon>> = {
  megaphone: MegaphoneIcon,
  image: ImageIcon,
  star: StarIcon,
  grid: LayoutGridIcon,
  folders: FoldersIcon,
  "image-text": LayoutPanelLeftIcon,
  text: TypeIcon,
  quote: QuoteIcon,
  "badge-check": BadgeCheckIcon,
  "message-circle": MessageCircleIcon,
};
