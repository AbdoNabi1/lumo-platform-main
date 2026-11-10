"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@platform/ui";
import {
  LINK_URL_MAX,
  MENU_LABEL_MAX,
  normalizeExternalUrl,
  type LinkRef,
  type LocalizedText,
} from "@platform/storefront-content";
import type { Locale } from "@/lib/i18n";
import type { EditableItem } from "@/lib/online-store/menu-tree";
import type { Dictionary } from "@/messages/en";
import { LinkPicker } from "./link-picker";

/** A fresh item id: the validator wants a UUID (`crypto.randomUUID`). */
function newItemId(): string {
  return globalThis.crypto.randomUUID();
}

/** Trimmed labels, an empty one left out (absent means "not written"). */
function labelOf(ar: string, en: string): LocalizedText {
  const label: { ar?: string; en?: string } = {};
  if (ar.trim() !== "") label.ar = ar.trim();
  if (en.trim() !== "") label.en = en.trim();
  return label;
}

const sameLink = (a: LinkRef, b: LinkRef) => JSON.stringify(a) === JSON.stringify(b);

interface Errors {
  readonly label?: string;
  readonly link?: string;
  readonly url?: string;
}

/**
 * Add or edit one menu item (spec 2.7): a label in Arabic and/or English, and where it links. A web
 * address is checked on Done with the shared `normalizeExternalUrl` and STORED normalised; anything
 * but `https:`, `mailto:` and `tel:` is refused inline. The parent remounts this per opening (a
 * `key`), so it always starts from the item it was given.
 */
export function MenuItemDialog({
  t,
  locale,
  title,
  item,
  onCancel,
  onDone,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly title: string;
  /** The item being edited, or null for a new one. */
  readonly item: EditableItem | null;
  readonly onCancel: () => void;
  readonly onDone: (item: EditableItem) => void;
}) {
  const n = t.onlineStoreNavigation;
  const [labelAr, setLabelAr] = useState(item?.label.ar ?? "");
  const [labelEn, setLabelEn] = useState(item?.label.en ?? "");
  const [link, setLink] = useState<LinkRef | null>(item?.link ?? { type: "home" });
  const [url, setUrl] = useState(item?.link.type === "url" ? item.link.url : "");
  const [pickedTitle, setPickedTitle] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});

  const done = () => {
    const label = labelOf(labelAr, labelEn);
    const found: { label?: string; link?: string; url?: string } = {};
    if (label.ar === undefined && label.en === undefined) found.label = n.labelRequired;
    let finalLink: LinkRef | null = link;
    if (link === null) found.link = n.invalidLink;
    else if (link.type === "url") {
      const normalized = normalizeExternalUrl(url.trim());
      if (normalized === null) found.url = n.urlError;
      else finalLink = { type: "url", url: normalized };
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || finalLink === null) return;
    // An unchanged link keeps what the API said about it; a new one is live until the next read.
    const kept = item !== null && sameLink(item.link, finalLink);
    onDone({
      id: item?.id ?? newItemId(),
      label,
      link: finalLink,
      children: item?.children ?? [],
      broken: kept ? item.broken : false,
      targetTitle: kept ? item.targetTitle : pickedTitle,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="menu-item-label-ar">{n.labelAr}</Label>
              <Input
                id="menu-item-label-ar"
                dir="auto"
                lang="ar"
                maxLength={MENU_LABEL_MAX}
                value={labelAr}
                aria-invalid={errors.label === undefined ? undefined : true}
                aria-describedby={errors.label === undefined ? undefined : "menu-item-label-error"}
                onChange={(e) => setLabelAr(e.currentTarget.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="menu-item-label-en">{n.labelEn}</Label>
              <Input
                id="menu-item-label-en"
                dir="auto"
                lang="en"
                maxLength={MENU_LABEL_MAX}
                value={labelEn}
                aria-invalid={errors.label === undefined ? undefined : true}
                aria-describedby={errors.label === undefined ? undefined : "menu-item-label-error"}
                onChange={(e) => setLabelEn(e.currentTarget.value)}
              />
            </div>
          </div>
          {errors.label === undefined ? null : (
            <p id="menu-item-label-error" className="text-destructive text-xs">
              {errors.label}
            </p>
          )}
          <LinkPicker
            t={t}
            locale={locale}
            value={link}
            targetTitle={item?.targetTitle ?? null}
            onChange={(next) => {
              setLink(next);
              setPickedTitle(null);
            }}
            onPick={(target) => setPickedTitle(target.title)}
            invalid={errors.link !== undefined}
            describedBy={errors.link === undefined ? undefined : "menu-item-link-error"}
          />
          {errors.link === undefined ? null : (
            <p id="menu-item-link-error" className="text-destructive text-xs">
              {errors.link}
            </p>
          )}
          {link?.type === "url" ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="menu-item-url">{n.webAddress}</Label>
              <Input
                id="menu-item-url"
                dir="ltr"
                inputMode="url"
                placeholder="https://"
                maxLength={LINK_URL_MAX}
                value={url}
                aria-invalid={errors.url === undefined ? undefined : true}
                aria-describedby={errors.url === undefined ? undefined : "menu-item-url-error"}
                onChange={(e) => setUrl(e.currentTarget.value)}
              />
              {errors.url === undefined ? null : (
                <p id="menu-item-url-error" className="text-destructive text-xs">
                  {errors.url}
                </p>
              )}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {n.cancel}
          </Button>
          <Button type="button" onClick={done}>
            {n.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
