"use client";

import { useState } from "react";
import { Input, Label, Switch } from "@platform/ui";
import {
  normalizeExternalUrl,
  type FieldDescriptor,
  type LinkRef,
  type LocalizedText,
} from "@platform/storefront-content";
import { LinkPicker } from "../link-picker";
import { LocalizedTextField } from "../localized-text-field";
import { RichTextEditor } from "../rich-text-editor";
import { ChoiceField } from "./choice-field";
import {
  errorAria,
  fieldId,
  fieldLabel,
  FieldError,
  firstError,
  optionLabel,
  type FieldEnv,
  type TargetKind,
} from "./field-shared";
import { SectionImageField } from "./image-field";
import { ItemsField } from "./items-field";
import { NumberField } from "./number-field";
import { PhoneField } from "./phone-field";
import { ResourcePicker } from "./resource-picker";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asLocalized = (value: unknown): LocalizedText => {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value["ar"] === "string" ? { ar: value["ar"] } : {}),
    ...(typeof value["en"] === "string" ? { en: value["en"] } : {}),
  };
};
const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asStringOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const asStrings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const LINK_TYPES = ["home", "search", "collection", "product", "page", "policy", "url"] as const;
/** A stored link as far as the picker needs: the server validates the rest. */
const asLink = (value: unknown): LinkRef | null =>
  isRecord(value) && LINK_TYPES.some((type) => type === value["type"])
    ? (value as unknown as LinkRef)
    : null;

const isTargetKind = (type: string): type is TargetKind =>
  type === "collection" || type === "product" || type === "page";

