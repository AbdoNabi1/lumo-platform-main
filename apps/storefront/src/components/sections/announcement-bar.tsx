import { pickText, type PublicAnnouncement } from "@platform/storefront-content";
import { MenuLink } from "@/components/menu-link";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { SectionFrame } from "./section-frame";
import { ANNOUNCEMENT_STYLES } from "./section-styles";

/**
 * The site-wide bar above the header. Live shows nothing for a hidden bar; preview shows the
 * placeholder inside the editor's focus frame. The link renders through `MenuLink` (safe rules).
 */
export function AnnouncementBar({
  section,
  locale,
  previewToken,
  t,
  preview,
}: {
  readonly section: PublicAnnouncement;
  readonly locale: Locale;
  readonly previewToken: string | null;
  readonly t: Dictionary;
  readonly preview: boolean;
}) {
  const hidden = section.hidden === true;
  if (!preview && hidden) return null;
  const text = pickText(section.settings.text, locale);
  const bar =
    text === null ? null : (
      <div
        role="region"
        aria-label={t.sections.announcement}
        className={`break-words px-4 py-2 text-center text-sm ${
          ANNOUNCEMENT_STYLES[section.settings.style]
        }`}
      >
        {section.settings.link === null ? (
          <bdi dir="auto">{text}</bdi>
        ) : (
          <MenuLink
            entry={{
              label: text,
              href: section.settings.link.href,
              external: section.settings.link.external,
              children: [],
            }}
            previewToken={previewToken}
            className="underline underline-offset-4"
          />
        )}
      </div>
    );
  if (!preview) return bar;
  return (
    <SectionFrame id={section.id} hidden={hidden} preview t={t}>
      {bar}
    </SectionFrame>
  );
}
