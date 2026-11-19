"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  AlertCircleIcon,
  BoldIcon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
} from "lucide-react";
import { Label, Textarea } from "@platform/ui";
import type { LocalizedText, RichTextIssue } from "@platform/storefront-content";
import type { Locale } from "@/lib/i18n";
import {
  applyMarkup,
  richTextIssues,
  richTextLength,
  type MarkupKind,
} from "@/lib/online-store/markup";
import type { Dictionary } from "@/messages/en";
import { RichTextPreview } from "./rich-text-preview";

type Key = "ar" | "en";
type Mode = "write" | "preview";
const KEYS: readonly Key[] = ["ar", "en"];

const TOOLS: readonly {
  readonly kind: MarkupKind;
  readonly Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}[] = [
  { kind: "h2", Icon: Heading2Icon },
  { kind: "h3", Icon: Heading3Icon },
  { kind: "bold", Icon: BoldIcon },
  { kind: "italic", Icon: ItalicIcon },
  { kind: "bullets", Icon: ListIcon },
  { kind: "numbers", Icon: ListOrderedIcon },
  { kind: "link", Icon: LinkIcon },
];

const tabClass = (selected: boolean, invalid: boolean) =>
  selected
    ? "bg-secondary rounded-md px-2 py-0.5 font-medium"
    : invalid
      ? "text-destructive px-2 py-0.5"
      : "text-muted-foreground px-2 py-0.5";

/**
 * The Morbeh text editor (spec 2.7) for policies and pages: ar/en tabs over one field, both
 * textareas mounted so a form submits `<name>.ar` and `<name>.en` (the `LocalizedTextField`
 * pattern). Each language has Write and Preview: Preview is the storefront's own renderer over the
 * same text. The toolbar's seven tools rewrite the selection (`applyMarkup`) and select the result
 * again. The counter and the issues come from the shared validator over the text as the API will
 * store it, with line numbers as the textarea shows them; server field errors (`<name>.ar`) show
 * under their tab. A changed `value` (a template, a refresh) replaces the text.
 */
