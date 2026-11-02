import {
  FacebookIcon,
  InstagramIcon,
  LinkIcon,
  TwitterIcon,
  YoutubeIcon,
  type LucideIcon,
} from "lucide-react";
import { pickText, SOCIAL_NETWORKS, type SocialNetwork } from "@platform/storefront-content";
import type { Locale } from "@/lib/i18n";
import type { StorefrontShell } from "@/lib/online-store";
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

/** Spec 1.12: store name, footer note, social icons for the set fields, ©, "Powered by مربح". */
export function SiteFooter({
  t,
  locale,
  shell,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly shell: StorefrontShell;
}) {
  const name = shell.storeName.trim();
  const note = pickText(shell.footer.note, locale);
  const year = new Intl.NumberFormat(locale, { useGrouping: false }).format(
    new Date().getFullYear(),
  );
  const networks = shell.footer.showSocial
    ? SOCIAL_NETWORKS.filter((n) => shell.brand.social[n] !== undefined)
    : [];
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
