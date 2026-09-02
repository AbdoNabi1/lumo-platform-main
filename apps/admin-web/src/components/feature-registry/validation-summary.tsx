import { AlertTriangleIcon, LockIcon } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import type { FetchRegistryValidationResult } from "@/lib/api/feature-registry";
import type { Dictionary } from "@/messages/en";
import { InlineState } from "./state-panels";

/**
 * The whole-registry validation report as a pass/fail summary with its failures listed (T3.4
 * brief) — `GET /feature-registry/validate`'s `RegistryValidationReport` (`valid` +
 * `issues[]`, `FeatureRegistryValidator`). Always visible above the tabs, never folded into an
 * empty table on failure.
 */
export function ValidationSummary({
  result,
  t,
}: {
  readonly result: FetchRegistryValidationResult;
  readonly t: Dictionary;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.featureRegistryPage.validationTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        {result.outcome === "unauthorized" ? (
          <InlineState
            icon={<LockIcon aria-hidden="true" className="size-5" />}
            message={t.featureRegistryPage.validationUnauthorized}
          />
        ) : result.outcome === "error" ? (
          <InlineState
            icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
            message={t.featureRegistryPage.validationError}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <Badge variant={result.data.valid ? "success" : "destructive"}>
              {result.data.valid
                ? t.featureRegistryPage.validationPass
                : t.featureRegistryPage.validationFail}
            </Badge>
            {result.data.issues.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t.featureRegistryPage.validationIssuesEmpty}
              </p>
            ) : (
              <Table aria-label={t.featureRegistryPage.validationTitle}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.featureRegistryPage.validationColumns.severity}</TableHead>
                    <TableHead>{t.featureRegistryPage.validationColumns.key}</TableHead>
                    <TableHead>{t.featureRegistryPage.validationColumns.code}</TableHead>
                    <TableHead>{t.featureRegistryPage.validationColumns.message}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.data.issues.map((issue, index) => (
                    <TableRow key={`${issue.key}-${issue.code}-${index}`}>
                      <TableCell>
                        <Badge variant={issue.severity === "error" ? "destructive" : "warning"}>
                          {issue.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{issue.key}</TableCell>
                      <TableCell>{issue.code}</TableCell>
                      <TableCell>{issue.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
