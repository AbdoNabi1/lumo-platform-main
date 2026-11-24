"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";
import { Badge, Button, Input } from "@platform/ui";
import { mergeTags, splitTags } from "@/lib/customers/tags";
import type { Dictionary } from "@/messages/en";

/**
 * Tag chips plus a comma-separated entry box. Enter, a comma, the Add button or leaving the box
 * turns the typed text into chips (case-insensitive de-duplication, first spelling wins). Tag
 * names go inside `<bdi dir="auto">` so an Arabic tag next to a Latin one never reorders. With
 * `name`, a hidden input carries every chip AND any text still in the box — so submitting a form
 * straight after typing loses nothing; the API splits and validates the comma-separated value.
 */
export function CustomerTagsEditor({
  tags,
  onChange,
  inputId,
  describedBy,
  invalid = false,
  name,
  disabled = false,
  onPendingChange,
  t,
}: {
  readonly tags: readonly string[];
  readonly onChange: (tags: string[]) => void;
  readonly inputId: string;
  readonly describedBy?: string;
  readonly invalid?: boolean;
  readonly name?: string;
  readonly disabled?: boolean;
  /** Reports the text still in the entry box, so a Save button can include it. */
  readonly onPendingChange?: (raw: string) => void;
  readonly t: Dictionary;
}) {
  const k = t.customerForm;
  const [draft, setDraftState] = useState("");

  function setDraft(raw: string): void {
    setDraftState(raw);
    onPendingChange?.(raw);
  }

  function commit(raw: string): void {
    const added = splitTags(raw);
    if (added.length > 0) onChange(mergeTags(tags, added));
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          dir="auto"
          value={draft}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => {
            const value = event.target.value;
            if (/[,\u060C]/.test(value)) {
              // Everything before the last separator is complete; what follows is still being typed.
              const cut = Math.max(value.lastIndexOf(","), value.lastIndexOf("\u060C"));
              const added = splitTags(value.slice(0, cut + 1));
              if (added.length > 0) onChange(mergeTags(tags, added));
              setDraft(value.slice(cut + 1));
              return;
            }
            setDraft(value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              // Enter adds the tag; it must not submit the surrounding form.
              event.preventDefault();
              commit(draft);
            }
          }}
          onBlur={() => commit(draft)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || splitTags(draft).length === 0}
          onClick={() => commit(draft)}
        >
          {k.tagsAdd}
        </Button>
      </div>
      {tags.length > 0 && (
        <ul aria-label={k.tagsAdded} className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag.toLowerCase()}>
              <Badge variant="neutral" className="gap-1 pe-1 ps-2">
                <bdi dir="auto">{tag}</bdi>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={k.removeTag.replace("{tag}", tag)}
                  className="hover:bg-accent focus-visible:ring-ring rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2"
                  onClick={() => onChange(tags.filter((other) => other !== tag))}
                >
                  <XIcon aria-hidden="true" className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {name !== undefined && (
        <input type="hidden" name={name} value={mergeTags(tags, splitTags(draft)).join(",")} />
      )}
    </div>
  );
}
