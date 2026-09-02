import { AlertTriangleIcon, LockIcon, SearchXIcon } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import type { BundleOutputDto } from "@/lib/api/feature-registry";
import type { Dictionary } from "@/messages/en";
import { StatePanel } from "./state-panels";

export type BundlesPanelResult =
  | { readonly outcome: "ok"; readonly data: readonly BundleOutputDto[] }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** The commercial bundle catalog table (`GET /feature-registry/bundles`) — the Bundles tab. */
export function BundlesPanel({
  result,
  t,
}: {
  readonly result: BundlesPanelResult;
  readonly t: Dictionary;
}) {
  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.featureRegistryPage.bundlesUnauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.featureRegistryPage.bundlesError}
      />
    );
  }
  if (result.data.length === 0) {
    return (
      <StatePanel
        icon={<SearchXIcon aria-hidden="true" className="size-5" />}
        message={t.featureRegistryPage.bundlesEmpty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <Table aria-label={t.featureRegistryPage.tabs.bundles}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.featureRegistryPage.bundlesColumns.key}</TableHead>
              <TableHead>{t.featureRegistryPage.bundlesColumns.name}</TableHead>
              <TableHead>{t.featureRegistryPage.bundlesColumns.status}</TableHead>
              <TableHead>{t.featureRegistryPage.bundlesColumns.features}</TableHead>
              <TableHead>{t.featureRegistryPage.bundlesColumns.groups}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.map((bundle) => (
              <TableRow key={bundle.key}>
                <TableCell className="font-medium">{bundle.key}</TableCell>
                <TableCell>{bundle.name}</TableCell>
                <TableCell>
                  <Badge variant="neutral">{bundle.status}</Badge>
                </TableCell>
                <TableCell>
                  {bundle.featureKeys.length > 0
                    ? bundle.featureKeys.join(", ")
                    : t.featureRegistryPage.none}
                </TableCell>
                <TableCell>
                  {bundle.groups.length > 0 ? bundle.groups.join(", ") : t.featureRegistryPage.none}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
