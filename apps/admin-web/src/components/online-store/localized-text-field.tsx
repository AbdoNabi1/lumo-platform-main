"use client";

import { useState } from "react";
import { Input, Label, Textarea } from "@platform/ui";
import type { LocalizedText } from "@platform/storefront-content";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * ar/en tabs over ONE field (spec 1.11). Both inputs stay mounted (the hidden one too), so the form
 * always submits `<name>.ar` and `<name>.en`. Counters are formatted for the admin's locale.
 * `errors` is the form's field errors, keyed `<name>.ar` / `<name>.en` (or `<name>` for both).
 * The language switch is a full tabs pattern (each tab controls its panel). A changed `value` from
 * the server (a refresh after a save) replaces the text; the same text re-sent keeps what was typed.
 */
export function LocalizedTextField({
  t,
  locale,
  name,
  label,
  max,
  value,
  multiline = false,
  disabled = false,
  errors = {},
  onChange,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly name: string;
  readonly label: string;
  readonly max: number;
  readonly value: LocalizedText;
  readonly multiline?: boolean;
  readonly disabled?: boolean;
  readonly errors?: Readonly<Record<string, string>>;
  readonly onChange?: (value: LocalizedText) => void;
}) {
  const [tab, setTab] = useState<"ar" | "en">("ar");
  const [current, setCurrent] = useState<{ ar: string; en: string }>({
    ar: value.ar ?? "",
    en: value.en ?? "",
  });
  // Re-sync on a new server value, during render (React's "adjust state on a prop change").
  const valueKey = JSON.stringify([value.ar ?? "", value.en ?? ""]);
  const [syncedKey, setSyncedKey] = useState(valueKey);
  if (syncedKey !== valueKey) {
    setSyncedKey(valueKey);
    setCurrent({ ar: value.ar ?? "", en: value.en ?? "" });
  }
  const number = new Intl.NumberFormat(locale);
  const set = (key: "ar" | "en", text: string) => {
    const next = { ...current, [key]: text };
    setCurrent(next);
    onChange?.({
      ...(next.ar === "" ? {} : { ar: next.ar }),
      ...(next.en === "" ? {} : { en: next.en }),
    });
  };
  const errorFor = (key: "ar" | "en"): string | undefined =>
    errors[`${name}.${key}`] ?? errors[name];
  const shownError = errorFor(tab);
  const errorId = `${name}-error`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${name}-${tab}`}>{label}</Label>
        <div role="tablist" className="flex gap-1 text-xs">
          {(["ar", "en"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`${name}-${key}-tab`}
              aria-controls={`${name}-${key}-panel`}
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={
                tab === key
                  ? "bg-secondary rounded-md px-2 py-0.5 font-medium"
                  : errorFor(key) === undefined
                    ? "text-muted-foreground px-2 py-0.5"
                    : "text-destructive px-2 py-0.5"
              }
            >
              {key === "ar" ? t.onlineStorePreferences.arabic : t.onlineStorePreferences.english}
            </button>
          ))}
        </div>
      </div>
      {(["ar", "en"] as const).map((key) => {
        const invalid = errorFor(key) !== undefined;
        const common = {
          id: `${name}-${key}`,
          name: `${name}.${key}`,
          // Merchant text: its own content decides the direction (an English word in the Arabic tab).
          dir: "auto",
          lang: key,
          value: current[key],
          disabled,
          maxLength: max * 2,
          "aria-invalid": invalid || undefined,
          "aria-describedby": invalid ? errorId : undefined,
        };
        return (
          <div
            key={key}
            role="tabpanel"
            id={`${name}-${key}-panel`}
            aria-labelledby={`${name}-${key}-tab`}
            hidden={tab !== key}
          >
            {multiline ? (
              <Textarea {...common} onChange={(e) => set(key, e.currentTarget.value)} />
            ) : (
              <Input {...common} onChange={(e) => set(key, e.currentTarget.value)} />
            )}
          </div>
        );
      })}
      <p
        className={
          current[tab].length > max ? "text-destructive text-xs" : "text-muted-foreground text-xs"
        }
      >
        {t.onlineStorePreferences.counter
          .replace("{count}", number.format(current[tab].length))
          .replace("{max}", number.format(max))}
      </p>
      {shownError === undefined ? null : (
        <p id={errorId} className="text-destructive text-xs">
          {shownError}
        </p>
      )}
    </div>
  );
}
