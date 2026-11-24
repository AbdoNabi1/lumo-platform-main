"use client";

import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { StaffMemberView, StaffStatus } from "@/lib/api/staff";
import type { Locale } from "@/lib/i18n";
import { formatLastSignedIn } from "@/lib/staff/last-signed-in";
import type { Dictionary } from "@/messages/en";
import { StaffRowActions, type RowAction } from "./staff-row-actions";

const STATUS_VARIANT: Record<StaffStatus, "success" | "info" | "warning" | "neutral"> = {
  active: "success",
  invited: "info",
  invitation_expired: "warning",
  deactivated: "neutral",
};

/**
 * The staff table: email (isolated in a `<bdi>`, with "(you)" on your own row), role (the Owner
 * badge for the owner), status badge, last signed in, and the row's actions menu. The owner's and
 * your own rows have no actions at all; the server is still the authority for every action.
 */
export function StaffTable({
  members,
  t,
  locale,
  nowIso,
  busyIds,
  registerTrigger,
  onChoose,
  keepFocusAway,
}: {
  readonly members: readonly StaffMemberView[];
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly nowIso: string;
  readonly busyIds: ReadonlySet<string>;
  readonly registerTrigger: (id: string, element: HTMLButtonElement | null) => void;
  readonly onChoose: (action: RowAction, member: StaffMemberView) => void;
  readonly keepFocusAway: { current: boolean };
}) {
  const k = t.users;
  return (
    <Table aria-label={k.listLabel}>
      <TableHeader>
        <TableRow>
          <TableHead>{k.columns.email}</TableHead>
          <TableHead>{k.columns.role}</TableHead>
          <TableHead>{k.columns.status}</TableHead>
          <TableHead>{k.columns.lastSignedIn}</TableHead>
          <TableHead>
            <span className="sr-only">{k.columns.actions}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.principalExternalId}>
            <TableCell className="font-medium">
              <bdi dir="auto">{member.email}</bdi>
              {member.isSelf && <span className="text-muted-foreground ms-1.5">{k.you}</span>}
            </TableCell>
            <TableCell>
              {member.isOwner ? (
                <Badge variant="accent">{k.roles.owner}</Badge>
              ) : (
                k.roles[member.role === "owner" ? "admin" : member.role]
              )}
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[member.status]}>{k.statuses[member.status]}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatLastSignedIn(member.lastSignInAt, nowIso, locale, t)}
            </TableCell>
            <TableCell className="text-end">
              <StaffRowActions
                member={member}
                t={t}
                busy={busyIds.has(member.principalExternalId)}
                registerTrigger={registerTrigger}
                onChoose={onChoose}
                keepFocusAway={keepFocusAway}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
