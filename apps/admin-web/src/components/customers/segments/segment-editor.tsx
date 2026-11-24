"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import {
  createSegmentAction,
  previewSegmentAction,
  updateSegmentAction,
  type SegmentFormState,
} from "@/app/customers/segments/actions";
import type { SegmentCondition } from "@/lib/api/customer-segments";
import {
  conditionFromDraft,
  conditionsFromDrafts,
  draftFromCondition,
  MAX_SEGMENT_CONDITIONS,
  newDraft,
  type ConditionDraft,
} from "@/lib/customers/segment-draft";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { SegmentConditionRow } from "./segment-condition-row";
import { SegmentPreview, type PreviewView } from "./segment-preview";

/** The pause after the last edit before the preview asks the API. */
export const PREVIEW_DEBOUNCE_MS = 400;

const IDLE: SegmentFormState = { status: "idle" };

/**
 * The segment editor: a name, up to ten ANDed condition rows, a live preview and Save. Used to
 * create a segment (`mode="create"`, possibly prefilled from a duplicate), to edit a custom one
 * (`mode="edit"`, which carries the loaded `version` for the stale-write check) and — with
 * `readOnly` — to show a default segment or to show a viewer a segment they may not change.
 *
 * Only a COMPLETE set of rows is sent to the preview; the newest answer wins (an older, slower
 * answer is dropped). Money is typed in major units of the shop currency and converted to minor
 * units here, never with floating point.
 */
