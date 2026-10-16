"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Badge, Button, Input, Label } from "@platform/ui";
import { MAX_OPTIONS, type MatrixOption } from "@/lib/products/variant-matrix";
import type { Dictionary } from "@/messages/en";
import { PRODUCT_FORM_ID } from "./field";
import { OptionNamePicker } from "./option-name-picker";

interface ValueRow {
  readonly key: number;
  readonly text: string;
}

interface OptionRow {
  readonly key: number;
  readonly name: string;
  readonly values: readonly ValueRow[];
  readonly editing: boolean;
}

/** Keeps exactly one empty value at the end, so there is always a field to type the next one in. */
function withTrailingBlank(values: readonly ValueRow[], nextKey: () => number): ValueRow[] {
  const filled = [...values];
  while (filled.length > 0 && filled[filled.length - 1]!.text.trim().length === 0) filled.pop();
  return [...filled, { key: nextKey(), text: "" }];
}

function filledValues(row: OptionRow): string[] {
  return row.values.map((value) => value.text.trim()).filter((text) => text.length > 0);
}

/** Another option with the same name (case and spaces ignored) — the one this row merges into. */
function sameNameAs(rows: readonly OptionRow[], row: OptionRow): OptionRow | undefined {
  const name = row.name.trim().toLowerCase();
  if (name.length === 0) return undefined;
  return rows.find((other) => other.key !== row.key && other.name.trim().toLowerCase() === name);
}

function optionsOf(rows: readonly OptionRow[]): MatrixOption[] {
  return rows
    .map((row) => ({ name: row.name.trim(), values: filledValues(row) }))
    .filter((option) => option.name.length > 0 || option.values.length > 0);
}

/**
 * Plan 2B-2 — the Shopify option editor. Each value has its own field and the next one appears as
 * you type; "Done" folds an option into its name and value chips. Every option, folded or not,
 * submits with the page's one Save: `optionName-<i>` and one `optionValue-<i>` per value, joined
 * to the page form with `form=`.
 */
