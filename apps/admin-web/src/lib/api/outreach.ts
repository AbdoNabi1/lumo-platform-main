import { getAdminApi, mutateAdminApi, type ApiResult, type MutationResult } from "./client";

/**
 * Typed guards and calls for the outreach admin routes (`apps/admin/src/http/outreach-routes.ts`). Server-only,
 * like every module here: the bearer credential never reaches the browser.
 *
 * What a merchant sees is deliberately narrow. The connection and template DTOs are PROJECTED after the guard, so a
 * field the API adds later (or an id it should not send) never travels to the client bundle.
 */

export type WhatsAppConnectionStatus =
  "connected" | "disconnected" | "error" | "not_connected" | "onboarding";
export type WhatsAppOnboardingStage = "verified" | "subscribed" | "registering" | "registered";

/** What the Embedded Signup SDK needs. Only present when the platform is configured. */
export interface WhatsAppSignupDto {
  readonly appId: string;
  readonly configId: string;
  readonly graphApiVersion: string;
}

export interface WhatsAppConnectionDto {
  readonly available: boolean;
  readonly status: WhatsAppConnectionStatus;
  readonly displayPhoneNumber: string | null;
  readonly verifiedName: string | null;
  readonly qualityRating: string | null;
  readonly messagingLimitTier: string | null;
  readonly connectedAt: string | null;
  /** An allowlisted code; the UI maps it to copy and never shows it. */
  readonly lastError: string | null;
  /** An allowlisted code; the UI maps it to copy and never shows it. */
  readonly onboardingFailure: string | null;
  readonly onboardingStage: WhatsAppOnboardingStage | null;
  readonly version: number;
  readonly signup?: WhatsAppSignupDto;
}

export interface TemplateSendShape {
  readonly bodyVariableCount: number;
  readonly headerHasVariable: boolean;
  readonly buttons: readonly {
    readonly index: number;
    readonly type: string;
    readonly urlHasVariable: boolean;
  }[];
}

/** The part of the API's `TemplateDto` the settings screen reads. */
export interface WhatsAppTemplateDto {
  readonly name: string;
  readonly language: string;
  readonly category: string;
  readonly status: string;
  readonly variableCount: number;
  readonly supported: boolean;
  readonly sendShape: TemplateSendShape;
}

export type SendStatus =
  "pending" | "accepted" | "sent" | "delivered" | "read" | "failed" | "unknown" | "suppressed";

export interface SendResultDto {
  readonly outboundId: string;
  readonly status: SendStatus;
  readonly providerMessageId: string | null;
  readonly acceptedAt: string | null;
  /** An allowlisted code; the UI maps it to copy and never shows it. */
  readonly errorCode: string | null;
}

export interface TestSendInput {
  readonly to: string;
  readonly templateName: string;
  readonly language: string;
  readonly values: {
    readonly body: readonly string[];
    readonly header?: string;
    readonly urlSuffixes?: Readonly<Record<string, string>>;
  };
  readonly attestConsent?: boolean;
}

const STATUSES: ReadonlySet<string> = new Set([
  "connected",
  "disconnected",
  "error",
  "not_connected",
  "onboarding",
]);
const STAGES: ReadonlySet<string> = new Set([
  "verified",
  "subscribed",
  "registering",
  "registered",
]);
const SEND_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
  "unknown",
  "suppressed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
function isSignup(value: unknown): value is WhatsAppSignupDto {
  return (
    isRecord(value) &&
    typeof value.appId === "string" &&
    typeof value.configId === "string" &&
    typeof value.graphApiVersion === "string"
  );
}

export function isWhatsAppConnectionDto(value: unknown): value is WhatsAppConnectionDto {
  return (
    isRecord(value) &&
    typeof value.available === "boolean" &&
    typeof value.status === "string" &&
    STATUSES.has(value.status) &&
    isStringOrNull(value.displayPhoneNumber) &&
    isStringOrNull(value.verifiedName) &&
    isStringOrNull(value.qualityRating) &&
    isStringOrNull(value.messagingLimitTier) &&
    isStringOrNull(value.connectedAt) &&
    isStringOrNull(value.lastError) &&
    isStringOrNull(value.onboardingFailure) &&
    (value.onboardingStage === null ||
      (typeof value.onboardingStage === "string" && STAGES.has(value.onboardingStage))) &&
    typeof value.version === "number" &&
    Number.isInteger(value.version) &&
    (value.signup === undefined || isSignup(value.signup))
  );
}

function isSendShape(value: unknown): value is TemplateSendShape {
  return (
    isRecord(value) &&
    typeof value.bodyVariableCount === "number" &&
    typeof value.headerHasVariable === "boolean" &&
    Array.isArray(value.buttons) &&
    value.buttons.every(
      (b: unknown) =>
        isRecord(b) &&
        typeof b.index === "number" &&
        typeof b.type === "string" &&
        typeof b.urlHasVariable === "boolean",
    )
  );
}

