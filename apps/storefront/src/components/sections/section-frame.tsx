import type { ReactNode } from "react";
import type { Dictionary } from "@/messages/en";

/**
 * One section's wrapper. In preview it carries `data-section-id` (the editor's focus target), and a
 * hidden or unfinished section is a dashed placeholder instead of its content. Live carries no
 * attribute, and a hidden or unfinished section never shows.
 */
export function SectionFrame({
  id,
  hidden,
  incomplete = false,
  labelledBy,
  preview,
  t,
  children,
}: {
  readonly id: string;
  readonly hidden: boolean;
  readonly incomplete?: boolean;
  /** The id of the heading that names this section, when it has one. */
  readonly labelledBy?: string;
  readonly preview: boolean;
  readonly t: Dictionary;
  readonly children: ReactNode;
}) {
  if (!preview) {
    return hidden || incomplete ? null : (
      <section aria-labelledby={labelledBy} className="flex flex-col gap-3">
        {children}
      </section>
    );
  }
  const placeholder = hidden
    ? t.sections.hiddenPlaceholder
    : incomplete
      ? t.sections.incompletePlaceholder
      : null;
  return (
    <section
      data-section-id={id}
      aria-labelledby={placeholder === null ? labelledBy : undefined}
      className="flex flex-col gap-3"
    >
      {placeholder === null ? (
        children
      ) : (
        <p className="border-border text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          {placeholder}
        </p>
      )}
    </section>
  );
}
