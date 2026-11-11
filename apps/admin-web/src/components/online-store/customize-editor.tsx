"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, MonitorIcon, SmartphoneIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@platform/ui";
import { isKnownSection, type ThemeDocument } from "@platform/storefront-content";
import {
  previewUrlAction,
  publishThemeAction,
  saveThemeDraftAction,
} from "@/app/online-store/themes/actions";
import type { OnlineStoreImageDto, ThemeStateDto, ThemeTargetsDto } from "@/lib/api/online-store";
import {
  createAutosaver,
  createReplayingSender,
  createRequestKey,
  type AutosaveState,
  type SendAnswer,
} from "@/lib/online-store/autosave";
import { postFocus, PREVIEW_READY_MESSAGE, previewOrigin } from "@/lib/online-store/preview-focus";
import { findSection, updateSectionSettings } from "@/lib/online-store/section-tree";
import { themeFieldErrors } from "@/lib/online-store/theme-field-errors";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import {
  ColorsPanel,
  CornersPanel,
  LogoPanel,
  SocialPanel,
  TypographyPanel,
  type FieldErrors,
  type MenuChoice,
} from "./customize-panels";
import { SectionSettingsForm } from "./sections/section-settings-form";
import {
  SectionTreePanel,
  sectionTitle,
  type SectionTreeHandle,
} from "./sections/section-tree-panel";
import { openPreview, publishMessage, type StaffRole } from "./theme-card";

const AUTOSAVE_DELAY_MS = 1000;
/** Preview tokens live 60 minutes; refresh 10 minutes early (at 50), never more often than 1/min. */
const PREVIEW_LIFETIME_MS = 60 * 60 * 1000;
const PREVIEW_MARGIN_MS = 10 * 60 * 1000;
const PREVIEW_MIN_REFRESH_MS = 60 * 1000;
/**
 * M-1: the storefront needs scripts (hydration), its own origin (cookies, fetches) and forms
 * (search); top-level navigation of the admin is what the sandbox takes away.
 */
