import {
  FacebookIcon,
  InstagramIcon,
  LinkIcon,
  TwitterIcon,
  YoutubeIcon,
  type LucideIcon,
} from "lucide-react";
import { pickText, SOCIAL_NETWORKS, type SocialNetwork } from "@platform/storefront-content";
import { MenuLink } from "@/components/menu-link";
import type { Locale } from "@/lib/i18n";
import type { StorefrontShell } from "@/lib/online-store";
import { footerColumns, footerPolicyLinks } from "@/lib/shell-menus";
import type { Dictionary } from "@/messages/en";

// lucide has no TikTok or Snapchat glyph; a generic link icon with the network's accessible name.
const ICONS: Readonly<Record<SocialNetwork, LucideIcon>> = {
  facebook: FacebookIcon,
  instagram: InstagramIcon,
  tiktok: LinkIcon,
  x: TwitterIcon,
  youtube: YoutubeIcon,
  snapchat: LinkIcon,
};

const LINK = "hover:text-foreground";

/**
 * Spec 1.12: store name, footer note, social icons for the set fields, ©, "Powered by مربح".
 * Spec 2.8: between the note and the social row, the footer menu as columns (each parent item is a
 * column of its children; childless items gather under "Links"), then the policy links the menu
 * does not already carry (Ruling 12). Internal links keep the preview token.
 */
export function SiteFooter({
  t,
  locale,
  shell,
  previewToken = null,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly shell: StorefrontShell;
  readonly previewToken?: string | null;
}) {
  const name = shell.storeName.trim();
  const note = pickText(shell.footer.note, locale);
  const year = new Intl.NumberFormat(locale, { useGrouping: false }).format(
    new Date().getFullYear(),
  );
  const networks = shell.footer.showSocial
    ? SOCIAL_NETWORKS.filter((n) => shell.brand.social[n] !== undefined)
    : [];
  const columns = footerColumns(shell.footer.menu, locale, t.footer.links);
  const policyLinks = footerPolicyLinks(shell.footer.policies, shell.footer.menu, locale);
  return (
    <footer className="border-border mt-12 border-t">
      <div className="text-muted-foreground mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-sm">
        {name === "" ? null : (
          <p className="text-foreground font-medium">
            <bdi dir="auto">{name}</bdi>
          </p>
        )}
        {note === null ? null : (
          <p dir="auto" className="whitespace-pre-line">
            <bdi>{note}</bdi>
          </p>
        )}
        {columns.length === 0 ? null : (
          <div className="grid gap-6 py-2 sm:grid-cols-2 md:grid-cols-4">
            {columns.map((column, index) => (
              <section key={`${index}-${column.title}`} className="flex flex-col gap-2">
                <h2 className="text-foreground text-sm font-medium">
                  <bdi dir="auto">{column.title}</bdi>
                </h2>
                <ul className="flex flex-col gap-1.5">
                  {column.links.map((link, linkIndex) => (
                    <li key={`${linkIndex}-${link.href}`}>
                      <MenuLink entry={link} previewToken={previewToken} className={LINK} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {policyLinks.length === 0 ? null : (
          <nav aria-label={t.footer.policies}>
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {policyLinks.map((link) => (
                <li key={link.href}>
                  <MenuLink entry={link} previewToken={previewToken} className={LINK} />
                </li>
              ))}
            </ul>
          </nav>
        )}
        {networks.length === 0 ? null : (
          <ul className="flex flex-wrap gap-2" aria-label={t.footer.social}>
            {networks.map((network) => {
              const Icon = ICONS[network];
              return (
                <li key={network}>
                  <a
                    href={shell.brand.social[network]}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t.footer.networks[network]}
                    className="hover:text-foreground inline-flex size-9 items-center justify-center rounded-md"
                  >
                    <Icon aria-hidden="true" className="size-4" />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
        <p>
          © {year} <bdi dir="auto">{name !== "" ? name : t.brand}</bdi>
        </p>
        <p className="text-xs">{t.footer.poweredBy}</p>
      </div>
    </footer>
  );
}
