import { shapeOfStoredTemplate, type StoredTemplateShape } from "../domain/template-send";
import type {
  ContactRecord,
  OutboundRecord,
  TemplateRecord,
  WhatsAppConnectionRecord,
} from "../domain/repositories";
import type { OutboundStatus } from "../domain/outbound-message";
import { safeCode, templateReason } from "./error-codes";

export interface WhatsAppConnectionDto {
  available: boolean;
  status: "connected" | "disconnected" | "error" | "not_connected" | "onboarding";
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  messagingLimitTier: string | null;
  connectedAt: string | null;
  /** Allowlisted code only. */
  lastError: string | null;
  /** Allowlisted code only. */
  onboardingFailure: string | null;
  onboardingStage: "verified" | "subscribed" | "registering" | "registered" | null;
  version: number;
}

export function connectionDto(
  row: WhatsAppConnectionRecord | null,
  available: boolean,
): WhatsAppConnectionDto {
  if (row === null) {
    return {
      available,
      status: "not_connected",
      displayPhoneNumber: null,
      verifiedName: null,
      qualityRating: null,
      messagingLimitTier: null,
      connectedAt: null,
      lastError: null,
      onboardingFailure: null,
      onboardingStage: null,
      version: 0,
    };
  }
  // A never-completed onboarding row has no identity yet: nothing but the stage and failure code is exposed.
  return {
    available,
    status: row.status,
    displayPhoneNumber: row.displayPhoneNumber,
    verifiedName: row.verifiedName,
    qualityRating: row.qualityRating,
    messagingLimitTier: row.messagingLimitTier,
    connectedAt: row.connectedAt === null ? null : row.connectedAt.toISOString(),
    lastError: safeCode(row.lastError),
    onboardingFailure: safeCode(row.onboardingFailure),
    onboardingStage: row.onboardingStage,
    version: row.version,
  };
}

export interface TemplateDto {
  name: string;
  language: string;
  category: string;
  status: string;
  rejectedReason: string | null;
  components: unknown;
  variableCount: number;
  buttons: { type: string; text: string }[];
  supported: boolean;
  sendShape: {
    bodyVariableCount: number;
    headerHasVariable: boolean;
    buttons: Array<{ index: number; type: string; urlHasVariable: boolean }>;
  };
}

function storedButtons(components: unknown): { type: string; text: string }[] {
  if (!Array.isArray(components)) return [];
  const out: { type: string; text: string }[] = [];
  for (const c of components as unknown[]) {
    if (typeof c !== "object" || c === null) continue;
    const rec = c as { type?: unknown; buttons?: unknown };
    if (typeof rec.type !== "string" || rec.type.toUpperCase() !== "BUTTONS") continue;
    if (!Array.isArray(rec.buttons)) continue;
    for (const b of rec.buttons as unknown[]) {
      const btn = b as { type?: unknown; text?: unknown };
      if (typeof btn?.type === "string" && typeof btn?.text === "string") {
        out.push({ type: btn.type, text: btn.text });
      }
    }
  }
  return out;
}

export function templateDto(t: TemplateRecord): TemplateDto {
  const shape: StoredTemplateShape = shapeOfStoredTemplate(t.components);
  const reason = t.rejectedReason;
  return {
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    rejectedReason: templateReason(reason),
    components: t.components,
    variableCount: shape.bodyVariableCount,
    buttons: storedButtons(t.components),
    supported: shape.supported,
    sendShape: {
      bodyVariableCount: shape.bodyVariableCount,
      headerHasVariable: shape.headerHasVariable,
      buttons: shape.buttons.map((b) => ({ ...b })),
    },
  };
}

export interface ContactDto {
  id: string;
  phone: string | null;
  email: string | null;
  customerRef: string | null;
  displayName: string | null;
  whatsappMarketing: string;
  whatsappTransactional: string;
  emailMarketing: string;
  lastInboundAt: string | null;
}

export function contactDto(c: ContactRecord): ContactDto {
  return {
    id: c.id,
    phone: c.phoneE164,
    email: c.email,
    customerRef: c.customerRef,
    displayName: c.displayName,
    whatsappMarketing: c.whatsappMarketing,
    whatsappTransactional: c.whatsappTransactional,
    emailMarketing: c.emailMarketing,
    lastInboundAt: c.lastInboundAt === null ? null : c.lastInboundAt.toISOString(),
  };
}

export interface SendResultDto {
  outboundId: string;
  status: OutboundStatus;
  providerMessageId: string | null;
  acceptedAt: string | null;
  errorCode: string | null;
}

export function sendResultDto(o: OutboundRecord): SendResultDto {
  return {
    outboundId: o.id,
    status: o.status,
    providerMessageId: o.providerMessageId,
    acceptedAt: o.acceptedAt === null ? null : o.acceptedAt.toISOString(),
    errorCode: safeCode(o.errorCode),
  };
}

export interface EmailSettingsDto {
  available: boolean;
  from: string | null;
  replyTo: string | null;
}
