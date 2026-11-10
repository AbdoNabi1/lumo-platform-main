"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDownIcon, MenuIcon, XIcon } from "lucide-react";
import type { MenuEntry } from "@/lib/shell-menus";
import { MenuLink } from "./menu-link";

const LINK = "hover:bg-muted block rounded-sm px-2 py-2 text-sm font-medium";

/**
 * Spec 2.8: the header menu below `md`, a drawer from the inline start (the right in RTL). It is
 * Part 2's only client component, and it holds no data of its own: the entries were resolved and
 * re-validated on the server. Opening moves focus to the close button; Escape, the close button,
 * the overlay and following a link close it, and focus goes back to the trigger.
 */
export function MobileMenu({
  entries,
  previewToken,
  openLabel,
  closeLabel,
  title,
}: {
  readonly entries: readonly MenuEntry[];
  readonly previewToken: string | null;
  readonly openLabel: string;
  readonly closeLabel: string;
  readonly title: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (entries.length === 0) return null;
  // Following a link closes the drawer; focus moves with the navigation, not to the trigger.
  const follow = () => setOpen(false);
  return (
    <div className="md:hidden">
      <button
        ref={triggerRef}
        type="button"
        aria-label={openLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="hover:bg-muted inline-flex size-9 items-center justify-center rounded-md"
      >
        <MenuIcon aria-hidden="true" className="size-5" />
      </button>
      {open ? (
        <>
          <button
            type="button"
            data-overlay=""
            aria-hidden="true"
            tabIndex={-1}
            onClick={close}
            className="fixed inset-0 z-40 bg-black/40"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="bg-background fixed inset-y-0 start-0 z-50 flex w-80 max-w-[85vw] flex-col gap-4 overflow-y-auto p-4 shadow-lg"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id={titleId} className="text-base font-semibold">
                {title}
              </h2>
              <button
                ref={closeRef}
                type="button"
                aria-label={closeLabel}
                onClick={close}
                className="hover:bg-muted inline-flex size-9 items-center justify-center rounded-md"
              >
                <XIcon aria-hidden="true" className="size-5" />
              </button>
            </div>
            <ul className="flex flex-col gap-1">
              {entries.map((entry, index) => (
                <li key={`${index}-${entry.href}`}>
                  {entry.children.length === 0 ? (
                    <MenuLink
                      entry={entry}
                      previewToken={previewToken}
                      className={LINK}
                      onClick={follow}
                    />
                  ) : (
                    <details className="group">
                      <summary
                        className={`${LINK} flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden`}
                      >
                        <bdi dir="auto">{entry.label}</bdi>
                        <ChevronDownIcon
                          aria-hidden="true"
                          className="size-4 transition-transform group-open:rotate-180"
                        />
                      </summary>
                      <ul className="flex flex-col gap-1 ps-4">
                        {[{ ...entry, children: [] }, ...entry.children].map(
                          (child, childIndex) => (
                            <li key={`${childIndex}-${child.href}`}>
                              <MenuLink
                                entry={child}
                                previewToken={previewToken}
                                className={LINK}
                                onClick={follow}
                              />
                            </li>
                          ),
                        )}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
