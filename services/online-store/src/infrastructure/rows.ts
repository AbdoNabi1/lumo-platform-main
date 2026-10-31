import type { Prisma } from "@platform/db";
import {
  readThemeDocument,
  type Locale,
  type LocalizedText,
  type ThemeDocument,
} from "@platform/storefront-content";

/** Tolerant read of a stored `{ ar?, en? }` (only string values survive). */
export function localizedTextOf(value: unknown): LocalizedText {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as Record<string, unknown>;
  return {
    ...(typeof raw["ar"] === "string" && raw["ar"] !== "" ? { ar: raw["ar"] } : {}),
    ...(typeof raw["en"] === "string" && raw["en"] !== "" ? { en: raw["en"] } : {}),
  };
}

export const localeOf = (value: unknown): Locale => (value === "en" ? "en" : "ar");

export function documentOf(value: unknown): ThemeDocument {
  return readThemeDocument(value);
}

export const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/** Prisma's unique-violation code: a concurrent first insert lost the race. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}
