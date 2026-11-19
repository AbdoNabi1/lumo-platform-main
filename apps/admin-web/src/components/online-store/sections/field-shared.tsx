import type { OnlineStoreImageDto, ThemeTargetsDto } from "@/lib/api/online-store";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/** Targets a section can reference; policies are not part of the theme's `targets`. */
export type TargetKind = "collection" | "product" | "page";

/** What every generated control needs, built once by the form and passed down. */
export interface FieldEnv {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly images: Readonly<Record<string, OnlineStoreImageDto>>;
  readonly targets: ThemeTargetsDto | null;
  /** Keyed by the full document path (`homepage.sections.0.settings.heading.ar`). */
  readonly errors: Readonly<Record<string, string>>;
  readonly disabled: boolean;
  /** Unique per form instance, so two sections never share an id. */
  readonly idBase: string;
  readonly onImage: (image: OnlineStoreImageDto & { id: string }) => void;
  readonly onTarget: (kind: TargetKind, id: string, title: string) => void;
}

/** `<form id>-<path with dots as dashes>`: unique per section (useId) and per item (the path). */
export const fieldId = (env: Pick<FieldEnv, "idBase">, path: string): string =>
  `${env.idBase}-${path.replaceAll(".", "-")}`;

/** A descriptor key's label. Keys come from the shared definitions, never from merchant input. */
export function fieldLabel(t: Dictionary, key: string): string {
  const labels: Readonly<Record<string, string>> = t.onlineStoreSections.fields;
  return Object.hasOwn(labels, key) ? (labels[key] ?? key) : key;
}

/** An option's label; `manual` reads "Pick collections" in a collection list. */
export function optionLabel(
  t: Dictionary,
  field: { readonly key: string; readonly options: readonly string[] },
  option: string,
): string {
  const labels: Readonly<Record<string, string>> = t.onlineStoreSections.options;
  const key =
    field.key === "source" && option === "manual" && field.options.includes("all")
      ? "manualCollections"
      : option;
  return Object.hasOwn(labels, key) ? (labels[key] ?? option) : option;
}

/** The first error at `path` or under it (a product list's `.3`, a link's `.url`). */
export function firstError(
  errors: Readonly<Record<string, string>>,
  path: string,
): string | undefined {
  const own = Object.hasOwn(errors, path) ? errors[path] : undefined;
  if (own !== undefined) return own;
  const prefix = `${path}.`;
  for (const [key, message] of Object.entries(errors)) {
    if (key.startsWith(prefix)) return message;
  }
  return undefined;
}

/** `aria-invalid` and `aria-describedby` for a control and the error under it. */
export function errorAria(
  id: string,
  error: string | undefined,
  extra?: string,
): { "aria-invalid"?: true; "aria-describedby"?: string } {
  const described = [extra, error === undefined ? undefined : `${id}-error`]
    .filter((part): part is string => part !== undefined)
    .join(" ");
  return {
    ...(error === undefined ? {} : { "aria-invalid": true as const }),
    ...(described === "" ? {} : { "aria-describedby": described }),
  };
}

export function FieldError({ id, error }: { readonly id: string; readonly error?: string }) {
  return error === undefined ? null : (
    <p id={`${id}-error`} className="text-destructive text-xs">
      {error}
    </p>
  );
}
