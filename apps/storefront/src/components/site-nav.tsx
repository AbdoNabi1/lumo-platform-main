import { ChevronDownIcon } from "lucide-react";
import type { MenuEntry } from "@/lib/shell-menus";
import { MenuLink } from "./menu-link";

const LINK = "hover:text-foreground text-muted-foreground text-sm font-medium";

/**
 * Spec 2.8: the desktop header menu, a server component with no JavaScript. An item with children
 * is a `<details>` dropdown whose list starts with the parent's own link, so the parent's page stays
 * reachable. The list opens under its summary at the inline start (`start-0`), so it grows toward
 * the inline end in both directions. Hidden below `md`, where the drawer takes over.
 */
export function SiteNav({
  entries,
  previewToken,
  label,
}: {
  readonly entries: readonly MenuEntry[];
  readonly previewToken: string | null;
  readonly label: string;
}) {
  if (entries.length === 0) return null;
  return (
    <nav aria-label={label} className="hidden md:block">
      <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-3">
        {entries.map((entry, index) => (
          <li key={`${index}-${entry.href}`}>
            {entry.children.length === 0 ? (
              <MenuLink entry={entry} previewToken={previewToken} className={LINK} />
            ) : (
              <details className="group relative">
                <summary
                  className={`${LINK} flex cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden`}
                >
                  <bdi dir="auto">{entry.label}</bdi>
                  <ChevronDownIcon
                    aria-hidden="true"
                    className="size-4 transition-transform group-open:rotate-180"
                  />
                </summary>
                <ul className="bg-background border-border absolute start-0 top-full z-40 mt-2 flex min-w-48 flex-col gap-1 rounded-md border p-2 shadow-md">
                  {[{ ...entry, children: [] }, ...entry.children].map((child, childIndex) => (
                    <li key={`${childIndex}-${child.href}`}>
                      <MenuLink
                        entry={child}
                        previewToken={previewToken}
                        className={`${LINK} hover:bg-muted block rounded-sm px-2 py-1.5`}
                      />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
