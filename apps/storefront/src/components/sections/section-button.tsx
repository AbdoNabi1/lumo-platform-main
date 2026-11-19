import { pickText, type PublicButton } from "@platform/storefront-content";
import type { Locale } from "@/lib/i18n";
import { MenuLink } from "@/components/menu-link";
import { BUTTON_CLASS } from "./section-styles";

/**
 * A section's button. It renders through `MenuLink`, which checks the href again, keeps the preview
 * token on same-site links and opens external ones without an opener (F23). No label, no button.
 */
export function SectionButton({
  button,
  locale,
  previewToken,
  variant = "primary",
}: {
  readonly button: PublicButton;
  readonly locale: Locale;
  readonly previewToken: string | null;
  readonly variant?: "primary" | "secondary";
}) {
  const label = pickText(button.label, locale);
  if (label === null) return null;
  return (
    <MenuLink
      entry={{ label, href: button.link.href, external: button.link.external, children: [] }}
      previewToken={previewToken}
      className={BUTTON_CLASS[variant]}
    />
  );
}
