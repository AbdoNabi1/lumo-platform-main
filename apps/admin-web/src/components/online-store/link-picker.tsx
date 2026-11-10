"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Input, Label, NativeSelect } from "@platform/ui";
import { isPolicyType, POLICY_TITLES, type LinkRef } from "@platform/storefront-content";
import { searchLinkTargetsAction } from "@/app/online-store/navigation/actions";
import type { LinkTargetDto, LinkTargetType } from "@/lib/api/online-store";
import type { Locale } from "@/lib/i18n";
import { linkTargetText } from "@/lib/online-store/menu-copy";
import type { Dictionary } from "@/messages/en";

type Kind = LinkRef["type"];
const KINDS: readonly Kind[] = ["home", "search", "collection", "product", "page", "policy", "url"];
const SEARCHABLE: readonly LinkTargetType[] = ["collection", "product", "page", "policy"];

const searchableKind = (kind: Kind): LinkTargetType | null =>
  SEARCHABLE.find((type) => type === kind) ?? null;

/** A picked target as the link it stores: by id, never by path (a policy by its type). */
function linkOf(type: LinkTargetType, target: LinkTargetDto): LinkRef | null {
  if (type === "policy") return isPolicyType(target.id) ? { type, policy: target.id } : null;
  return { type, id: target.id };
}

/**
 * The menu item's link (spec 2.7): a kind, and for collections, products, pages and policies a
 * search over the shop's own (`searchLinkTargetsAction`, a server action: the browser never calls
 * the runtime API). Each change searches again; the latest answer wins. Policies are named in the
 * admin's language (`POLICY_TITLES`), not with the API's English title. `onChange(null)` means a
 * searchable kind is chosen and nothing is picked yet; a web address is typed in the dialog.
 */
export function LinkPicker({
  t,
  locale,
  value,
  targetTitle = null,
  disabled = false,
  onChange,
  onPick,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly value: LinkRef | null;
  /** The current target's title as the API resolved it (for the chip). */
  readonly targetTitle?: string | null;
  readonly disabled?: boolean;
  readonly onChange: (link: LinkRef | null) => void;
  /** The picked target itself, so the editor can name it before the menu is saved. */
  readonly onPick?: (target: LinkTargetDto) => void;
}) {
  const n = t.onlineStoreNavigation;
  const [kind, setKind] = useState<Kind>(value?.type ?? "home");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly LinkTargetDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pickedTitle, setPickedTitle] = useState<string | null>(null);
  const requests = useRef(0);
  const initialKind = useRef(kind);

  // Stable (refs and state setters only), so the mount effect below runs once.
  const search = useCallback((type: LinkTargetType, q: string) => {
    const request = ++requests.current;
    void searchLinkTargetsAction(type, q).then(
      (found) => {
        if (request !== requests.current) return; // a newer search was sent: drop this answer
        setResults(found);
        setLoaded(true);
      },
      () => {
        if (request !== requests.current) return;
        setResults([]);
        setLoaded(true);
      },
    );
  }, []);

  // Editing an existing catalogue or policy link: list its kind's targets straight away.
  useEffect(() => {
    const type = searchableKind(initialKind.current);
    if (type !== null) search(type, "");
    return () => {
      requests.current += 1; // unmounted: ignore any answer still on its way
    };
  }, [search]);

  const chooseKind = (next: Kind) => {
    setKind(next);
    setQuery("");
    setResults([]);
    setLoaded(false);
    setPickedTitle(null);
    const type = searchableKind(next);
    if (type !== null) {
      onChange(null);
      search(type, "");
    } else if (next === "url") {
      onChange({ type: "url", url: value?.type === "url" ? value.url : "" });
    } else if (next === "home" || next === "search") {
      onChange({ type: next });
    }
  };

  const type = searchableKind(kind);
  const titleOf = (target: LinkTargetDto) =>
    type === "policy" && isPolicyType(target.id) ? POLICY_TITLES[target.id][locale] : target.title;
  // The current target: the one just picked, else the stored link of this kind.
  const chip =
    type === null
      ? null
      : (pickedTitle ??
        (value !== null && value.type === kind
          ? linkTargetText(t, locale, value, targetTitle)
          : null));

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="menu-item-link">{n.link}</Label>
      <NativeSelect
        id="menu-item-link"
        value={kind}
        disabled={disabled}
        onChange={(e) => {
          const next = KINDS.find((k) => k === e.currentTarget.value);
          if (next !== undefined) chooseKind(next);
        }}
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {n.kinds[k]}
          </option>
        ))}
      </NativeSelect>
      {chip === null ? null : (
        <Badge data-testid="link-chip" variant="accent" className="self-start">
          <bdi dir="auto">{chip}</bdi>
        </Badge>
      )}
      {type === null ? null : (
        <>
          <Input
            type="search"
            aria-label={n.searchPlaceholder}
            placeholder={n.searchPlaceholder}
            value={query}
            maxLength={100}
            disabled={disabled}
            onChange={(e) => {
              const q = e.currentTarget.value;
              setQuery(q);
              search(type, q);
            }}
          />
          <div
            role="listbox"
            aria-label={n.kinds[type]}
            className="border-border flex max-h-56 flex-col overflow-y-auto rounded-xl border"
          >
            {results.map((target) => {
              const selected =
                value !== null &&
                ((value.type === "policy" && value.policy === target.id) ||
                  ("id" in value && value.type === type && value.id === target.id));
              return (
                <button
                  key={target.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={disabled}
                  className="hover:bg-accent aria-selected:bg-primary-subtle flex flex-col items-start px-3 py-2 text-start text-sm"
                  onClick={() => {
                    const link = linkOf(type, target);
                    if (link === null) return;
                    setPickedTitle(titleOf(target));
                    onChange(link);
                    onPick?.({ ...target, title: titleOf(target) });
                  }}
                >
                  <bdi dir="auto">{titleOf(target)}</bdi>
                  <bdi dir="ltr" className="text-muted-foreground text-xs">
                    {target.subtitle}
                  </bdi>
                </button>
              );
            })}
            {loaded && results.length === 0 ? (
              <p className="text-muted-foreground px-3 py-2 text-sm">{n.noResults}</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