/** A section link: the shared picker with "No link", and the address box for a web link. */
function LinkField({
  env,
  id,
  path,
  label,
  value,
  onChange,
}: {
  readonly env: FieldEnv;
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly value: unknown;
  readonly onChange: (link: LinkRef | null) => void;
}) {
  const { t, locale, targets, errors, disabled } = env;
  const link = asLink(value);
  const [badUrl, setBadUrl] = useState(false);
  const urlError = errors[`${path}.url`] ?? (badUrl ? t.onlineStoreNavigation.urlError : undefined);
  const pickerError = firstError(
    Object.fromEntries(Object.entries(errors).filter(([key]) => key !== `${path}.url`)),
    path,
  );
  let targetTitle: string | null = null;
  if (link !== null && isTargetKind(link.type) && "id" in link && targets !== null) {
    const bucket = targets[link.type];
    targetTitle = Object.hasOwn(bucket, link.id) ? (bucket[link.id]?.title ?? null) : null;
  }
  const urlId = `${id}-url`;
  return (
    <div className="flex flex-col gap-2">
      <LinkPicker
        t={t}
        locale={locale}
        value={link}
        label={label}
        allowNone
        targetTitle={targetTitle}
        disabled={disabled}
        invalid={pickerError !== undefined}
        {...(pickerError === undefined ? {} : { describedBy: `${id}-error` })}
        onChange={(next) => {
          setBadUrl(false);
          onChange(next);
        }}
        onPick={(target, type) => {
          if (isTargetKind(type)) env.onTarget(type, target.id, target.title);
        }}
      />
      <FieldError id={id} error={pickerError} />
      {link?.type === "url" ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor={urlId}>
            <bdi>{t.onlineStoreNavigation.webAddress}</bdi>
          </Label>
          <Input
            id={urlId}
            dir="ltr"
            inputMode="url"
            placeholder="https://"
            value={link.url}
            disabled={disabled}
            onChange={(e) => {
              setBadUrl(false);
              onChange({ type: "url", url: e.currentTarget.value });
            }}
            onBlur={() => {
              if (link.url.trim() === "") return;
              const normalized = normalizeExternalUrl(link.url.trim());
              if (normalized === null) setBadUrl(true);
              else if (normalized !== link.url) onChange({ type: "url", url: normalized });
            }}
            {...errorAria(urlId, urlError)}
          />
          <FieldError id={urlId} error={urlError} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One control for one field descriptor. `path` is the field's full document path: ids derive from
 * it (unique per section and per item), and the field's errors are read from `env.errors` by it.
 * A value of the wrong shape (an older document) reads as the field's empty value.
 */
export function FieldControl({
  env,
  field,
  value,
  path,
  onChange,
}: {
  readonly env: FieldEnv;
  readonly field: FieldDescriptor;
  readonly value: unknown;
  readonly path: string;
  readonly onChange: (value: unknown) => void;
}) {
  const { t, locale, errors, disabled } = env;
  const id = fieldId(env, path);
  const label = fieldLabel(t, field.key);
  const error = Object.hasOwn(errors, path) ? errors[path] : undefined;
  switch (field.kind) {
    case "localizedText":
      return (
        <LocalizedTextField
          t={t}
          locale={locale}
          name={path}
          label={label}
          max={field.max}
          layout="both"
          multiline={field.max > 100}
          value={asLocalized(value)}
          disabled={disabled}
          errors={errors}
          onChange={onChange}
        />
      );
    case "richText":
      return (
        <RichTextEditor
          t={t}
          locale={locale}
          name={path}
          label={label}
          max={field.max}
          value={asLocalized(value)}
          disabled={disabled}
          errors={errors}
          onChange={onChange}
        />
      );
    case "image":
      return (
        <SectionImageField
          t={t}
          id={id}
          label={label}
          value={asStringOrNull(value)}
          images={env.images}
          disabled={disabled}
          error={error}
          onChange={onChange}
          onImage={env.onImage}
        />
      );
    case "link":
      return (
        <LinkField env={env} id={id} path={path} label={label} value={value} onChange={onChange} />
      );
    case "collection": {
      const ids = asStrings(value === null ? [] : [value]);
      return (
        <ResourcePicker
          t={t}
          locale={locale}
          id={id}
          label={label}
          kind="collection"
          multiple={false}
          max={1}
          value={ids}
          targets={env.targets}
          disabled={disabled}
          error={error}
          onChange={(next) => onChange(next[0] ?? null)}
          onTarget={env.onTarget}
        />
      );
    }
    case "products":
      return (
        <ResourcePicker
          t={t}
          locale={locale}
          id={id}
          label={label}
          kind="product"
          multiple
          max={field.max}
          value={asStrings(value)}
          targets={env.targets}
          disabled={disabled}
          error={firstError(errors, path)}
          onChange={onChange}
          onTarget={env.onTarget}
        />
      );
    case "number":
      return (
        <NumberField
          id={id}
          label={label}
          valueLabel={t.onlineStoreSections.fields.valueOf.replace("{label}", label)}
          min={field.min}
          max={field.max}
          step={field.step}
          value={typeof value === "number" ? value : field.min}
          disabled={disabled}
          error={error}
          onChange={onChange}
        />
      );
    case "select":
      return (
        <ChoiceField
          id={id}
          label={label}
          options={field.options.map((option) => ({
            value: option,
            label: optionLabel(t, field, option),
          }))}
          value={asString(value)}
          disabled={disabled}
          error={error}
          onChange={onChange}
        />
      );
    case "boolean":
      return (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-3 text-sm">
            <Switch
              id={id}
              checked={value === true}
              disabled={disabled}
              onCheckedChange={onChange}
              {...errorAria(id, error)}
            />
            <bdi>{label}</bdi>
          </label>
          <FieldError id={id} error={error} />
        </div>
      );
    case "phone":
      return (
        <PhoneField
          id={id}
          label={label}
          hint={t.onlineStoreSections.phone.hint}
          invalidCopy={t.onlineStoreSections.errors.invalidPhone}
          value={asString(value)}
          disabled={disabled}
          error={error}
          onChange={onChange}
        />
      );
    case "text":
      return (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id}>
            <bdi>{label}</bdi>
          </Label>
          <Input
            id={id}
            dir="auto"
            maxLength={field.max}
            value={asString(value)}
            disabled={disabled}
            onChange={(e) => onChange(e.currentTarget.value)}
            {...errorAria(id, error)}
          />
          <FieldError id={id} error={error} />
        </div>
      );
    case "items":
      return (
        <ItemsField
          t={t}
          id={id}
          path={path}
          label={label}
          field={field}
          value={Array.isArray(value) ? value : []}
          disabled={disabled}
          error={error}
          renderField={(sub, subValue, subPath, subChange) => (
            <FieldControl
              env={env}
              field={sub}
              value={subValue}
              path={subPath}
              onChange={subChange}
            />
          )}
          onChange={onChange}
        />
      );
  }
}
