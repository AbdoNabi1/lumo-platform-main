"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  Badge,
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
} from "@platform/ui";
import {
  discardThemeDraftAction,
  previewUrlAction,
  publishThemeAction,
  type PublishActionResult,
} from "@/app/online-store/themes/actions";
import type { ThemeStateDto } from "@/lib/api/online-store";
import { createRequestKey } from "@/lib/online-store/autosave";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

export type StaffRole = "viewer" | "operator" | "admin";

/**
 * Opens the preview in a new tab without giving it a handle back to the admin (noopener). The tab
 * opens first, inside the click, so a popup blocker allows it; `before` (the editor's save) runs
 * while it loads. The url holds the preview token: it goes only into that tab's location.
 */
export async function openPreview(
  onError: () => void,
  before: () => Promise<boolean> = () => Promise.resolve(true),
): Promise<void> {
  const tab = window.open("about:blank", "_blank");
  const proceed = await before();
  const result = proceed ? await previewUrlAction() : null;
  if (result === null || result.status !== "ok" || tab === null) {
    tab?.close();
    if (proceed) onError();
    return;
  }
  tab.opener = null;
  tab.location.href = result.url;
}

/** The sentence for a publish result, shared by the Themes page and the editor. */
export function publishMessage(t: Dictionary, result: PublishActionResult): string {
  switch (result.status) {
    case "ok":
      return result.liveDelayed === true
        ? t.onlineStoreThemes.publishedLiveDelayed
        : t.onlineStoreThemes.published;
    case "draft_changed":
      return t.onlineStoreCustomize.draftChanged;
    case "nothing_to_publish":
      return t.onlineStoreThemes.nothingToPublish;
    case "in_flight":
      return t.onlineStorePreferences.inFlight;
    case "forbidden":
      return t.formErrors.forbidden;
    default:
      return t.formErrors.unexpected;
  }
}

export function ThemeCard({
  t,
  locale,
  state,
  role,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly state: ThemeStateDto;
  readonly role: StaffRole;
}) {
  const s = t.onlineStoreThemes;
  const router = useRouter();
  const [dialog, setDialog] = useState<"publish" | "discard" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const publishKey = useRef(createRequestKey());
  const isAdmin = role === "admin";
  const canEdit = role !== "viewer";
  const date =
    state.publishedAt === null
      ? null
      : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(state.publishedAt),
        );
  // Publishes the revision this page shows (and the merchant previewed), never a later one.
  const publish = () =>
    start(async () => {
      const revision = state.draftRevision;
      const result = await publishThemeAction(
        revision,
        publishKey.current.keyFor(String(revision)),
      );
      if (result.status !== "error" && result.status !== "in_flight") publishKey.current.reset();
      setDialog(null);
      setMessage(publishMessage(t, result));
      router.refresh();
    });
  const discard = () =>
    start(async () => {
      const result = await discardThemeDraftAction(state.version);
      setDialog(null);
      setMessage(
        result.status === "ok"
          ? s.discarded
          : result.status === "conflict"
            ? t.onlineStoreCustomize.conflict
            : result.status === "forbidden"
              ? t.formErrors.forbidden
              : t.formErrors.unexpected,
      );
      router.refresh();
    });
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs">{s.currentTheme}</p>
          <CardTitle>{s.themeName}</CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">
            {date === null
              ? s.neverPublished
              : s.lastPublished.replace("{date}", date).replace("{name}", s.staff)}
          </p>
        </div>
        {/* Ruling 7: the server decides whether the draft differs from the live theme. */}
        {state.hasUnpublishedChanges ? (
          <Badge variant="warning">{s.unpublishedChanges}</Badge>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <Button asChild>
            <Link href="/online-store/themes/customize">{s.customize}</Link>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={() => void openPreview(() => setMessage(s.previewFailed))}
        >
          {s.preview}
        </Button>
        {state.hasUnpublishedChanges ? (
          <Button
            type="button"
            variant="secondary"
            disabled={!isAdmin}
            title={isAdmin ? undefined : s.adminOnlyPublish}
            onClick={() => setDialog("publish")}
          >
            {s.publish}
          </Button>
        ) : null}
        {state.hasUnpublishedChanges && canEdit ? (
          <Button type="button" variant="ghost" onClick={() => setDialog("discard")}>
            {s.discard}
          </Button>
        ) : null}
        {message === null ? null : (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </CardContent>
      <Dialog open={dialog !== null} onOpenChange={(open) => setDialog(open ? dialog : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "discard" ? s.discardTitle : s.publishTitle}</DialogTitle>
            <DialogDescription>
              {dialog === "discard" ? s.discardBody : s.publishBody}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
              {s.cancel}
            </Button>
            {dialog === "discard" ? (
              <Button type="button" variant="destructive" loading={pending} onClick={discard}>
                {s.confirmDiscard}
              </Button>
            ) : (
              <Button type="button" loading={pending} onClick={publish}>
                {s.confirmPublish}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
