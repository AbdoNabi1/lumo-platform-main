import type {
  GetNotificationSettings,
  UpdateNotificationSettings,
} from "../application/notification-settings.use-cases";
import type {
  GetNotificationTemplate,
  ListNotificationTemplates,
  PreviewNotificationTemplate,
  PutNotificationTemplate,
  RevertNotificationTemplate,
  SendTestEmail,
} from "../application/notification-templates.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface NotificationSettingsControllerDeps {
  readonly getSettings: GetNotificationSettings;
  readonly updateSettings: UpdateNotificationSettings;
  readonly listTemplates: ListNotificationTemplates;
  readonly getTemplate: GetNotificationTemplate;
  readonly putTemplate: PutNotificationTemplate;
  readonly revertTemplate: RevertNotificationTemplate;
  readonly previewTemplate: PreviewNotificationTemplate;
  readonly sendTest: SendTestEmail;
}

/** Wave 2b (Settings > Notifications): sender, templates, preview and test-send. Framework-agnostic. */
export class NotificationSettingsController {
  private readonly deps: NotificationSettingsControllerDeps;

  constructor(deps: NotificationSettingsControllerDeps) {
    this.deps = deps;
  }

  async getSettings(
    input: Parameters<GetNotificationSettings["execute"]>[0],
  ): Promise<ControllerResponse> {
    return present(await this.deps.getSettings.execute(input), 200);
  }

  async updateSettings(
    input: Parameters<UpdateNotificationSettings["execute"]>[0],
  ): Promise<ControllerResponse> {
    return present(await this.deps.updateSettings.execute(input), 200);
  }

  async listTemplates(
    input: Parameters<ListNotificationTemplates["execute"]>[0],
  ): Promise<ControllerResponse> {
    return present(await this.deps.listTemplates.execute(input), 200);
  }

  async getTemplate(
    input: Parameters<GetNotificationTemplate["execute"]>[0],
  ): Promise<ControllerResponse> {
    return present(await this.deps.getTemplate.execute(input), 200);
  }

  async putTemplate(
    input: Parameters<PutNotificationTemplate["execute"]>[0],
  ): Promise<ControllerResponse> {
    return present(await this.deps.putTemplate.execute(input), 200);
  }

  async revertTemplate(
    input: Parameters<RevertNotificationTemplate["execute"]>[0],
  ): Promise<ControllerResponse> {
    return present(await this.deps.revertTemplate.execute(input), 200);
  }

  async previewTemplate(
    input: Parameters<PreviewNotificationTemplate["execute"]>[0],
  ): Promise<ControllerResponse> {
    return present(await this.deps.previewTemplate.execute(input), 200);
  }

  async sendTest(input: Parameters<SendTestEmail["execute"]>[0]): Promise<ControllerResponse> {
    return present(await this.deps.sendTest.execute(input), 200);
  }
}
