"use client";

import { useActionState, useId, useState, type FormEvent } from "react";
import { AlertTriangleIcon, PlusIcon, XIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createComponentAction } from "@/app/components-library/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out";

const TEXTAREA_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) min-h-32 w-full rounded-xl border px-3.5 py-2.5 font-mono text-sm transition-colors ease-out aria-invalid:border-destructive aria-invalid:outline-destructive";

const PROPERTY_TYPES = ["string", "number", "boolean", "object", "array"] as const;

interface PropertyRow {
  readonly rowKey: string;
}

interface StringRow {
  readonly rowKey: string;
}

let nextRowKey = 0;
function newRowKey(prefix: string): string {
  nextRowKey += 1;
  return `${prefix}-${nextRowKey}`;
}

/**
 * The Component Library create form (T5.9c). `properties` is a repeated `{name, type, required}`
 * row group; `slots`/`events` are each a simple repeated string-row array — same array-of-rows
 * technique `OrderLineItemsField`/`ProductCreateForm`'s variant rows use. `defaults` is a plain
 * JSON textarea (`Record<string,unknown>`, per the task brief — no typed-per-property editor in
 * scope): validated client-side on submit (`onSubmit` below) so a malformed value never reaches
 * the server action, and re-validated there too as defense in depth.
 */
