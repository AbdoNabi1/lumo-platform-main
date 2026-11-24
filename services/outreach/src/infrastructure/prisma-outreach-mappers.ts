import type {
  ConsentEvent,
  Contact,
  InboundMessage,
  MessageTemplate,
  OutboundMessage,
  Prisma,
  UnmatchedStatusEvent,
  WhatsAppConnection,
} from "@prisma/client";
import type {
  ConnectionStatus,
  ConsentEventRecord,
  ConsentValue,
  ContactRecord,
  InboundRecord,
  InboundType,
  OnboardingStage,
  OutboundChannel,
  OutboundKind,
  OutboundPurpose,
  OutboundRecord,
  StatusEventRecord,
  TemplateCategoryValue,
  TemplateRecord,
  TemplateStatus,
  TransactionalConsentValue,
  UnmatchedStatusRecord,
  WhatsAppConnectionRecord,
} from "../domain/repositories";
import type { OutboundStatus } from "../domain/outbound-message";

/** Narrows a stored string column to its literal union; an unknown value is a data-integrity error, not a default. */
function oneOf<T extends string>(field: string, value: string, allowed: readonly T[]): T {
  const found = allowed.find((a) => a === value);
  if (found === undefined) throw new Error(`Unexpected stored value for ${field}`);
  return found;
}

const CONNECTION_STATUS = ["onboarding", "connected", "disconnected", "error"] as const;
const ONBOARDING_STAGE = ["verified", "subscribed", "registering", "registered"] as const;
const TEMPLATE_STATUS = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "IN_APPEAL",
  "DELETED",
  "ARCHIVED",
  "PENDING_DELETION",
  "UNKNOWN",
] as const;
const TEMPLATE_CATEGORY = ["UTILITY", "MARKETING", "AUTHENTICATION"] as const;
const CONSENT = ["granted", "revoked", "unknown"] as const;
const TRANSACTIONAL = ["allowed", "revoked", "unknown"] as const;
const CHANNEL = ["whatsapp", "email"] as const;
const PURPOSE = ["marketing", "transactional"] as const;
const ACTION = ["grant", "revoke"] as const;
const SOURCE = ["admin", "import", "inbound_keyword", "checkout", "api"] as const;
const OUTBOUND_KIND = ["template", "session_text", "session_interactive", "email"] as const;
const OUTBOUND_PURPOSE = ["marketing", "utility", "transactional", "authentication"] as const;
const OUTBOUND_STATUS = [
  "pending",
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
  "unknown",
  "suppressed",
] as const satisfies readonly OutboundStatus[];
const INBOUND_TYPE = ["text", "button", "interactive", "image", "other"] as const;

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export function connectionFromRow(row: WhatsAppConnection): WhatsAppConnectionRecord {
  return {
    tenantId: row.tenantId,
    status: oneOf<ConnectionStatus>("whatsapp_connections.status", row.status, CONNECTION_STATUS),
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    displayPhoneNumber: row.displayPhoneNumber,
    verifiedName: row.verifiedName,
    qualityRating: row.qualityRating,
    messagingLimitTier: row.messagingLimitTier,
    sealedCredentials: row.sealedCredentials,
    connectedAt: row.connectedAt,
    disconnectedAt: row.disconnectedAt,
    lastStatusSyncAt: row.lastStatusSyncAt,
    lastError: row.lastError,
    onboardingAttemptId: row.onboardingAttemptId,
    onboardingStage:
      row.onboardingStage === null
        ? null
        : oneOf<OnboardingStage>(
            "whatsapp_connections.onboarding_stage",
            row.onboardingStage,
            ONBOARDING_STAGE,
          ),
    onboardingFailure: row.onboardingFailure,
    onboardingLeaseOwner: row.onboardingLeaseOwner,
    onboardingLeaseUntil: row.onboardingLeaseUntil,
    version: row.version,
  };
}

/** Every column except the key and the version (the repository owns those). */
export function connectionColumns(r: WhatsAppConnectionRecord) {
  return {
    status: r.status,
    wabaId: r.wabaId,
    phoneNumberId: r.phoneNumberId,
    displayPhoneNumber: r.displayPhoneNumber,
    verifiedName: r.verifiedName,
    qualityRating: r.qualityRating,
    messagingLimitTier: r.messagingLimitTier,
    sealedCredentials: r.sealedCredentials,
    connectedAt: r.connectedAt,
    disconnectedAt: r.disconnectedAt,
    lastStatusSyncAt: r.lastStatusSyncAt,
    lastError: r.lastError,
    onboardingAttemptId: r.onboardingAttemptId,
    onboardingStage: r.onboardingStage,
    onboardingFailure: r.onboardingFailure,
    onboardingLeaseOwner: r.onboardingLeaseOwner,
    onboardingLeaseUntil: r.onboardingLeaseUntil,
  };
}

