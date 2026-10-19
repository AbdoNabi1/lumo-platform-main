"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { XIcon } from "lucide-react";
import { Badge, Input, Label } from "@platform/ui";
import { hasTag, splitTagInput } from "@/lib/orders/order-tags";
import type { Dictionary } from "@/messages/en";

const SUGGEST_DEBOUNCE_MS = 200;

/** Tags as chips; with `onRemove`, each chip has a × (logical spacing, so it mirrors in Arabic). */
export function TagChips({
  tags,
  onRemove,
  disabled = false,
  t,
}: {
  readonly tags: readonly string[];
  readonly onRemove?: ((tag: string) => void) | undefined;
  readonly disabled?: boolean;
  readonly t: Dictionary;
}) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t.orderTags.listLabel}>
      {tags.map((tag) => (
        <li key={tag}>
          <Badge variant="neutral" className="gap-1">
            <span dir="auto">{tag}</span>
            {onRemove !== undefined && (
              <button
                type="button"
                className="hover:text-foreground focus-visible:ring-ring -me-0.5 ms-0.5 rounded focus-visible:outline-none focus-visible:ring-2"
                aria-label={t.orderTags.remove.replace("{tag}", () => tag)}
                disabled={disabled}
                onClick={() => onRemove(tag)}
              >
                <XIcon aria-hidden="true" className="size-3" />
              </button>
            )}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * Shopify's tag input: Enter or a comma adds what was typed (a comma splits, case-insensitive
 * duplicates and tags the list already has are dropped, over-long tags are refused with a message),
 * × removes, and — when `suggest` is given — the shop's matching tags are offered while typing.
 */
export function TagInput({
  label,
  tags,
  onAdd,
  onRemove,
  suggest,
  disabled = false,
  t,
}: {
  readonly label: string;
  readonly tags: readonly string[];
  readonly onAdd: (tags: readonly string[]) => void;
  readonly onRemove: (tag: string) => void;
  readonly suggest?: ((prefix: string) => Promise<readonly string[]>) | undefined;
  readonly disabled?: boolean;
  readonly t: Dictionary;
}) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  const [tooLong, setTooLong] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (suggest === undefined) return undefined;
    if (timer.current !== undefined) clearTimeout(timer.current);
    const prefix = value.trim();
    if (prefix.length === 0) {
      setSuggestions([]);
      return undefined;
    }
    let cancelled = false;
    timer.current = setTimeout(() => {
      suggest(prefix)
        .then((found) => {
          if (!cancelled) setSuggestions(found.filter((tag) => !hasTag(tags, tag)));
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      if (timer.current !== undefined) clearTimeout(timer.current);
    };
  }, [value, suggest, tags]);

  /** Adds the good tags; answers the entries that were too long, so the caller can keep them. */
  const commit = (raw: string): readonly string[] => {
    const split = splitTagInput(raw);
    setTooLong(split.tooLong.length > 0);
    const fresh = split.tags.filter((tag) => !hasTag(tags, tag));
    if (fresh.length > 0) onAdd(fresh);
    return split.tooLong;
  };

  const onChange = (next: string) => {
    const cut = Math.max(next.lastIndexOf(","), next.lastIndexOf("،"));
    if (cut >= 0) {
      commit(next.slice(0, cut));
      setValue(next.slice(cut + 1));
      return;
    }
    setValue(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    // An over-long tag stays in the box (with the message) so it can be shortened, not retyped.
    const rejected = commit(value);
    setValue(rejected.join(", "));
  };

  const pick = (tag: string) => {
    onAdd([tag]);
    setValue("");
    setSuggestions([]);
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        value={value}
        readOnly={disabled}
        autoComplete="off"
        placeholder={t.orderTags.placeholder}
        aria-describedby={tooLong ? `${inputId}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {tooLong && (
        <p id={`${inputId}-error`} role="alert" className="text-destructive text-sm">
          {t.orderTags.tooLong}
        </p>
      )}
      {suggestions.length > 0 && (
        <ul
          aria-label={t.orderTags.suggestions}
          className="border-border bg-card flex flex-col rounded-xl border p-1"
        >
          {suggestions.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                className="hover:bg-muted focus-visible:ring-ring w-full rounded-lg px-2 py-1 text-start text-sm focus-visible:outline-none focus-visible:ring-2"
                onClick={() => pick(tag)}
              >
                {tag}
              </button>
            </li>
          ))}
        </ul>
      )}
      {tags.length > 0 && <TagChips tags={tags} onRemove={onRemove} disabled={disabled} t={t} />}
    </div>
  );
}
