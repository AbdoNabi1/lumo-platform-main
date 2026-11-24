"use client";

import { useActionState, useId, useState } from "react";
import { Button, Card, CardContent, Input, Label } from "@platform/ui";
import { createCollectionAction } from "@/app/collections/actions";
import type { FormState } from "@/lib/api/mutation";
import { slugFromTitle } from "@/lib/collections/collection-helpers";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * Title + Handle. The Handle follows the title (lowercase, dashes, `[a-z0-9-]` only) until the
 * merchant types in it themselves; an Arabic title suggests nothing, so they type it. Saving
 * creates the collection and opens it.
 */
export function CollectionCreateForm({ t }: { readonly t: Dictionary }) {
  const k = t.collections.form;
  const [state, formAction, isPending] = useActionState(createCollectionAction, INITIAL_STATE);
  const formId = useId();
  const [title, setTitle] = useState("");
  const [handle, setHandle] = useState("");
  const [handleEdited, setHandleEdited] = useState(false);
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};
  const nameError = fieldErrors["name"];
  const slugError = fieldErrors["slug"];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-name`}>{k.title}</Label>
            <Input
              id={`${formId}-name`}
              name="name"
              dir="auto"
              maxLength={255}
              value={title}
              aria-invalid={nameError !== undefined || undefined}
              aria-describedby={nameError !== undefined ? `${formId}-name-error` : undefined}
              onChange={(event) => {
                setTitle(event.target.value);
                if (!handleEdited) setHandle(slugFromTitle(event.target.value));
              }}
            />
            {nameError !== undefined && (
              <p id={`${formId}-name-error`} className="text-destructive text-sm">
                {nameError}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-slug`}>{k.handle}</Label>
            <Input
              id={`${formId}-slug`}
              name="slug"
              dir="ltr"
              maxLength={255}
              value={handle}
              className="text-start"
              aria-invalid={slugError !== undefined || undefined}
              aria-describedby={
                slugError !== undefined
                  ? `${formId}-slug-hint ${formId}-slug-error`
                  : `${formId}-slug-hint`
              }
              onChange={(event) => {
                setHandleEdited(true);
                setHandle(event.target.value);
              }}
            />
            <p id={`${formId}-slug-hint`} className="text-muted-foreground text-sm">
              {k.handleHint}
            </p>
            {slugError !== undefined && (
              <p id={`${formId}-slug-error`} className="text-destructive text-sm">
                {slugError}
              </p>
            )}
          </div>
          {state.status === "error" && Object.keys(fieldErrors).length === 0 && (
            <p role="alert" className="text-destructive text-sm">
              {state.message}
            </p>
          )}
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? k.saving : k.save}
        </Button>
      </div>
    </form>
  );
}
