"use client";

import { useState } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Badge, Button } from "@platform/ui";
import {
  PAGE_META_DESCRIPTION_MAX,
  PAGE_TITLE_MAX,
  RICH_TEXT_MAX,
  type LocalizedText,
} from "@platform/storefront-content";
import { savePageContentAction, type PageContentSaveState } from "@/app/pages/actions";
import type { PageDto } from "@/lib/api/pages";
import type { Locale } from "@/lib/i18n";
import { settleAction } from "@/lib/online-store/settle-action";
import { isStorefrontPagePath } from "@/lib/pages/route-path";
import type { Dictionary } from "@/messages/en";
import { LocalizedTextField } from "@/components/online-store/localized-text-field";
import { RichTextEditor } from "@/components/online-store/rich-text-editor";
import { SaveStatus } from "@/components/online-store/save-status";

/**
 * A page's address and where it shows (spec 2.4): only `/pages/<handle>` is on the storefront, so
 * any other path is flagged "Not on your storefront"; a published, served page links to the store.
 */
export function PageAddress({
  t,
  routePath,
  status,
  storefrontUrl,
}: {
  readonly t: Dictionary;
  readonly routePath: string;
  readonly status: string;
  readonly storefrontUrl: string | null;
}) {
  const served = isStorefrontPagePath(routePath);
  const base = storefrontUrl?.replace(/\/+$/, "") ?? "";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span dir="ltr" className="text-muted-foreground font-mono">
        {routePath}
      </span>
      {served ? null : <Badge variant="outline">{t.pageEditor.notOnStorefront}</Badge>}
      {served && status === "published" && base !== "" ? (
        <a
          href={`${base}${routePath}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary inline-flex items-center gap-1 underline-offset-4 hover:underline"
        >
          {t.pageEditor.viewOnStore}
          <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
        </a>
      ) : null}
    </div>
  );
}

/**
 * The page editor (spec 2.4, 2.7): the title, the content in the Morbeh editor and the search engine
 * listing's meta description, each in Arabic and English. Save sends all three with the version
 * the form holds and takes the new one from the answer (or from the refreshed page, after Publish,
 * Hide or Archive), so the next save is guarded too; a lost race keeps the edits and asks for a
 * reload. Read-only for a viewer and for an archived page (for an editor, the "archived" note sits
 * in `PageLifecycleActions`, where focus lands after Archive).
 */
export function PageContentForm({
  t,
  locale,
  page,
  canEdit,
  storefrontUrl = null,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly page: PageDto;
  readonly canEdit: boolean;
  /** For Preview's links (opened on the store, in a new tab). */
  readonly storefrontUrl?: string | null;
}) {
  const e = t.pageEditor;
  const editable = canEdit && page.status !== "archived";
  const [title, setTitle] = useState<LocalizedText>(page.title);
  const [body, setBody] = useState<LocalizedText>(page.body ?? {});
  const [metaDescription, setMetaDescription] = useState<LocalizedText>(page.metaDescription);
  const [version, setVersion] = useState(page.version);
  // Publish, Hide and Archive bump the page's version too (review I-1): adopt a newer one when the
  // server refresh brings it, during render ("adjust state on a prop change"); never go back.
  const [seenVersion, setSeenVersion] = useState(page.version);
  if (seenVersion !== page.version) {
    setSeenVersion(page.version);
    setVersion(Math.max(version, page.version));
  }
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<PageContentSaveState>({ status: "idle" });
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  const save = async () => {
    setPending(true);
    setState({ status: "idle" });
    try {
      const result = await settleAction(
        () =>
          savePageContentAction(page.id, {
            title,
            body,
            metaDescription,
            expectedVersion: version,
          }),
        { status: "error", message: t.formErrors.unexpected, fieldErrors: {} },
      );
      if (result.status === "success" && result.version !== undefined) setVersion(result.version);
      setState(result);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {page.status === "archived" && !canEdit ? (
        <p role="note" className="text-muted-foreground text-sm">
          {e.archived}
        </p>
      ) : null}
      <LocalizedTextField
        t={t}
        locale={locale}
        name="title"
        label={e.title}
        max={PAGE_TITLE_MAX}
        value={page.title}
        disabled={!editable || pending}
        errors={fieldErrors}
        onChange={setTitle}
      />
      <RichTextEditor
        t={t}
        locale={locale}
        name="body"
        label={e.content}
        value={page.body ?? {}}
        max={RICH_TEXT_MAX.body}
        disabled={!editable || pending}
        errors={fieldErrors}
        onChange={setBody}
        previewBase={storefrontUrl}
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{e.seo}</h2>
        <LocalizedTextField
          t={t}
          locale={locale}
          name="metaDescription"
          label={e.metaDescription}
          max={PAGE_META_DESCRIPTION_MAX}
          value={page.metaDescription}
          multiline
          disabled={!editable || pending}
          errors={fieldErrors}
          onChange={setMetaDescription}
        />
      </section>
      {editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" loading={pending} disabled={pending} onClick={() => void save()}>
            {pending ? t.onlineStorePreferences.saving : t.onlineStorePreferences.save}
          </Button>
          <SaveStatus t={t} state={state} />
        </div>
      ) : null}
    </div>
  );
}
