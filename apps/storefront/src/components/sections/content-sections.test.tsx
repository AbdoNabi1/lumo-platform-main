import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  FEATURE_ICONS,
  type CompletePublicSection,
  type PublicImage,
  type PublicSection,
} from "@platform/storefront-content";
import { formatNumber } from "@/lib/format";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { AnnouncementBar } from "./announcement-bar";
import { FEATURE_ICON_COMPONENTS, FeaturesSection } from "./features";
import { HeroSection } from "./hero";
import { ImageWithTextSection } from "./image-with-text";
import { RichTextSection } from "./rich-text-section";
import { Sections } from "./sections";
import {
  ALIGN_CLASSES,
  ANNOUNCEMENT_STYLES,
  HERO_HEIGHTS,
  OVERLAY_CLASSES,
} from "./section-styles";
import { TestimonialsSection } from "./testimonials";
import { WhatsAppCtaSection } from "./whatsapp-cta";

const ID = "00000000-0000-4000-8000-000000000001";
const lt = (text: string) => ({ ar: text, en: text });
const DESKTOP: PublicImage = {
  url: "https://cdn.example/desktop.jpg",
  alt: "Shop front",
  width: 2000,
  height: 800,
};
const MOBILE: PublicImage = {
  url: "https://cdn.example/mobile.jpg",
  alt: null,
  width: 800,
  height: 1000,
};
const BUTTON = { label: lt("Shop now"), link: { href: "/collections/all", external: false } };

type Of<T extends PublicSection["type"]> = Extract<CompletePublicSection, { type: T }>;
type S<T extends PublicSection["type"]> = Of<T>["settings"];

const hero = (over: Partial<S<"hero">> = {}): Of<"hero"> => ({
  id: ID,
  type: "hero",
  settings: {
    image: DESKTOP,
    mobileImage: null,
    heading: lt("Summer"),
    subheading: lt("Fresh arrivals"),
    button: null,
    height: "medium",
    contentAlign: "center",
    overlay: 30,
    ...over,
  },
});
const iwt = (over: Partial<S<"image_with_text">> = {}): Of<"image_with_text"> => ({
  id: ID,
  type: "image_with_text",
  settings: {
    image: DESKTOP,
    heading: lt("Our story"),
    body: lt("Made by hand"),
    button: null,
    imagePosition: "start",
    ...over,
  },
});
const rich = (over: Partial<S<"rich_text">> = {}): Of<"rich_text"> => ({
  id: ID,
  type: "rich_text",
  settings: { heading: lt("About"), body: lt("Hello"), button: null, align: "start", ...over },
});
const testimonials = (items: S<"testimonials">["items"]): Of<"testimonials"> => ({
  id: ID,
  type: "testimonials",
  settings: { heading: lt("Reviews"), items },
});
const features = (items: S<"features">["items"]): Of<"features"> => ({
  id: ID,
  type: "features",
  settings: { heading: lt("Why us"), items },
});
const wa = (over: Partial<S<"whatsapp_cta">> = {}): Of<"whatsapp_cta"> => ({
  id: ID,
  type: "whatsapp_cta",
  settings: {
    heading: lt("Chat"),
    text: lt("We reply fast"),
    buttonLabel: { ar: "راسلنا على واتساب", en: "Message us on WhatsApp" },
    phone: "201001234567",
    message: lt(""),
    ...over,
  },
});
const bar = (over: Partial<S<"announcement_bar">> = {}): Of<"announcement_bar"> => ({
  id: ID,
  type: "announcement_bar",
  settings: { text: lt("Free shipping"), link: null, style: "accent", ...over },
});

beforeEach(() => {
  expect.hasAssertions();
});

describe("section styles (Ruling 16)", () => {
  it("are fixed class lookups, verbatim", () => {
    expect(Object.keys(OVERLAY_CLASSES).map(Number)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80]);
    for (const [n, cls] of Object.entries(OVERLAY_CLASSES)) {
      expect(cls).toBe(`after:bg-foreground after:absolute after:inset-0 after:opacity-${n}`);
    }
    expect(HERO_HEIGHTS).toEqual({
      small: "h-60 md:h-80",
      medium: "h-80 md:h-[30rem]",
      large: "h-[28rem] md:h-[40rem]",
    });
    expect(ANNOUNCEMENT_STYLES).toEqual({
      accent: "bg-accent text-accent-foreground",
      primary: "bg-primary text-primary-foreground",
      dark: "bg-foreground text-background",
    });
    expect(ALIGN_CLASSES).toEqual({
      start: "items-start text-start",
      center: "items-center text-center",
    });
  });
});

