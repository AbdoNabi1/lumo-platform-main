import type { LocalizedText } from "./locale";
import type {
  AnnouncementBarSettings,
  FeaturesSettings,
  HeroSettings,
  SectionType,
  TestimonialsSettings,
} from "./sections";

type LT = LocalizedText;

/** What the storefront receives for a section: references resolved, nothing editable. */
export interface PublicImage {
  readonly url: string;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface PublicLink {
  readonly href: string;
  readonly external: boolean;
}

export interface PublicCollectionRef {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface PublicButton {
  readonly label: LocalizedText;
  readonly link: PublicLink;
}

export interface PublicSettingsByType {
  announcement_bar: {
    text: LT;
    link: PublicLink | null;
    style: AnnouncementBarSettings["style"];
  };
  hero: {
    image: PublicImage | null;
    mobileImage: PublicImage | null;
    heading: LT;
    subheading: LT;
    button: PublicButton | null;
    height: HeroSettings["height"];
    contentAlign: HeroSettings["contentAlign"];
    overlay: number;
  };
  featured_collection: {
    collection: PublicCollectionRef;
    heading: LT;
    productCount: number;
    columns: number;
    showViewAll: boolean;
  };
  featured_products:
    | { source: "newest"; count: number; heading: LT; columns: number }
    | { source: "manual"; productIds: readonly string[]; heading: LT; columns: number };
  collection_list:
    | { source: "all"; heading: LT; columns: number }
    | {
        source: "manual";
        items: readonly { collection: PublicCollectionRef; image: PublicImage | null }[];
        heading: LT;
        columns: number;
      };
  image_with_text: {
    image: PublicImage | null;
    heading: LT;
    body: LT;
    button: PublicButton | null;
    imagePosition: "start" | "end";
  };
  rich_text: { heading: LT; body: LT; button: PublicButton | null; align: "start" | "center" };
  testimonials: { heading: LT; items: TestimonialsSettings["items"] };
  features: { heading: LT; items: FeaturesSettings["items"] };
  whatsapp_cta: { heading: LT; text: LT; buttonLabel: LT; phone: string; message: LT };
}

/**
 * `hidden` is present only in preview (Ruling 13). `incomplete` is preview only too (F2): a known
 * section the live rules would drop, kept as a placeholder so the editor can say what is missing.
 */
export type PublicSection =
  | {
      [T in SectionType]: {
        readonly id: string;
        readonly type: T;
        readonly hidden?: boolean;
        readonly settings: PublicSettingsByType[T];
      };
    }[SectionType]
  | {
      readonly id: string;
      readonly type: SectionType;
      readonly hidden?: boolean;
      readonly incomplete: true;
    };

export type PublicAnnouncement = Extract<PublicSection, { type: "announcement_bar" }>;
