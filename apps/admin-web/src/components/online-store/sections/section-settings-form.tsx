"use client";

import { useId } from "react";
import {
  sectionDefinition,
  type FieldDescriptor,
  type KnownSection,
} from "@platform/storefront-content";
import type { OnlineStoreImageDto, ThemeTargetsDto } from "@/lib/api/online-store";
import type { Locale } from "@/lib/i18n";
import { sectionProblems } from "@/lib/online-store/section-problems";
import type { Dictionary } from "@/messages/en";
import { FieldControl } from "./field-control";
import type { FieldEnv, TargetKind } from "./field-shared";

/**
 * A source switch hides the fields it makes meaningless: a manual product list has no "how many"
 * and a "newest" one has no picks; a collection list shows its tiles only when they are picked by
 * hand. The values stay in the document (switching back restores them); only the controls change.
 */
function isVisible(type: string, field: FieldDescriptor, settings: Record<string, unknown>) {
  const source = settings["source"];
  if (type === "featured_products") {
    if (field.key === "products") return source === "manual";
    if (field.key === "count") return source !== "manual";
  }
  if (type === "collection_list" && field.key === "items") return source === "manual";
  return true;
}

/** The section's own document path, for a form that is not given one. */
const defaultPath = (section: KnownSection) =>
  section.type === "announcement_bar" ? "header.announcement" : "homepage.sections.0";

/**
 * The settings form of one section, generated from its definition (`sectionDefinition(type).fields`,
 * in order). `path` is the section's document path (`homepage.sections.3`, `header.announcement`):
 * field paths are `<path>.settings.<key>`, which is how the API's field errors find their control.
 * Edits are immutable: `onChange` gets the whole next settings object. `onImage` registers an
 * upload or a library pick in the editor's image map; `onTarget` registers a picked collection,
 * product or page, so the editor can name it before the draft is saved.
 */
export function SectionSettingsForm({
  t,
  locale,
  section,
  path = defaultPath(section),
  images,
  targets,
  errors,
  disabled,
  onChange,
  onImage,
  onTarget,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly section: KnownSection;
  readonly path?: string;
  readonly images: Readonly<Record<string, OnlineStoreImageDto>>;
  readonly targets: ThemeTargetsDto | null;
  /** Keyed by the full document path. */
  readonly errors: Readonly<Record<string, string>>;
  readonly disabled: boolean;
  readonly onChange: (settings: Readonly<Record<string, unknown>>) => void;
  readonly onImage: (image: OnlineStoreImageDto & { id: string }) => void;
  readonly onTarget: (kind: TargetKind, id: string, title: string) => void;
}) {
  const idBase = useId();
  const definition = sectionDefinition(section.type);
  if (definition === null) return null;
  const settings: Record<string, unknown> = { ...section.settings };
  const env: FieldEnv = { t, locale, images, targets, errors, disabled, idBase, onImage, onTarget };
  const problems = sectionProblems(section, targets, images);
  return (
    <div className="flex flex-col gap-5">
      {problems.map((problem) => (
        <p
          key={problem}
          role="alert"
          className="bg-warning-subtle text-warning-foreground rounded-lg px-3 py-2 text-sm"
        >
          {t.onlineStoreSections.problems[problem]}
        </p>
      ))}
      {definition.fields
        .filter((field) => isVisible(section.type, field, settings))
        .map((field) => (
          <FieldControl
            key={field.key}
            env={env}
            field={field}
            value={settings[field.key]}
            path={`${path}.settings.${field.key}`}
            onChange={(value) => onChange({ ...settings, [field.key]: value })}
          />
        ))}
    </div>
  );
}
