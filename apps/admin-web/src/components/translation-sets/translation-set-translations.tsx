"use client";

import { useActionState, useId } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { publishTranslationAction, setTranslationAction } from "@/app/translation-sets/actions";
import type { FormState } from "@/lib/api/mutation";
import type { TranslationDto } from "@/lib/api/localization";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

function FormError({ state }: { readonly state: FormState }) {
  if (state.status !== "error") return null;
  return (
    <p role="alert" className="text-destructive text-xs">
      {state.message}
    </p>
  );
}

/**
 * One translation row's "Publish" action (`POST /translation-sets/:id/translations/publish`).
 * Offered unconditionally per row, per the task brief — the `TranslationDto.status` enum isn't
 * confirmed beyond the field existing, so a same-status resubmit is a harmless no-op/backend-
 * rejected attempt rather than a fabricated client-side gate on an unverified enum.
 */
function PublishRowForm({
  translationSetId,
  translationKey,
  t,
}: {
  readonly translationSetId: string;
  readonly translationKey: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(publishTranslationAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="translationSetId" value={translationSetId} />
      <input type="hidden" name="key" value={translationKey} />
      <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
        {isPending
          ? t.translationSetTranslations.publishing
          : t.translationSetTranslations.publish}
      </Button>
      <FormError state={state} />
    </form>
  );
}

/** The "upsert translation" key/value form (`POST /translation-sets/:id/translations`). */
function UpsertTranslationForm({
  translationSetId,
  t,
}: {
  readonly translationSetId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(setTranslationAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="translationSetId" value={translationSetId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-key`}>{t.translationSetTranslations.keyLabel}</Label>
          <Input
            id={`${formId}-key`}
            name="key"
            aria-invalid={fieldErrors["key"] !== undefined || undefined}
          />
          {fieldErrors["key"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["key"]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-value`}>{t.translationSetTranslations.valueLabel}</Label>
          <Input
            id={`${formId}-value`}
            name="value"
            aria-invalid={fieldErrors["value"] !== undefined || undefined}
          />
          {fieldErrors["value"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["value"]}</p>
          )}
        </div>
      </div>
      <div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending
            ? t.translationSetTranslations.saving
            : t.translationSetTranslations.save}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/**
 * The Translation Set Detail screen's translations table + write controls (T5.11a): the existing
 * `translations` array (key/value/status), an upsert form to add or replace one entry, and a
 * per-row "Publish" action. No delete route exists for a translation entry.
 */
export function TranslationSetTranslations({
  translationSetId,
  translations,
  t,
}: {
  readonly translationSetId: string;
  readonly translations: readonly TranslationDto[];
  readonly t: Dictionary;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.translationSetTranslations.title}</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {translations.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-sm sm:px-5">
              {t.translationSetTranslations.empty}
            </p>
          ) : (
            <Table aria-label={t.translationSetTranslations.title}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.translationSetTranslations.keyLabel}</TableHead>
                  <TableHead>{t.translationSetTranslations.valueLabel}</TableHead>
                  <TableHead>{t.translationSetTranslations.statusLabel}</TableHead>
                  <TableHead className="text-end">
                    {t.translationSetTranslations.actionsLabel}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {translations.map((translation) => (
                  <TableRow key={translation.key}>
                    <TableCell className="font-mono text-sm">{translation.key}</TableCell>
                    <TableCell className="max-w-md">{translation.value}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {translation.status}
                    </TableCell>
                    <TableCell className="text-end">
                      <PublishRowForm
                        translationSetId={translationSetId}
                        translationKey={translation.key}
                        t={t}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.translationSetTranslations.upsertTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <UpsertTranslationForm translationSetId={translationSetId} t={t} />
        </CardContent>
      </Card>
    </div>
  );
}
