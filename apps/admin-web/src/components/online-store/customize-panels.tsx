"use client";

import { useState } from "react";
import { Badge, Button, ColorField, Label, NativeSelect, Switch } from "@platform/ui";
import {
  BASE_SIZES,
  bestTextOn,
  checkBrandContrast,
  COLOR_KEYS,
  CORNER_STYLES,
  DEFAULT_THEME_DOCUMENT,
  FONT_FAMILIES,
  FONT_KEYS,
  fontStack,
  LOGO_WIDTH,
  normalizeHex,
  RADIUS_SCALES,
  SOCIAL_NETWORKS,
  validateThemeDocument,
  type ColorKey,
  type SocialNetwork,
  type ThemeDocument,
} from "@platform/storefront-content";
import type { OnlineStoreImageDto, OnlineStoreImagePurpose } from "@/lib/api/online-store";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { ImageUploadField } from "./image-upload-field";
import { LocalizedTextField } from "./localized-text-field";

type Update = (change: (doc: ThemeDocument) => ThemeDocument) => void;
type Images = Readonly<Record<string, OnlineStoreImageDto>>;
type StoredImage = OnlineStoreImageDto & { readonly id: string };
/** Field errors from the last save, keyed by document path (`brand.colors.primary`), as copy. */
export type FieldErrors = Readonly<Record<string, string>>;

interface PanelProps {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly doc: ThemeDocument;
  readonly update: Update;
  readonly disabled: boolean;
  readonly errors: FieldErrors;
}

const withBrand = (doc: ThemeDocument, brand: Partial<ThemeDocument["brand"]>): ThemeDocument => ({
  ...doc,
  brand: { ...doc.brand, ...brand },
});

function FieldError({ id, message }: { readonly id?: string; readonly message?: string }) {
  if (message === undefined) return null;
  return (
    <p id={id} className="text-destructive text-xs">
      {message}
    </p>
  );
}

/**
 * One image ref. A ref the API no longer resolves (an archived image, or a restored release that
 * holds one) is said so and can be removed (Ruling 3), the same way Preferences handles its share
 * image; the editor never drops it on its own.
 */
function ImageRefField({
  t,
  purpose,
  imageRef,
  images,
  error,
  disabled,
  onImage,
  onRef,
}: {
  readonly t: Dictionary;
  readonly purpose: OnlineStoreImagePurpose;
  readonly imageRef: string | null;
  readonly images: Images;
  readonly error: string | undefined;
  readonly disabled: boolean;
  readonly onImage: (image: StoredImage) => void;
  readonly onRef: (id: string | null) => void;
}) {
  const resolved = imageRef === null ? undefined : images[imageRef];
  const image: StoredImage | null =
    imageRef === null || resolved === undefined ? null : { ...resolved, id: imageRef };
  const missing = imageRef !== null && image === null;
  const message = error ?? (missing ? t.onlineStorePreferences.imageNotFound : undefined);
  return (
    <div className="flex flex-col gap-2">
      <ImageUploadField
        t={t}
        purpose={purpose}
        image={image}
        disabled={disabled}
        onChange={(next) => {
          if (next !== null) onImage(next);
          onRef(next?.id ?? null);
        }}
      />
      {missing && !disabled ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => onRef(null)}
        >
          {t.onlineStorePreferences.shareRemove}
        </Button>
      ) : null}
      <FieldError message={message} />
    </div>
  );
}

export function LogoPanel({
  t,
  doc,
  update,
  disabled,
  errors,
  images,
  onImage,
}: PanelProps & {
  readonly images: Images;
  readonly onImage: (image: StoredImage) => void;
}) {
  const c = t.onlineStoreCustomize;
  return (
    <section className="flex flex-col gap-3">
      <Label>{c.logo}</Label>
      <ImageRefField
        t={t}
        purpose="logo"
        imageRef={doc.brand.logo.imageRef}
        images={images}
        error={errors["brand.logo.imageRef"]}
        disabled={disabled}
        onImage={onImage}
        onRef={(imageRef) => update((d) => withBrand(d, { logo: { ...d.brand.logo, imageRef } }))}
      />
      <Label htmlFor="logo-width">{c.logoWidth}</Label>
      <input
        id="logo-width"
        type="range"
        min={LOGO_WIDTH.min}
        max={LOGO_WIDTH.max}
        step={10}
        value={doc.brand.logo.widthPx}
        disabled={disabled}
        onChange={(e) => {
          const widthPx = Number(e.currentTarget.value);
          if (!Number.isInteger(widthPx) || widthPx < LOGO_WIDTH.min || widthPx > LOGO_WIDTH.max)
            return;
          update((d) => withBrand(d, { logo: { ...d.brand.logo, widthPx } }));
        }}
      />
      <FieldError message={errors["brand.logo.widthPx"]} />
      <Label>{c.favicon}</Label>
      <p className="text-muted-foreground text-xs">{c.faviconHint}</p>
      <ImageRefField
        t={t}
        purpose="favicon"
        imageRef={doc.brand.favicon.imageRef}
        images={images}
        error={errors["brand.favicon.imageRef"]}
        disabled={disabled}
        onImage={onImage}
        onRef={(imageRef) => update((d) => withBrand(d, { favicon: { imageRef } }))}
      />
    </section>
  );
}

