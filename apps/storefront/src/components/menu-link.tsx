import Link from "next/link";
import { safeHref } from "@platform/storefront-content";
import type { MenuEntry } from "@/lib/shell-menus";
import { withPreview } from "@/lib/preview-href";

/**
 * One menu link (spec 2.8, Global constraint 6). The href is checked again here and only
 * `safeHref`'s output is rendered (preflight 3): a same-site path, which is canonical and starts
 * with exactly one `/`, goes through `next/link` and keeps the preview token; `https:` opens in a
 * new tab without an opener or a referrer; `mailto:` and `tel:` are plain links. Whether a link is
 * external is decided by the href itself, never by the entry's flag. A refused href renders its
 * label as text. The label is always isolated (`<bdi dir="auto">`).
 */
export function MenuLink({
  entry,
  previewToken,
  className,
  onClick,
}: {
  readonly entry: MenuEntry;
  readonly previewToken: string | null;
  readonly className?: string;
  readonly onClick?: () => void;
}) {
  const label = <bdi dir="auto">{entry.label}</bdi>;
  const safe = safeHref(entry.href);
  if (safe === null) return <span className={className}>{label}</span>;
  if (safe.href.startsWith("/")) {
    return (
      <Link href={withPreview(safe.href, previewToken)} className={className} onClick={onClick}>
        {label}
      </Link>
    );
  }
  if (safe.external) {
    return (
      <a
        href={safe.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className={className}
        onClick={onClick}
      >
        {label}
      </a>
    );
  }
  return (
    <a href={safe.href} className={className} onClick={onClick}>
      {label}
    </a>
  );
}
