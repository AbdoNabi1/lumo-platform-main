import { useId, type ReactNode } from "react";
import { cn } from "@platform/ui";

export interface ChoiceOption<V extends string> {
  readonly value: V;
  readonly label: string;
  /** The one-line explanation shown under the label. */
  readonly hint: string;
  /** An extra line under this option (for example a legal warning); always visible. */
  readonly note?: string | undefined;
  readonly disabled?: boolean | undefined;
  /** Why this option is disabled, shown under it. */
  readonly reason?: ReactNode;
}

/**
 * A radio group the way Shopify's settings pages show one: a legend, then one row per choice with
 * its label and a one-line explanation. Controlled; the chosen value posts under `name`, so it
 * joins the page's form. A server-reported problem for the field shows under the group.
 */
export function ChoiceGroup<V extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  error,
  footer,
}: {
  readonly legend: string;
  readonly name: string;
  readonly value: V;
  readonly options: readonly ChoiceOption<V>[];
  readonly onChange: (next: V) => void;
  readonly error?: string | undefined;
  /** A line under the whole group (for example "the phone number can't be hidden"). */
  readonly footer?: string | undefined;
}) {
  const base = useId();
  const errorId = `${base}-error`;
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-2"
      aria-describedby={error === undefined ? undefined : errorId}
    >
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {options.map((option, index) => {
        const id = `${base}-${index}`;
        const hintId = `${id}-hint`;
        const noteId = `${id}-note`;
        const reasonId = `${id}-reason`;
        const describedBy = [
          hintId,
          option.note === undefined ? null : noteId,
          option.reason === undefined ? null : reasonId,
        ]
          .filter((part) => part !== null)
          .join(" ");
        return (
          <div key={option.value} className="flex flex-col gap-0.5">
            <label
              htmlFor={id}
              className={cn(
                "flex items-center gap-2 text-sm",
                option.disabled === true ? "text-muted-foreground" : "cursor-pointer",
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                disabled={option.disabled === true}
                aria-describedby={describedBy}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </label>
            <p id={hintId} className="text-muted-foreground ps-6 text-sm">
              {option.hint}
            </p>
            {option.note !== undefined && (
              <p id={noteId} role="note" className="text-foreground ps-6 text-sm">
                {option.note}
              </p>
            )}
            {option.reason !== undefined && (
              <p id={reasonId} className="text-muted-foreground ps-6 text-sm">
                {option.reason}
              </p>
            )}
          </div>
        );
      })}
      {footer !== undefined && <p className="text-muted-foreground text-sm">{footer}</p>}
      {error !== undefined && (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </fieldset>
  );
}
