import { getImageProps } from "next/image";
import { pickText, type PublicSection } from "@platform/storefront-content";
import type { Locale } from "@/lib/i18n";
import { safeImageSrc } from "@/lib/safe-image";
import type { Dictionary } from "@/messages/en";
import { SectionButton } from "./section-button";
import { ALIGN_CLASSES, HERO_HEIGHTS, overlayClass } from "./section-styles";
import type { Settings } from "./section-types";

type HeroSectionData = Extract<PublicSection, { type: "hero"; incomplete?: never }>;

/**
 * The image banner (spec 3.6). Every class comes from a fixed lookup (Ruling 16), so the box keeps
 * its height whatever the picture's size. The mobile picture is art direction through `<picture>`;
 * a banner with only a mobile image never gets here (it is empty, T6). `t` is unused today but kept
 * so every section takes the same props.
 */
export function HeroSection({
  section,
  locale,
  previewToken,
  eager,
}: {
  readonly section: HeroSectionData;
  readonly locale: Locale;
  readonly previewToken: string | null;
  readonly eager: boolean;
  readonly t: Dictionary;
}) {
  const s: Settings<"hero"> = section.settings;
  const heading = pickText(s.heading, locale);
  const subheading = pickText(s.subheading, locale);
  const src = s.image === null ? null : safeImageSrc(s.image.url);
  const mobileSrc = s.mobileImage === null ? null : safeImageSrc(s.mobileImage.url);
  const picture =
    s.image === null || src === null ? null : (
      <picture>
        {s.mobileImage !== null && mobileSrc !== null ? (
          // `getImageProps({ unoptimized })` has no srcSet, so the (checked) address is used as is.
          <source
            media="(max-width: 767px)"
            srcSet={mobileSrc}
            width={s.mobileImage.width ?? undefined}
            height={s.mobileImage.height ?? undefined}
          />
        ) : null}
        {heroImage(src, s.image.alt, s.image.width, s.image.height, eager)}
      </picture>
    );
  return (
    <div
      className={`relative flex w-full overflow-hidden rounded-lg ${HERO_HEIGHTS[s.height] ?? HERO_HEIGHTS.medium} ${
        picture === null ? "bg-muted" : overlayClass(s.overlay)
      }`}
    >
      {picture}
      <div
        className={`relative z-10 mx-auto flex w-full max-w-3xl flex-col justify-center gap-3 px-6 py-8 ${
          ALIGN_CLASSES[s.contentAlign]
        } ${picture === null ? "text-foreground" : "text-white"}`}
      >
        {heading === null ? null : (
          <h2 dir="auto" className="break-words text-2xl font-semibold md:text-4xl">
            {heading}
          </h2>
        )}
        {subheading === null ? null : (
          <p dir="auto" className="break-words text-base md:text-lg">
            {subheading}
          </p>
        )}
        {s.button === null ? null : (
          <SectionButton button={s.button} locale={locale} previewToken={previewToken} />
        )}
      </div>
    </div>
  );
}

function heroImage(
  src: string,
  alt: string | null,
  width: number | null,
  height: number | null,
  eager: boolean,
) {
  const { props } = getImageProps({
    src,
    alt: alt ?? "",
    width: width ?? 1600,
    height: height ?? 900,
    sizes: "100vw",
    unoptimized: true,
    ...(eager ? { priority: true } : { loading: "lazy" as const }),
  });
  // Next 15 gives `priority` no fetchpriority attribute through getImageProps, so it is set here.
  // `style` is dropped: `next/image` adds fixed colour styles, and none may reach the page (F9).
  const img = { ...props, style: undefined };
  return (
    // A plain <img> fed by getImageProps: art direction through <picture> (spec 3.6).
    <img
      {...img}
      alt={img.alt}
      fetchPriority={eager ? "high" : undefined}
      className="absolute inset-0 size-full object-cover"
    />
  );
}