export function templateFromRow(row: MessageTemplate): TemplateRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    wabaId: row.wabaId,
    metaTemplateId: row.metaTemplateId,
    name: row.name,
    language: row.language,
    category: oneOf<TemplateCategoryValue>(
      "message_templates.category",
      row.category,
      TEMPLATE_CATEGORY,
    ),
    components: row.components,
    status: oneOf<TemplateStatus>("message_templates.status", row.status, TEMPLATE_STATUS),
    rejectedReason: row.rejectedReason,
    qualityScore: row.qualityScore,
    lastSyncedAt: row.lastSyncedAt,
    statusEventAt: row.statusEventAt,
    categoryEventAt: row.categoryEventAt,
    reconciledAt: row.reconciledAt,
    revision: row.revision,
    version: row.version,
  };
}

export function templateInsertRow(r: TemplateRecord): Prisma.MessageTemplateCreateManyInput {
  return {
    id: r.id,
    tenantId: r.tenantId,
    wabaId: r.wabaId,
    metaTemplateId: r.metaTemplateId,
    name: r.name,
    language: r.language,
    category: r.category,
    components: json(r.components),
    status: r.status,
    rejectedReason: r.rejectedReason,
    qualityScore: r.qualityScore,
    lastSyncedAt: r.lastSyncedAt,
    statusEventAt: r.statusEventAt,
    categoryEventAt: r.categoryEventAt,
    reconciledAt: r.reconciledAt,
    revision: r.revision,
    version: 1,
  };
}

export function contactFromRow(row: Contact): ContactRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    phoneE164: row.phoneE164,
    email: row.email,
    customerRef: row.customerRef,
    displayName: row.displayName,
    whatsappMarketing: oneOf<ConsentValue>(
      "contacts.whatsapp_marketing",
      row.whatsappMarketing,
      CONSENT,
    ),
    whatsappTransactional: oneOf<TransactionalConsentValue>(
      "contacts.whatsapp_transactional",
      row.whatsappTransactional,
      TRANSACTIONAL,
    ),
    emailMarketing: oneOf<ConsentValue>("contacts.email_marketing", row.emailMarketing, CONSENT),
    lastInboundAt: row.lastInboundAt,
    version: row.version,
  };
}

/** Identity columns only: consent columns are deliberately absent (they take the DB defaults on create). */
export function contactIdentityColumns(r: ContactRecord) {
  return {
    phoneE164: r.phoneE164,
    email: r.email,
    customerRef: r.customerRef,
    displayName: r.displayName,
    lastInboundAt: r.lastInboundAt,
  };
}

export function consentColumns(r: ContactRecord) {
  return {
    whatsappMarketing: r.whatsappMarketing,
    whatsappTransactional: r.whatsappTransactional,
    emailMarketing: r.emailMarketing,
  };
}

export function consentEventFromRow(row: ConsentEvent): ConsentEventRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    contactId: row.contactId,
    channel: oneOf<"whatsapp" | "email">("consent_events.channel", row.channel, CHANNEL),
    purpose: oneOf<"marketing" | "transactional">("consent_events.purpose", row.purpose, PURPOSE),
    action: oneOf<"grant" | "revoke">("consent_events.action", row.action, ACTION),
    source: oneOf<ConsentEventRecord["source"]>("consent_events.source", row.source, SOURCE),
    evidence: row.evidence,
    ...(row.operationKey === null ? {} : { operationKey: row.operationKey }),
    occurredAt: row.occurredAt,
  };
}

export function outboundFromRow(row: OutboundMessage): OutboundRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    channel: oneOf<OutboundChannel>("outbound_messages.channel", row.channel, CHANNEL),
    kind: oneOf<OutboundKind>("outbound_messages.kind", row.kind, OUTBOUND_KIND),
    contactId: row.contactId,
    recipient: row.recipient,
    templateName: row.templateName,
    templateLanguage: row.templateLanguage,
    templateRevision: row.templateRevision,
    purpose: oneOf<OutboundPurpose>("outbound_messages.purpose", row.purpose, OUTBOUND_PURPOSE),
    payload: row.payload,
    idempotencyKey: row.idempotencyKey,
    status: oneOf<OutboundStatus>("outbound_messages.status", row.status, OUTBOUND_STATUS),
    providerMessageId: row.providerMessageId,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    contextRef: row.contextRef,
    acceptedAt: row.acceptedAt,
    correlationId: row.correlationId,
    dispatchStartedAt: row.dispatchStartedAt,
    providerIdempotencyKey: row.providerIdempotencyKey,
    dispatchPhoneNumberId: row.dispatchPhoneNumberId,
    dispatchWabaId: row.dispatchWabaId,
    version: row.version,
  };
}

