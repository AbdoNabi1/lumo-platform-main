"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CirclePlusIcon, PlusIcon } from "lucide-react";
import { Button, Input, Separator } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/**
 * Plan 2B-3 — Shopify's "add options" menu: a button that opens a small panel with a search box,
 * the recommended option names (Size, Color, …) that are not already used, and "Create custom
 * option". Choosing one hands the chosen name to the caller (`onPick("")` for a custom option with
 * nothing typed, which the caller opens unnamed). Escape and a press outside close it and, when the
 * focus was inside the panel, give it back to the button.
 */
export function OptionNamePicker({
  used,
  onPick,
  t,
  triggerLabel,
  disabled = false,
}: {
  /** Option names already on the product; matched without regard to case or surrounding spaces. */
  readonly used: readonly string[];
  readonly onPick: (name: string) => void;
  readonly t: Dictionary;
  readonly triggerLabel: string;
  readonly disabled?: boolean;
}) {
  const editor = t.productEditor;
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);

  const close = useCallback((restoreFocus: boolean): void => {
    setOpen(false);
    setSearch("");
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // A press outside closes the panel; focus goes back to the button only if it was inside.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      const wrapper = wrapperRef.current;
      if (wrapper === null || wrapper.contains(event.target as Node)) return;
      const focusWasInside = wrapper.contains(document.activeElement);
      close(focusWasInside);
    }
    // Escape closes it from anywhere inside the panel or on its button.
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      if (wrapperRef.current?.contains(event.target as Node) !== true) return;
      event.stopPropagation();
      close(true);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // The search box gets the cursor once, when the panel opens.
  useEffect(() => {
    if (open && focusSearch.current) {
      focusSearch.current = false;
      searchRef.current?.focus();
    }
  }, [open]);

  const taken = new Set(used.map((name) => name.trim().toLowerCase()));
  const query = search.trim().toLowerCase();
  const choices = editor.recommendedOptions.filter(
    (name) => !taken.has(name.toLowerCase()) && name.toLowerCase().includes(query),
  );

  function pick(name: string): void {
    close(false);
    onPick(name);
  }

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (open) {
            close(false);
            return;
          }
          focusSearch.current = true;
          setOpen(true);
        }}
      >
        <PlusIcon aria-hidden="true" />
        {triggerLabel}
      </Button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={editor.addOptions}
          className="border-border bg-card absolute start-0 top-full z-20 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-xl border p-2 shadow-lg"
        >
          <Input
            ref={searchRef}
            type="search"
            aria-label={editor.searchOptions}
            placeholder={editor.searchOptions}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              // Enter would submit the whole page; here it picks nothing.
              if (event.key === "Enter") event.preventDefault();
            }}
          />

          {choices.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <p className="text-muted-foreground px-2 py-1 text-xs font-medium">
                {editor.recommended}
              </p>
              {choices.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="hover:bg-muted focus-visible:bg-muted rounded-md px-2 py-1.5 text-start text-sm"
                  onClick={() => pick(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          <Separator />
          <button
            type="button"
            className="hover:bg-muted focus-visible:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm"
            onClick={() => pick(search.trim())}
          >
            <CirclePlusIcon className="size-4" aria-hidden="true" />
            {editor.createCustomOption}
          </button>
        </div>
      )}
    </div>
  );
}
