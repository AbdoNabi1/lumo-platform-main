import { createHash, randomBytes } from "node:crypto";

export const PREVIEW_TOKEN_TTL_MS = 60 * 60 * 1000;
export const PREVIEW_TOKEN_MAX_LENGTH = 100;
const SHAPE = /^[A-Za-z0-9_-]{32,100}$/;

/**
 * A stored preview token: plain data, so it has no class to hide fields behind. It holds the
 * SHA-256 of a 256-bit random token, never the token, so the hash cannot be turned back into a
 * working link; it is still not a DTO field, and nothing here may add the raw token.
 */
export interface PreviewTokenRecord {
  readonly id: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/** 256 random bits, base64url (Plan 1C's shape). Exists once: in the 201 body and the preview URL. */
export function mintPreviewToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What is stored and looked up. Never the token. */
export function hashPreviewToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWellFormedPreviewToken(value: unknown): value is string {
  return typeof value === "string" && value.length <= PREVIEW_TOKEN_MAX_LENGTH && SHAPE.test(value);
}
