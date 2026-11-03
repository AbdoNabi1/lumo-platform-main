"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { restoreReleaseAction } from "@/app/online-store/themes/actions";
import type { ReleaseDto } from "@/lib/api/online-store";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * The last releases, newest first. Restore copies a release into the DRAFT only (Ruling 6); the live
 * store changes when that draft is previewed and published. Admin only: disabled with the reason
 * for everyone else, and refused by the API anyway. Restoring replaces the draft for good, so it
 * always asks first, like Discard (I-3): the page's unpublished flag may be stale.
 */
export function ReleaseHistory({
  t,
  locale,
  releases,
  version,
  isAdmin,
  loadFailed = false,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly releases: readonly ReleaseDto[];
  readonly version: number;
  readonly isAdmin: boolean;
  readonly loadFailed?: boolean;
}) {
  const s = t.onlineStoreThemes;
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const number = new Intl.NumberFormat(locale);
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const restore = (releaseNumber: number) =>
    start(async () => {
      const result = await restoreReleaseAction(releaseNumber, version);
      setConfirming(null);
      setMessage(
        result.status === "ok"
          ? s.restored
          : result.status === "conflict"
            ? t.onlineStoreCustomize.conflict
            : result.status === "not_found"
              ? s.releaseNotFound
              : result.status === "forbidden"
                ? t.formErrors.forbidden
                : t.formErrors.unexpected,
      );
      router.refresh();
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{s.history}</CardTitle>
      </CardHeader>
      <CardContent>
        {loadFailed ? (
          <p role="alert" className="text-destructive text-sm">
            {s.historyError}
          </p>
        ) : releases.length === 0 ? (
          <p className="text-muted-foreground text-sm">{s.noReleases}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{s.releaseNumber}</TableHead>
                <TableHead>{s.releaseDate}</TableHead>
                <TableHead>{s.releaseBy}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {releases.map((release) => (
                <TableRow key={release.releaseNumber}>
                  <TableCell>{number.format(release.releaseNumber)}</TableCell>
                  <TableCell>{dates.format(new Date(release.publishedAt))}</TableCell>
                  <TableCell>
                    {release.publishedByName === null ? (
                      s.staff
                    ) : (
                      <bdi dir="auto">{release.publishedByName}</bdi>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!isAdmin || pending}
                      title={isAdmin ? undefined : s.adminOnlyRestore}
                      onClick={() => setConfirming(release.releaseNumber)}
                    >
                      {s.restore}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {message === null ? null : (
          <p role="status" className="mt-3 text-sm">
            {message}
          </p>
        )}
      </CardContent>
      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => setConfirming(open ? confirming : null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {s.restoreTitle.replace("{number}", number.format(confirming ?? 0))}
            </DialogTitle>
            <DialogDescription>{s.restoreBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirming(null)}>
              {s.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={pending}
              onClick={() => {
                if (confirming !== null) restore(confirming);
              }}
            >
              {s.confirmRestore}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
