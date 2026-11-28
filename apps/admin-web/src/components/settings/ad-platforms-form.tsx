"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@platform/ui";
import { saveAdPlatformAction } from "@/app/settings/ad-platforms/actions";
import { Switch } from "@/components/products/editor/controls";
import { Field } from "@/components/products/editor/field";
import {
  AD_PLATFORM_SPECS,
  idValuesOf,
  maskedToken,
  statusOf,
  type AdPlatformFormState,
  type AdPlatformSpec,
  type AdPlatformStatus,
  type ConnectionViewDto,
} from "@/lib/ad-platforms-model";
import type { Dictionary } from "@/messages/en";
import { AdPlatformRemoveTokenDialog } from "./ad-platform-remove-token-dialog";
import { AdPlatformTestCodeWarning, AdPlatformTestEvent } from "./ad-platform-test-event";

const INITIAL_STATE: AdPlatformFormState = { status: "idle" };
const NO_ERRORS: Readonly<Record<string, string>> = {};

/** What is typed in a card. The token is only ever typed text here: it is cleared after a save. */
interface Draft {
  readonly enabled: boolean;
  readonly ids: Readonly<Record<string, string>>;
  readonly testEventCode: string;
  readonly secret: string;
}

function draftOf(view: ConnectionViewDto): Draft {
  const spec = AD_PLATFORM_SPECS[view.platform];
  const saved = idValuesOf(view);
  return {
    enabled: view.enabled,
    ids: Object.fromEntries(spec.idInputs.map((input) => [input.name, saved[input.name] ?? ""])),
    testEventCode: view.testEventCode ?? "",
    secret: "",
  };
}

function isDirty(draft: Draft, view: ConnectionViewDto): boolean {
  const original = draftOf(view);
  return (
    draft.secret !== "" ||
    draft.enabled !== original.enabled ||
    draft.testEventCode.trim() !== original.testEventCode ||
    Object.keys(original.ids).some((name) => (draft.ids[name] ?? "").trim() !== original.ids[name])
  );
}

const STATUS_VARIANT: Readonly<Record<AdPlatformStatus, "success" | "warning" | "neutral">> = {
  live: "success",
  incomplete: "warning",
  off: "neutral",
};

function statusLabel(status: AdPlatformStatus, copy: Dictionary["adPlatformsSettings"]): string {
  return status === "live"
    ? copy.statusLive
    : status === "incomplete"
      ? copy.statusIncomplete
      : copy.statusOff;
}

/** A sentence with `{last4}` filled in; the digits are isolated so they never reorder the sentence. */
function WithLast4({ template, last4 }: { readonly template: string; readonly last4: string }) {
  const [before = "", after = ""] = template.split("{last4}");
  return (
    <>
      {before}
      <bdi dir="ltr">{last4}</bdi>
      {after}
    </>
  );
}

function IdInputs({
  spec,
  draft,
  errors,
  disabled,
  onChange,
  t,
}: {
  readonly spec: AdPlatformSpec;
  readonly draft: Draft;
  readonly errors: Readonly<Record<string, string>>;
  readonly disabled: boolean;
  readonly onChange: (name: string, value: string) => void;
  readonly t: Dictionary;
}): ReactNode {
  const copy = t.adPlatformsSettings;
  return spec.idInputs.map((input) => (
    <Field key={input.name} label={copy[input.name]} name={input.name} error={errors[input.name]}>
      {(control) => (
        <Input
          {...control}
          type="text"
          dir="ltr"
          inputMode={input.inputMode}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={input.placeholder}
          disabled={disabled}
          value={draft.ids[input.name] ?? ""}
          onChange={(event) => onChange(input.name, event.target.value)}
        />
      )}
    </Field>
  ));
}

/**
 * One platform: its own `<form>` (one save = one platform, one Idempotency-Key). The card keeps the
 * latest view in state, seeded from props and replaced by the action's answer, and posts that view's
 * version, so a second save does not conflict with the first. A newer version from the server (someone
 * else saved; a reload) replaces what is typed. The token is write-only: an empty box keeps the saved
 * one, the box is cleared after every answer, and only its last four digits are ever shown.
 */