describe("content sections (spec 3.6)", () => {
  it("hero: <picture> with the mobile image under 768 px; the first hero is eager and fetchpriority high, others lazy", () => {
    const { container } = render(
      <HeroSection
        section={hero({ mobileImage: MOBILE })}
        locale="ar"
        previewToken={null}
        eager
        t={ar}
      />,
    );
    const source = container.querySelector('picture source[media="(max-width: 767px)"]');
    expect(source).toHaveAttribute("srcset", MOBILE.url);
    expect(source).toHaveAttribute("width", "800");
    expect(source).toHaveAttribute("height", "1000");
    const img = container.querySelector("picture img")!;
    expect(img).toHaveAttribute("src", DESKTOP.url);
    expect(img).toHaveAttribute("fetchpriority", "high");
    expect(img).not.toHaveAttribute("loading", "lazy");

    const lazy = render(
      <HeroSection section={hero()} locale="ar" previewToken={null} eager={false} t={ar} />,
    );
    expect(lazy.container.querySelector("img")).toHaveAttribute("loading", "lazy");
    expect(lazy.container.querySelector("source")).toBeNull();
  });

  it("hero: overlay, height and alignment are fixed classes, never a style attribute (Ruling 16)", () => {
    const { container } = render(
      <HeroSection
        section={hero({ overlay: 40, height: "large", contentAlign: "start", mobileImage: MOBILE })}
        locale="en"
        previewToken={null}
        eager={false}
        t={en}
      />,
    );
    expect(container.innerHTML).toContain("after:opacity-40");
    expect(container.innerHTML).toContain(HERO_HEIGHTS.large);
    expect(container.innerHTML).toContain("items-start");
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("hero: an unknown overlay falls back to none instead of becoming a class", () => {
    const { container } = render(
      <HeroSection
        section={hero({ overlay: 35 })}
        locale="en"
        previewToken={null}
        eager={false}
        t={en}
      />,
    );
    expect(container.innerHTML).toContain("after:opacity-0");
    expect(container.innerHTML).not.toContain("after:opacity-35");
  });

  it("hero without an image shows its text on the muted panel; texts are dir=auto; the button works", () => {
    const { container } = render(
      <HeroSection
        section={hero({ image: null, button: BUTTON })}
        locale="en"
        previewToken="tok"
        eager
        t={en}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.firstElementChild).toHaveClass("bg-muted");
    const h = screen.getByRole("heading", { level: 2, name: "Summer" });
    expect(h).toHaveAttribute("dir", "auto");
    expect(h).toHaveClass("break-words");
    expect(screen.getByText("Fresh arrivals")).toHaveAttribute("dir", "auto");
    expect(screen.getByRole("link", { name: "Shop now" })).toHaveAttribute(
      "href",
      "/collections/all?preview=tok",
    );
  });

  it("hero: an unsafe image url drops the image and does not crash", () => {
    const { container } = render(
      <HeroSection
        section={hero({ image: { ...DESKTOP, url: "javascript:alert(1)" }, mobileImage: MOBILE })}
        locale="en"
        previewToken={null}
        eager={false}
        t={en}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { name: "Summer" })).toBeInTheDocument();
  });

  it("hero: an Arabic-only heading viewed in English falls back and wraps long words", () => {
    render(
      <HeroSection
        section={hero({ image: null, heading: { ar: "مرحبًا بكم" } })}
        locale="en"
        previewToken={null}
        eager={false}
        t={en}
      />,
    );
    expect(screen.getByRole("heading", { name: "مرحبًا بكم" })).toHaveClass("break-words");
  });

  it("image with text: image at the inline start or end; the body through <RichText>, never HTML", () => {
    const { container } = render(
      <ImageWithTextSection
        section={iwt({ body: { en: "<img src=x onerror=alert(1)> **bold**" } })}
        locale="en"
        previewToken={null}
        t={en}
      />,
    );
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    const grid = container.querySelector(".md\\:grid-cols-2")!;
    expect(grid.firstElementChild?.className).not.toContain("md:order-last");

    const end = render(
      <ImageWithTextSection
        section={iwt({ imagePosition: "end" })}
        locale="en"
        previewToken={null}
        t={en}
      />,
    );
    expect(end.container.querySelector(".md\\:grid-cols-2")!.firstElementChild).toHaveClass(
      "md:order-last",
    );
  });

  it("image with text: no style attribute carries a merchant value, and an unsafe image is dropped", () => {
    const section = iwt({ heading: lt("SECRET-HEAD"), image: { ...DESKTOP, alt: "SECRET-ALT" } });
    const { container } = render(
      <ImageWithTextSection section={section} locale="en" previewToken={null} t={en} />,
    );
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", DESKTOP.url);
    expect(img).toHaveAttribute("loading", "lazy");
    for (const el of container.querySelectorAll("[style]")) {
      const style = el.getAttribute("style") ?? "";
      for (const value of ["SECRET", DESKTOP.url, "2000", "800", "Made by hand"]) {
        expect(style).not.toContain(value);
      }
    }
    const bad = render(
      <ImageWithTextSection
        section={iwt({ image: { ...DESKTOP, url: "data:text/html,x" } })}
        locale="en"
        previewToken={null}
        t={en}
      />,
    );
    expect(bad.container.querySelector("img")).toBeNull();
    expect(within(bad.container).getByRole("heading", { name: "Our story" })).toHaveAttribute(
      "dir",
      "auto",
    );
  });

  it("rich text: align start or center; a button only when it has a label and a link", () => {
    const centered = render(
      <RichTextSection
        section={rich({ align: "center", button: BUTTON })}
        locale="en"
        previewToken={null}
        t={en}
      />,
    );
    expect(centered.container.innerHTML).toContain(ALIGN_CLASSES.center);
    expect(screen.getByRole("link", { name: "Shop now" })).toBeInTheDocument();
    centered.unmount();

    const plain = render(
      <RichTextSection
        section={rich({ button: { label: {}, link: BUTTON.link } })}
        locale="en"
        previewToken={null}
        t={en}
      />,
    );
    expect(plain.container.innerHTML).toContain(ALIGN_CLASSES.start);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("testimonials: quotes stack on mobile, rating 0 shows no stars, rating 4 says so to screen readers", () => {
    const { container } = render(
      <TestimonialsSection
        section={testimonials([
          { quote: { ar: "رائع" }, author: "نور", rating: 4 },
          { quote: { en: "Nice" }, author: "", rating: 0 },
        ])}
        locale="ar"
        t={ar}
      />,
    );
    const said = ar.sections.rating
      .replace("{rating}", formatNumber("ar", 4))
      .replace("{max}", formatNumber("ar", 5));
    expect(said.startsWith("التقييم")).toBe(true);
    expect(screen.getByText(said)).toHaveClass("sr-only");
    expect(screen.getAllByText(/التقييم/)).toHaveLength(1);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    expect(container.innerHTML).toContain("★★★★");
    expect(container.querySelector(".grid")).toHaveClass("md:grid-cols-2", "lg:grid-cols-3");
    expect(screen.getByText("نور").closest("bdi")).toHaveAttribute("dir", "auto");
    expect(screen.getByText("رائع")).toHaveAttribute("dir", "auto");
    expect(screen.getByText("Nice")).toBeInTheDocument();
  });

  it("testimonials: the English copy reads 'Rated 4 out of 5'", () => {
    render(
      <TestimonialsSection
        section={testimonials([{ quote: lt("Great"), author: "Sam", rating: 4 }])}
        locale="en"
        t={en}
      />,
    );
    expect(screen.getByText("Rated 4 out of 5")).toHaveClass("sr-only");
  });

  it("features: the fixed icon per key, titles and texts with dir=auto", () => {
    expect(Object.keys(FEATURE_ICON_COMPONENTS).sort()).toEqual([...FEATURE_ICONS].sort());
    const { container } = render(
      <FeaturesSection
        section={features([
          { icon: "cod", title: lt("Cash on delivery"), text: lt("Pay at the door") },
          { icon: "shipping", title: lt("Fast"), text: lt("") },
        ])}
        locale="en"
        t={en}
      />,
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(2);
    expect(svgs[0]).toHaveClass("lucide-banknote");
    expect(svgs[1]).toHaveClass("lucide-truck");
    for (const svg of svgs) expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Cash on delivery")).toHaveAttribute("dir", "auto");
    expect(screen.getByText("Pay at the door")).toHaveAttribute("dir", "auto");
    expect(container.querySelector(".grid")).toHaveClass("sm:grid-cols-2", "lg:grid-cols-3");
  });

  it("features: every icon key has its own component", () => {
    const seen = new Set(FEATURE_ICONS.map((k) => FEATURE_ICON_COMPONENTS[k]));
    expect(seen.size).toBe(FEATURE_ICONS.length);
  });

  it("WhatsApp: wa.me with the message in the request locale, new tab, no opener, no referrer, no preview token", () => {
    render(
      <WhatsAppCtaSection
        section={wa({ phone: "201001234567", message: { ar: "مرحبًا", en: "Hello" } })}
        locale="en"
        t={en}
      />,
    );
    const link = screen.getByRole("link", { name: /Message us on WhatsApp/ });
    expect(link).toHaveAttribute("href", "https://wa.me/201001234567?text=Hello");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(within(link).getByText(en.sections.opensInNewTab)).toHaveClass("sr-only");
  });

  it("WhatsApp: no message gives the bare link, and bad digits render nothing", () => {
    render(<WhatsAppCtaSection section={wa()} locale="ar" t={ar} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://wa.me/201001234567");
    expect(screen.getByRole("link")).toHaveTextContent("راسلنا على واتساب");
    const bad = render(<WhatsAppCtaSection section={wa({ phone: "12ab" })} locale="ar" t={ar} />);
    expect(bad.container).toBeEmptyDOMElement();
  });

  it("announcement bar: style class, a link through the safe link rules, isolated text", () => {
    const { container } = render(
      <AnnouncementBar
        section={bar({ style: "dark", link: { href: "/collections/sale", external: false } })}
        locale="en"
        previewToken="tok"
        t={en}
        preview={false}
      />,
    );
    const region = screen.getByRole("region", { name: en.sections.announcement });
    expect(region).toHaveClass(...ANNOUNCEMENT_STYLES.dark.split(" "));
    const link = within(region).getByRole("link");
    expect(link).toHaveAttribute("href", "/collections/sale?preview=tok");
    expect(within(link).getByText("Free shipping").closest("bdi")).toHaveAttribute("dir", "auto");
    expect(container.querySelector("[style]")).toBeNull();
    expect(container.querySelector("[data-section-id]")).toBeNull();
  });

  it("announcement bar: an unsafe link falls back to plain text", () => {
    render(
      <AnnouncementBar
        section={bar({ link: { href: "javascript:alert(1)", external: false } })}
        locale="en"
        previewToken={null}
        t={en}
        preview={false}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("region")).toHaveTextContent("Free shipping");
  });

  it("announcement bar: live hidden renders nothing; preview hidden is the placeholder inside data-section-id", () => {
    const hidden = { ...bar(), hidden: true };
    const live = render(
      <AnnouncementBar section={hidden} locale="en" previewToken={null} t={en} preview={false} />,
    );
    expect(live.container).toBeEmptyDOMElement();
    live.unmount();
    const { container } = render(
      <AnnouncementBar section={hidden} locale="en" previewToken="tok" t={en} preview />,
    );
    const frame = container.querySelector(`[data-section-id="${ID}"]`);
    expect(frame).toHaveTextContent(en.sections.hiddenPlaceholder);
    expect(screen.queryByText("Free shipping")).toBeNull();
  });

  it("an Arabic-only section viewed in English falls back; long Arabic words wrap at 320 px (break-words)", () => {
    const long = "كلمةطويلةجداجداجداجداجداجداجداجدا";
    render(
      <RichTextSection
        section={rich({ heading: { ar: long } })}
        locale="en"
        previewToken={null}
        t={en}
      />,
    );
    const h = screen.getByRole("heading", { name: long });
    expect(h).toHaveClass("break-words");
    expect(h).toHaveAttribute("dir", "auto");
  });
});

describe("Sections dispatch of the content types (T8 carry)", () => {
  const ids = [0, 1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-00000000010${n}`);
  const complete = [
    hero(),
    iwt(),
    rich(),
    testimonials([{ quote: lt("Q"), author: "A", rating: 3 }]),
    features([{ icon: "gift", title: lt("T"), text: lt("X") }]),
    wa(),
  ].map((s, i) => ({ ...s, id: ids[i]! })) as PublicSection[];

  const renderAll = (sections: PublicSection[], mode: "live" | "preview") =>
    render(
      <Sections
        sections={sections}
        data={new Map()}
        availability={null}
        t={en}
        locale="en"
        previewToken={mode === "preview" ? "tok" : null}
        mode={mode}
        eagerHeroId={ids[0]!}
      />,
    );

  it("renders one frame per content type in preview, the first hero eager", () => {
    const { container } = renderAll(complete, "preview");
    expect(container.querySelectorAll("[data-section-id]")).toHaveLength(6);
    expect(container.querySelector("picture img")).toHaveAttribute("fetchpriority", "high");
    expect(screen.getByRole("link", { name: /Message us on WhatsApp/ })).toBeInTheDocument();
  });

  it("in preview an incomplete or hidden hero and WhatsApp section keeps its data-section-id frame", () => {
    const stub = "00000000-0000-4000-8000-000000000200";
    const sections = [
      { id: ids[0]!, type: "hero", incomplete: true, hidden: false },
      { ...complete[5]!, hidden: true },
      { id: stub, type: "whatsapp_cta", incomplete: true, hidden: false },
      { ...complete[0]!, id: "00000000-0000-4000-8000-000000000201", hidden: true },
    ] as unknown as PublicSection[];
    const { container } = renderAll(sections, "preview");
    const frames = [...container.querySelectorAll("[data-section-id]")];
    expect(frames.map((f) => f.getAttribute("data-section-id"))).toEqual([
      ids[0],
      ids[5],
      stub,
      "00000000-0000-4000-8000-000000000201",
    ]);
    expect(frames[0]).toHaveTextContent(en.sections.incompletePlaceholder);
    expect(frames[1]).toHaveTextContent(en.sections.hiddenPlaceholder);
    expect(frames[2]).toHaveTextContent(en.sections.incompletePlaceholder);
    expect(frames[3]).toHaveTextContent(en.sections.hiddenPlaceholder);
  });

  it("live drops hidden and incomplete content sections and shows no frame attribute", () => {
    const sections = [
      { id: ids[0]!, type: "hero", incomplete: true },
      { ...complete[5]!, hidden: true },
      complete[1]!,
    ] as unknown as PublicSection[];
    const { container } = renderAll(sections, "live");
    expect(container.querySelector("[data-section-id]")).toBeNull();
    expect(container.querySelectorAll("section")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
  });
});

describe("fix round 1", () => {
  it("WhatsApp: an empty button label falls back to the default text in both locales", () => {
    const empty = wa({ buttonLabel: {} });
    const arView = render(<WhatsAppCtaSection section={empty} locale="ar" t={ar} />);
    expect(screen.getByRole("link")).toHaveTextContent("راسلنا على واتساب");
    arView.unmount();
    render(<WhatsAppCtaSection section={empty} locale="en" t={en} />);
    expect(screen.getByRole("link", { name: /Message us on WhatsApp/ })).toHaveAttribute(
      "href",
      "https://wa.me/201001234567",
    );
  });

  it("WhatsApp: an Arabic-only label viewed in English falls back to the Arabic label", () => {
    render(
      <WhatsAppCtaSection section={wa({ buttonLabel: { ar: "تواصل" } })} locale="en" t={en} />,
    );
    expect(screen.getByRole("link")).toHaveTextContent("تواصل");
  });

  it("preview: an announcement with no text and a WhatsApp section with bad digits are placeholders; live drops them", () => {
    const empty = { ...bar({ text: {} }) };
    const view = render(
      <AnnouncementBar section={empty} locale="en" previewToken="tok" t={en} preview />,
    );
    expect(view.container.querySelector(`[data-section-id="${ID}"]`)).toHaveTextContent(
      en.sections.incompletePlaceholder,
    );
    view.unmount();
    expect(
      render(
        <AnnouncementBar section={empty} locale="en" previewToken={null} t={en} preview={false} />,
      ).container,
    ).toBeEmptyDOMElement();

    const sections = [wa({ phone: "12ab" })] as PublicSection[];
    const props = {
      sections,
      data: new Map(),
      availability: null,
      t: en,
      locale: "en" as const,
      eagerHeroId: null,
    };
    const prev = render(<Sections {...props} previewToken="tok" mode="preview" />);
    expect(prev.container.querySelector(`[data-section-id="${ID}"]`)).toHaveTextContent(
      en.sections.incompletePlaceholder,
    );
    prev.unmount();
    expect(
      render(<Sections {...props} previewToken={null} mode="live" />).container,
    ).toBeEmptyDOMElement();
  });

  it("class maps fall back instead of printing undefined", () => {
    const h = render(
      <HeroSection
        section={hero({ height: "huge" as never })}
        locale="en"
        previewToken={null}
        eager={false}
        t={en}
      />,
    );
    expect(h.container.innerHTML).toContain(HERO_HEIGHTS.medium);
    expect(h.container.innerHTML).not.toContain("undefined");
    h.unmount();
    const a = render(
      <AnnouncementBar
        section={bar({ style: "neon" as never })}
        locale="en"
        previewToken={null}
        t={en}
        preview={false}
      />,
    );
    expect(a.container.innerHTML).toContain(ANNOUNCEMENT_STYLES.accent);
    expect(a.container.innerHTML).not.toContain("undefined");
  });
});
