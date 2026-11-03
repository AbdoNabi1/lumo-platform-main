"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { MonitorIcon, SmartphoneIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@platform/ui";
import type { ThemeDocument } from "@platform/storefront-content";
import {
  previewUrlAction,
  publishThemeAction,
  saveThemeDraftAction,
} from "@/app/online-store/themes/actions";
import type { FieldIssue } from "@/lib/api/client";
import type { OnlineStoreImageDto, ThemeStateDto } from "@/lib/api/online-store";
import { createAutosaver, createRequestKey, type AutosaveState } from "@/lib/online-store/autosave";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import {
  ColorsPanel,
  CornersPanel,
  FooterPanel,
  LogoPanel,
  SocialPanel,
  TypographyPanel,
  type FieldErrors,
} from "./customize-panels";
import { openPreview, publishMessage, type StaffRole } from "./theme-card";

const AUTOSAVE_DELAY_MS = 1000;
/** Preview tokens live 60 minutes; refresh 10 minutes early (at 50), never more often than 1/min. */
const PREVIEW_LIFETIME_MS = 60 * 60 * 1000;
const PREVIEW_MARGIN_MS = 10 * 60 * 1000;
const PREVIEW_MIN_REFRESH_MS = 60 * 1000;

/**
 * The API's 422 codes as copy, keyed by document path; the path `""` is the whole document
 * (`DOCUMENT_TOO_LARGE`). Server text never reaches the page.
 */
function fieldErrorsOf(t: Dictionary, fields: readonly FieldIssue[]): Record<string, string> {
  const e = t.onlineStoreErrors;
  const c = t.onlineStoreCustomize;
  const errors: Record<string, string> = {};
  for (const { field, message: code } of fields) {
    const social = field.startsWith("brand.social.");
    errors[field] =
      code === "IMAGE_NOT_FOUND"
        ? t.onlineStorePreferences.imageNotFound
        : code === "INVALID_URL"
          ? social
            ? c.socialInvalid
            : e.invalidUrl
          : code === "TOO_LONG"
            ? social
              ? c.socialTooLong
              : t.onlineStorePreferences.tooLong
            : code === "INVALID_COLOR"
              ? e.invalidColor
              : code === "OUT_OF_RANGE"
                ? e.outOfRange
                : code === "CONTRAST_TOO_LOW"
                  ? c.contrastBlocked
                  : code === "DOCUMENT_TOO_LARGE"
                    ? e.documentTooLarge
                    : t.formErrors.invalid;
  }
  return errors;
}

/** The token lifetime left as this browser sees it; a skewed clock falls back to the full hour. */
function lifetimeLeft(expiresAt: number): number | null {
  if (!Number.isFinite(expiresAt)) return null;
  const left = expiresAt - Date.now();
  return left <= 0 ? PREVIEW_LIFETIME_MS : Math.min(left, PREVIEW_LIFETIME_MS);
}

/**
 * Spec 1.11: Theme settings panels on the start side, the storefront preview on the end side. Every
 * change autosaves the DRAFT (never the live store); the iframe reloads after each successful save.
 * The preview url carries a token: it lives only in the iframe `src` (and the Preview tab), is
 * refreshed before it expires, and is never logged or stored.
 */
