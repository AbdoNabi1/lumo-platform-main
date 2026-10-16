"use client";

import * as React from "react";
import { SearchIcon, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { focusRing, focusRingInset } from "../../lib/focus";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

/**
 * Morbeh Command/Search — the one global search interaction, reusable by any Morbeh surface.
 *
 * Implemented as a combobox over a listbox (WAI-ARIA pattern): the input keeps DOM focus
 * while ArrowUp/ArrowDown move an `aria-activedescendant` cursor through the results, so
 * a screen reader announces each option as it is highlighted and Enter activates it.
 * Escape closes, and focus returns to the trigger — that part comes from Dialog.
 */

export interface CommandItem {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly Icon?: LucideIcon;
  readonly onSelect: () => void;
}

export interface CommandGroup {
  readonly id: string;
  readonly heading: string;
  readonly items: readonly CommandItem[];
}

export interface CommandSearchProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly groups: readonly CommandGroup[];
  readonly title: string;
  readonly description: string;
  readonly placeholder: string;
  readonly emptyLabel: string;
}

function matches(item: CommandItem, query: string): boolean {
  if (query === "") return true;
  return item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

export function CommandSearch({
  open,
  onOpenChange,
  groups,
  title,
  description,
  placeholder,
  emptyLabel,
}: CommandSearchProps) {
  const [query, setQuery] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const listboxId = React.useId();

  const visibleGroups = React.useMemo(
    () =>
      groups
        .map((group) => ({ ...group, items: group.items.filter((item) => matches(item, query)) }))
        .filter((group) => group.items.length > 0),
    [groups, query],
  );

  const flat = React.useMemo(() => visibleGroups.flatMap((group) => group.items), [visibleGroups]);

  // Reset when the palette re-opens, and keep the cursor inside the current result set.
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);

  React.useEffect(() => {
    setCursor((current) => (current >= flat.length ? 0 : current));
  }, [flat.length]);

  const activeItem = flat[cursor];

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (flat.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => (current + 1) % flat.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => (current - 1 + flat.length) % flat.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setCursor(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setCursor(flat.length - 1);
    } else if (event.key === "Enter" && activeItem !== undefined) {
      event.preventDefault();
      activeItem.onSelect();
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 p-0" aria-label={title}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>

        <div className="border-border flex items-center gap-3 border-b px-4">
          <SearchIcon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          <input
            type="text"
            role="combobox"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label={title}
            aria-expanded={flat.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={activeItem ? `${listboxId}-${activeItem.id}` : undefined}
            aria-autocomplete="list"
            className={cn(
              "text-md text-foreground placeholder:text-muted-foreground h-12 w-full bg-transparent",
              "focus-visible:outline-none",
            )}
          />
        </div>

        {flat.length === 0 ? (
          <p className="text-muted-foreground px-4 py-8 text-center text-base">{emptyLabel}</p>
        ) : (
          <ul
            id={listboxId}
            role="listbox"
            aria-label={title}
            className="max-h-80 overflow-y-auto p-2"
          >
            {visibleGroups.map((group) => (
              <li key={group.id} role="presentation">
                <p className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                  {group.heading}
                </p>
                <ul role="presentation">
                  {group.items.map((item) => {
                    const selected = item.id === activeItem?.id;
                    const { Icon } = item;
                    return (
                      <li
                        key={item.id}
                        id={`${listboxId}-${item.id}`}
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          item.onSelect();
                          onOpenChange(false);
                        }}
                        className={cn(
                          "flex cursor-default items-center gap-3 rounded-lg px-2.5 py-2 text-base",
                          selected
                            ? "bg-accent text-accent-foreground"
                            : "text-secondary-foreground",
                          focusRingInset,
                        )}
                      >
                        {Icon !== undefined && (
                          <Icon
                            className="text-muted-foreground size-4 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.hint !== undefined && (
                          <span className="text-muted-foreground text-xs">{item.hint}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The topbar affordance that opens the palette: a real button that looks like a field.
 * It is never an `<input>` — a control that opens a dialog must announce itself as a
 * button, not invite typing that goes nowhere.
 */
export function CommandSearchTrigger({
  label,
  shortcut,
  onClick,
  className,
}: {
  readonly label: string;
  readonly shortcut?: string;
  readonly onClick: () => void;
  readonly className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-border/60 bg-muted/60 text-muted-foreground flex h-10 items-center gap-2 rounded-xl border px-4 text-base",
        "duration-(--duration-fast) transition-[border-color,background-color,box-shadow] ease-out",
        "hover:border-border-strong hover:bg-card hover:text-foreground hover:shadow-sm",
        focusRing,
        className,
      )}
    >
      <SearchIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate text-start">{label}</span>
      {shortcut !== undefined && (
        <kbd className="rounded-xs border-border bg-muted text-muted-foreground hidden border px-1.5 py-0.5 font-mono text-xs sm:inline-block">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
