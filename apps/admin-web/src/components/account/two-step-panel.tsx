"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CopyIcon, DownloadIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { Badge, Button, Card, CardContent, Input, Label } from "@platform/ui";
import {
  confirmTwoStepAction,
  disableTwoStepAction,
  regenerateBackupCodesAction,
  startTwoStepAction,
  type TwoStepActionResult,
} from "@/app/account/security/actions";
import {
  DialogError,
  StaffDialog,
  StaffDialogFooter,
} from "@/components/settings/users/staff-dialog";
import { formatMediumDate, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { groupManualKey, type OwnTwoStepStatus, type TwoStepSetup } from "@/lib/staff/two-step";
import type { Dictionary } from "@/messages/en";

type Phase =
  | { readonly kind: "overview" }
  | { readonly kind: "setup"; readonly setup: TwoStepSetup }
  | { readonly kind: "codes"; readonly codes: readonly string[]; readonly fresh: boolean };

type DialogKind = "regenerate" | "disable";

interface Notice {
  readonly tone: "success" | "error";
  readonly text: string;
}

const DOWNLOAD_NAME = "morbeh-backup-codes.txt";

/**
 * The member's own two-step verification: off → set up (manual key + `otpauth://` link + first code) →
 * the 10 backup codes once → on (status, new backup codes, turn off).
 *
 * The TOTP secret, the link and the backup codes live ONLY in this component's state, handed over by
 * the server actions' return values: never a URL, a cookie, a log or a server component. They are
 * dropped the moment setup is cancelled or "Done" is pressed. The request owner is this component (like
 * the Users panel): dismissing a dialog never cancels or forgets the request, and a result that lands
 * after the dialog closed still applies (new backup codes are shown, never lost). Focus: initial focus
 * is Cancel on the destructive confirm; closing returns to a still-mounted trigger (after a successful
 * turn-off, to the button that replaced it).
 */
export function TwoStepPanel({
  status,
  t,
  locale,
}: {
  readonly status: OwnTwoStepStatus;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const k = t.accountSecurity;
  const [phase, setPhaseState] = useState<Phase>({ kind: "overview" });
  const phaseRef = useRef<Phase>({ kind: "overview" });
  /** A local truth that wins only until the server re-renders this page with a NEW `status`. */
  const [override, setOverride] = useState<{
    readonly base: OwnTwoStepStatus;
    readonly value: OwnTwoStepStatus;
  } | null>(null);
  const live = override !== null && override.base === status ? override.value : status;

  const [dialog, setDialogState] = useState<DialogKind | null>(null);
  const dialogRef = useRef<DialogKind | null>(null);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const pendingRef = useRef<Set<string>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [fieldError, setFieldError] = useState<{
    readonly scope: "confirm" | DialogKind;
    readonly message: string;
  } | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [regenerateCode, setRegenerateCode] = useState("");
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<"key" | "codes" | null>(null);

  const turnOnButton = useRef<HTMLButtonElement>(null);
  const turnOffButton = useRef<HTMLButtonElement>(null);
  const newCodesButton = useRef<HTMLButtonElement>(null);
  const codesHeading = useRef<HTMLHeadingElement>(null);
  const lastDialog = useRef<DialogKind>("regenerate");
  const afterClose = useRef<(() => void) | null>(null);
  const previousKind = useRef<Phase["kind"]>("overview");

  function setPhase(next: Phase): void {
    phaseRef.current = next;
    setPhaseState(next);
  }

  function setDialog(next: DialogKind | null): void {
    dialogRef.current = next;
    setDialogState(next);
  }

  // Focus follows the phase: the codes heading when the codes appear, the primary button when we
  // come back to the overview. Never on the first render.
  useEffect(() => {
    const before = previousKind.current;
    previousKind.current = phase.kind;
    if (before === phase.kind) return;
    if (phase.kind === "codes") codesHeading.current?.focus();
    else if (phase.kind === "overview") {
      (turnOnButton.current ?? newCodesButton.current ?? turnOffButton.current)?.focus();
    }
  }, [phase.kind]);

  function setPending(key: string, on: boolean): void {
    if (on) pendingRef.current.add(key);
    else pendingRef.current.delete(key);
    setPendingKeys(new Set(pendingRef.current));
  }

  /** Runs one request, once per key at a time. `null` = one with this key is already in flight. */
  async function run<T>(
    key: string,
    call: () => Promise<TwoStepActionResult<T>>,
  ): Promise<TwoStepActionResult<T> | null> {
    if (pendingRef.current.has(key)) return null;
    setPending(key, true);
    setNotice(null);
    let result: TwoStepActionResult<T>;
    try {
      result = await call();
    } catch {
      result = { status: "error", reason: "unexpected", message: t.formErrors.unexpected };
    }
    setPending(key, false);
    return result;
  }

  function showCodes(codes: readonly string[], fresh: boolean): void {
    setSaved(false);
    setCopied(null);
    setPhase({ kind: "codes", codes, fresh });
    setOverride({
      base: status,
      value: {
        ...live,
        enabled: true,
        activatedAt: live.activatedAt ?? new Date().toISOString(),
        backupCodesLeft: codes.length,
      },
    });
  }

  async function start(): Promise<void> {
    const result = await run("start", startTwoStepAction);
    if (result === null) return;
    if (result.status === "ok") {
      setConfirmCode("");
      setFieldError(null);
      setCopied(null);
      setPhase({ kind: "setup", setup: result.data });
      return;
    }
    setNotice({ tone: "error", text: result.message });
  }

  function cancelSetup(): void {
    setConfirmCode("");
    setFieldError(null);
    setCopied(null);
    setPhase({ kind: "overview" });
  }

  async function confirm(setup: TwoStepSetup): Promise<void> {
    const result = await run("confirm", () =>
      confirmTwoStepAction({ enrollmentId: setup.enrollmentId, code: confirmCode }),
    );
    if (result === null) return;
    if (result.status === "ok") {
      // Two-step IS on now, whether or not the setup panel is still showing: the codes must be seen.
      setConfirmCode("");
      setFieldError(null);
      showCodes(result.data.backupCodes, true);
      return;
    }
    if (result.reason === "expired") {
      setConfirmCode("");
      setFieldError(null);
      setPhase({ kind: "overview" });
      setNotice({ tone: "error", text: result.message });
      return;
    }
    if (phaseRef.current.kind === "setup")
      setFieldError({ scope: "confirm", message: result.message });
    else setNotice({ tone: "error", text: result.message });
  }

  function done(): void {
    setSaved(false);
    setCopied(null);
    setPhase({ kind: "overview" });
    setNotice({ tone: "success", text: k.notices.enabled });
  }

  function openDialog(kind: DialogKind): void {
    lastDialog.current = kind;
    afterClose.current = null;
    setFieldError(null);
    setRegenerateCode("");
    setPassword("");
    setDialog(kind);
  }

  function closeDialog(): void {
    setDialog(null);
    setFieldError(null);
    setRegenerateCode("");
    setPassword("");
  }

  /** A refusal: inside the dialog while it is open, else in the page notice. */
  function refused(kind: DialogKind, reason: string, message: string): void {
    if (reason === "policy_required") {
      setOverride({ base: status, value: { ...live, policyRequired: true } });
    }
    if (dialogRef.current === kind) setFieldError({ scope: kind, message });
    else setNotice({ tone: "error", text: message });
  }

  async function regenerate(): Promise<void> {
    const result = await run("regenerate", () =>
      regenerateBackupCodesAction({ code: regenerateCode }),
    );
    if (result === null) return;
    if (result.status === "ok") {
      afterClose.current = () => codesHeading.current?.focus();
      if (dialogRef.current === "regenerate") closeDialog();
      showCodes(result.data.backupCodes, false);
      return;
    }
    refused("regenerate", result.reason, result.message);
  }

  async function disable(): Promise<void> {
    const result = await run("disable", () => disableTwoStepAction({ password }));
    if (result === null) return;
    if (result.status === "ok") {
      afterClose.current = () => turnOnButton.current?.focus();
      setOverride({
        base: status,
        value: { ...live, enabled: false, activatedAt: null, backupCodesLeft: 0 },
      });
      setNotice({ tone: "success", text: k.notices.disabled });
      if (dialogRef.current === "disable") closeDialog();
      return;
    }
    refused("disable", result.reason, result.message);
  }

  function onCloseAutoFocus(event: Event): void {
    event.preventDefault();
    const custom = afterClose.current;
    afterClose.current = null;
    if (custom !== null) {
      custom();
      return;
    }
    (lastDialog.current === "disable" ? turnOffButton.current : newCodesButton.current)?.focus();
  }

  async function copy(text: string, what: "key" | "codes"): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      // Clipboard blocked: the text is still on screen for the person to select.
    }
  }

  function download(codes: readonly string[]): void {
    const text = `${k.codes.fileHeading}\n\n${codes.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = DOWNLOAD_NAME;
    link.click();
    URL.revokeObjectURL(url);
  }

  const starting = pendingKeys.has("start");
  const confirming = pendingKeys.has("confirm");
  const regenerating = pendingKeys.has("regenerate");
  const disabling = pendingKeys.has("disable");
  const errorHere = (scope: "confirm" | DialogKind): string | null =>
    fieldError !== null && fieldError.scope === scope ? fieldError.message : null;

  return (
    <div className="flex flex-col gap-4">
      {notice !== null && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={
            notice.tone === "error"
              ? "bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm"
              : "bg-success-subtle text-success-foreground flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm"
          }
        >
          <p className="flex-1">{notice.text}</p>
          <button
            type="button"
            aria-label={k.notices.dismiss}
            className="shrink-0 rounded-sm p-0.5"
            onClick={() => setNotice(null)}
          >
            <XIcon aria-hidden="true" className="size-4" />
          </button>
        </div>
      )}

      {phase.kind === "overview" && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={live.enabled ? "success" : "neutral"}>
                {live.enabled ? k.statusOn : k.statusOff}
              </Badge>
              {live.enabled && live.activatedAt !== null && (
                <span className="text-muted-foreground text-sm">
                  {k.onSince.replace("{date}", formatMediumDate(locale, live.activatedAt))}
                </span>
              )}
            </div>
            {live.enabled ? (
              <>
                <p className="text-sm">
                  {k.codesLeft.replace("{count}", formatNumber(locale, live.backupCodesLeft))}
                </p>
                {live.policyRequired && (
                  <p className="text-muted-foreground text-sm">{k.policyOnNote}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    ref={newCodesButton}
                    type="button"
                    variant="outline"
                    onClick={() => openDialog("regenerate")}
                  >
                    {k.newCodes}
                  </Button>
                  {!live.policyRequired && (
                    <Button
                      ref={turnOffButton}
                      type="button"
                      variant="outline"
                      onClick={() => openDialog("disable")}
                    >
                      {k.turnOff}
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="text-muted-foreground text-sm">{k.offBody}</p>
                {live.policyRequired && <p className="text-sm">{k.policyOffNote}</p>}
                <div>
                  <Button
                    ref={turnOnButton}
                    type="button"
                    loading={starting}
                    disabled={starting}
                    onClick={() => void start()}
                  >
                    {starting ? k.starting : k.turnOn}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {phase.kind === "setup" && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <h2 className="text-lg font-semibold">{k.setup.title}</h2>
            <p className="text-sm">{k.setup.step1}</p>
            <div className="flex flex-col gap-1.5">
              <span id="two-step-key-label" className="text-sm font-medium">
                {k.setup.keyLabel}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <code
                  dir="ltr"
                  aria-labelledby="two-step-key-label"
                  className="bg-muted break-all rounded-xl px-3 py-2 text-base tracking-wider"
                >
                  {groupManualKey(phase.setup.manualKey)}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copy(phase.setup.manualKey, "key")}
                >
                  <CopyIcon aria-hidden="true" />
                  {copied === "key" ? k.setup.copied : k.setup.copy}
                </Button>
              </div>
            </div>
            <p className="text-sm">
              <a href={phase.setup.provisioningUri} className="text-primary underline">
                <ExternalLinkIcon aria-hidden="true" className="me-1 inline size-4" />
                {k.setup.openInApp}
              </a>
            </p>
            <p className="text-sm">{k.setup.step2}</p>
            <form
              className="flex flex-col gap-3"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                if (confirmCode.trim().length > 0) void confirm(phase.setup);
              }}
            >
              <div className="flex max-w-xs flex-col gap-1.5">
                <Label htmlFor="two-step-code">{k.setup.codeLabel}</Label>
                <Input
                  id="two-step-code"
                  name="code"
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={confirmCode}
                  onChange={(event) => setConfirmCode(event.target.value)}
                />
              </div>
              {errorHere("confirm") !== null && (
                <p role="alert" className="text-destructive text-sm">
                  {errorHere("confirm")}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  loading={confirming}
                  disabled={confirming || confirmCode.trim().length === 0}
                >
                  {confirming ? k.setup.confirming : k.setup.confirm}
                </Button>
                <Button type="button" variant="outline" onClick={cancelSetup}>
                  {k.setup.cancel}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {phase.kind === "codes" && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <h2 ref={codesHeading} tabIndex={-1} className="text-lg font-semibold outline-none">
              {phase.fresh ? k.codes.title : k.codes.regeneratedTitle}
            </h2>
            <p className="text-sm">{k.codes.body}</p>
            <ul aria-label={k.codes.listLabel} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {phase.codes.map((code) => (
                <li key={code} className="bg-muted rounded-xl px-3 py-2 text-base tracking-wider">
                  <bdi dir="ltr">{code}</bdi>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copy(phase.codes.join("\n"), "codes")}
              >
                <CopyIcon aria-hidden="true" />
                {copied === "codes" ? k.codes.copied : k.codes.copyAll}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => download(phase.codes)}
              >
                <DownloadIcon aria-hidden="true" />
                {k.codes.download}
              </Button>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={saved}
                onChange={(event) => setSaved(event.target.checked)}
              />
              <span>{k.codes.savedLabel}</span>
            </label>
            <div>
              <Button type="button" disabled={!saved} onClick={done}>
                {k.codes.done}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <StaffDialog
        open={dialog === "regenerate"}
        onOpenChange={(next) => {
          if (!next && dialogRef.current === "regenerate") closeDialog();
        }}
        title={k.regenerate.title}
        description={k.regenerate.description}
        initialFocus="field"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (regenerateCode.trim().length > 0) void regenerate();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="two-step-regenerate-code">{k.regenerate.codeLabel}</Label>
            <Input
              id="two-step-regenerate-code"
              name="code"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={regenerateCode}
              onChange={(event) => setRegenerateCode(event.target.value)}
            />
          </div>
          <DialogError message={errorHere("regenerate")} />
          <StaffDialogFooter
            cancelLabel={k.regenerate.cancel}
            submitLabel={k.regenerate.submit}
            pendingLabel={k.regenerate.submitting}
            pending={regenerating}
            destructive={false}
            submitType="submit"
            onCancel={closeDialog}
          />
        </form>
      </StaffDialog>

      <StaffDialog
        open={dialog === "disable"}
        onOpenChange={(next) => {
          if (!next && dialogRef.current === "disable") closeDialog();
        }}
        title={k.disable.title}
        description={k.disable.description}
        initialFocus="cancel"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (password.length > 0) void disable();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="two-step-disable-password">{k.disable.passwordLabel}</Label>
            <Input
              id="two-step-disable-password"
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={256}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <DialogError message={errorHere("disable")} />
          <StaffDialogFooter
            cancelLabel={k.disable.cancel}
            submitLabel={k.disable.confirm}
            pendingLabel={k.disable.confirming}
            pending={disabling}
            destructive
            submitType="submit"
            onCancel={closeDialog}
          />
        </form>
      </StaffDialog>
    </div>
  );
}