export function RichTextEditor({
  t,
  locale,
  name,
  label,
  value,
  max,
  disabled = false,
  errors = {},
  onChange,
  tab: controlledTab,
  onTabChange,
  previewBase = null,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly name: string;
  readonly label: string;
  readonly value: LocalizedText;
  readonly max: number;
  readonly disabled?: boolean;
  readonly errors?: Readonly<Record<string, string>>;
  readonly onChange?: (value: LocalizedText) => void;
  /** The open language, when the parent decides it (a template fills one language and opens it). */
  readonly tab?: Key;
  readonly onTabChange?: (tab: Key) => void;
  /** The storefront's address: Preview opens shop paths there, in a new tab (review M-3). */
  readonly previewBase?: string | null;
}) {
  const r = t.richText;
  const id = useId();
  const [ownTab, setOwnTab] = useState<Key>(locale);
  const tab = controlledTab ?? ownTab;
  const [mode, setMode] = useState<Record<Key, Mode>>({ ar: "write", en: "write" });
  const [current, setCurrent] = useState<Record<Key, string>>({
    ar: value.ar ?? "",
    en: value.en ?? "",
  });
  // Re-sync on a new value from outside, during render (React's "adjust state on a prop change").
  const valueKey = JSON.stringify([value.ar ?? "", value.en ?? ""]);
  const [syncedKey, setSyncedKey] = useState(valueKey);
  if (syncedKey !== valueKey) {
    setSyncedKey(valueKey);
    setCurrent({ ar: value.ar ?? "", en: value.en ?? "" });
  }

  const textareas = useRef<Record<Key, HTMLTextAreaElement | null>>({ ar: null, en: null });
  const pendingSelection = useRef<{ key: Key; start: number; end: number } | null>(null);
  // After a tool changed the text, React has re-rendered the textarea: put the selection back.
  useLayoutEffect(() => {
    const pending = pendingSelection.current;
    if (pending === null) return;
    pendingSelection.current = null;
    const element = textareas.current[pending.key];
    if (element === null) return;
    element.focus();
    element.setSelectionRange(pending.start, pending.end);
  });

  const issuesAr = useMemo(() => richTextIssues(current.ar, max), [current.ar, max]);
  const issuesEn = useMemo(() => richTextIssues(current.en, max), [current.en, max]);
  const issues: Record<Key, readonly RichTextIssue[]> = { ar: issuesAr, en: issuesEn };

  const number = new Intl.NumberFormat(locale, { useGrouping: false });
  const grouped = new Intl.NumberFormat(locale);

  const set = (key: Key, text: string) => {
    const next = { ...current, [key]: text };
    setCurrent(next);
    onChange?.({
      ...(next.ar === "" ? {} : { ar: next.ar }),
      ...(next.en === "" ? {} : { en: next.en }),
    });
  };

  const selectTab = (key: Key) => {
    setOwnTab(key);
    onTabChange?.(key);
  };

  const apply = (key: Key, kind: MarkupKind) => {
    const element = textareas.current[key];
    if (element === null || disabled) return;
    const out = applyMarkup(
      current[key],
      { start: element.selectionStart, end: element.selectionEnd },
      kind,
    );
    if (out.text === current[key]) {
      element.focus();
      element.setSelectionRange(out.selection.start, out.selection.end);
      return;
    }
    pendingSelection.current = { key, ...out.selection };
    set(key, out.text);
  };

  const serverError = (key: Key): string | undefined => errors[`${name}.${key}`] ?? errors[name];
  const issueText = (issue: RichTextIssue, key: Key) =>
    issue.code === "TOO_LONG"
      ? r.tooLong
          .replace("{count}", grouped.format(richTextLength(current[key])))
          .replace("{max}", grouped.format(max))
      : r.unsafeLink.replace("{line}", number.format(issue.line));
  const idOf = (part: string, key: Key) => `${id}-${part}-${key}`;
  const languageName = (key: Key) =>
    key === "ar" ? t.onlineStorePreferences.arabic : t.onlineStorePreferences.english;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={idOf("text", tab)}>{label}</Label>
        <div role="tablist" aria-label={label} className="flex gap-1 text-xs">
          {KEYS.map((key) => {
            const invalid = serverError(key) !== undefined || issues[key].length > 0;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={idOf("lang-tab", key)}
                aria-controls={idOf("lang-panel", key)}
                aria-selected={tab === key}
                data-invalid={invalid || undefined}
                onClick={() => selectTab(key)}
                className={`inline-flex items-center gap-1 ${tabClass(tab === key, invalid)}`}
              >
                {languageName(key)}
                {invalid ? (
                  <>
                    {" "}
                    {/* Not colour alone (review M-4): an icon, and words for screen readers. */}
                    <AlertCircleIcon aria-hidden className="size-3" />
                    <span className="sr-only">{r.tabHasErrors}</span>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      {KEYS.map((key) => {
        const own = issues[key];
        const error = serverError(key);
        const writing = mode[key] === "write";
        const describedBy = [
          idOf("count", key),
          own.length > 0 ? idOf("issues", key) : null,
          error === undefined ? null : idOf("error", key),
        ]
          .filter((part) => part !== null)
          .join(" ");
        const length = richTextLength(current[key]);
        return (
          <div
            key={key}
            role="tabpanel"
            id={idOf("lang-panel", key)}
            aria-labelledby={idOf("lang-tab", key)}
            hidden={tab !== key}
            className="flex flex-col gap-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                role="toolbar"
                aria-label={r.toolbar}
                aria-controls={idOf("text", key)}
                className="flex flex-wrap gap-1"
              >
                {TOOLS.map(({ kind, Icon }) => (
                  <button
                    key={kind}
                    type="button"
                    aria-label={r[kind]}
                    title={r[kind]}
                    disabled={disabled || !writing}
                    // Keep the textarea's focus and selection while the tool is pressed.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => apply(key, kind)}
                    className="hover:bg-muted text-muted-foreground hover:text-foreground rounded-md p-1.5 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <Icon aria-hidden className="size-4" />
                  </button>
                ))}
              </div>
              <div role="tablist" aria-label={languageName(key)} className="flex gap-1 text-xs">
                {(["write", "preview"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    id={idOf(`${option}-tab`, key)}
                    aria-controls={idOf(`${option}-panel`, key)}
                    aria-selected={mode[key] === option}
                    onClick={() => setMode((before) => ({ ...before, [key]: option }))}
                    className={tabClass(mode[key] === option, false)}
                  >
                    {option === "write" ? r.write : r.preview}
                  </button>
                ))}
              </div>
            </div>
            <div
              role="tabpanel"
              id={idOf("write-panel", key)}
              aria-labelledby={idOf("write-tab", key)}
              hidden={!writing}
            >
              <Textarea
                ref={(element) => {
                  textareas.current[key] = element;
                }}
                id={idOf("text", key)}
                name={`${name}.${key}`}
                // Merchant text: its own content decides the direction.
                dir="auto"
                lang={key}
                rows={16}
                value={current[key]}
                disabled={disabled}
                aria-invalid={own.length > 0 || error !== undefined || undefined}
                aria-describedby={describedBy}
                onChange={(event) => set(key, event.currentTarget.value)}
              />
            </div>
            <div
              role="tabpanel"
              id={idOf("preview-panel", key)}
              aria-labelledby={idOf("preview-tab", key)}
              hidden={writing}
              lang={key}
              className="border-border bg-card min-h-40 rounded-xl border px-4 py-2"
            >
              {writing ? null : current[key].trim() === "" ? (
                <p className="text-muted-foreground my-3 text-sm">{r.previewEmpty}</p>
              ) : (
                <RichTextPreview text={current[key]} linkBase={previewBase} />
              )}
            </div>
            <p
              id={idOf("count", key)}
              className={
                length > max ? "text-destructive text-xs" : "text-muted-foreground text-xs"
              }
            >
              {t.onlineStorePreferences.counter
                .replace("{count}", grouped.format(length))
                .replace("{max}", grouped.format(max))}
            </p>
            {own.length === 0 ? null : (
              <ul id={idOf("issues", key)} className="text-destructive flex flex-col gap-1 text-xs">
                {own.map((issue) => (
                  <li key={`${issue.code}-${issue.line}`}>{issueText(issue, key)}</li>
                ))}
              </ul>
            )}
            {error === undefined ? null : (
              <p id={idOf("error", key)} className="text-destructive text-xs">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