export function isWhatsAppTemplateDto(value: unknown): value is WhatsAppTemplateDto {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.language === "string" &&
    typeof value.category === "string" &&
    typeof value.status === "string" &&
    typeof value.variableCount === "number" &&
    typeof value.supported === "boolean" &&
    isSendShape(value.sendShape)
  );
}

export function isWhatsAppTemplateList(value: unknown): value is readonly WhatsAppTemplateDto[] {
  return Array.isArray(value) && value.every(isWhatsAppTemplateDto);
}

export function isSendResultDto(value: unknown): value is SendResultDto {
  return (
    isRecord(value) &&
    typeof value.outboundId === "string" &&
    typeof value.status === "string" &&
    SEND_STATUSES.has(value.status) &&
    isStringOrNull(value.providerMessageId) &&
    isStringOrNull(value.acceptedAt) &&
    isStringOrNull(value.errorCode)
  );
}

/** Copies only the fields the screen shows. */
export function projectConnection(dto: WhatsAppConnectionDto): WhatsAppConnectionDto {
  return {
    available: dto.available,
    status: dto.status,
    displayPhoneNumber: dto.displayPhoneNumber,
    verifiedName: dto.verifiedName,
    qualityRating: dto.qualityRating,
    messagingLimitTier: dto.messagingLimitTier,
    connectedAt: dto.connectedAt,
    lastError: dto.lastError,
    onboardingFailure: dto.onboardingFailure,
    onboardingStage: dto.onboardingStage,
    version: dto.version,
    ...(dto.signup === undefined
      ? {}
      : {
          signup: {
            appId: dto.signup.appId,
            configId: dto.signup.configId,
            graphApiVersion: dto.signup.graphApiVersion,
          },
        }),
  };
}

/** Copies only the fields the screen shows (the template components stay on the server). */
export function projectTemplate(dto: WhatsAppTemplateDto): WhatsAppTemplateDto {
  return {
    name: dto.name,
    language: dto.language,
    category: dto.category,
    status: dto.status,
    variableCount: dto.variableCount,
    supported: dto.supported,
    sendShape: {
      bodyVariableCount: dto.sendShape.bodyVariableCount,
      headerHasVariable: dto.sendShape.headerHasVariable,
      buttons: dto.sendShape.buttons.map((b) => ({
        index: b.index,
        type: b.type,
        urlHasVariable: b.urlHasVariable,
      })),
    },
  };
}

const BASE = "/api/v1/outreach/whatsapp";

export async function fetchWhatsAppConnection(): Promise<ApiResult<WhatsAppConnectionDto>> {
  const result = await getAdminApi(BASE, isWhatsAppConnectionDto);
  return result.outcome === "ok" ? { outcome: "ok", data: projectConnection(result.data) } : result;
}

export async function fetchWhatsAppTemplates(): Promise<ApiResult<readonly WhatsAppTemplateDto[]>> {
  const result = await getAdminApi(`${BASE}/templates`, isWhatsAppTemplateList);
  return result.outcome === "ok"
    ? { outcome: "ok", data: result.data.map(projectTemplate) }
    : result;
}

/** Completes Embedded Signup: five Meta calls happen behind this one, so it gets a long timeout. */
export function connectWhatsApp(
  input: { code: string; wabaId: string; phoneNumberId: string },
  idempotencyKey: string,
): Promise<MutationResult<WhatsAppConnectionDto>> {
  return mutateAdminApi(
    `${BASE}/connect`,
    { method: "POST", body: input, idempotencyKey, timeoutMs: 60_000 },
    isWhatsAppConnectionDto,
  );
}

export function refreshWhatsApp(
  idempotencyKey: string,
): Promise<MutationResult<WhatsAppConnectionDto>> {
  return mutateAdminApi(
    `${BASE}/refresh`,
    { method: "POST", idempotencyKey, timeoutMs: 30_000 },
    isWhatsAppConnectionDto,
  );
}

export function disconnectWhatsApp(
  expectedVersion: number,
  idempotencyKey: string,
): Promise<MutationResult<WhatsAppConnectionDto>> {
  return mutateAdminApi(
    `${BASE}/disconnect`,
    { method: "POST", body: { expectedVersion }, idempotencyKey, timeoutMs: 30_000 },
    isWhatsAppConnectionDto,
  );
}

export function abandonWhatsAppOnboarding(
  expectedVersion: number,
  idempotencyKey: string,
): Promise<MutationResult<WhatsAppConnectionDto>> {
  return mutateAdminApi(
    `${BASE}/onboarding/abandon`,
    { method: "POST", body: { expectedVersion }, idempotencyKey, timeoutMs: 30_000 },
    isWhatsAppConnectionDto,
  );
}

/** `idempotencyKey` is the form's per-submission key; the API requires it. */
export function sendWhatsAppTest(
  input: TestSendInput,
  idempotencyKey: string,
): Promise<MutationResult<SendResultDto>> {
  return mutateAdminApi(
    `${BASE}/test-send`,
    { method: "POST", body: input, idempotencyKey, timeoutMs: 45_000 },
    isSendResultDto,
  );
}

