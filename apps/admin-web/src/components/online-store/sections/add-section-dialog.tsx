"use client";

import { useId } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@platform/ui";
import {
  SECTION_DEFINITIONS,
  type SectionPlacement,
  type SectionType,
  type ThemeDocument,
} from "@platform/storefront-content";
import type { SiteType } from "@/lib/api/store-settings";
import type { Locale } from "@/lib/i18n";
import { sectionTypeAllowed } from "@/lib/online-store/section-availability";
import { canAddSection } from "@/lib/online-store/section-tree";
import type { Dictionary } from "@/messages/en";
import { SECTION_ICON_COMPONENTS } from "./section-icons";

/**
 * The picker behind "Add section" and "Add announcement" (spec 3.5): one button per section type
 * of the placement, with its icon, name and one-line description. A type the page cannot take
 * (25 sections, or its own per-page limit) is disabled, and the reason is its accessible
 * description. The dialog is portalled by `@platform/ui`, so a `backdrop-blur` ancestor can't trap it.
 */
export function AddSectionDialog({
  t,
  locale,
  open,
  onOpenChange,
  doc,
  placement,
  siteType,
  onAdd,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly doc: ThemeDocument;
  readonly placement: SectionPlacement;
  /** Decides which types are offered; `null` when the shop's site type could not be read. */
  readonly siteType: SiteType | null;
  readonly onAdd: (type: SectionType) => void;
}) {
  const s = t.onlineStoreSections;
  const idBase = useId();
  const descriptions: Readonly<Record<string, string>> = s.descriptions;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[85dvh] max-w-lg overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{s.pickerTitle}</DialogTitle>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {SECTION_DEFINITIONS.filter(
            (definition) =>
              definition.placement === placement && sectionTypeAllowed(definition.type, siteType),
          ).map((definition) => {
            const Icon = SECTION_ICON_COMPONENTS[definition.icon];
            const block = canAddSection(doc, definition.type);
            const reasonId = `${idBase}-${definition.type}-reason`;
            const reason =
              block === "limit"
                ? s.limitReached
                : block === "type_limit"
                  ? s.typeLimit.replace("{max}", String(definition.maxPerPage ?? 1))
                  : null;
            return (
              <li key={definition.type}>
                <button
                  type="button"
                  data-section-type={definition.type}
                  disabled={reason !== null}
                  aria-describedby={reason === null ? undefined : reasonId}
                  className="border-border hover:bg-accent focus-visible:ring-ring flex w-full items-start gap-3 rounded-xl border p-3 text-start focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => {
                    onAdd(definition.type);
                    onOpenChange(false);
                  }}
                >
                  <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{definition.labels[locale]}</span>
                    <span className="text-muted-foreground text-sm">
                      {descriptions[definition.type] ?? ""}
                    </span>
                  </span>
                </button>
                {reason === null ? null : (
                  <p id={reasonId} className="text-muted-foreground mt-1 px-3 text-xs">
                    {reason}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