export function OptionsEditor({
  initial,
  onChange,
  t,
}: {
  readonly initial: readonly MatrixOption[];
  readonly onChange: (options: MatrixOption[]) => void;
  readonly t: Dictionary;
}) {
  const editor = t.productEditor;
  const counter = useRef(0);
  const nextKey = (): number => {
    counter.current += 1;
    return counter.current;
  };
  const listId = useId();
  const [focusRow, setFocusRow] = useState<number | null>(null);
  // A custom option opened with no name puts the cursor in its name field, once.
  const [focusNameRow, setFocusNameRow] = useState<number | null>(null);

  const [rows, setRows] = useState<readonly OptionRow[]>(() =>
    initial.map((option) => ({
      key: nextKey(),
      name: option.name,
      values: withTrailingBlank(
        option.values.map((text) => ({ key: nextKey(), text })),
        nextKey,
      ),
      editing: false,
    })),
  );

  useEffect(() => {
    onChange(optionsOf(rows));
  }, [rows, onChange]);

  function update(key: number, patch: Partial<Pick<OptionRow, "name" | "values" | "editing">>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function setValue(row: OptionRow, valueKey: number, text: string): void {
    const values = row.values.map((value) => (value.key === valueKey ? { ...value, text } : value));
    const last = values[values.length - 1];
    update(row.key, {
      values:
        last !== undefined && last.text.trim().length > 0
          ? [...values, { key: nextKey(), text: "" }]
          : values,
    });
  }

  function removeValue(row: OptionRow, valueKey: number): void {
    update(row.key, {
      values: withTrailingBlank(
        row.values.filter((value) => value.key !== valueKey),
        nextKey,
      ),
    });
  }

  /**
   * Done. A second option named like an existing one ("Size" twice) would be refused as a duplicate,
   * so its values join the existing option instead — what the merchant meant.
   */
  function finish(row: OptionRow): void {
    setRows((current) => {
      const target = sameNameAs(current, row);
      if (target === undefined) {
        return current.map((r) => (r.key === row.key ? { ...r, editing: false } : r));
      }
      const merged = [...new Set([...filledValues(target), ...filledValues(row)])];
      return current
        .filter((r) => r.key !== row.key)
        .map((r) =>
          r.key === target.key
            ? {
                ...r,
                values: withTrailingBlank(
                  merged.map((text) => ({ key: nextKey(), text })),
                  nextKey,
                ),
              }
            : r,
        );
    });
  }

  /** A new option, already named when it came from the menu; the cursor goes to the field that is still empty. */
  function addOption(name: string): void {
    const key = nextKey();
    setRows((current) => [
      ...current,
      { key, name, values: withTrailingBlank([], nextKey), editing: true },
    ]);
    if (name.trim().length > 0) setFocusRow(key);
    else setFocusNameRow(key);
  }

  /** The suggested values for an option by its name ("Size", "المقاس", "Color", …), if any. */
  function suggestionsFor(name: string): readonly string[] {
    return editor.valueSuggestions[name.trim().toLowerCase()] ?? [];
  }

  return (
    <div className="flex flex-col gap-3">
      <datalist id={listId}>
        {editor.recommendedOptions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>

      {rows.map((row, index) =>
        row.editing ? (
          <div key={row.key} className="border-border flex flex-col gap-3 rounded-md border p-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${listId}-name-${row.key}`}>{editor.optionName}</Label>
              <Input
                id={`${listId}-name-${row.key}`}
                name={`optionName-${index}`}
                form={PRODUCT_FORM_ID}
                list={listId}
                ref={
                  focusNameRow === row.key
                    ? (element: HTMLInputElement | null) => {
                        if (element === null) return;
                        element.focus();
                        setFocusNameRow(null);
                      }
                    : undefined
                }
                value={row.name}
                onChange={(event) => update(row.key, { name: event.target.value })}
              />
              {row.name.trim().length === 0 &&
                filledValues(row).length === 0 &&
                rows.some((other) => other.key !== row.key && filledValues(other).length > 0) && (
                  <p className="text-muted-foreground text-xs">{editor.newOptionHint}</p>
                )}
              {sameNameAs(rows, row) !== undefined && (
                <p className="text-muted-foreground text-xs">
                  {editor.mergesIntoOption.replace("{name}", sameNameAs(rows, row)!.name.trim())}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {suggestionsFor(row.name).length > 0 && (
                <datalist id={`${listId}-values-${row.key}`}>
                  {suggestionsFor(row.name).map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
              )}
              {row.values.map((value, position) => {
                const isTrailing = position === row.values.length - 1;
                return (
                  <div key={value.key} className="flex items-center gap-2">
                    <Input
                      aria-label={editor.optionValue}
                      name={`optionValue-${index}`}
                      form={PRODUCT_FORM_ID}
                      list={
                        suggestionsFor(row.name).length > 0
                          ? `${listId}-values-${row.key}`
                          : undefined
                      }
                      value={value.text}
                      ref={
                        isTrailing && focusRow === row.key
                          ? (element: HTMLInputElement | null) => {
                              // "Add value" opened this option: put the cursor in its empty field, once.
                              if (element === null) return;
                              element.focus();
                              setFocusRow(null);
                            }
                          : undefined
                      }
                      onChange={(event) => setValue(row, value.key, event.target.value)}
                      onKeyDown={(event) => {
                        // Enter would submit the whole page; here it should only finish the value.
                        if (event.key === "Enter") event.preventDefault();
                      }}
                    />
                    {!isTrailing && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={editor.removeValue.replace("{value}", value.text)}
                        onClick={() => removeValue(row, value.key)}
                      >
                        <XIcon aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
              >
                {editor.deleteOption}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={row.name.trim().length === 0 || filledValues(row).length === 0}
                onClick={() => finish(row)}
              >
                {editor.done}
              </Button>
            </div>
          </div>
        ) : (
          <div
            key={row.key}
            className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
          >
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-medium">{row.name}</span>
              <div className="flex flex-wrap gap-1.5">
                {filledValues(row).map((text, position) => (
                  <Badge key={`${position}-${text}`} variant="neutral">
                    {text}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={editor.addValue.replace("{name}", row.name)}
                onClick={() => {
                  setFocusRow(row.key);
                  update(row.key, { editing: true });
                }}
              >
                <PlusIcon aria-hidden="true" />
                <span aria-hidden="true">{editor.addValueShort}</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => update(row.key, { editing: true })}
              >
                {editor.edit}
              </Button>
            </div>
            {/* Folded, not forgotten: the option still travels with the page's Save. */}
            <input
              type="hidden"
              name={`optionName-${index}`}
              form={PRODUCT_FORM_ID}
              value={row.name}
            />
            {filledValues(row).map((text, position) => (
              <input
                key={`${position}-${text}`}
                type="hidden"
                name={`optionValue-${index}`}
                form={PRODUCT_FORM_ID}
                value={text}
              />
            ))}
          </div>
        ),
      )}

      <div>
        <OptionNamePicker
          used={rows.map((row) => row.name)}
          onPick={addOption}
          t={t}
          triggerLabel={rows.length === 0 ? editor.addOptions : editor.addAnotherOption}
          disabled={rows.length >= MAX_OPTIONS}
        />
      </div>
    </div>
  );
}
