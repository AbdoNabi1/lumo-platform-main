"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createContentBlockAction } from "@/app/content/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out";

const TEXTAREA_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) min-h-40 w-full rounded-xl border px-3.5 py-2.5 text-sm transition-colors ease-out";

/** The Content Blocks create form (T5.9a Part A) — same `useActionState` shape as `ProductCreateForm`. */
export function ContentCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createContentBlockAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-6">
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
          <Label htmlFor={`${formId}-name`}>{t.contentCreateForm.name}</Label>
          <Input
            id={`${formId}-name`}
            name="name"
            aria-invalid={fieldErrors["name"] !== undefined || undefined}
            aria-describedby={fieldErrors["name"] !== undefined ? `${formId}-name-error` : undefined}
          />
          {fieldErrors["name"] !== undefined && (
            <p id={`${formId}-name-error`} className="text-destructive text-sm">
              {fieldErrors["name"]}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-blockType`}>{t.contentCreateForm.blockType}</Label>
          <Input
            id={`${formId}-blockType`}
            name="blockType"
            aria-invalid={fieldErrors["blockType"] !== undefined || undefined}
            aria-describedby={
              fieldErrors["blockType"] !== undefined ? `${formId}-blockType-error` : undefined
            }
          />
          {fieldErrors["blockType"] !== undefined && (
            <p id={`${formId}-blockType-error`} className="text-destructive text-sm">
              {fieldErrors["blockType"]}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-format`}>{t.contentCreateForm.format}</Label>
          <select
            id={`${formId}-format`}
            name="format"
            defaultValue="html"
            aria-invalid={fieldErrors["format"] !== undefined || undefined}
            className={SELECT_CLASS}
          >
            <option value="html">{t.contentCreateForm.formatHtml}</option>
            <option value="markdown">{t.contentCreateForm.formatMarkdown}</option>
            <option value="json">{t.contentCreateForm.formatJson}</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-locale`}>{t.contentCreateForm.locale}</Label>
          <Input id={`${formId}-locale`} name="locale" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-content`}>{t.contentCreateForm.content}</Label>
        <textarea
          id={`${formId}-content`}
          name="content"
          rows={10}
          aria-invalid={fieldErrors["content"] !== undefined || undefined}
          aria-describedby={
            fieldErrors["content"] !== undefined ? `${formId}-content-error` : undefined
          }
          className={TEXTAREA_CLASS}
        />
        {fieldErrors["content"] !== undefined && (
          <p id={`${formId}-content-error`} className="text-destructive text-sm">
            {fieldErrors["content"]}
          </p>
        )}
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.contentCreateForm.submitting : t.contentCreateForm.submit}
        </Button>
      </div>
    </form>
  );
}
