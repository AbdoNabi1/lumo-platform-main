"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useState } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { pickText, type LocalizedText } from "@platform/storefront-content";
import {
  savePreferencesAction,
  type OnlineStoreSaveState,
} from "@/app/online-store/preferences/actions";
import type { OnlineStoreImageDto, PreferencesDto } from "@/lib/api/online-store";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { ImageUploadField } from "./image-upload-field";
import { LocalizedTextField } from "./localized-text-field";
import { SaveStatus } from "./save-status";

const IDLE: OnlineStoreSaveState = { status: "idle" };
const NO_ERRORS: Readonly<Record<string, string>> = {};

/**
 * Online Store → Preferences (spec 1.11): home title and meta description in both languages, the
 * share image, the store language. Live on save; sends the version it was loaded at (Ruling 33).
 * The share image starts from the STORED id (F4): if that image no longer resolves (archived) the
 * merchant is told and keeps it until they replace or remove it — a save never clears it silently.
 */
export function PreferencesForm({
  t,
  locale,
  preferences,
  canEdit,
  storefrontUrl,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly preferences: PreferencesDto;
  readonly canEdit: boolean;
  readonly storefrontUrl: string | null;
}) {
  const p = t.onlineStorePreferences;
  const [state, action, pending] = useActionState(savePreferencesAction, IDLE);
  const [title, setTitle] = useState<LocalizedText>(preferences.homeTitle);
  const [description, setDescription] = useState<LocalizedText>(preferences.homeMetaDescription);
  // Controlled, so React's post-action form reset never throws away an unsaved choice on an error.
  const [defaultLocale, setDefaultLocale] = useState(preferences.defaultLocale);
  const [shareId, setShareId] = useState<string | null>(preferences.shareImageId);
  const [share, setShare] = useState<(OnlineStoreImageDto & { id: string }) | null>(
    preferences.shareImage === null || preferences.shareImageId === null
      ? null
      : { ...preferences.shareImage, id: preferences.shareImageId },
  );
  const errors = state.status === "error" ? state.fieldErrors : NO_ERRORS;
  const shareMissing = shareId !== null && share === null;
  const shareError = errors["shareImageId"];
  const shownTitle = pickText(title, locale) ?? preferences.storeName;
  const shownDescription = pickText(description, locale) ?? "";
  const changeShare = (image: (OnlineStoreImageDto & { id: string }) | null) => {
    setShare(image);
    setShareId(image?.id ?? null);
  };
  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="expectedVersion" value={preferences.version} />
      <input type="hidden" name="shareImageId" value={shareId ?? ""} />
      <Card>
        <CardHeader>
          <CardTitle>{p.storeNameLabel}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <bdi dir="auto" className="font-medium">
            {preferences.storeName}
          </bdi>
          <Link href="/settings/general" className="text-primary text-sm underline">
            {p.changeStoreName}
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{p.homeTitleCard}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <LocalizedTextField
            t={t}
            locale={locale}
            name="homeTitle"
            label={p.homeTitle}
            max={70}
            value={preferences.homeTitle}
            disabled={!canEdit}
            errors={errors}
            onChange={setTitle}
          />
          <LocalizedTextField
            t={t}
            locale={locale}
            name="homeMetaDescription"
            label={p.homeDescription}
            max={320}
            value={preferences.homeMetaDescription}
            multiline
            disabled={!canEdit}
            errors={errors}
            onChange={setDescription}
          />
          <section aria-label={p.searchPreview} className="bg-surface rounded-lg p-3">
            <p className="text-muted-foreground truncate text-xs" dir="ltr">
              {storefrontUrl ?? ""}
            </p>
            <p className="text-info-foreground truncate text-base" dir="auto">
              <bdi>{shownTitle}</bdi>
            </p>
            <p className="text-muted-foreground line-clamp-2 text-sm" dir="auto">
              <bdi>{shownDescription}</bdi>
            </p>
          </section>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{p.shareCard}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">{p.shareHint}</p>
          {shareMissing ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <p className="text-warning-foreground flex items-center gap-2">
                <AlertTriangleIcon className="size-4 shrink-0" aria-hidden="true" />
                {p.imageNotFound}
              </p>
              {canEdit ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => changeShare(null)}>
                  {p.shareRemove}
                </Button>
              ) : null}
            </div>
          ) : null}
          <ImageUploadField
            t={t}
            purpose="share_image"
            image={share}
            disabled={!canEdit}
            onChange={changeShare}
          />
          {shareError === undefined || shareMissing ? null : (
            <p className="text-destructive text-sm">{shareError}</p>
          )}
          <div className="border-border max-w-sm overflow-hidden rounded-lg border">
            {share === null ? null : (
              <Image
                src={share.url}
                alt=""
                width={1200}
                height={630}
                unoptimized
                className="aspect-[1200/630] w-full object-cover"
              />
            )}
            <div className="bg-surface p-2 text-sm">
              <p className="font-medium" dir="auto">
                <bdi>{shownTitle}</bdi>
              </p>
              <p className="text-muted-foreground line-clamp-1" dir="auto">
                <bdi>{shownDescription}</bdi>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{p.languageCard}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">{p.languageHint}</p>
          {(["ar", "en"] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="defaultLocale"
                value={value}
                checked={defaultLocale === value}
                onChange={() => setDefaultLocale(value)}
                disabled={!canEdit}
              />
              {value === "ar" ? p.languageArabic : p.languageEnglish}
            </label>
          ))}
        </CardContent>
      </Card>
      <SaveStatus t={t} state={state} />
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" loading={pending}>
            {pending ? p.saving : p.save}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
