"use client";

import { useId, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  cn,
} from "@platform/ui";

/**
 * Plan 2C-4 — the Shopify-style primitives of the product editor. Each is a thin wrapper over a
 * native input, so `form="product-editor"` keeps joining the page form, and none of them renames a
 * field: what a card posts is decided by its `name`, as before.
 */

type SwitchProps = Omit<
  ComponentProps<"input">,
  "type" | "role" | "onChange" | "className" | "children"
> & {
  readonly label: string;
  readonly className?: string | undefined;
  readonly onCheckedChange?: ((checked: boolean) => void) | undefined;
};

/** An on/off switch: a checkbox with `role="switch"`, so it posts "on" while on and nothing off. */
export function Switch({ label, className, onCheckedChange, ...props }: SwitchProps) {
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-center gap-2 text-sm", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="relative inline-flex">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          onChange={(event) => onCheckedChange?.(event.target.checked)}
          {...props}
          id={id}
        />
        <span className="bg-muted peer-checked:bg-foreground peer-focus-visible:ring-ring h-5 w-9 rounded-full transition-colors peer-focus-visible:ring-2" />
        <span className="bg-background absolute start-0.5 top-0.5 size-4 rounded-full shadow transition-transform peer-checked:translate-x-4 rtl:peer-checked:-translate-x-4" />
      </span>
    </label>
  );
}

/** The row of chips under a card; each chip opens the panel it controls. */
export function ChipRow({ children }: { readonly children: ReactNode }) {
  return <div className="border-border flex flex-wrap gap-2 border-t pt-3">{children}</div>;
}

export function Chip({
  label,
  value,
  expanded,
  onToggle,
  controls,
}: {
  readonly label: string;
  /** The field's current value, shown after a middle dot: "Charge tax · Yes". */
  readonly value?: string | undefined;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /** The `id` of the panel this chip opens. */
  readonly controls: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        "border-border inline-flex h-7 items-center gap-1 rounded-full border px-3 text-xs",
        expanded ? "bg-muted" : "bg-card hover:bg-muted",
      )}
    >
      <span>{label}</span>
      {value !== undefined && (
        <>
          {" "}
          <span className="text-muted-foreground">· {value}</span>
        </>
      )}
    </button>
  );
}

/**
 * What a chip opens. Hidden, never unmounted: a field behind a closed chip is still in the form and
 * still saved, the same way the weight row survives its switch being turned off.
 */
export function ChipPanel({
  id,
  open,
  children,
}: {
  readonly id: string;
  readonly open: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div id={id} hidden={!open} className="flex flex-col gap-3">
      {children}
    </div>
  );
}

function currencySymbol(locale: string, currency: string): string {
  try {
    const symbol = new Intl.NumberFormat(locale, { style: "currency", currency })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value;
    return symbol ?? currency;
  } catch {
    // An unknown currency code makes Intl throw; the code itself is the honest prefix.
    return currency;
  }
}

/** A decimal input with the currency symbol as a non-editable prefix at the start edge. */
export function MoneyInput({
  name,
  currency,
  locale,
  value,
  onValueChange,
  form,
  invalid,
  describedBy,
  id,
  label,
}: {
  readonly name: string;
  readonly currency: string;
  readonly locale: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly form?: string | undefined;
  readonly invalid?: boolean | undefined;
  readonly describedBy?: string | undefined;
  readonly id?: string | undefined;
  /** The accessible name; a visible `<Label>` for the same `id` may repeat it. */
  readonly label: string;
}) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm"
      >
        {currencySymbol(locale, currency)}
      </span>
      <Input
        id={id}
        name={name}
        form={form}
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid === true ? true : undefined}
        aria-describedby={describedBy}
        className="ps-12"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
    </div>
  );
}

const TAG_SEPARATORS = /[,،]/;

/**
 * Tags as removable chips. Enter or a comma (`,` or the Arabic `،`) adds one, Backspace in the empty
 * input takes the last one back, a half-typed tag is kept when the input loses focus. The chips
 * post as one hidden `name` value, comma-joined, which is what the save action already parses.
 */
export function TagsInput({
  name,
  defaultTags,
  form,
  label,
  hint,
  error,
  removeLabel,
}: {
  readonly name: string;
  readonly defaultTags: readonly string[];
  readonly form?: string | undefined;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  /** Contains `{tag}`, replaced by the tag being removed: "Remove {tag}". */
  readonly removeLabel: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [error === undefined ? null : errorId, hint === undefined ? null : hintId]
      .filter((value) => value !== null)
      .join(" ") || undefined;
  const [tags, setTags] = useState<readonly string[]>(defaultTags);
  const [draft, setDraft] = useState("");

  function commit(raw: string): void {
    const next = [...tags];
    for (const part of raw.split(TAG_SEPARATORS)) {
      const tag = part.trim();
      if (tag.length === 0) continue;
      if (next.some((existing) => existing.toLowerCase() === tag.toLowerCase())) continue;
      next.push(tag);
    }
    if (next.length !== tags.length) setTags(next);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      // Enter is "add this tag", never "submit the page".
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && draft.length === 0 && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="border-input bg-card focus-within:ring-ring flex min-h-9 flex-wrap items-center gap-1.5 rounded-xl border px-2 py-1.5 focus-within:ring-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className="bg-muted inline-flex items-center gap-1 rounded-full py-0.5 pe-1 ps-2.5 text-xs"
          >
            {tag}
            <button
              type="button"
              aria-label={removeLabel.replace("{tag}", tag)}
              onClick={() => setTags(tags.filter((existing) => existing !== tag))}
              className="hover:bg-border inline-flex size-4 items-center justify-center rounded-full"
            >
              <XIcon aria-hidden="true" className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={draft}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none"
          onChange={(event) => {
            const typed = event.target.value;
            if (TAG_SEPARATORS.test(typed)) commit(typed);
            else setDraft(typed);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft.trim().length > 0) commit(draft);
          }}
        />
      </div>
      <input type="hidden" name={name} form={form} value={tags.join(", ")} />
      {hint !== undefined && (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

export interface StatusOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

/**
 * A menu of options that each explain themselves, as Shopify's status list does. Radix gives the
 * keyboard behaviour; the chosen value posts through a hidden input.
 */
export function StatusPicker({
  name,
  value,
  onChange,
  options,
  form,
  label,
}: {
  readonly name: string;
  readonly value: string;
  readonly onChange?: ((value: string) => void) | undefined;
  readonly options: readonly StatusOption[];
  readonly form?: string | undefined;
  readonly label: string;
}) {
  const [current, setCurrent] = useState(value);
  const currentOption = options.find((option) => option.value === current) ?? options[0];

  function choose(next: string): void {
    setCurrent(next);
    onChange?.(next);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-between">
            <span>
              <span className="sr-only">{label}: </span>
              {currentOption?.label}
            </span>
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              role="menuitemradio"
              aria-checked={option.value === current}
              onSelect={() => choose(option.value)}
              className="items-start"
            >
              <CheckIcon
                aria-hidden="true"
                className={cn(
                  "mt-0.5 size-4",
                  option.value === current ? "opacity-100" : "opacity-0",
                )}
              />
              <span className="flex flex-col">
                <span className="font-medium">{option.label}</span>
                <span className="text-muted-foreground text-xs">{option.description}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <input type="hidden" name={name} form={form} value={current} />
    </>
  );
}
