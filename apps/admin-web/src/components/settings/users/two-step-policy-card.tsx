"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { Badge, Card, CardContent, Switch } from "@platform/ui";
import { setRequireTwoStepAction, type StaffActionState } from "@/app/settings/users/actions";
import type { StaffMemberView } from "@/lib/staff/roles";
import type { StaffSecurityPolicy } from "@/lib/staff/two-step";
import type { Dictionary } from "@/messages/en";
import { DialogError, StaffDialog, StaffDialogFooter } from "./staff-dialog";

type DialogKind = "enable" | "disable";
type Blocker = keyof Dictionary["usersPolicy"]["errors"];

interface Notice {
  readonly tone: "success" | "error";
  readonly text: string;
}

/**
 * Why "require two-step for everyone" cannot be turned on yet, in the order the server checks (so the
 * screen names the same reason a refusal would): the code step isn't live on this server, you haven't
 * turned yours on, someone else hasn't, a pending invitation. `null` = nothing in the way (the server
 * still decides). Pure.
 */
export function policyBlocker(
  policy: StaffSecurityPolicy,
  members: readonly StaffMemberView[],
): Blocker | null {
  const self = members.find((member) => member.isSelf);
  if (!policy.codeStepAvailable) return "unavailable";
  if (self !== undefined && !self.twoStep) return "selfFirst";
  if (policy.notEnrolled.length > 0) return "everyoneFirst";
  if (policy.pendingInvitations > 0) return "pendingInvitations";
  return null;
}

/**
 * Settings > Users and permissions > the "Require two-step verification for everyone" switch.
 *
 * The switch always shows the SERVER's value: clicking it only asks for confirmation (a real dialog,
 * initial focus on Cancel), and the answer, not the click, flips it. When it can't be turned on the
 * reason is shown with the people who still have no two-step (emails isolated in `<bdi>`). Like the
 * Users panel, this component owns its request: dismissing the dialog (Escape included, also while it
 * is busy) never cancels it, and an outcome that lands after dismissal shows in the card's notice.
 */
export function TwoStepPolicyCard({
  policy,
  members,
  t,
}: {
  readonly policy: StaffSecurityPolicy | null;
  readonly members: readonly StaffMemberView[];
  readonly t: Dictionary;
}) {
  const k = t.usersPolicy;
  const [override, setOverride] = useState<{
    readonly base: StaffSecurityPolicy;
    readonly value: boolean;
  } | null>(null);
  const [dialog, setDialogState] = useState<DialogKind | null>(null);
  const dialogRef = useRef<DialogKind | null>(null);
  const [pending, setPending] = useState<ReadonlySet<DialogKind>>(new Set());
  const pendingRef = useRef<Set<DialogKind>>(new Set());
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const switchRef = useRef<HTMLInputElement>(null);

  if (policy === null) {
    return (
      <Card>
        <CardContent className="pt-6">
          <h2 className="text-base font-semibold">{k.title}</h2>
          <p role="alert" className="text-muted-foreground mt-1 text-sm">
            {k.loadError}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Wave 1f (D29): while Morbeh requires two-step for everyone the per-store switch is gone: a read-only note.
  if (policy.platformRequired === true) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{k.title}</h2>
            <p role="note" className="text-muted-foreground mt-1 text-sm">
              {k.platformNote}
            </p>
          </div>
          <Badge variant="success">{k.platformRequired}</Badge>
        </CardContent>
      </Card>
    );
  }
  const on = override !== null && override.base === policy ? override.value : policy.requireTwoStep;
  const blocker = on ? null : policyBlocker(policy, members);
  const showMissing = !on && policy.notEnrolled.length > 0;

  function setDialog(next: DialogKind | null): void {
    dialogRef.current = next;
    setDialogState(next);
  }

  function open(kind: DialogKind): void {
    setDialogError(null);
    setDialog(kind);
  }

  function close(): void {
    setDialog(null);
    setDialogError(null);
  }

  async function submit(kind: DialogKind): Promise<void> {
    if (pendingRef.current.has(kind) || policy === null) return;
    const enabled = kind === "enable";
    pendingRef.current.add(kind);
    setPending(new Set(pendingRef.current));
    setNotice(null);
    let result: StaffActionState;
    try {
      result = await setRequireTwoStepAction(enabled);
    } catch {
      result = { status: "error", message: t.formErrors.unexpected, fieldErrors: {} };
    }
    pendingRef.current.delete(kind);
    setPending(new Set(pendingRef.current));
    if (result.status === "success") {
      setOverride({ base: policy, value: enabled });
      setNotice({ tone: "success", text: enabled ? k.notices.enabled : k.notices.disabled });
      if (dialogRef.current === kind) close();
      return;
    }
    if (dialogRef.current === kind) setDialogError(result.message);
    else setNotice({ tone: "error", text: result.message });
  }

  function onCloseAutoFocus(event: Event): void {
    event.preventDefault();
    switchRef.current?.focus();
  }

  const pendingHere = (kind: DialogKind): boolean => pending.has(kind);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{k.title}</h2>
            <p id="two-step-policy-description" className="text-muted-foreground mt-1 text-sm">
              {k.description}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Badge variant={on ? "success" : "neutral"}>{on ? k.stateOn : k.stateOff}</Badge>
            <span>{k.switchLabel}</span>
            <Switch
              ref={switchRef}
              checked={on}
              disabled={blocker !== null}
              aria-describedby="two-step-policy-description"
              onCheckedChange={() => open(on ? "disable" : "enable")}
            />
          </label>
        </div>

        {blocker !== null && (
          <div
            role="note"
            className="bg-warning-subtle text-warning-foreground rounded-xl px-3.5 py-2.5 text-sm"
          >
            <p className="font-medium">{k.cantEnable}</p>
            <p>{k.errors[blocker]}</p>
            {blocker === "selfFirst" && (
              <p className="mt-1">
                <Link href="/account/security" className="underline">
                  {k.accountLink}
                </Link>
              </p>
            )}
          </div>
        )}
        {showMissing && (
          <div className="text-sm">
            <p className="text-muted-foreground">{k.missingHeading}</p>
            <ul className="mt-1 list-disc ps-5">
              {policy.notEnrolled.map((member) => (
                <li key={member.principalExternalId}>
                  <bdi dir="auto" className="text-foreground font-medium">
                    {member.email}
                  </bdi>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <StaffDialog
        open={dialog === "enable"}
        onOpenChange={(next) => {
          if (!next && dialogRef.current === "enable") close();
        }}
        title={k.enable.title}
        description={k.enable.description}
        initialFocus="cancel"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogError message={dialog === "enable" ? dialogError : null} />
        <StaffDialogFooter
          cancelLabel={k.enable.cancel}
          submitLabel={k.enable.confirm}
          pendingLabel={k.enable.confirming}
          pending={pendingHere("enable")}
          destructive={false}
          submitType="button"
          onCancel={close}
          onSubmit={() => void submit("enable")}
        />
      </StaffDialog>

      <StaffDialog
        open={dialog === "disable"}
        onOpenChange={(next) => {
          if (!next && dialogRef.current === "disable") close();
        }}
        title={k.disable.title}
        description={k.disable.description}
        initialFocus="cancel"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogError message={dialog === "disable" ? dialogError : null} />
        <StaffDialogFooter
          cancelLabel={k.disable.cancel}
          submitLabel={k.disable.confirm}
          pendingLabel={k.disable.confirming}
          pending={pendingHere("disable")}
          destructive
          submitType="button"
          onCancel={close}
          onSubmit={() => void submit("disable")}
        />
      </StaffDialog>
    </Card>
  );
}
