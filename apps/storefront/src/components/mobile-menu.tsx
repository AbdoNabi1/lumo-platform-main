"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, MenuIcon, XIcon } from "lucide-react";
import type { MenuEntry } from "@/lib/shell-menus";
import { MenuLink } from "./menu-link";

const LINK = "hover:bg-muted block rounded-sm px-2 py-2 text-sm font-medium";
const FOCUSABLE =
  'a[href], button:not([disabled]), summary, input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** False on the server and during hydration, true once hydrated: the portal needs `document`. */
const noSubscription = () => () => {};
const useHydrated = () =>
  useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

/** What Tab can reach inside `root`: a closed `<details>` hides all but its own summary. */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
    const closed = element.closest("details:not([open])");
    if (closed === null) return true;
    const summary = closed.querySelector(":scope > summary");
    return summary !== null && summary.contains(element);
  });
}

/**
 * Spec 2.8: the header menu below `md`, a drawer from the inline start (the right in RTL). It is
 * Part 2's only client component, and it holds no data of its own: the entries were resolved and
 * re-validated on the server.
 *
 * The drawer and its overlay are portalled into `document.body` (review I-1): the header container's
 * `backdrop-blur` makes it the containing block of any `fixed` descendant, which would confine the
 * drawer to the header bar. While open it is modal (review I-2, M-1): everything else in the body is
 * `inert`, Tab and Shift+Tab cycle inside it, and the page does not scroll. Opening moves focus to
 * the close button. Escape, the close button and the overlay close it and return focus to the
 * trigger, after the page is interactive again; following a link closes it and lets the navigation
 * move focus.
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
  const hydrated = useHydrated();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  /** Whether closing hands focus back to the trigger (not after following a link). */
  const refocusTrigger = useRef(true);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || dialog === null) return;
    const trigger = triggerRef.current;
    const overlay = overlayRef.current;
    const madeInert: Element[] = [];
    for (const element of Array.from(document.body.children)) {
      if (element === dialog || element === overlay || element.hasAttribute("inert")) continue;
      element.setAttribute("inert", "");
      madeInert.push(element);
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    refocusTrigger.current = true;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        refocusTrigger.current = true;
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const reachable = focusableIn(dialog);
      const first = reachable[0];
      const last = reachable.at(-1);
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      for (const element of madeInert) element.removeAttribute("inert");
      document.body.style.overflow = overflow;
      // Only now is the trigger focusable again: an inert element cannot take focus.
      if (refocusTrigger.current && trigger?.isConnected === true) trigger.focus();
    };
  }, [open, hydrated]);

  if (entries.length === 0) return null;
  const close = () => {
    refocusTrigger.current = true;
    setOpen(false);
  };
  const follow = () => {
    refocusTrigger.current = false;
    setOpen(false);
  };
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
      {open && hydrated
        ? createPortal(
            <>
              <button
                ref={overlayRef}
                type="button"
                data-overlay=""
                aria-hidden="true"
                tabIndex={-1}
                onClick={close}
                className="fixed inset-0 z-40 bg-black/40"
              />
              <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="bg-background fixed inset-y-0 start-0 z-50 flex w-80 max-w-[85vw] flex-col gap-4 overflow-y-auto overscroll-contain p-4 shadow-lg"
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
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
