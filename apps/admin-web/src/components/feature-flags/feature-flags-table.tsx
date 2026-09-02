import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import type { FeatureFlagDto } from "@/lib/api/feature-flags";
import type { Dictionary } from "@/messages/en";
import { FeatureFlagStatusBadge } from "./feature-flag-status-badge";

export function FeatureFlagsTable({
  flags,
  t,
}: {
  readonly flags: readonly FeatureFlagDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.featureFlagsPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.featureFlagsPage.columns.key}</TableHead>
          <TableHead>{t.featureFlagsPage.columns.name}</TableHead>
          <TableHead>{t.featureFlagsPage.columns.rollout}</TableHead>
          <TableHead>{t.featureFlagsPage.columns.status}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {flags.map((flag) => (
          <TableRow key={flag.id}>
            <TableCell className="font-mono text-sm font-medium whitespace-nowrap">
              <Link href={`/feature-flags/${flag.id}`} className="hover:text-primary">
                {flag.key}
              </Link>
            </TableCell>
            <TableCell className="whitespace-nowrap">{flag.name}</TableCell>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              {flag.rolloutPercentage}%
            </TableCell>
            <TableCell>
              <FeatureFlagStatusBadge status={flag.status} t={t} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