// ── Templates page (Task 8) ──────────────────────────────────────────────────────────────────────────────────────

/** What the templates list shows: the send-form shape plus the rejection reason (an allowlisted Meta reason code). */
export interface WhatsAppTemplateRowDto extends WhatsAppTemplateDto {
  /** An allowlisted Meta reason; the UI maps it to copy and never shows it. */
  readonly rejectedReason: string | null;
}

export function isWhatsAppTemplateRowDto(value: unknown): value is WhatsAppTemplateRowDto {
  return (
    isWhatsAppTemplateDto(value) &&
    isStringOrNull((value as unknown as Record<string, unknown>)["rejectedReason"])
  );
}

export function isWhatsAppTemplateRowList(
  value: unknown,
): value is readonly WhatsAppTemplateRowDto[] {
  return Array.isArray(value) && value.every(isWhatsAppTemplateRowDto);
}

/** Copies only what the list shows (the Meta components stay on the server). */
export function projectTemplateRow(dto: WhatsAppTemplateRowDto): WhatsAppTemplateRowDto {
  return { ...projectTemplate(dto), rejectedReason: dto.rejectedReason };
}

/** The create-template request body (`TemplateDraft`, strict on the API). Part 1 is TEXT headers only. */
export interface TemplateDraftBody {
  readonly name: string;
  readonly language: string;
  readonly category: "UTILITY" | "MARKETING";
  readonly header?: { readonly format: "TEXT"; readonly text: string; readonly example?: string };
  readonly body: { readonly text: string; readonly examples: readonly string[] };
  readonly footer?: { readonly text: string };
  readonly buttons?: readonly {
    readonly type: "QUICK_REPLY" | "URL";
    readonly text: string;
    readonly url?: string;
    readonly example?: string;
  }[];
}

export function isDeletedResult(value: unknown): value is { readonly deleted: number } {
  return isRecord(value) && typeof value.deleted === "number";
}

export async function fetchWhatsAppTemplateRows(): Promise<
  ApiResult<readonly WhatsAppTemplateRowDto[]>
> {
  const result = await getAdminApi(`${BASE}/templates`, isWhatsAppTemplateRowList);
  return result.outcome === "ok"
    ? { outcome: "ok", data: result.data.map(projectTemplateRow) }
    : result;
}

/** Pulls the latest statuses from Meta; several Graph calls happen behind this, so it gets a long timeout. */
export function syncWhatsAppTemplates(
  idempotencyKey: string,
): Promise<MutationResult<readonly WhatsAppTemplateRowDto[]>> {
  return mutateAdminApi(
    `${BASE}/templates/sync`,
    { method: "POST", idempotencyKey, timeoutMs: 60_000 },
    isWhatsAppTemplateRowList,
  );
}

/** Submits a template to Meta for review. A domain issue is a 422 with `fields:[{field, message:<issue code>}]`. */
export function createWhatsAppTemplate(
  draft: TemplateDraftBody,
  idempotencyKey: string,
): Promise<MutationResult<WhatsAppTemplateRowDto>> {
  return mutateAdminApi(
    `${BASE}/templates`,
    { method: "POST", body: draft, idempotencyKey, timeoutMs: 60_000 },
    isWhatsAppTemplateRowDto,
  );
}

/** Deletes the template by NAME, in every language, on the active account. */
export function deleteWhatsAppTemplate(
  name: string,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly deleted: number }>> {
  return mutateAdminApi(
    `${BASE}/templates/${encodeURIComponent(name)}`,
    { method: "DELETE", idempotencyKey, timeoutMs: 60_000 },
    isDeletedResult,
  );
}

// ── Email (Task 8) ───────────────────────────────────────────────────────────────────────────────────────────────

export interface EmailSettingsDto {
  readonly available: boolean;
  /** `"<display name> <address>"`, or `null` while email isn't available. */
  readonly from: string | null;
  /** The store contact email, or `null` when it has none. */
  readonly replyTo: string | null;
}

export function isEmailSettingsDto(value: unknown): value is EmailSettingsDto {
  return (
    isRecord(value) &&
    typeof value.available === "boolean" &&
    isStringOrNull(value.from) &&
    isStringOrNull(value.replyTo)
  );
}

export async function fetchEmailSettings(): Promise<ApiResult<EmailSettingsDto>> {
  const result = await getAdminApi("/api/v1/outreach/email", isEmailSettingsDto);
  return result.outcome === "ok"
    ? {
        outcome: "ok",
        data: {
          available: result.data.available,
          from: result.data.from,
          replyTo: result.data.replyTo,
        },
      }
    : result;
}

/** `idempotencyKey` is the form's per-submission key (≤200 characters); the API requires it. */
export function sendTestEmail(
  to: string,
  idempotencyKey: string,
): Promise<MutationResult<SendResultDto>> {
  return mutateAdminApi(
    "/api/v1/outreach/email/test-send",
    { method: "POST", body: { to }, idempotencyKey, timeoutMs: 45_000 },
    isSendResultDto,
  );
}
