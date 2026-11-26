"use client";

import { MoreHorizontalIcon } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@platform/ui";
import type { StaffMemberView } from "@/lib/staff/roles";
import type { Dictionary } from "@/messages/en";

export type RowAction = "role" | "reset" | "deactivate" | "reactivate" | "resend" | "revoke";

/**
 * Which actions a row offers. The owner and the signed-in member offer none (the server refuses them
 * anyway). Wave 1f: "Reset two-step" is for someone who has two-step on and is not a pending invitee.
 */
export function rowActionsOf(member: StaffMemberView): readonly RowAction[] {
  if (member.isOwner || member.isSelf) return [];
  const actions: RowAction[] = ["role"];
  if (member.twoStep && member.invitation === null) actions.push("reset");
  if (member.status === "active") actions.push("deactivate");
  if (member.status === "deactivated") actions.push("reactivate");
  if (member.invitation !== null) actions.push("resend", "revoke");
  return actions;
}

/**
 * The per-row actions menu. Dialog-opening items hand the choice to the panel, which renders the
 * dialog OUTSIDE the menu (a dialog inside a menu item would unmount with it); the menu then must
 * not pull focus back to its button, because the dialog owns focus from that moment.
 */
export function StaffRowActions({
  member,
  t,
  busy,
  registerTrigger,
  onChoose,
  keepFocusAway,
}: {
  readonly member: StaffMemberView;
  readonly t: Dictionary;
  readonly busy: boolean;
  readonly registerTrigger: (id: string, element: HTMLButtonElement | null) => void;
  readonly onChoose: (action: RowAction, member: StaffMemberView) => void;
  /** Called with `true` right before a dialog opens, so the menu skips its own focus return. */
  readonly keepFocusAway: { current: boolean };
}) {
  const actions = rowActionsOf(member);
  if (actions.length === 0) return null;
  const label = t.users.menu.label.replace("{email}", member.email);
  const names: Record<RowAction, string> = {
    role: t.users.menu.changeRole,
    reset: t.users.menu.resetTwoStep,
    deactivate: t.users.menu.deactivate,
    reactivate: t.users.menu.reactivate,
    resend: t.users.menu.resend,
    revoke: t.users.menu.revoke,
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={(element) => registerTrigger(member.principalExternalId, element)}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          loading={busy}
        >
          <MoreHorizontalIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (!keepFocusAway.current) return;
          keepFocusAway.current = false;
          event.preventDefault();
        }}
      >
        {actions.map((action) => (
          <DropdownMenuItem
            key={action}
            disabled={busy}
            onSelect={() => {
              keepFocusAway.current =
                action === "role" ||
                action === "reset" ||
                action === "deactivate" ||
                action === "revoke";
              onChoose(action, member);
            }}
          >
            {names[action]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
