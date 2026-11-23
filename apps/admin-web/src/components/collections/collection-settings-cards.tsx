"use client";

import { useActionState, useId, useState } from "react";
import { CheckIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
} from "@platform/ui";
import { renameCollectionAction, setCollectionStatusAction } from "@/app/collections/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/** The Title card: rename the collection. The handle (its address) is shown, not editable. */
export function CollectionTitleCard({
  collectionId,
  name,
  slug,
  t,
}: {
  readonly collectionId: string;
  readonly name: string;
  readonly slug: string;
  readonly t: Dictionary;
}) {
  const k = t.collections.form;
  const [state, formAction, isPending] = useActionState(renameCollectionAction, INITIAL_STATE);
  const formId = useId();
  const [value, setValue] = useState(name);
  const fieldError = state.status === "error" ? state.fieldErrors["name"] : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{k.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="collectionId" value={collectionId} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-name`} className="sr-only">
              {k.title}
            </Label>
            <Input
              id={`${formId}-name`}
              name="name"
              dir="auto"
              maxLength={255}
              value={value}
              aria-invalid={fieldError !== undefined || undefined}
              aria-describedby={fieldError !== undefined ? `${formId}-name-error` : undefined}
              onChange={(event) => setValue(event.target.value)}
            />
            {fieldError !== undefined && (
              <p id={`${formId}-name-error`} className="text-destructive text-sm">
                {fieldError}
              </p>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {k.handle}: <bdi dir="ltr">{slug}</bdi>
          </p>
          {state.status === "error" && fieldError === undefined && (
            <p role="alert" className="text-destructive text-sm">
              {state.message}
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            {state.status === "success" && (
              <p role="status" className="text-muted-foreground flex items-center gap-1 text-sm">
                <CheckIcon aria-hidden="true" className="size-3.5" />
                {k.saved}
              </p>
            )}
            <Button
              type="submit"
              size="sm"
              loading={isPending}
              disabled={isPending || value.trim() === name}
            >
              {isPending ? k.saving : k.save}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** The Status card: Active (published) or Draft — Save publishes or unpublishes. */
export function CollectionStatusCard({
  collectionId,
  status,
  t,
}: {
  readonly collectionId: string;
  readonly status: "draft" | "published";
  readonly t: Dictionary;
}) {
  const k = t.collections;
  const [state, formAction, isPending] = useActionState(setCollectionStatusAction, INITIAL_STATE);
  const formId = useId();
  const [value, setValue] = useState<"draft" | "published">(status);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{k.statusCard.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="collectionId" value={collectionId} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-status`} className="sr-only">
              {k.statusCard.label}
            </Label>
            <NativeSelect
              id={`${formId}-status`}
              name="value"
              value={value}
              aria-describedby={`${formId}-status-hint`}
              onChange={(event) =>
                setValue(event.target.value === "published" ? "published" : "draft")
              }
            >
              <option value="published">{k.statusPublished}</option>
              <option value="draft">{k.statusDraft}</option>
            </NativeSelect>
            <p id={`${formId}-status-hint`} className="text-muted-foreground text-sm">
              {k.statusCard.hint}
            </p>
          </div>
          {state.status === "error" && (
            <p role="alert" className="text-destructive text-sm">
              {state.message}
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            {state.status === "success" && (
              <p role="status" className="text-muted-foreground flex items-center gap-1 text-sm">
                <CheckIcon aria-hidden="true" className="size-3.5" />
                {k.form.saved}
              </p>
            )}
            <Button
              type="submit"
              size="sm"
              loading={isPending}
              disabled={isPending || value === status}
            >
              {isPending ? k.form.saving : k.form.save}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