/** Text key → the fill it sits on (the three pairs the contrast rules check). */
const PAIRS: readonly [
  ColorKey,
  ColorKey,
  "foreground" | "primaryForeground" | "accentForeground",
][] = [
  ["foreground", "background", "foreground"],
  ["primaryForeground", "primary", "primaryForeground"],
  ["accentForeground", "accent", "accentForeground"],
];

export function ColorsPanel({ t, locale, doc, update, disabled, errors }: PanelProps) {
  const c = t.onlineStoreCustomize;
  const contrast = checkBrandContrast(doc.brand.colors);
  const blocked = contrast.blocking.length > 0;
  const ratio = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  // Only what the validator accepts (6-digit hex) ever reaches the document (Ruling 9).
  const setColor = (key: ColorKey, value: string) => {
    const hex = normalizeHex(value);
    if (hex === null) return;
    update((d) => withBrand(d, { colors: { ...d.brand.colors, [key]: hex } }));
  };
  return (
    <section className="flex flex-col gap-3">
      {COLOR_KEYS.map((key) => (
        <div key={key} className="flex flex-col gap-1">
          <ColorField
            id={`color-${key}`}
            label={c.colors[key]}
            textLabel={c.hex.replace("{name}", c.colors[key])}
            value={doc.brand.colors[key]}
            disabled={disabled}
            onChange={(hex) => setColor(key, hex)}
          />
          <FieldError message={errors[`brand.colors.${key}`]} />
        </div>
      ))}
      {PAIRS.map(([text, fill, pair]) => {
        const warning = contrast.warnings.find((w) => w.pair === pair);
        const isBlocked = pair === "foreground" && blocked;
        if (!isBlocked && warning === undefined)
          return (
            <Badge key={pair} variant="success" className="self-start">
              {c.colors[text]} · {c.contrastOk}
            </Badge>
          );
        return (
          <div key={pair} className="flex flex-wrap items-center gap-2">
            <Badge variant={isBlocked ? "destructive" : "warning"} className="whitespace-normal">
              {isBlocked
                ? c.contrastBlocked
                : `${c.colors[text]} · ${c.contrastLow.replace("{ratio}", ratio.format(warning?.ratio ?? 0))}`}
            </Badge>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => setColor(text, bestTextOn(doc.brand.colors[fill]))}
            >
              {c.autoFix}
            </Button>
          </div>
        );
      })}
    </section>
  );
}

export function TypographyPanel({ t, doc, update, disabled }: PanelProps) {
  const c = t.onlineStoreCustomize;
  const setTypography = (patch: Partial<ThemeDocument["brand"]["typography"]>) =>
    update((d) => withBrand(d, { typography: { ...d.brand.typography, ...patch } }));
  return (
    <section className="flex flex-col gap-3">
      {(["headingFont", "bodyFont"] as const).map((field) => (
        <div key={field} className="flex flex-col gap-1">
          <Label htmlFor={field}>{field === "headingFont" ? c.headingFont : c.bodyFont}</Label>
          <NativeSelect
            id={field}
            value={doc.brand.typography[field]}
            disabled={disabled}
            onChange={(e) => {
              const key = FONT_KEYS.find((k) => k === e.currentTarget.value);
              if (key !== undefined) setTypography({ [field]: key });
            }}
          >
            {FONT_KEYS.map((key) => (
              <option key={key} value={key}>
                {FONT_FAMILIES[key]}
              </option>
            ))}
          </NativeSelect>
          {/* The family comes from the fixed key → family map only (spec 1.3), never from input. */}
          <p className="text-lg" style={{ fontFamily: fontStack(doc.brand.typography[field]) }}>
            {c.fontSample}
          </p>
        </div>
      ))}
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1 text-sm font-medium">{c.baseSize}</legend>
        {BASE_SIZES.map((size) => (
          <Button
            key={size}
            type="button"
            size="sm"
            variant={doc.brand.typography.baseSize === size ? "primary" : "secondary"}
            aria-pressed={doc.brand.typography.baseSize === size}
            disabled={disabled}
            onClick={() => setTypography({ baseSize: size })}
          >
            {c.sizes[size]}
          </Button>
        ))}
      </fieldset>
    </section>
  );
}

export function CornersPanel({ t, doc, update, disabled }: PanelProps) {
  const c = t.onlineStoreCustomize;
  return (
    <section className="flex flex-wrap gap-2">
      {CORNER_STYLES.map((style) => (
        <button
          key={style}
          type="button"
          aria-pressed={doc.brand.corners === style}
          disabled={disabled}
          onClick={() => update((d) => withBrand(d, { corners: style }))}
          className="border-border aria-pressed:border-primary flex flex-col items-center gap-1 rounded-lg border p-2 text-xs"
        >
          <span
            className="bg-primary block h-6 w-12"
            style={{ borderRadius: `${RADIUS_SCALES[style][4] ?? 0}px` }}
          />
          {c.corners[style]}
        </button>
      ))}
    </section>
  );
}

