import { substituteExamples } from "@/lib/outreach/template-rules";
import type { Dictionary } from "@/messages/en";

export interface TemplatePreviewValues {
  readonly header: string;
  /** The example for the header's `{{1}}`. */
  readonly headerExample: string;
  readonly body: string;
  /** One example per body variable, by index. */
  readonly examples: readonly string[];
  readonly footer: string;
  /** Button labels, in display order (quick replies, then links). */
  readonly buttons: readonly string[];
}

/**
 * A WhatsApp-style message bubble: the header, the body with its examples substituted, the footer and the buttons.
 * Every text block carries `dir="auto"` so an Arabic template reads right-to-left inside an English admin (and the
 * other way round); the bubble itself follows the page direction.
 */
export function TemplatePreview({
  values,
  t,
}: {
  readonly values: TemplatePreviewValues;
  readonly t: Dictionary;
}) {
  const copy = t.whatsappTemplates.preview;
  const header = substituteExamples(values.header, [values.headerExample]);
  const body = substituteExamples(values.body, values.examples);
  const empty = header.length === 0 && body.trim().length === 0;

  if (empty) {
    return (
      <p role="note" className="text-muted-foreground text-sm">
        {copy.empty}
      </p>
    );
  }

  return (
    <div
      role="group"
      aria-label={copy.bubbleLabel}
      className="bg-muted/60 flex w-full max-w-sm flex-col gap-1 rounded-2xl p-3"
    >
      <div className="bg-card text-card-foreground flex flex-col gap-1 rounded-xl p-3 shadow-sm">
        {header.length > 0 && (
          <p
            dir="auto"
            className="break-words text-start font-semibold"
            data-testid="preview-header"
          >
            {header}
          </p>
        )}
        {body.trim().length > 0 && (
          <p
            dir="auto"
            className="whitespace-pre-wrap break-words text-start text-sm"
            data-testid="preview-body"
          >
            {body}
          </p>
        )}
        {values.footer.length > 0 && (
          <p
            dir="auto"
            className="text-muted-foreground break-words text-start text-xs"
            data-testid="preview-footer"
          >
            {values.footer}
          </p>
        )}
      </div>
      {values.buttons.length > 0 && (
        <ul className="flex flex-col gap-1">
          {values.buttons.map((label, index) => (
            <li
              key={index}
              dir="auto"
              className="bg-card text-primary rounded-xl p-2 text-center text-sm font-medium shadow-sm"
              data-testid="preview-button"
            >
              {label.length > 0 ? label : "…"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
