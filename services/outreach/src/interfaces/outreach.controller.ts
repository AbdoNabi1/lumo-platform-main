import type {
  ConnectWhatsApp,
  ConnectWhatsAppInput,
} from "../application/connect-whatsapp.use-case";
import type { UpsertContact, UpsertContactInput } from "../application/contact.use-cases";
import type { RecordConsent, RecordConsentInput } from "../application/contact.use-cases";
import type {
  AbandonWhatsAppOnboarding,
  DisconnectWhatsApp,
  GetWhatsAppConnection,
  RefreshWhatsAppStatus,
} from "../application/connection.use-cases";
import type { GetEmailSettings } from "../application/email-settings.use-case";
import type {
  SendEmail,
  SendEmailInput,
  SendWhatsAppSessionMessage,
  SendWhatsAppSessionMessageInput,
  SendWhatsAppTemplate,
  SendWhatsAppTemplateInput,
} from "../application/send.use-cases";
import type {
  CreateTemplate,
  DeleteTemplate,
  ListTemplates,
  SyncTemplates,
} from "../application/template.use-cases";
import type { TemplateDraft } from "../domain/message-template";
import { type ControllerResponse, present } from "./presenter";

export interface OutreachControllerDeps {
  readonly getConnection: GetWhatsAppConnection;
  readonly connect: ConnectWhatsApp;
  readonly refresh: RefreshWhatsAppStatus;
  readonly disconnect: DisconnectWhatsApp;
  readonly abandon: AbandonWhatsAppOnboarding;
  readonly listTemplates: ListTemplates;
  readonly syncTemplates: SyncTemplates;
  readonly createTemplate: CreateTemplate;
  readonly deleteTemplate: DeleteTemplate;
  readonly upsertContact: UpsertContact;
  readonly recordConsent: RecordConsent;
  readonly sendTemplate: SendWhatsAppTemplate;
  readonly sendSession: SendWhatsAppSessionMessage;
  readonly sendEmail: SendEmail;
  readonly emailSettings: GetEmailSettings;
}

type Without<T> = Omit<T, "tenantId">;

/**
 * Framework-agnostic boundary: one method per use case, taking `(tenantId, input)` (the tenant is the verified request
 * tenant, never a body field) and returning the presenter's transport-neutral response.
 */
export class OutreachController {
  constructor(private readonly deps: OutreachControllerDeps) {}

  async getConnection(tenantId: string): Promise<ControllerResponse> {
    return present(await this.deps.getConnection.execute({ tenantId }), 200);
  }

  async connect(
    tenantId: string,
    input: Without<ConnectWhatsAppInput>,
  ): Promise<ControllerResponse> {
    return present(await this.deps.connect.execute({ ...input, tenantId }), 200);
  }

  async refresh(tenantId: string): Promise<ControllerResponse> {
    return present(await this.deps.refresh.execute({ tenantId }), 200);
  }

  async disconnect(
    tenantId: string,
    input: { expectedVersion: number },
  ): Promise<ControllerResponse> {
    return present(await this.deps.disconnect.execute({ ...input, tenantId }), 200);
  }

  async abandonOnboarding(
    tenantId: string,
    input: { expectedVersion: number },
  ): Promise<ControllerResponse> {
    return present(await this.deps.abandon.execute({ ...input, tenantId }), 200);
  }

  async listTemplates(tenantId: string): Promise<ControllerResponse> {
    return present(await this.deps.listTemplates.execute({ tenantId }), 200);
  }

  async syncTemplates(tenantId: string): Promise<ControllerResponse> {
    return present(await this.deps.syncTemplates.execute({ tenantId }), 200);
  }

  async createTemplate(
    tenantId: string,
    input: { draft: TemplateDraft },
  ): Promise<ControllerResponse> {
    return present(await this.deps.createTemplate.execute({ ...input, tenantId }), 201);
  }

  async deleteTemplate(tenantId: string, input: { name: string }): Promise<ControllerResponse> {
    return present(await this.deps.deleteTemplate.execute({ ...input, tenantId }), 200);
  }

  async upsertContact(
    tenantId: string,
    input: Without<UpsertContactInput>,
  ): Promise<ControllerResponse> {
    return present(await this.deps.upsertContact.execute({ ...input, tenantId }), 200);
  }

  async recordConsent(
    tenantId: string,
    input: Without<RecordConsentInput>,
  ): Promise<ControllerResponse> {
    return present(await this.deps.recordConsent.execute({ ...input, tenantId }), 200);
  }

  async sendTemplate(
    tenantId: string,
    input: Without<SendWhatsAppTemplateInput>,
  ): Promise<ControllerResponse> {
    return present(await this.deps.sendTemplate.execute({ ...input, tenantId }), 200);
  }

  async sendSessionMessage(
    tenantId: string,
    input: Without<SendWhatsAppSessionMessageInput>,
  ): Promise<ControllerResponse> {
    return present(await this.deps.sendSession.execute({ ...input, tenantId }), 200);
  }

  async sendEmail(tenantId: string, input: Without<SendEmailInput>): Promise<ControllerResponse> {
    return present(await this.deps.sendEmail.execute({ ...input, tenantId }), 200);
  }

  async getEmailSettings(tenantId: string): Promise<ControllerResponse> {
    return present(await this.deps.emailSettings.execute({ tenantId }), 200);
  }
}
