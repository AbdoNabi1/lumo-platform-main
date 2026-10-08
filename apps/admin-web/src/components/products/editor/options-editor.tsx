"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Badge, Button, Input, Label } from "@platform/ui";
import { MAX_OPTIONS, type MatrixOption } from "@/lib/products/variant-matrix";
import type { Dictionary } from "@/messages/en";
import { PRODUCT_FORM_ID } from "./field";

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

  function addOption(): void {
    setRows((current) => [
      ...current,
      { key: nextKey(), name: "", values: withTrailingBlank([], nextKey), editing: true },
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      <datalist id={listId}>
        {editor.optionSuggestions.map((suggestion) => (
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
                value={row.name}
                onChange={(event) => update(row.key, { name: event.target.value })}
              />
            </div>

            <div className="flex flex-col gap-2">
              {row.values.map((value, position) => {
                const isTrailing = position === row.values.length - 1;
                return (
                  <div key={value.key} className="flex items-center gap-2">
                    <Input
                      aria-label={editor.optionValue}
                      name={`optionValue-${index}`}
                      form={PRODUCT_FORM_ID}
                      value={value.text}
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
                onClick={() => update(row.key, { editing: false })}
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => update(row.key, { editing: true })}
            >
              {editor.edit}
            </Button>
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addOption}
          disabled={rows.length >= MAX_OPTIONS}
        >
          <PlusIcon aria-hidden="true" />
          {rows.length === 0 ? editor.addOptions : editor.addAnotherOption}
        </Button>
      </div>
    </div>
  );
}
