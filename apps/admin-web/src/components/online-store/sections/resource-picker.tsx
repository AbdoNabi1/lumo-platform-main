"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { Input, Label } from "@platform/ui";
import { searchLinkTargetsAction } from "@/app/online-store/navigation/actions";
import type { LinkTargetDto, ThemeTargetsDto } from "@/lib/api/online-store";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { LINK_SEARCH_DEBOUNCE_MS } from "../link-picker";
import { errorAria, FieldError } from "./field-shared";

/**
 * Pick a collection (one) or products (up to `max`) by searching the shop's own. Search is a server
 * action, typed text waits `LINK_SEARCH_DEBOUNCE_MS`, the latest answer wins, and a pending search
 * is dropped on unmount. Chosen items are chips: the title is the API's for a reference already in
 * the draft (`targets`), or what was just picked. Each chip has its own remove button; removing
 * one moves focus to the next chip, else the search box.
 */
export function ResourcePicker({
  t,
  id,
  label,
  kind,
  multiple,
  max,
  value,
  targets,
  disabled,
  error,
  onChange,
  onTarget,
}: {
  readonly t: Dictionary;
  /** Kept for the callers' symmetry with the other pickers; titles come from the API as is. */
  readonly locale?: Locale;
  readonly id: string;
  readonly label: string;
  readonly kind: "collection" | "product";
  readonly multiple: boolean;
  readonly max: number;
  readonly value: readonly string[];
  readonly targets: ThemeTargetsDto | null;
  readonly disabled: boolean;
  readonly error?: string | undefined;
  readonly onChange: (ids: readonly string[]) => void;
  readonly onTarget: (kind: "collection" | "product", id: string, title: string) => void;
}) {
  const p = t.onlineStoreSections.picker;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly LinkTargetDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<ReadonlyMap<string, string>>(new Map());
  const requests = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const chipButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const focusAfter = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // Unmounted: no pending timer fires, and an answer still on its way is ignored.
  useEffect(
    () => () => {
      cancel();
      requests.current += 1;
    },
    [cancel],
  );

  const search = useCallback(
    (q: string) => {
      cancel();
      const request = ++requests.current;
      void searchLinkTargetsAction(kind, q).then(
        (found) => {
          if (request !== requests.current) return; // a newer search was sent
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
    [cancel, kind],
  );

  // After a chip is removed: the next chip, else the search box.
  useLayoutEffect(() => {
    const index = focusAfter.current;
    if (index === null) return;
    focusAfter.current = null;
    (chipButtons.current[index] ?? searchBox.current)?.focus();
  });

  const titleOf = (itemId: string): string => {
    const known = picked.get(itemId);
    if (known !== undefined) return known;
    const bucket = targets?.[kind];
    const fromTargets =
      bucket !== undefined && Object.hasOwn(bucket, itemId) ? bucket[itemId]?.title : undefined;
    return fromTargets ?? itemId;
  };

  const full = value.length >= max;
  const hint = kind === "product" ? p.pickOneProduct : p.pickOneCollection;
  const hintId = `${id}-hint`;
  const searchId = `${id}-search`;

  const pick = (target: LinkTargetDto) => {
    if (value.includes(target.id) || (multiple && full)) return;
    setPicked((before) => new Map(before).set(target.id, target.title));
    onTarget(kind, target.id, target.title);
    onChange(multiple ? [...value, target.id] : [target.id]);
  };
  const remove = (index: number) => {
    focusAfter.current = index;
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={searchId}>
        <bdi>{label}</bdi>
      </Label>
      {value.length === 0 ? null : (
        <ul className="flex flex-wrap gap-2">
          {value.map((itemId, index) => {
            const title = titleOf(itemId);
            return (
              <li
                key={itemId}
                className="bg-primary-subtle flex items-center gap-1 rounded-full pe-1 ps-3 text-sm"
              >
                <bdi dir="auto">{title}</bdi>
                <button
                  type="button"
                  ref={(el) => {
                    chipButtons.current[index] = el;
                  }}
                  aria-label={p.removeChip.replace("{name}", title)}
                  disabled={disabled}
                  className="hover:bg-accent rounded-full p-1"
                  onClick={() => remove(index)}
                >
                  <XIcon aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Input
        ref={searchBox}
        id={searchId}
        type="search"
        placeholder={p.search}
        value={query}
        maxLength={100}
        disabled={disabled || (multiple && full)}
        onChange={(e) => {
          const q = e.currentTarget.value;
          setQuery(q);
          cancel();
          if (q.trim() === "") {
            requests.current += 1; // nothing to look for: drop any answer on its way
            setResults([]);
            setLoaded(false);
            return;
          }
          timer.current = setTimeout(() => search(q), LINK_SEARCH_DEBOUNCE_MS);
        }}
        {...errorAria(id, error, hintId)}
      />
      {results.length === 0 ? null : (
        <ul className="border-border flex max-h-56 flex-col overflow-y-auto rounded-xl border">
          {results.map((target) => {
            const chosen = value.includes(target.id);
            return (
              <li key={target.id}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  disabled={disabled || chosen || (multiple && full)}
                  className="hover:bg-accent aria-pressed:bg-primary-subtle flex w-full flex-col items-start px-3 py-2 text-start text-sm"
                  onClick={() => pick(target)}
                >
                  <bdi dir="auto">{target.title}</bdi>
                  <bdi dir="ltr" className="text-muted-foreground text-xs">
                    {target.subtitle}
                  </bdi>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {/* Always rendered, so "no results" is announced when it appears. */}
      <p role="status" aria-live="polite" className="text-muted-foreground text-sm">
        {loaded && results.length === 0 ? p.noResults : ""}
      </p>
      <p id={hintId} className="text-muted-foreground text-xs">
        {value.length === 0 ? hint : ""} {multiple ? p.max.replace("{max}", String(max)) : ""}
      </p>
      <FieldError id={id} error={error} />
    </div>
  );
}