export function outboundInsertRow(r: OutboundRecord): Prisma.OutboundMessageCreateManyInput {
  return {
    id: r.id,
    tenantId: r.tenantId,
    channel: r.channel,
    kind: r.kind,
    contactId: r.contactId,
    recipient: r.recipient,
    templateName: r.templateName,
    templateLanguage: r.templateLanguage,
    templateRevision: r.templateRevision,
    purpose: r.purpose,
    payload: json(r.payload),
    idempotencyKey: r.idempotencyKey,
    status: r.status,
    providerMessageId: r.providerMessageId,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    contextRef: r.contextRef,
    acceptedAt: r.acceptedAt,
    correlationId: r.correlationId,
    dispatchStartedAt: r.dispatchStartedAt,
    providerIdempotencyKey: r.providerIdempotencyKey,
    dispatchPhoneNumberId: r.dispatchPhoneNumberId,
    dispatchWabaId: r.dispatchWabaId,
    version: 1,
  };
}

/** The only outbound columns an update may change. */
export function outboundMutableColumns(r: OutboundRecord) {
  return {
    status: r.status,
    providerMessageId: r.providerMessageId,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    acceptedAt: r.acceptedAt,
  };
}

export function statusEventInsertRow(
  e: StatusEventRecord,
): Prisma.MessageStatusEventCreateManyInput {
  return {
    id: e.id,
    tenantId: e.tenantId,
    outboundMessageId: e.outboundMessageId,
    providerEventId: e.providerEventId,
    status: e.status,
    occurredAt: e.occurredAt,
    raw: json(e.raw),
  };
}

export function inboundFromRow(row: InboundMessage): InboundRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    contactId: row.contactId,
    providerMessageId: row.providerMessageId,
    type: oneOf<InboundType>("inbound_messages.type", row.type, INBOUND_TYPE),
    text: row.text,
    buttonPayload: row.buttonPayload,
    contextProviderMessageId: row.contextProviderMessageId,
    occurredAt: row.occurredAt,
    receivedAt: row.receivedAt,
  };
}

export function inboundInsertRow(r: InboundRecord): Prisma.InboundMessageCreateManyInput {
  return {
    id: r.id,
    tenantId: r.tenantId,
    contactId: r.contactId,
    providerMessageId: r.providerMessageId,
    type: r.type,
    text: r.text,
    buttonPayload: r.buttonPayload,
    contextProviderMessageId: r.contextProviderMessageId,
    occurredAt: r.occurredAt,
    receivedAt: r.receivedAt,
  };
}

export function unmatchedFromRow(row: UnmatchedStatusEvent): UnmatchedStatusRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    phoneNumberId: row.phoneNumberId,
    providerEventId: row.providerEventId,
    providerMessageId: row.providerMessageId,
    correlationId: row.correlationId,
    occurredAt: row.occurredAt,
    resolvedAt: row.resolvedAt,
    status: oneOf<OutboundStatus>("unmatched_status_events.status", row.status, OUTBOUND_STATUS),
    recipientId: row.recipient,
    wabaId: row.dispatchWabaId,
    errorCode: row.errorCode,
    quarantined: row.quarantined,
  };
}

export function unmatchedInsertRow(
  e: UnmatchedStatusRecord,
): Prisma.UnmatchedStatusEventCreateManyInput {
  return {
    id: e.id,
    tenantId: e.tenantId,
    phoneNumberId: e.phoneNumberId,
    providerEventId: e.providerEventId,
    providerMessageId: e.providerMessageId,
    correlationId: e.correlationId,
    status: e.status,
    recipient: e.recipientId,
    dispatchWabaId: e.wabaId,
    errorCode: e.errorCode,
    quarantined: e.quarantined,
    occurredAt: e.occurredAt,
    resolvedAt: e.resolvedAt,
  };
}

export function consentEventInsertRow(e: ConsentEventRecord): Prisma.ConsentEventCreateManyInput {
  return {
    id: e.id,
    tenantId: e.tenantId,
    contactId: e.contactId,
    channel: e.channel,
    purpose: e.purpose,
    action: e.action,
    source: e.source,
    evidence: e.evidence,
    ...(e.operationKey === undefined || e.operationKey === null
      ? {}
      : { operationKey: e.operationKey }),
    occurredAt: e.occurredAt,
  };
}

export { json as toInputJson };
