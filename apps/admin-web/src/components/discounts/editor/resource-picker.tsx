"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
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
import type { TargetSearchResult } from "@/app/discounts/actions";
import type { PickedItem } from "@/lib/discounts/form";
import type { Dictionary } from "@/messages/en";
import { ErrorText } from "./inputs";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Shopify's "Search products … [Browse]" field and its dialog. Typing in the field or pressing
 * Browse opens the dialog; results are ticked there and added on Done. `search` is a server action
 * (or, for countries, a local filter), so nothing here calls the runtime API.
 */
export function ResourcePicker({
  title,
  searchLabel,
  selected,
  onChange,
  search,
  t,
  error,
}: {
  readonly title: string;
  readonly searchLabel: string;
  readonly selected: readonly PickedItem[];
  readonly onChange: (items: readonly PickedItem[]) => void;
  readonly search: (query: string) => Promise<TargetSearchResult>;
  readonly t: Dictionary;
  readonly error?: string | undefined;
}) {
  const copy = t.discounts.form;
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<readonly PickedItem[]>(selected);
  const [result, setResult] = useState<TargetSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef(search);
  const dialogSearchInput = useRef<HTMLInputElement>(null);
  searchRef.current = search;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchRef
        .current(query)
        .catch((): TargetSearchResult => ({ outcome: "error" }))
        .then((next) => {
          if (cancelled) return;
          setResult(next);
          setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  function openWith(initialQuery: string): void {
    setQuery(initialQuery);
    setDraft(selected);
    // Drop the previous list so another scope's items are never tickable before this search lands.
    setResult(null);
    setOpen(true);
  }

  function toggle(item: PickedItem, checked: boolean): void {
    setDraft((current) =>
      checked ? [...current, item] : current.filter((picked) => picked.id !== item.id),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
          />
          <Label htmlFor={fieldId} className="sr-only">
            {searchLabel}
          </Label>
          <Input
            id={fieldId}
            type="search"
            placeholder={searchLabel}
            className="ps-9"
            value=""
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : `${fieldId}-error`}
            onChange={(event) => openWith(event.target.value)}
          />
        </div>
        <Button type="button" variant="outline" onClick={() => openWith("")}>
          {copy.browse}
        </Button>
      </div>
      <ErrorText id={`${fieldId}-error`} message={error} />

      {selected.length > 0 && (
        <ul className="border-border divide-border flex flex-col divide-y rounded-xl border">
          {selected.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="truncate">{item.label}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={copy.remove.replace("{name}", item.label)}
                onClick={() => onChange(selected.filter((picked) => picked.id !== item.id))}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-xl"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // Start in the search box (not the first result or the close button).
            event.preventDefault();
            dialogSearchInput.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Input
            type="search"
            aria-label={searchLabel}
            placeholder={searchLabel}
            ref={dialogSearchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="max-h-80 overflow-y-auto" aria-busy={searching || undefined}>
            {result === null || (searching && result.outcome !== "ok") ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {copy.pickerSearching}
              </p>
            ) : result.outcome === "error" ? (
              <p role="alert" className="text-destructive py-6 text-center text-sm">
                {copy.pickerError}
              </p>
            ) : result.items.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">{copy.pickerEmpty}</p>
            ) : (
              <ul className="divide-border flex flex-col divide-y">
                {result.items.map((item) => (
                  <li key={item.id}>
                    <label className="flex items-center gap-3 px-1 py-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-primary size-4"
                        checked={draft.some((picked) => picked.id === item.id)}
                        onChange={(event) =>
                          toggle({ id: item.id, label: item.label }, event.target.checked)
                        }
                      />
                      <span className="flex flex-col">
                        <span>{item.label}</span>
                        {item.detail !== null && (
                          <span className="text-muted-foreground text-xs">{item.detail}</span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {copy.pickerCancel}
            </Button>
            <Button
              type="button"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              {copy.pickerDone}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