/**
 * One social link through the document validator itself, so the editor accepts exactly what the
 * API will: the stored (normalised, percent-encoded) form, or the validator's code.
 */
function checkSocial(
  network: SocialNetwork,
  value: string,
): { readonly url: string } | { readonly code: string } {
  const result = validateThemeDocument({
    ...DEFAULT_THEME_DOCUMENT,
    brand: { ...DEFAULT_THEME_DOCUMENT.brand, social: { [network]: value } },
  });
  if (result.ok) return { url: result.value.brand.social[network] ?? value };
  const path = `brand.social.${network}`;
  return { code: result.issues.find((issue) => issue.path === path)?.code ?? "INVALID_VALUE" };
}

/**
 * Ruling 5: a stored link is percent-encoded (`https://x.com/%D9%85…`); show it decoded so an
 * Arabic handle reads as typed. Only when the decoded text is itself a valid link that encodes back
 * to the same stored value (so a decoded space, control or bidi mark never shows or round-trips).
 */
function displaySocial(network: SocialNetwork, stored: string): string {
  let decoded: string;
  try {
    decoded = decodeURI(stored);
  } catch {
    return stored;
  }
  if (decoded === stored) return stored;
  const check = checkSocial(network, decoded);
  return "url" in check && check.url === stored ? decoded : stored;
}

export function SocialPanel({ t, doc, update, disabled, errors }: PanelProps) {
  const c = t.onlineStoreCustomize;
  const [text, setText] = useState<Partial<Record<SocialNetwork, string>>>(() => {
    const shown: Partial<Record<SocialNetwork, string>> = {};
    for (const network of SOCIAL_NETWORKS) {
      const stored = doc.brand.social[network];
      if (stored !== undefined) shown[network] = displaySocial(network, stored);
    }
    return shown;
  });
  const [local, setLocal] = useState<Partial<Record<SocialNetwork, string>>>({});
  const copyFor = (code: string) =>
    code === "INVALID_URL"
      ? c.socialInvalid
      : code === "TOO_LONG"
        ? c.socialTooLong
        : t.formErrors.invalid;
  const commit = (network: SocialNetwork, value: string) => {
    const trimmed = value.trim();
    const stored = doc.brand.social[network];
    if (trimmed === "") {
      setLocal((s) => ({ ...s, [network]: undefined }));
      if (stored === undefined) return;
      update((d) => {
        const social = { ...d.brand.social };
        delete social[network];
        return withBrand(d, { social });
      });
      return;
    }
    const check = checkSocial(network, trimmed);
    if ("code" in check) {
      setLocal((s) => ({ ...s, [network]: copyFor(check.code) }));
      return;
    }
    setLocal((s) => ({ ...s, [network]: undefined }));
    if (check.url === stored) return;
    update((d) => withBrand(d, { social: { ...d.brand.social, [network]: check.url } }));
  };
  return (
    <section className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">{c.socialHint}</p>
      {SOCIAL_NETWORKS.map((network) => {
        const message = local[network] ?? errors[`brand.social.${network}`];
        const errorId = `social-${network}-error`;
        return (
          <div key={network} className="flex flex-col gap-1">
            <Label htmlFor={`social-${network}`}>{c.networks[network]}</Label>
            <input
              id={`social-${network}`}
              type="url"
              dir="ltr"
              inputMode="url"
              autoComplete="off"
              className="border-input bg-card h-9 rounded-xl border px-3 text-sm"
              value={text[network] ?? ""}
              disabled={disabled}
              aria-invalid={message !== undefined}
              aria-describedby={message === undefined ? undefined : errorId}
              onChange={(e) => {
                const next = e.currentTarget.value;
                setText((s) => ({ ...s, [network]: next }));
              }}
              onBlur={(e) => commit(network, e.currentTarget.value)}
            />
            <FieldError id={errorId} message={message} />
          </div>
        );
      })}
    </section>
  );
}

export function FooterPanel({ t, locale, doc, update, disabled, errors }: PanelProps) {
  const c = t.onlineStoreCustomize;
  return (
    <section className="flex flex-col gap-4">
      <label className="flex items-center gap-3 text-sm">
        <Switch
          checked={doc.header.sticky}
          disabled={disabled}
          onCheckedChange={(sticky) => update((d) => ({ ...d, header: { ...d.header, sticky } }))}
        />
        {c.stickyHeader}
      </label>
      {/* `name` is the document path, so the API's `footer.note.ar` errors land on their tab. */}
      <LocalizedTextField
        t={t}
        locale={locale}
        name="footer.note"
        label={c.footerNote}
        max={200}
        multiline
        value={doc.footer.note}
        disabled={disabled}
        errors={errors}
        onChange={(note) => update((d) => ({ ...d, footer: { ...d.footer, note } }))}
      />
      <label className="flex items-center gap-3 text-sm">
        <Switch
          checked={doc.footer.showSocial}
          disabled={disabled}
          onCheckedChange={(showSocial) =>
            update((d) => ({ ...d, footer: { ...d.footer, showSocial } }))
          }
        />
        {c.showSocial}
      </label>
    </section>
  );
}