export function CustomizeEditor({
  t,
  locale,
  state,
  role,
  storeName,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly state: ThemeStateDto;
  readonly role: StaffRole;
  readonly storeName: string;
}) {
  const c = t.onlineStoreCustomize;
  const canEdit = role !== "viewer";
  const isAdmin = role === "admin";
  const [doc, setDoc] = useState<ThemeDocument>(state.draft);
  const docRef = useRef(doc);
  const versionRef = useRef(state.version);
  const revisionRef = useRef(state.draftRevision);
  const saveKeys = useRef(createRequestKey());
  const publishKeys = useRef(createRequestKey());
  const [images, setImages] = useState<Record<string, OnlineStoreImageDto>>({ ...state.images });
  const [saveState, setSaveState] = useState<AutosaveState>("idle");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [preview, setPreview] = useState<{ url: string; expiresAt: number } | null>(null);
  const [previewProblem, setPreviewProblem] = useState<"expired" | "failed" | null>(null);
  const hasPreview = useRef(false);
  const mounted = useRef(true);
  const [frameVersion, setFrameVersion] = useState(state.draftRevision);
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Created once (not in an effect), so React Strict Mode's remount keeps the same saver (F19).
  const [saver] = useState(() =>
    createAutosaver<ThemeDocument>({
      delayMs: AUTOSAVE_DELAY_MS,
      onState: (s) => {
        setSaveState(s);
        if (s === "conflict") setAlert(c.conflict);
      },
      save: async (document) => {
        const expectedVersion = versionRef.current;
        // Ruling 2: the same payload at the same version keeps its key, so a retry after a lost
        // response replays the first answer instead of a false VERSION_CONFLICT.
        const idempotencyKey = saveKeys.current.keyFor(
          `${expectedVersion}|${JSON.stringify(document)}`,
        );
        const result = await saveThemeDraftAction({ document, expectedVersion, idempotencyKey });
        switch (result.status) {
          case "ok":
            versionRef.current = result.version;
            revisionRef.current = result.draftRevision;
            setFrameVersion(result.draftRevision);
            setFieldErrors({});
            return "ok";
          case "conflict":
            return "conflict";
          case "invalid":
            // Not retried until the merchant changes something (or retries): no loop (Ruling 3).
            setFieldErrors(fieldErrorsOf(t, result.fields));
            return "error";
          default:
            return "error";
        }
      },
    }),
  );
  // F19: the cleanup saves a pending change (Exit, navigation) and never switches autosave off.
  useEffect(
    () => () => {
      void saver.flush();
    },
    [saver],
  );

  const loadPreview = useCallback(async () => {
    const result = await previewUrlAction();
    if (!mounted.current) return;
    if (result.status === "ok") {
      hasPreview.current = true;
      setPreview({ url: result.url, expiresAt: Date.parse(result.expiresAt) });
      setPreviewProblem(null);
    } else if (!hasPreview.current) {
      setPreviewProblem("failed");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadPreview();
    return () => {
      mounted.current = false;
    };
  }, [loadPreview]);

  // Ruling 4: refresh before the token runs out (and on return to the tab when it is close); once
  // it has expired the storefront would answer the frame with its password page (locked store) or
  // the live theme, and a cross-origin frame cannot be read, so expiry is tracked here instead.
  useEffect(() => {
    if (preview === null) return;
    const left = lifetimeLeft(preview.expiresAt);
    const refreshIn =
      left === null
        ? PREVIEW_LIFETIME_MS - PREVIEW_MARGIN_MS
        : Math.min(
            PREVIEW_LIFETIME_MS - PREVIEW_MARGIN_MS,
            Math.max(PREVIEW_MIN_REFRESH_MS, left - PREVIEW_MARGIN_MS),
          );
    const refresh = setTimeout(() => void loadPreview(), refreshIn);
    const expire = left === null ? null : setTimeout(() => setPreviewProblem("expired"), left);
    const onReturn = () => {
      if (document.visibilityState === "hidden") return;
      if (Number.isFinite(preview.expiresAt) && preview.expiresAt - Date.now() < PREVIEW_MARGIN_MS)
        void loadPreview();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      clearTimeout(refresh);
      if (expire !== null) clearTimeout(expire);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [preview, loadPreview]);

  const locked = saveState === "conflict";
  const update = (change: (d: ThemeDocument) => ThemeDocument) => {
    if (!canEdit || locked) return;
    const next = change(docRef.current);
    docRef.current = next;
    setDoc(next);
    saver.schedule(next);
  };

  /** Saves first; false (with the reason shown) when the panels differ from the saved draft. */
  const saveFirst = async (): Promise<boolean> => {
    const outcome = await saver.flush();
    if (outcome === "conflict" || outcome === "error") {
      setAlert(outcome === "conflict" ? c.conflict : c.saveError);
      return false;
    }
    return true;
  };

  // F20 + Ruling 6: publish exactly the saved revision the panels show, and nothing after a failed
  // save; the key is kept while that revision is unchanged (Ruling 2).
  const publish = async () => {
    setPublishing(true);
    if (!(await saveFirst())) {
      setPublishing(false);
      setConfirming(false);
      return;
    }
    const revision = revisionRef.current;
    const result = await publishThemeAction(revision, publishKeys.current.keyFor(String(revision)));
    if (result.status !== "error" && result.status !== "in_flight") publishKeys.current.reset();
    setPublishing(false);
    setConfirming(false);
    setAlert(
      result.status === "ok" && result.liveDelayed !== true
        ? c.published
        : publishMessage(t, result),
    );
  };

  const frameSrc =
    preview === null
      ? undefined
      : `${preview.url}${preview.url.includes("?") ? "&" : "?"}v=${frameVersion}`;
  const stateLabel =
    saveState === "saving"
      ? c.saving
      : saveState === "saved"
        ? c.saved
        : saveState === "error"
          ? c.saveError
          : null;
  const panels = { t, locale, doc, update, disabled: !canEdit || locked, errors: fieldErrors };

  return (
    <div className="bg-background flex h-dvh flex-col">
      <header className="border-border flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/online-store/themes">{c.exit}</Link>
        </Button>
        <bdi dir="auto" className="min-w-0 truncate text-sm font-medium">
          {storeName}
        </bdi>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant={device === "desktop" ? "secondary" : "ghost"}
            aria-label={c.desktop}
            aria-pressed={device === "desktop"}
            onClick={() => setDevice("desktop")}
          >
            <MonitorIcon aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant={device === "mobile" ? "secondary" : "ghost"}
            aria-label={c.mobile}
            aria-pressed={device === "mobile"}
            onClick={() => setDevice("mobile")}
          >
            <SmartphoneIcon aria-hidden="true" className="size-4" />
          </Button>
          {stateLabel === null ? null : (
            <span role="status" className="text-muted-foreground text-xs">
              {stateLabel}
            </span>
          )}
          {saveState === "error" ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => void saver.flush()}>
              {c.retry}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() =>
              void openPreview(() => setAlert(t.onlineStoreThemes.previewFailed), saveFirst)
            }
          >
            {c.preview}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!isAdmin || locked}
            title={isAdmin ? undefined : t.onlineStoreThemes.adminOnlyPublish}
            onClick={() => setConfirming(true)}
          >
            {c.publish}
          </Button>
        </div>
      </header>
      {alert === null ? null : (
        <p role="alert" className="bg-warning-subtle text-warning-foreground px-4 py-2 text-sm">
          {alert}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="border-border max-h-[45dvh] w-full shrink-0 overflow-y-auto border-b p-4 md:max-h-none md:w-80 md:border-b-0 md:border-e">
          {fieldErrors[""] === undefined ? null : (
            <p className="text-destructive mb-3 text-sm">{fieldErrors[""]}</p>
          )}
          <details open className="mb-4">
            <summary className="mb-2 font-medium">{c.logoPanel}</summary>
            <LogoPanel
              {...panels}
              images={images}
              onImage={(image) => setImages((m) => ({ ...m, [image.id]: image }))}
            />
          </details>
          <details open className="mb-4">
            <summary className="mb-2 font-medium">{c.colorsPanel}</summary>
            <ColorsPanel {...panels} />
          </details>
          <details className="mb-4">
            <summary className="mb-2 font-medium">{c.typographyPanel}</summary>
            <TypographyPanel {...panels} />
          </details>
          <details className="mb-4">
            <summary className="mb-2 font-medium">{c.cornersPanel}</summary>
            <CornersPanel {...panels} />
          </details>
          <details className="mb-4">
            <summary className="mb-2 font-medium">{c.socialPanel}</summary>
            <SocialPanel {...panels} />
          </details>
          <details className="mb-4">
            <summary className="mb-2 font-medium">{c.footerPanel}</summary>
            <FooterPanel {...panels} />
          </details>
        </aside>
        <main className="bg-surface flex min-h-0 min-w-0 flex-1 justify-center overflow-auto p-4">
          {previewProblem !== null ? (
            <div role="status" className="m-auto flex flex-col items-center gap-3 text-center">
              <p className="text-sm">
                {previewProblem === "expired"
                  ? c.previewExpired
                  : t.onlineStoreThemes.previewFailed}
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void loadPreview()}
              >
                {c.reloadPreview}
              </Button>
            </div>
          ) : frameSrc === undefined ? null : (
            // Ruling 17: no scroll restore across reloads in Part 1.
            <iframe
              key={frameVersion}
              title={c.previewTitle}
              src={frameSrc}
              referrerPolicy="no-referrer"
              className="bg-card h-full min-h-96 rounded-lg border"
              style={{ width: device === "desktop" ? "100%" : "390px" }}
            />
          )}
        </main>
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{c.publish}</DialogTitle>
            <DialogDescription>{c.publishBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              {c.cancel}
            </Button>
            <Button type="button" loading={publishing} onClick={() => void publish()}>
              {c.confirmPublish}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
