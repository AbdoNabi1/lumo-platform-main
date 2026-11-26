"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AlertTriangleIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@platform/ui";
import {
  changeStaffRoleAction,
  inviteStaffAction,
  resendInvitationAction,
  resetStaffTwoStepAction,
  revokeInvitationAction,
  setStaffActiveAction,
  type StaffActionState,
} from "@/app/settings/users/actions";
import type { StaffMemberView, StaffRole } from "@/lib/staff/roles";
import type { StaffSecurityPolicy } from "@/lib/staff/two-step";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { ChangeRoleForm } from "./change-role-form";
import { InviteStaffForm } from "./invite-staff-form";
import { DialogError, StaffDialog, StaffDialogFooter } from "./staff-dialog";
import type { RowAction } from "./staff-row-actions";
import { StaffTable } from "./staff-table";
import { TwoStepPolicyCard } from "./two-step-policy-card";
import { WithEmail } from "./with-email";

type DialogKind = "invite" | "role" | "reset" | "deactivate" | "revoke";

interface Target {
  readonly kind: DialogKind;
  /** The member's `principalExternalId`; `null` for the invite dialog. */
  readonly id: string | null;
}

interface Notice {
  readonly tone: "success" | "error";
  readonly template: string;
  readonly email: string | null;
}

const keyOf = (kind: string, id: string | null): string => `${kind}:${id ?? ""}`;
const targetKey = (target: Target | null): string | null =>
  target === null ? null : keyOf(target.kind, target.id);

/**
 * Settings > Users and permissions, the interactive part: header with "Add staff", the page-level
 * notice and the "email couldn't be sent" banner, the table, and the four dialogs.
 *
 * This component OWNS every in-flight request and its outcome (like the Files browser): dismissing
 * a dialog — Escape, Cancel, the close button, also while it is busy — never cancels or forgets the
 * request. A refusal while the dialog is open shows inside it; a refusal that lands after it was
 * dismissed shows in the page notice; success closes it. Focus rules: initial focus is Cancel for
 * the destructive confirms (the first field for the forms); closing returns focus to the row's
 * actions button, which is still mounted; after a revoke, focus moves to the next surviving row's
 * actions button, else the previous, else "Add staff" — never to `body`.
 */