const PREVIEW_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

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
  menus,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly state: ThemeStateDto;
  readonly role: StaffRole;
  readonly storeName: string;
  /** The shop's menus for the header and footer selects (the two defaults when the list failed). */
  readonly menus: readonly MenuChoice[];
}) {
  const c = t.onlineStoreCustomize;
  const canEdit = role !== "viewer";
  const isAdmin = role === "admin";
  const [doc, setDoc] = useState<ThemeDocument>(state.draft);
  const docRef = useRef(doc);
  const revisionRef = useRef(state.draftRevision);
  const publishKeys = useRef(createRequestKey());
  const [images, setImages] = useState<Record<string, OnlineStoreImageDto>>({ ...state.images });
  // Ruling 21 + F4: what the draft's references point to. `null` (the read failed) stays null until
  // the first pick, which starts the map; each pick is merged as live so it shows no false flag.
  const [targets, setTargets] = useState<ThemeTargetsDto | null>(state.targets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const treeRef = useRef<SectionTreeHandle>(null);
  const backTo = useRef<string | null>(null);
  const [saveState, setSaveState] = useState<AutosaveState>("idle");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [socialInvalid, setSocialInvalid] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  /** `deadline` is in this browser's clock, fixed at receipt (M-4: skew-proof). */
  const [preview, setPreview] = useState<{ url: string; deadline: number | null } | null>(null);
  const [previewProblem, setPreviewProblem] = useState<"expired" | "failed" | null>(null);
  const hasPreview = useRef(false);
  const mounted = useRef(true);
  const [frameVersion, setFrameVersion] = useState(state.draftRevision);
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // I-1: one draft save at the server's optimistic version; a save whose answer was lost is
  // replayed with its own key before anything newer goes out.
  const [sender] = useState(() =>
    createReplayingSender<ThemeDocument>({
      initialVersion: state.version,
      send: async (document, expectedVersion, idempotencyKey): Promise<SendAnswer> => {
        const result = await saveThemeDraftAction({ document, expectedVersion, idempotencyKey });
        switch (result.status) {
          // Side effects go in `apply`: the sender drops them for an answer that came too late.
          case "ok":
            return {
              status: "ok",
              version: result.version,
              apply: () => {
                revisionRef.current = result.draftRevision;
                setFrameVersion(result.draftRevision);
                setFieldErrors({});
              },
            };
          case "conflict":
            return { status: "conflict" };
          case "invalid":
            // Final: never retried on a timer, so a refused save cannot loop (Ruling 3).
            return {
              status: "invalid",
              apply: () => setFieldErrors(themeFieldErrors(t, result.fields)),
            };
          default:
            return { status: "transient" }; // error or in_flight: the answer may still come
        }
      },
    }),
  );
  // Created once (not in an effect), so React Strict Mode's remount keeps the same saver (F19).
  const [saver] = useState(() =>
    createAutosaver<ThemeDocument>({
      delayMs: AUTOSAVE_DELAY_MS,
      onState: (s) => {
        setSaveState(s);
        if (s === "conflict") setAlert(c.conflict);
      },
      save: (document) => sender.save(document),
    }),
  );
  // F19: the cleanup saves a pending change (Exit, navigation) and never switches autosave off.
  // Like page hide, it never resends a draft the server refused (422).
  useEffect(
    () => () => {
      void saver.flush({ includeRefused: false });
    },
    [saver],
  );

  // I-2: a tab close or reload does not unmount React. Save as the page is hidden or left (best
  // effort), and ask the browser to confirm leaving while a change is unsaved or failed.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!saver.hasUnsaved()) return;
      event.preventDefault();
    };
    const onPageHide = () => {
      void saver.flush({ includeRefused: false });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void saver.flush({ includeRefused: false });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [saver]);

  const loadPreview = useCallback(async () => {
    const result = await previewUrlAction();
    if (!mounted.current) return;
    if (result.status === "ok") {
      hasPreview.current = true;
      // M-4: the server's own remaining lifetime when it has one, else this browser's reading.
      const left =
        result.expiresInMs !== undefined && Number.isFinite(result.expiresInMs)
          ? Math.min(Math.max(result.expiresInMs, 0), PREVIEW_LIFETIME_MS)
          : lifetimeLeft(Date.parse(result.expiresAt));
      setPreview({ url: result.url, deadline: left === null ? null : Date.now() + left });
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
    const { deadline } = preview;
    const left = deadline === null ? null : Math.max(0, deadline - Date.now());
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
      if (deadline !== null && deadline - Date.now() < PREVIEW_MARGIN_MS) void loadPreview();
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

  // Ruling 18: the preview scrolls to the section being edited, on selection and after a reload.
  const previewUrl = preview?.url ?? null;
  useEffect(() => {
    if (selectedId === null || previewUrl === null) return;
    postFocus(frameRef.current, previewUrl, selectedId);
  }, [selectedId, previewUrl]);

  // F3: the storefront says when its listener is ready; answer with the current selection. Only
  // the preview's own origin and its own frame are believed.
  useEffect(() => {
    if (previewUrl === null) return;
    const origin = previewOrigin(previewUrl);
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      if ((data as { type?: unknown }).type !== PREVIEW_READY_MESSAGE) return;
      const frame = frameRef.current;
      if (origin === null || event.origin !== origin) return;
      if (frame === null || event.source !== frame.contentWindow) return;
      if (selectedRef.current !== null) postFocus(frame, previewUrl, selectedRef.current);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [previewUrl]);

  // "Back to sections" hides the form and shows the tree again: focus returns to the row.
  useEffect(() => {
    if (selectedId !== null || backTo.current === null) return;
    treeRef.current?.focusRow(backTo.current);
    backTo.current = null;
  }, [selectedId]);

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
    if (outcome === "ok" || outcome === null) return true;
    setAlert(outcome === "conflict" ? c.conflict : c.saveError);
    return false;
  };

  // F20 + Ruling 6: publish exactly the saved revision the panels show, and nothing after a failed
  // save or while a field is invalid as typed (M-6); the key is kept while that revision is
  // unchanged (Ruling 2).
  const publish = async () => {
    if (socialInvalid) {
      setConfirming(false);
      setAlert(c.fixFieldsFirst);
      return;
    }
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
  const s = t.onlineStoreSections;
  const selected = selectedId === null ? null : findSection(doc, selectedId);
  const selectedPath =
    selected === null
      ? null
      : selected.place === "announcement"
        ? "header.announcement"
        : `homepage.sections.${selected.place}`;
  const onTarget = (kind: keyof ThemeTargetsDto, id: string, title: string) =>
    setTargets((previous) => {
      const base: ThemeTargetsDto = previous ?? { collection: {}, product: {}, page: {} };
      return { ...base, [kind]: { ...base[kind], [id]: { title, live: true } } };
    });

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
              void openPreview(
                (reason) =>
                  setAlert(
                    reason === "blocked"
                      ? t.onlineStoreThemes.popupBlocked
                      : t.onlineStoreThemes.previewFailed,
                  ),
                saveFirst,
              )
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
        <div
          role="alert"
          className="bg-warning-subtle text-warning-foreground flex flex-wrap items-center gap-3 px-4 py-2 text-sm"
        >
          <p>{alert}</p>
          {locked ? (
            // M-2: the editor's state comes from the server once, so only a full reload recovers.
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => window.location.reload()}
            >
              {c.reload}
            </Button>
          ) : null}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          data-testid="sections-aside"
          className="border-border max-h-[45dvh] w-full shrink-0 overflow-y-auto border-b p-4 md:max-h-none md:w-80 md:border-b-0 md:border-e xl:w-auto"
        >
          {fieldErrors[""] === undefined ? null : (
            <p className="text-destructive mb-3 text-sm">{fieldErrors[""]}</p>
          )}
          <Tabs defaultValue="sections">
            <TabsList className="mb-2 w-full">
              <TabsTrigger value="sections">{s.tabSections}</TabsTrigger>
              <TabsTrigger value="theme">{s.tabTheme}</TabsTrigger>
            </TabsList>
            <TabsContent value="sections">
              {/* One form instance in either layout: below xl the tree is swapped for it, at xl it
                  is the second column (pure CSS; Task 11 allows no hidden copy). */}
              <div className="xl:grid xl:grid-cols-[20rem_22rem] xl:items-start xl:gap-6">
                <div className={selected === null ? undefined : "hidden xl:block"}>
                  <SectionTreePanel
                    t={t}
                    locale={locale}
                    doc={doc}
                    targets={targets}
                    images={images}
                    errors={fieldErrors}
                    selectedId={selectedId}
                    disabled={!canEdit || locked}
                    menus={menus}
                    handleRef={treeRef}
                    onSelect={setSelectedId}
                    onUpdate={update}
                  />
                </div>
                {selected === null || selectedPath === null ? null : (
                  <div className="flex flex-col gap-4">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start xl:hidden"
                      onClick={() => {
                        backTo.current = selectedId;
                        setSelectedId(null);
                      }}
                    >
                      <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
                      {s.back}
                    </Button>
                    <h3 className="text-sm font-semibold">
                      <bdi dir="auto">{sectionTitle(t, locale, selected.section)}</bdi>
                    </h3>
                    {isKnownSection(selected.section) ? (
                      <SectionSettingsForm
                        t={t}
                        locale={locale}
                        section={selected.section}
                        path={selectedPath}
                        images={images}
                        targets={targets}
                        errors={fieldErrors}
                        disabled={!canEdit || locked}
                        onChange={(settings) =>
                          update((d) => updateSectionSettings(d, selected.section.id, settings))
                        }
                        onImage={(image) => setImages((m) => ({ ...m, [image.id]: image }))}
                        onTarget={onTarget}
                      />
                    ) : (
                      <p className="text-muted-foreground text-sm">{s.unsupportedBody}</p>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>
            {/* Kept mounted: a social link typed but not yet valid keeps its state across tabs. */}
            <TabsContent value="theme" forceMount className="data-[state=inactive]:hidden">
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
                <SocialPanel {...panels} onLocalErrors={setSocialInvalid} />
              </details>
            </TabsContent>
          </Tabs>
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
            // Ruling 18: the reload after a save returns to the selected section (a focus message).
            <iframe
              key={frameVersion}
              ref={frameRef}
              onLoad={() => {
                if (selectedRef.current !== null) {
                  postFocus(frameRef.current, preview?.url ?? "", selectedRef.current);
                }
              }}
              title={c.previewTitle}
              src={frameSrc}
              sandbox={PREVIEW_SANDBOX}
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