export function SegmentEditor({
  t,
  locale,
  currency,
  mode,
  segmentId,
  version,
  initialName,
  initialConditions,
  readOnly,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly currency: string;
  readonly mode: "create" | "edit";
  readonly segmentId?: string;
  /** The loaded version of a custom segment; sent back as `expectedVersion`. */
  readonly version?: number | null;
  readonly initialName: string;
  readonly initialConditions: readonly SegmentCondition[];
  readonly readOnly: boolean;
}) {
  const k = t.segments.editor;
  const router = useRouter();
  const nextRowId = useRef(0);
  const makeRowId = (): string => `row-${(nextRowId.current += 1)}`;

  const [name, setName] = useState(initialName);
  const [rows, setRows] = useState<readonly ConditionDraft[]>(() =>
    initialConditions.length > 0
      ? initialConditions.map((condition) => draftFromCondition(condition, currency, makeRowId()))
      : [newDraft(makeRowId())],
  );
  const [state, setState] = useState<SegmentFormState>(IDLE);
  const [attempted, setAttempted] = useState(false);
  const [saving, startSaving] = useTransition();
  const [preview, setPreview] = useState<PreviewView>({ status: "idle" });
  const [previewErrors, setPreviewErrors] = useState<Readonly<Record<string, string>>>({});
  const latestPreview = useRef(0);

  const conditions = useMemo(() => conditionsFromDrafts(rows, currency), [rows, currency]);
  const conditionsKey = conditions === null ? null : JSON.stringify(conditions);
  const savedKey = useMemo(() => {
    const saved = conditionsFromDrafts(
      initialConditions.map((condition, index) =>
        draftFromCondition(condition, currency, String(index)),
      ),
      currency,
    );
    return saved === null ? null : JSON.stringify(saved);
  }, [initialConditions, currency]);
  // An existing segment already shows its members below; the preview is for changes to it.
  const showPreview = !readOnly && (mode === "create" || conditionsKey !== savedKey);

  useEffect(() => {
    if (!showPreview || conditions === null) {
      setPreview({ status: "idle" });
      setPreviewErrors({});
      return;
    }
    setPreview({ status: "loading" });
    const mine = (latestPreview.current += 1);
    const timer = setTimeout(() => {
      void previewSegmentAction(conditions).then(
        (result) => {
          if (mine !== latestPreview.current) return; // a newer edit superseded this answer
          if (result.status === "ok") {
            setPreview({ status: "ok", page: result.page });
            setPreviewErrors({});
          } else if (result.status === "unavailable") {
            setPreview({ status: "unavailable" });
          } else {
            setPreview({ status: "error" });
            setPreviewErrors(result.fieldErrors);
          }
        },
        () => {
          if (mine === latestPreview.current) setPreview({ status: "error" });
        },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      latestPreview.current += 1; // drop any answer still in flight for these conditions
    };
    // `conditionsKey` stands for `conditions`: equal conditions must not restart the debounce.
  }, [conditionsKey, showPreview]);

  const serverErrors = state.status === "error" ? state.fieldErrors : {};
  const fieldErrors: Readonly<Record<string, string>> = { ...previewErrors, ...serverErrors };
  const stale = state.status === "error" && state.message === t.segments.errors.stale;

  function rowErrors(index: number, draft: ConditionDraft): string[] {
    const messages: string[] = [];
    if (attempted) {
      const result = conditionFromDraft(draft, currency);
      if (!result.ok) messages.push(k.errors[result.error]);
    }
    for (const [path, message] of Object.entries(fieldErrors)) {
      if (path === `conditions.${index}` || path.startsWith(`conditions.${index}.`)) {
        messages.push(message);
      }
    }
    return messages;
  }

  function edited(): void {
    if (state.status === "error" && !stale) setState(IDLE);
    else if (state.status === "success") setState(IDLE);
  }

  function updateRow(id: string, next: ConditionDraft): void {
    edited();
    setRows((current) => current.map((row) => (row.id === id ? next : row)));
  }

  function removeRow(id: string): void {
    edited();
    setRows((current) => (current.length > 1 ? current.filter((row) => row.id !== id) : current));
  }

  function addRow(): void {
    edited();
    setRows((current) =>
      current.length >= MAX_SEGMENT_CONDITIONS ? current : [...current, newDraft(makeRowId())],
    );
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (readOnly || saving) return;
    setAttempted(true);
    const complete = conditionsFromDrafts(rows, currency);
    if (complete === null) return;
    startSaving(async () => {
      const result =
        mode === "create" || segmentId === undefined
          ? await createSegmentAction({ name, conditions: complete })
          : await updateSegmentAction(segmentId, {
              expectedVersion: version ?? 0,
              name,
              conditions: complete,
            });
      setState(result);
    });
  }

  const atLimit = rows.length >= MAX_SEGMENT_CONDITIONS;
  const nameError = fieldErrors["name"];
  const conditionsError = fieldErrors["conditions"];
  const showBanner = state.status === "error" && state.message !== nameError;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      {showBanner && state.status === "error" && (
        <div
          role="alert"
          className="bg-destructive-subtle text-destructive-subtle-foreground flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-base"
        >
          <p>{state.message}</p>
          {stale && (
            <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>
              {k.reload}
            </Button>
          )}
        </div>
      )}
      {state.status === "success" && (
        <p
          role="status"
          className="bg-success-subtle text-success-foreground rounded-2xl px-4 py-3 text-base"
        >
          {k.saved}
        </p>
      )}

      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          <Label htmlFor="segment-name">{k.nameLabel}</Label>
          <Input
            id="segment-name"
            dir="auto"
            value={name}
            placeholder={k.namePlaceholder}
            disabled={readOnly}
            aria-invalid={nameError !== undefined || undefined}
            aria-describedby={nameError === undefined ? undefined : "segment-name-error"}
            onChange={(event) => {
              edited();
              setName(event.target.value);
            }}
          />
          {nameError !== undefined && (
            <p id="segment-name-error" role="alert" className="text-destructive text-sm">
              {nameError}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{k.conditionsHeading}</CardTitle>
          <p className="text-muted-foreground text-sm">{k.conditionsHint}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {conditionsError !== undefined && (
            <p role="alert" className="text-destructive text-sm">
              {conditionsError}
            </p>
          )}
          {rows.map((row, index) => (
            <SegmentConditionRow
              key={row.id}
              t={t}
              currency={currency}
              index={index}
              draft={row}
              errors={rowErrors(index, row)}
              disabled={readOnly}
              canRemove={rows.length > 1}
              onChange={(next) => updateRow(row.id, next)}
              onRemove={() => removeRow(row.id)}
            />
          ))}
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={atLimit} onClick={addRow}>
                <PlusIcon aria-hidden="true" />
                {k.addCondition}
              </Button>
              {atLimit && (
                <p className="text-muted-foreground text-sm">
                  {k.conditionLimit.replace("{max}", String(MAX_SEGMENT_CONDITIONS))}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {showPreview && <SegmentPreview view={preview} t={t} locale={locale} />}

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button asChild variant="outline">
            <Link href="/customers/segments">{k.cancel}</Link>
          </Button>
          <Button type="submit" loading={saving} disabled={saving}>
            {saving ? k.saving : k.save}
          </Button>
        </div>
      )}
    </form>
  );
}