export function ComponentCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createComponentAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  const [properties, setProperties] = useState<readonly PropertyRow[]>([
    { rowKey: newRowKey("property") },
  ]);
  const [slots, setSlots] = useState<readonly StringRow[]>([{ rowKey: newRowKey("slot") }]);
  const [events, setEvents] = useState<readonly StringRow[]>([{ rowKey: newRowKey("event") }]);
  const [defaultsError, setDefaultsError] = useState<string | undefined>(undefined);

  function addProperty(): void {
    setProperties((current) => [...current, { rowKey: newRowKey("property") }]);
  }
  function removeProperty(rowKey: string): void {
    setProperties((current) =>
      current.length > 1 ? current.filter((row) => row.rowKey !== rowKey) : current,
    );
  }

  function addSlot(): void {
    setSlots((current) => [...current, { rowKey: newRowKey("slot") }]);
  }
  function removeSlot(rowKey: string): void {
    setSlots((current) =>
      current.length > 1 ? current.filter((row) => row.rowKey !== rowKey) : current,
    );
  }

  function addEvent(): void {
    setEvents((current) => [...current, { rowKey: newRowKey("event") }]);
  }
  function removeEvent(rowKey: string): void {
    setEvents((current) =>
      current.length > 1 ? current.filter((row) => row.rowKey !== rowKey) : current,
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    const raw = new FormData(event.currentTarget).get("defaults");
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text.length === 0) {
      setDefaultsError(undefined);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setDefaultsError(t.componentCreate.defaultsInvalid);
        event.preventDefault();
        return;
      }
      setDefaultsError(undefined);
    } catch {
      setDefaultsError(t.componentCreate.defaultsInvalid);
      event.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-6">
      {state.status === "error" && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
        >
          <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-key`}>{t.componentCreate.key}</Label>
          <Input
            id={`${formId}-key`}
            name="key"
            aria-invalid={fieldErrors["key"] !== undefined || undefined}
          />
          {fieldErrors["key"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["key"]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-name`}>{t.componentCreate.name}</Label>
          <Input
            id={`${formId}-name`}
            name="name"
            aria-invalid={fieldErrors["name"] !== undefined || undefined}
          />
          {fieldErrors["name"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["name"]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-permission`}>{t.componentCreate.permission}</Label>
          <Input id={`${formId}-permission`} name="permission" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-featureFlagKey`}>{t.componentCreate.featureFlagKey}</Label>
          <Input id={`${formId}-featureFlagKey`} name="featureFlagKey" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`${formId}-responsive`}
          name="responsive"
          className="mt-0.5"
        />
        <Label htmlFor={`${formId}-responsive`}>{t.componentCreate.responsive}</Label>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t.componentCreate.properties}</h2>
          <Button type="button" variant="outline" size="sm" onClick={addProperty}>
            <PlusIcon aria-hidden="true" />
            {t.componentCreate.addProperty}
          </Button>
        </div>
        {fieldErrors["properties"] !== undefined && (
          <p className="text-destructive text-sm">{fieldErrors["properties"]}</p>
        )}
        <div className="flex flex-col gap-3">
          {properties.map((row, index) => (
            <div
              key={row.rowKey}
              className="grid grid-cols-1 gap-3 sm:grid-cols-[1.5fr_1fr_1fr_2.5rem]"
            >
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={`${formId}-propertyName-${index}`}
                  className={index > 0 ? "sr-only" : undefined}
                >
                  {t.componentCreate.propertyName}
                </Label>
                <Input id={`${formId}-propertyName-${index}`} name="propertyName" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={`${formId}-propertyType-${index}`}
                  className={index > 0 ? "sr-only" : undefined}
                >
                  {t.componentCreate.propertyType}
                </Label>
                <select
                  id={`${formId}-propertyType-${index}`}
                  name="propertyType"
                  className={SELECT_CLASS}
                  defaultValue="string"
                >
                  {PROPERTY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {(t.componentPropertyType as Record<string, string>)[type] ?? type}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={`${formId}-propertyRequired-${index}`}
                  className={index > 0 ? "sr-only" : undefined}
                >
                  {t.componentCreate.propertyRequired}
                </Label>
                <select
                  id={`${formId}-propertyRequired-${index}`}
                  name="propertyRequired"
                  className={SELECT_CLASS}
                  defaultValue="false"
                >
                  <option value="true">{t.componentCreate.yes}</option>
                  <option value="false">{t.componentCreate.no}</option>
                </select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={index === 0 ? "mt-6" : undefined}
                disabled={properties.length === 1}
                onClick={() => removeProperty(row.rowKey)}
                aria-label={t.componentCreate.removeProperty}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <StringRowGroup
        title={t.componentCreate.slots}
        addLabel={t.componentCreate.addSlot}
        removeLabel={t.componentCreate.removeSlot}
        label={t.componentCreate.slotValue}
        fieldName="slotValue"
        rows={slots}
        onAdd={addSlot}
        onRemove={removeSlot}
        idPrefix={`${formId}-slot`}
      />

      <StringRowGroup
        title={t.componentCreate.events}
        addLabel={t.componentCreate.addEvent}
        removeLabel={t.componentCreate.removeEvent}
        label={t.componentCreate.eventValue}
        fieldName="eventValue"
        rows={events}
        onAdd={addEvent}
        onRemove={removeEvent}
        idPrefix={`${formId}-event`}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-defaults`}>{t.componentCreate.defaults}</Label>
        <textarea
          id={`${formId}-defaults`}
          name="defaults"
          placeholder="{}"
          className={TEXTAREA_CLASS}
          aria-invalid={
            defaultsError !== undefined || fieldErrors["defaults"] !== undefined || undefined
          }
        />
        <p className="text-muted-foreground text-xs">{t.componentCreate.defaultsHint}</p>
        {defaultsError !== undefined && <p className="text-destructive text-sm">{defaultsError}</p>}
        {fieldErrors["defaults"] !== undefined && (
          <p className="text-destructive text-sm">{fieldErrors["defaults"]}</p>
        )}
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.componentCreate.submitting : t.componentCreate.submit}
        </Button>
      </div>
    </form>
  );
}

function StringRowGroup({
  title,
  addLabel,
  removeLabel,
  label,
  fieldName,
  rows,
  onAdd,
  onRemove,
  idPrefix,
}: {
  readonly title: string;
  readonly addLabel: string;
  readonly removeLabel: string;
  readonly label: string;
  readonly fieldName: string;
  readonly rows: readonly StringRow[];
  readonly onAdd: () => void;
  readonly onRemove: (rowKey: string) => void;
  readonly idPrefix: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <PlusIcon aria-hidden="true" />
          {addLabel}
        </Button>
      </div>
      <div className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <div key={row.rowKey} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2.5rem]">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor={`${idPrefix}-${index}`}
                className={index > 0 ? "sr-only" : undefined}
              >
                {label}
              </Label>
              <Input id={`${idPrefix}-${index}`} name={fieldName} />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={index === 0 ? "mt-6" : undefined}
              disabled={rows.length === 1}
              onClick={() => onRemove(row.rowKey)}
              aria-label={removeLabel}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
