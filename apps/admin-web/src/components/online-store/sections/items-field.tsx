"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from "lucide-react";
import { Button } from "@platform/ui";
import { emptyFieldValue, type FieldDescriptor } from "@platform/storefront-content";
import type { Dictionary } from "@/messages/en";
import { FieldError } from "./field-shared";

type ItemsDescriptor = Extract<FieldDescriptor, { kind: "items" }>;
type Item = Readonly<Record<string, unknown>>;

/** Where focus goes once the new list has rendered (Ruling 22). */
type Focus =
  | { readonly kind: "item"; readonly index: number }
  | { readonly kind: "move"; readonly index: number; readonly control: "up" | "down" }
  | { readonly kind: "add" };

const FIRST_FIELD =
  'input:not([type="hidden"]):not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])';

const isItem = (value: unknown): value is Item =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A repeatable group (testimonials, highlights, collection tiles): one fieldset per item, numbered
 * in its legend, with Move up, Move down and Remove. Remove is disabled at `min` (with the hint)
 * and Add at `max`. Focus is restored after every edit: a removed item hands it to the next item's
 * first field (else the previous one, else Add); a move keeps it on the moved item's own control;
 * a new item gets it on its first field. The fields themselves come from `renderField`, so this
 * file does not depend on the field switch it is rendered by.
 */
export function ItemsField({
  t,
  id,
  path,
  label,
  field,
  value,
  disabled,
  error,
  renderField,
  onChange,
}: {
  readonly t: Dictionary;
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly field: ItemsDescriptor;
  readonly value: readonly unknown[];
  readonly disabled: boolean;
  readonly error?: string | undefined;
  readonly renderField: (
    field: FieldDescriptor,
    value: unknown,
    path: string,
    onChange: (value: unknown) => void,
  ) => ReactNode;
  readonly onChange: (items: readonly Item[]) => void;
}) {
  const s = t.onlineStoreSections.items;
  const list = value.filter(isItem);
  const bodies = useRef<(HTMLElement | null)[]>([]);
  const heads = useRef<(HTMLElement | null)[]>([]);
  const addButton = useRef<HTMLButtonElement>(null);
  const focus = useRef<Focus | null>(null);

  // After each render that follows an edit; a no-op otherwise.
  useLayoutEffect(() => {
    const target = focus.current;
    if (target === null) return;
    focus.current = null;
    if (target.kind === "add") {
      addButton.current?.focus();
    } else if (target.kind === "item") {
      bodies.current[target.index]?.querySelector<HTMLElement>(FIRST_FIELD)?.focus();
    } else {
      const head = heads.current[target.index];
      const other = target.control === "up" ? "down" : "up";
      const wanted = head?.querySelector<HTMLButtonElement>(`[data-control="${target.control}"]`);
      const fallback = head?.querySelector<HTMLButtonElement>(`[data-control="${other}"]`);
      (wanted !== null && wanted !== undefined && !wanted.disabled ? wanted : fallback)?.focus();
    }
  });

  const setItem = (index: number, key: string, next: unknown) =>
    onChange(list.map((item, i) => (i === index ? { ...item, [key]: next } : item)));
  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved as Item);
    focus.current = { kind: "move", index: to, control: delta === -1 ? "up" : "down" };
    onChange(next);
  };
  const remove = (index: number) => {
    const next = list.filter((_, i) => i !== index);
    focus.current =
      next.length === 0
        ? { kind: "add" }
        : { kind: "item", index: Math.min(index, next.length - 1) };
    onChange(next);
  };
  const add = () => {
    const created = Object.fromEntries(field.fields.map((f) => [f.key, emptyFieldValue(f)]));
    focus.current = { kind: "item", index: list.length };
    onChange([...list, created]);
  };

  const atMin = list.length <= field.min;
  const minId = `${id}-min`;
  const n = (index: number) => String(index + 1);
  return (
    <div className="flex flex-col gap-3">
      <span className="text-foreground text-base font-medium leading-none">
        <bdi>{label}</bdi>
      </span>
      {list.map((item, index) => (
        <fieldset
          // The list is edited in place by index, so the index is the item's identity.
          key={index}
          className="border-border flex flex-col gap-3 rounded-xl border p-3"
          disabled={disabled}
        >
          <legend className="px-1 text-sm font-medium">
            <bdi>{s.legend.replace("{n}", n(index))}</bdi>
          </legend>
          <div
            ref={(el) => {
              heads.current[index] = el;
            }}
            className="flex justify-end gap-1"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-control="up"
              aria-label={s.moveUp.replace("{n}", n(index))}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUpIcon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-control="down"
              aria-label={s.moveDown.replace("{n}", n(index))}
              disabled={index === list.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDownIcon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={s.remove.replace("{n}", n(index))}
              aria-describedby={atMin && field.min > 0 ? minId : undefined}
              disabled={atMin}
              onClick={() => remove(index)}
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          </div>
          <div
            ref={(el) => {
              bodies.current[index] = el;
            }}
            className="flex flex-col gap-4"
          >
            {field.fields.map((sub) => (
              <div key={sub.key}>
                {renderField(sub, item[sub.key], `${path}.${index}.${sub.key}`, (next) =>
                  setItem(index, sub.key, next),
                )}
              </div>
            ))}
          </div>
        </fieldset>
      ))}
      {atMin && field.min > 0 ? (
        <p id={minId} className="text-muted-foreground text-xs">
          {s.minItems}
        </p>
      ) : null}
      <FieldError id={id} error={error} />
      <Button
        ref={addButton}
        type="button"
        variant="secondary"
        size="sm"
        className="self-start"
        disabled={disabled || list.length >= field.max}
        onClick={add}
      >
        {s.add}
      </Button>
    </div>
  );
}
