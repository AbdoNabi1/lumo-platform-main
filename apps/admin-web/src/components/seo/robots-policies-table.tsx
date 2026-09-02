import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { RobotsPolicyDto } from "@/lib/api/seo";
import type { Dictionary } from "@/messages/en";

export function RobotsPoliciesTable({
  policies,
  t,
}: {
  readonly policies: readonly RobotsPolicyDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.robotsPoliciesPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.robotsPoliciesPage.columns.userAgent}</TableHead>
          <TableHead>{t.robotsPoliciesPage.columns.rules}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {policies.map((policy) => (
          <TableRow key={policy.id}>
            <TableCell className="font-mono text-xs font-medium">
              <Link
                href={`/seo/robots-policies/new?policyId=${encodeURIComponent(policy.id)}`}
                className="hover:text-primary"
                aria-label={t.robotsPoliciesPage.editPolicy.replace("{userAgent}", policy.userAgent)}
              >
                {policy.userAgent}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground font-mono text-xs">
              {policy.rules.length === 0
                ? t.robotsPoliciesPage.noRules
                : policy.rules.map((rule) => `${rule.type}: ${rule.path}`).join(", ")}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
