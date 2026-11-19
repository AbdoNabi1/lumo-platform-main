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
export type {
  EmailSendPort,
  OutreachCredentialVault,
  WhatsAppCloudApiPort,
} from "./application/ports";
