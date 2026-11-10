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

/** Typing waits this long before searching (review M-5): one server action per pause, not per key. */
export const LINK_SEARCH_DEBOUNCE_MS = 250;

/**
 * The menu item's link (spec 2.7): a kind, and for collections, products, pages and policies a
 * search over the shop's own (`searchLinkTargetsAction`, a server action: the browser never calls
 * the runtime API). Typing is debounced; choosing a kind searches at once; the latest answer wins.
 * Results are a plain list of buttons (one tab stop each, `aria-pressed` on the chosen one), and
 * "no results" is announced from a live region beside the list. Policies are named in the admin's
 * language (`POLICY_TITLES`), not with the API's English title. `onChange(null)` means a searchable
 * kind is chosen and nothing is picked yet; a web address is typed in the dialog.
 */
export function LinkPicker({
  t,
  locale,
  value,
  targetTitle = null,
  disabled = false,
  invalid = false,
  describedBy,
  onChange,
  onPick,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly value: LinkRef | null;
  /** The current target's title as the API resolved it (for the chip). */
  readonly targetTitle?: string | null;
  readonly disabled?: boolean;
  /** The dialog's link error: marks the kind select invalid and points it at the message. */
  readonly invalid?: boolean;
  readonly describedBy?: string;
  readonly onChange: (link: LinkRef | null) => void;
  /** The picked target itself, so the editor can name it before the menu is saved. */
  readonly onPick?: (target: LinkTargetDto) => void;
}) {
  const n = t.onlineStoreNavigation;
  const [kind, setKind] = useState<Kind>(value?.type ?? "home");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly LinkTargetDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<{ id: string; title: string } | null>(null);
  const requests = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialKind = useRef(kind);

  const cancelPending = useCallback(() => {
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = null;
  }, []);

  // Stable (refs and state setters only), so the mount effect below runs once.
  const search = useCallback(
    (type: LinkTargetType, q: string) => {
      cancelPending();
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
    },
    [cancelPending],
  );

  // Editing an existing catalogue or policy link: list its kind's targets straight away.
  useEffect(() => {
    const type = searchableKind(initialKind.current);
    if (type !== null) search(type, "");
    return () => {
      cancelPending();
      requests.current += 1; // unmounted: ignore any answer still on its way
    };
  }, [search, cancelPending]);

  const chooseKind = (next: Kind) => {
    setKind(next);
    setQuery("");
    setResults([]);
    setLoaded(false);
    setPicked(null);
    cancelPending();
    requests.current += 1; // the old kind's answer, if any, no longer applies
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
  const storedId =
    value === null || value.type !== kind
      ? null
      : value.type === "policy"
        ? value.policy
        : "id" in value
          ? value.id
          : null;
  const chosenId = picked?.id ?? storedId;
  // The current target: the one just picked, else the stored link of this kind.
  const chip =
    type === null
      ? null
      : (picked?.title ??
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
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
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
              cancelPending();
              debounce.current = setTimeout(() => search(type, q), LINK_SEARCH_DEBOUNCE_MS);
            }}
          />
          {results.length === 0 ? null : (
            <ul
              aria-label={n.kinds[type]}
              className="border-border flex max-h-56 flex-col overflow-y-auto rounded-xl border"
            >
              {results.map((target) => (
                <li key={target.id}>
                  <button
                    type="button"
                    aria-pressed={chosenId === target.id}
                    disabled={disabled}
                    className="hover:bg-accent aria-pressed:bg-primary-subtle flex w-full flex-col items-start px-3 py-2 text-start text-sm"
                    onClick={() => {
                      const link = linkOf(type, target);
                      if (link === null) return;
                      setPicked({ id: target.id, title: titleOf(target) });
                      onChange(link);
                      onPick?.({ ...target, title: titleOf(target) });
                    }}
                  >
                    <bdi dir="auto">{titleOf(target)}</bdi>
                    <bdi dir="ltr" className="text-muted-foreground text-xs">
                      {target.subtitle}
                    </bdi>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* Always rendered, so the announcement is heard when the text appears. */}
          <p role="status" aria-live="polite" className="text-muted-foreground text-sm">
            {loaded && results.length === 0 ? n.noResults : ""}
          </p>
        </>
      )}
    </div>
  );
}