export function StaffPanel({
  members,
  policy,
  t,
  locale,
  nowIso,
}: {
  readonly members: readonly StaffMemberView[];
  /** The store's two-step policy; `null` when it could not be loaded (the card says so). */
  readonly policy: StaffSecurityPolicy | null;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly nowIso: string;
}) {
  const k = t.users;
  const [target, setTarget] = useState<Target | null>(null);
  const targetRef = useRef<Target | null>(null);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const pendingRef = useRef<Set<string>>(new Set());
  const [dialogError, setDialogError] = useState<{
    readonly key: string;
    readonly message: string;
    readonly fieldErrors: Readonly<Record<string, string>>;
  } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** The email whose invitation was saved but not delivered (502): the banner offers Resend. */
  const [undelivered, setUndelivered] = useState<string | null>(null);

  const addButton = useRef<HTMLButtonElement>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const menuKeepsFocusAway = useRef(false);
  /** Where focus goes when the open dialog closes; `null` = the member's own actions button. */
  const afterClose = useRef<(() => void) | null>(null);
  const returnTo = useRef<string | null>(null);
  const membersRef = useRef(members);
  membersRef.current = members;

  const memberOf = (id: string | null): StaffMemberView | undefined =>
    members.find((member) => member.principalExternalId === id);

  function registerTrigger(id: string, element: HTMLButtonElement | null): void {
    if (element === null) triggers.current.delete(id);
    else triggers.current.set(id, element);
  }

  function focusTriggerOf(id: string | null): void {
    const element = id === null ? null : triggers.current.get(id);
    (element ?? addButton.current)?.focus();
  }

  /** The next surviving row's actions button, else the previous, else "Add staff". */
  function focusSurvivor(id: string): void {
    const rows = membersRef.current;
    const index = rows.findIndex((member) => member.principalExternalId === id);
    const around = [...rows.slice(index + 1), ...rows.slice(0, Math.max(index, 0)).reverse()];
    for (const member of around) {
      const element = triggers.current.get(member.principalExternalId);
      if (element !== undefined) {
        element.focus();
        return;
      }
    }
    addButton.current?.focus();
  }

  function open(next: Target): void {
    returnTo.current = next.id;
    afterClose.current = null;
    targetRef.current = next;
    setTarget(next);
    setDialogError(null);
  }

  function close(): void {
    targetRef.current = null;
    setTarget(null);
  }

  function setPending(key: string, on: boolean): void {
    if (on) pendingRef.current.add(key);
    else pendingRef.current.delete(key);
    setPendingKeys(new Set(pendingRef.current));
  }

  /** Runs one request, once per key at a time. `null` = one with this key is already in flight. */
  async function run(
    key: string,
    call: () => Promise<StaffActionState>,
  ): Promise<StaffActionState | null> {
    if (pendingRef.current.has(key)) return null;
    setPending(key, true);
    setNotice(null);
    let result: StaffActionState;
    try {
      result = await call();
    } catch {
      result = { status: "error", message: t.formErrors.unexpected, fieldErrors: {} };
    }
    setPending(key, false);
    return result;
  }

  /** An error from a request: inside its dialog while it is open, else in the page notice. */
  function showError(key: string, result: Extract<StaffActionState, { status: "error" }>): void {
    if (targetKey(targetRef.current) === key) {
      setDialogError({ key, message: result.message, fieldErrors: result.fieldErrors });
    } else {
      setNotice({ tone: "error", template: result.message, email: null });
    }
  }

  async function submitInvite(input: { email: string; role: StaffRole }): Promise<void> {
    const key = keyOf("invite", null);
    const result = await run(key, () => inviteStaffAction(input));
    if (result === null) return;
    if (result.status === "success") {
      setUndelivered(null);
      setNotice({ tone: "success", template: k.notices.invited, email: input.email });
      if (targetKey(targetRef.current) === key) close();
      return;
    }
    if (result.code === "EMAIL_FAILED") {
      // The invitation IS saved: leave the dialog and offer Resend.
      setUndelivered(input.email);
      if (targetKey(targetRef.current) === key) close();
      return;
    }
    showError(key, result);
  }

  async function submitRole(member: StaffMemberView, role: StaffRole): Promise<void> {
    const key = keyOf("role", member.principalExternalId);
    const result = await run(key, () => changeStaffRoleAction(member.principalExternalId, role));
    if (result === null) return;
    if (result.status === "success") {
      if (targetKey(targetRef.current) === key) close();
      return;
    }
    showError(key, result);
  }

  async function submitDeactivate(member: StaffMemberView): Promise<void> {
    const key = keyOf("deactivate", member.principalExternalId);
    const result = await run(key, () => setStaffActiveAction(member.principalExternalId, false));
    if (result === null) return;
    if (result.status === "success") {
      if (targetKey(targetRef.current) === key) close();
      return;
    }
    showError(key, result);
  }

  async function submitReset(member: StaffMemberView): Promise<void> {
    const key = keyOf("reset", member.principalExternalId);
    const result = await run(key, () => resetStaffTwoStepAction(member.principalExternalId));
    if (result === null) return;
    if (result.status === "success") {
      // Say it in the page too: the dialog may already have been dismissed while this was in flight.
      setNotice({ tone: "success", template: k.notices.twoStepReset, email: member.email });
      if (targetKey(targetRef.current) === key) close();
      return;
    }
    showError(key, result);
  }
  async function submitRevoke(member: StaffMemberView): Promise<void> {
    if (member.invitation === null) return;
    const key = keyOf("revoke", member.principalExternalId);
    const invitation = member.invitation;
    const result = await run(key, () => revokeInvitationAction(invitation.id, invitation.version));
    if (result === null) return;
    if (result.status === "success") {
      // The row is about to disappear: focus goes to a row that survives, not back to it.
      if (targetKey(targetRef.current) === key) {
        afterClose.current = () => focusSurvivor(member.principalExternalId);
        close();
      } else {
        const active = document.activeElement;
        const own = triggers.current.get(member.principalExternalId);
        if (active === null || active === document.body || active === own) {
          focusSurvivor(member.principalExternalId);
        }
      }
      return;
    }
    showError(key, result);
  }

  async function reactivate(member: StaffMemberView): Promise<void> {
    const key = keyOf("reactivate", member.principalExternalId);
    const result = await run(key, () => setStaffActiveAction(member.principalExternalId, true));
    if (result === null) return;
    setNotice(
      result.status === "success"
        ? { tone: "success", template: k.notices.reactivated, email: member.email }
        : { tone: "error", template: result.message, email: null },
    );
  }

  async function resend(member: StaffMemberView): Promise<void> {
    if (member.invitation === null) return;
    const invitation = member.invitation;
    const key = keyOf("resend", member.principalExternalId);
    const result = await run(key, () => resendInvitationAction(invitation.id, invitation.version));
    if (result === null) return;
    if (result.status === "success") {
      if (undelivered?.toLowerCase() === member.email) setUndelivered(null);
      setNotice({ tone: "success", template: k.notices.resent, email: member.email });
      return;
    }
    setNotice({ tone: "error", template: result.message, email: null });
  }

  function choose(action: RowAction, member: StaffMemberView): void {
    const id = member.principalExternalId;
    if (action === "role") open({ kind: "role", id });
    else if (action === "reset") open({ kind: "reset", id });
    else if (action === "deactivate") open({ kind: "deactivate", id });
    else if (action === "revoke") open({ kind: "revoke", id });
    else if (action === "reactivate") void reactivate(member);
    else void resend(member);
  }

  const busyIds = new Set<string>();
  for (const key of pendingKeys) {
    const [kind = "", id = ""] = key.split(":");
    if (kind === "reactivate" || kind === "resend") busyIds.add(id);
  }

  const targetMember = target === null ? undefined : memberOf(target.id);
  const currentKey = targetKey(target);
  const pending = currentKey !== null && pendingKeys.has(currentKey);
  const errorHere = dialogError !== null && dialogError.key === currentKey ? dialogError : null;
  const undeliveredMember =
    undelivered === null
      ? undefined
      : members.find((member) => member.email === undelivered.toLowerCase());

  function onOpenChange(kind: DialogKind) {
    return (next: boolean): void => {
      if (next) return;
      if (targetRef.current?.kind === kind) close();
    };
  }

  function onCloseAutoFocus(event: Event): void {
    event.preventDefault();
    const custom = afterClose.current;
    afterClose.current = null;
    if (custom !== null) custom();
    else focusTriggerOf(returnTo.current);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{k.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{k.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/settings/users/activity">{k.viewActivity}</Link>
          </Button>
          <Button ref={addButton} type="button" onClick={() => open({ kind: "invite", id: null })}>
            <PlusIcon aria-hidden="true" />
            {k.addStaff}
          </Button>
        </div>
      </header>

      {undelivered !== null && (
        <div
          role="alert"
          className="bg-warning-subtle text-warning-foreground flex flex-wrap items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm"
        >
          <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
          <p className="flex-1">
            <WithEmail template={k.banner.emailFailed} email={undelivered} />
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              undeliveredMember === undefined ||
              pendingKeys.has(keyOf("resend", undeliveredMember.principalExternalId))
            }
            onClick={() => {
              if (undeliveredMember !== undefined) void resend(undeliveredMember);
            }}
          >
            {undeliveredMember !== undefined &&
            pendingKeys.has(keyOf("resend", undeliveredMember.principalExternalId))
              ? k.banner.resending
              : k.banner.resend}
          </Button>
        </div>
      )}

      {notice !== null && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={
            notice.tone === "error"
              ? "bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm"
              : "bg-success-subtle text-success-foreground flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm"
          }
        >
          <p className="flex-1">
            {notice.email === null ? (
              notice.template
            ) : (
              <WithEmail template={notice.template} email={notice.email} />
            )}
          </p>
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

      <TwoStepPolicyCard policy={policy} members={members} t={t} />

      <StaffTable
        members={members}
        t={t}
        locale={locale}
        nowIso={nowIso}
        busyIds={busyIds}
        registerTrigger={registerTrigger}
        onChoose={choose}
        keepFocusAway={menuKeepsFocusAway}
      />

      <StaffDialog
        open={target?.kind === "invite"}
        onOpenChange={onOpenChange("invite")}
        title={k.invite.title}
        description={k.invite.description}
        initialFocus="field"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <InviteStaffForm
          t={t}
          pending={pending}
          error={errorHere?.message ?? null}
          fieldError={errorHere?.fieldErrors["email"] ?? null}
          onCancel={close}
          onSubmit={(input) => void submitInvite(input)}
        />
      </StaffDialog>

      <StaffDialog
        open={target?.kind === "role" && targetMember !== undefined}
        onOpenChange={onOpenChange("role")}
        title={k.changeRole.title}
        description={
          targetMember === undefined ? (
            ""
          ) : (
            <WithEmail template={k.changeRole.description} email={targetMember.email} />
          )
        }
        initialFocus="field"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {targetMember !== undefined && (
          <ChangeRoleForm
            key={targetMember.principalExternalId}
            t={t}
            current={targetMember.role === "owner" ? "admin" : targetMember.role}
            pending={pending}
            error={errorHere?.message ?? null}
            onCancel={close}
            onSubmit={(role) => void submitRole(targetMember, role)}
          />
        )}
      </StaffDialog>

      <StaffDialog
        open={target?.kind === "deactivate" && targetMember !== undefined}
        onOpenChange={onOpenChange("deactivate")}
        title={k.deactivate.title}
        description={
          targetMember === undefined ? (
            ""
          ) : (
            <WithEmail template={k.deactivate.body} email={targetMember.email} />
          )
        }
        initialFocus="cancel"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogError message={errorHere?.message ?? null} />
        <StaffDialogFooter
          cancelLabel={k.deactivate.cancel}
          submitLabel={k.deactivate.confirm}
          pendingLabel={k.deactivate.deactivating}
          pending={pending}
          destructive
          submitType="button"
          onCancel={close}
          onSubmit={() => {
            if (targetMember !== undefined) void submitDeactivate(targetMember);
          }}
        />
      </StaffDialog>

      <StaffDialog
        open={target?.kind === "reset" && targetMember !== undefined}
        onOpenChange={onOpenChange("reset")}
        title={k.resetTwoStep.title}
        description={
          targetMember === undefined ? (
            ""
          ) : (
            <>
              <WithEmail template={k.resetTwoStep.body} email={targetMember.email} />
              <span className="mt-1 block">{k.resetTwoStep.hint}</span>
            </>
          )
        }
        initialFocus="cancel"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogError message={errorHere?.message ?? null} />
        <StaffDialogFooter
          cancelLabel={k.resetTwoStep.cancel}
          submitLabel={k.resetTwoStep.confirm}
          pendingLabel={k.resetTwoStep.resetting}
          pending={pending}
          destructive
          submitType="button"
          onCancel={close}
          onSubmit={() => {
            if (targetMember !== undefined) void submitReset(targetMember);
          }}
        />
      </StaffDialog>
      <StaffDialog
        open={target?.kind === "revoke" && targetMember !== undefined}
        onOpenChange={onOpenChange("revoke")}
        title={k.revoke.title}
        description={
          targetMember === undefined ? (
            ""
          ) : (
            <WithEmail template={k.revoke.body} email={targetMember.email} />
          )
        }
        initialFocus="cancel"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogError message={errorHere?.message ?? null} />
        <StaffDialogFooter
          cancelLabel={k.revoke.cancel}
          submitLabel={k.revoke.confirm}
          pendingLabel={k.revoke.revoking}
          pending={pending}
          destructive
          submitType="button"
          onCancel={close}
          onSubmit={() => {
            if (targetMember !== undefined) void submitRevoke(targetMember);
          }}
        />
      </StaffDialog>
    </div>
  );
}