function AdPlatformCard({ view, t }: { readonly view: ConnectionViewDto; readonly t: Dictionary }) {
  const copy = t.adPlatformsSettings;
  const spec = AD_PLATFORM_SPECS[view.platform];
  const headingId = useId();
  const [state, formAction, isPending] = useActionState(saveAdPlatformAction, INITIAL_STATE);
  const [saved, setSaved] = useState(view);
  const [draft, setDraft] = useState<Draft>(() => draftOf(view));
  const [seen, setSeen] = useState(view);
  const removing = useRef(false);
  const tokenInput = useRef<HTMLInputElement>(null);

  if (view !== seen) {
    setSeen(view);
    if (view.version > saved.version) {
      setSaved(view);
      setDraft(draftOf(view));
    }
  }

  useEffect(() => {
    if (state.status === "idle") return;
    const wasRemoving = removing.current;
    removing.current = false;
    // A refusal keeps what was typed, so it can be fixed and sent again.
    if (state.status === "error") return;
    setSaved(state.view);
    // A saved token is never kept in the page: the box is empty again. A removal saves nothing else,
    // so what was typed beside it stays; any other save makes the saved view the draft.
    setDraft((current) => (wasRemoving ? { ...current, secret: "" } : draftOf(state.view)));
    // The "Remove token" button is gone now that no token is saved: keyboard focus goes to the box.
    if (wasRemoving) tokenInput.current?.focus();
  }, [state]);

  const dirty = isDirty(draft, saved);
  const errors = state.status === "error" ? (state.fieldErrors ?? NO_ERRORS) : NO_ERRORS;
  const status = statusOf(saved);
  const tokenSaved = saved.secret.configured;

  /** Removes the saved token and nothing else: the request is built from the saved view, not the typed draft. */
  const removeToken = () => {
    const data = new FormData();
    data.set("platform", saved.platform);
    data.set("expectedVersion", String(saved.version));
    if (saved.enabled) data.set("enabled", "on");
    for (const [name, value] of Object.entries(idValuesOf(saved))) data.set(name, value);
    if (spec.testEventCode) data.set("testEventCode", saved.testEventCode ?? "");
    data.set("clearSecret", "on");
    removing.current = true;
    startTransition(() => formAction(data));
  };

  return (
    <form action={formAction} aria-labelledby={headingId} noValidate>
      <input type="hidden" name="platform" value={saved.platform} />
      <input type="hidden" name="expectedVersion" value={saved.version} />
      <Card>
        <CardHeader>
          <CardTitle id={headingId}>
            <bdi dir="auto">{spec.label}</bdi>
          </CardTitle>
          <Badge variant={STATUS_VARIANT[status]} data-testid={`ad-status-${saved.platform}`}>
            {statusLabel(status, copy)}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Switch
            label={copy.enabled}
            name="enabled"
            checked={draft.enabled}
            disabled={isPending}
            onCheckedChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
            className="font-medium"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <IdInputs
              spec={spec}
              draft={draft}
              errors={errors}
              disabled={isPending}
              onChange={(name, value) =>
                setDraft((current) => ({ ...current, ids: { ...current.ids, [name]: value } }))
              }
              t={t}
            />
          </div>

          {spec.serverToken && (
            <div className="flex flex-col gap-2">
              <Field
                label={copy.token}
                name="secret"
                error={errors["secret"]}
                hint={tokenSaved ? copy.tokenKeep : copy.tokenNone}
              >
                {(control) => (
                  <Input
                    {...control}
                    ref={tokenInput}
                    type="password"
                    dir="ltr"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={tokenSaved ? maskedToken(saved.secret.last4) : undefined}
                    disabled={isPending}
                    value={draft.secret}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, secret: event.target.value }))
                    }
                  />
                )}
              </Field>
              {tokenSaved && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p
                    className="text-muted-foreground text-sm"
                    data-testid={`ad-token-${saved.platform}`}
                  >
                    <WithLast4 template={copy.tokenSaved} last4={saved.secret.last4 ?? ""} />
                  </p>
                  <AdPlatformRemoveTokenDialog
                    vendor={spec.label}
                    disabled={isPending}
                    onConfirm={removeToken}
                    t={t}
                  />
                </div>
              )}
            </div>
          )}

          {spec.testEventCode && (
            <Field
              label={copy.testEventCode}
              name="testEventCode"
              error={errors["testEventCode"]}
              hint={copy.testEventCodeHint}
            >
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  dir="ltr"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  disabled={isPending}
                  value={draft.testEventCode}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, testEventCode: event.target.value }))
                  }
                />
              )}
            </Field>
          )}

          {spec.testEventCode && (saved.testEventCode ?? "") !== "" && (
            <AdPlatformTestCodeWarning platform={saved.platform} t={t} />
          )}

          {spec.testEvent && (
            <AdPlatformTestEvent
              platform={saved.platform}
              typedCode={spec.testEventCode ? draft.testEventCode : ""}
              t={t}
            />
          )}

          {!spec.serverToken && (
            <p role="note" className="text-muted-foreground text-sm">
              {copy.googleNote}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {state.status === "error" && (
              <p role="alert" className="text-destructive me-auto text-sm">
                {state.message}
              </p>
            )}
            {state.status === "success" && !dirty && (
              <p role="status" className="text-muted-foreground me-auto text-sm">
                {copy.saved}
              </p>
            )}
            {dirty && <span className="text-muted-foreground text-sm">{copy.unsaved}</span>}
            <Button type="submit" loading={isPending} disabled={!dirty || isPending}>
              {isPending ? copy.saving : copy.save}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

/**
 * Settings > Ad platforms: one card per platform in the platform order (Meta, TikTok, Snapchat, GA4,
 * Google Ads), under a note on which events this kind of site sends.
 */
export function AdPlatformsForm({
  views,
  siteType,
  t,
}: {
  readonly views: readonly ConnectionViewDto[];
  /** Fixed at sign-up; undefined when the settings could not be read (the note is then left out). */
  readonly siteType: "store" | "lead_site" | undefined;
  readonly t: Dictionary;
}) {
  const copy = t.adPlatformsSettings;
  return (
    <div className="flex flex-col gap-4">
      {siteType !== undefined && (
        <p role="note" className="text-muted-foreground text-sm">
          {siteType === "lead_site" ? copy.siteTypeLead : copy.siteTypeStore}
        </p>
      )}
      {views.map((view) => (
        <AdPlatformCard key={view.platform} view={view} t={t} />
      ))}
    </div>
  );
}
