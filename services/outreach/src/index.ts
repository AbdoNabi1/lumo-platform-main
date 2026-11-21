export const OUTREACH_PUBLISHED_EVENTS = [] as const;
export { validateTemplateDraft } from "./domain/message-template";
export type { TemplateDraft, TemplateIssue } from "./domain/message-template";
export { wireOutreach, wireOutreachRecovery } from "./composition";
export type { OutreachWiringDeps, WiredOutreach } from "./composition";
export { OutreachController } from "./interfaces/outreach.controller";
export type {
  ContactDto,
  ControllerResponse,
  EmailSettingsDto,
  SendResultDto,
  TemplateDto,
  WhatsAppConnectionDto,
} from "./interfaces/presenter";
export type {
  OutreachEventInput,
  OutreachEventPayloads,
  OutreachEventSink,
  OutreachEventType,
} from "./application/events";
export type { StoreProfilePort } from "./application/outreach-deps";
export { DEFAULT_EMAIL_CAPS, DEFAULT_UNRESOLVED_AFTER_MS } from "./application/outreach-deps";
export type {
  EmailSendPort,
  MetaTemplateRecord,
  OutreachCredentialVault,
  SendOutcome,
  WhatsAppCloudApiPort,
  WhatsAppPhoneInfo,
} from "./application/ports";
export type { TemplateButton, TemplateCategory } from "./domain/message-template";
export type { TemplateSendValues } from "./domain/template-send";
// Production adapters, consumed by the runtime composition root (Task 3 ruling e). The ./testing harness stays off the root.
export { MetaApiError, MetaGraphClient } from "./infrastructure/meta-graph-client";
export { ResendEmailClient } from "./infrastructure/resend-email-client";
export {
  EnvelopeOutreachCredentialVault,
  InMemoryOutreachCredentialVault,
  OUTREACH_CREDENTIALS_KEY_ALIAS,
} from "./infrastructure/envelope-outreach-credential-vault";
export { verifyMetaSignature } from "./infrastructure/meta-webhook-signature";
