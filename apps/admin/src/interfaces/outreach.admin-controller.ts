import type { Principal } from "@platform/contracts";
import type {
  ContactDto,
  OutreachController,
  TemplateDto,
  TemplateDraft,
  TemplateSendValues,
} from "@platform/outreach";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

/** Embedded Signup values the browser needs. Non-secret by construction: an id, a config id and a version. */
export interface OutreachSignupInfo {
  readonly appId: string;
  readonly configId: string;
  readonly graphApiVersion: string;
}

export interface OutreachTestSendInput {
  readonly tenantId: string;
  readonly to: string;
  readonly templateName: string;
  readonly language: string;
  readonly values: {
    readonly body: string[];
    readonly header?: string;
    readonly urlSuffixes?: Record<string, string>;
  };
  /** The operator attests the owner of `to` agreed to receive this test (recorded as an admin consent event). */
  readonly attestConsent?: boolean;
  readonly idempotencyKey: string;
}

/** The fixed bilingual body of the email test send. */
export const OUTREACH_TEST_EMAIL = {
  subject: "Morbeh test email | رسالة تجريبية من Morbeh",
  text:
    "This is a test email from your Morbeh store. If you received it, email sending works.\n\n" +
    "هذه رسالة تجريبية من متجرك على Morbeh. إذا وصلتك فإرسال البريد يعمل.",
  html:
    '<div style="font-family:sans-serif"><p>This is a test email from your Morbeh store. If you received it, email sending works.</p>' +
    '<p dir="rtl">هذه رسالة تجريبية من متجرك على Morbeh. إذا وصلتك فإرسال البريد يعمل.</p></div>',
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * The admin boundary over Outreach: one `AdminGuard` check per method (`outreach:read` / `manage` / `send`), then the
 * context's own controller. Presentation (status + error envelope) stays the context's; this class adds only the
 * non-secret Embedded Signup values on the connection read and the test-send orchestration.
 */
export class OutreachAdminController {
  private readonly outreach: OutreachController;
  private readonly guard: AdminGuard;
  private readonly signup: OutreachSignupInfo | undefined;

  constructor(deps: {
    outreach: OutreachController;
    guard: AdminGuard;
    /** Present only when WhatsApp is ready (readiness decided in the runtime). */
    signup?: OutreachSignupInfo;
  }) {
    this.outreach = deps.outreach;
    this.guard = deps.guard;
    this.signup = deps.signup;
  }

  async getConnection(principal: Principal, input: { tenantId: string }): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "outreach:read");
    if (denied) return denied;
    const response = await this.outreach.getConnection(input.tenantId);
    if (response.status === 200 && isRecord(response.body) && response.body["available"] === true) {
      return this.signup === undefined
        ? response
        : { status: 200, body: { ...response.body, signup: { ...this.signup } } };
    }
    return response;
  }

  async connect(
    principal: Principal,
    input: { tenantId: string; code: string; wabaId: string; phoneNumberId: string },
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "outreach:manage");
    if (denied) return denied;
    const { tenantId, ...rest } = input;
    return this.outreach.connect(tenantId, rest);
  }

  async refresh(principal: Principal, input: { tenantId: string }): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "outreach:manage");
    if (denied) return denied;
    return this.outreach.refresh(input.tenantId);
  }

  async disconnect(
    principal: Principal,
    input: { tenantId: string; expectedVersion: number },
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "outreach:manage");
    if (denied) return denied;
    return this.outreach.disconnect(input.tenantId, { expectedVersion: input.expectedVersion });
  }

  async abandonOnboarding(
    principal: Principal,
    input: { tenantId: string; expectedVersion: number },
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "outreach:manage");
    if (denied) return denied;
    return this.outreach.abandonOnboarding(input.tenantId, {
      expectedVersion: input.expectedVersion,
    });
  }

  async listTemplates(principal: Principal, input: { tenantId: string }): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "outreach:read");
    if (denied) return denied;
    return this.outreach.listTemplates(input.tenantId);
  }

  async syncTemplates(principal: Principal, input: { tenantId: string }): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "outreach:manage");
    if (denied) return denied;
    return this.outreach.syncTemplates(input.tenantId);
  }

  async createTemplate(
    principal: Principal,
    input: { tenantId: string; draft: TemplateDraft },
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "outreach:manage");
    if (denied) return denied;
    return this.outreach.createTemplate(input.tenantId, { draft: input.draft });
  }

  async deleteTemplate(
    principal: Principal,
    input: { tenantId: string; name: string },
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "outreach:manage");
    if (denied) return denied;
    return this.outreach.deleteTemplate(input.tenantId, { name: input.name });
  }

  /**
   * A test template send. With `attestConsent` the number is upserted as a contact and an `admin` consent grant (for the
   * purpose the stored template's category implies) is recorded with the acting principal as evidence, then the template
   * is sent through the ordinary use case. Without it the use case's own consent check decides (and suppresses).
   */
  async testSendWhatsApp(
    principal: Principal,
    input: OutreachTestSendInput,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "outreach:send");
    if (denied) return denied;
    const { tenantId } = input;
    if (input.attestConsent === true) {
      const failed = await this.attestConsent(principal, input);
      if (failed !== null) return failed;
    }
    const values: TemplateSendValues = {
      body: input.values.body,
      ...(input.values.header === undefined ? {} : { header: input.values.header }),
      ...(input.values.urlSuffixes === undefined
        ? {}
        : {
            urlSuffixes: Object.fromEntries(
              Object.entries(input.values.urlSuffixes).map(([index, suffix]) => [
                Number(index),
                suffix,
              ]),
            ),
          }),
    };
    return this.outreach.sendTemplate(tenantId, {
      to: input.to,
      templateName: input.templateName,
      language: input.language,
      values,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async getEmailSettings(
    principal: Principal,
    input: { tenantId: string },
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "outreach:read");
    if (denied) return denied;
    return this.outreach.getEmailSettings(input.tenantId);
  }

  async testSendEmail(
    principal: Principal,
    input: { tenantId: string; to: string; idempotencyKey: string },
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "outreach:send");
    if (denied) return denied;
    return this.outreach.sendEmail(input.tenantId, {
      to: input.to,
      subject: OUTREACH_TEST_EMAIL.subject,
      html: OUTREACH_TEST_EMAIL.html,
      text: OUTREACH_TEST_EMAIL.text,
      purpose: "transactional",
      idempotencyKey: input.idempotencyKey,
    });
  }

  /** Returns a failure response, or `null` when the attestation was recorded (or there was nothing to record). */
  private async attestConsent(
    principal: Principal,
    input: OutreachTestSendInput,
  ): Promise<AdminResponse | null> {
    const { tenantId } = input;
    // The consent purpose follows the template's stored category. An unknown template records nothing: the send
    // below answers with the template error.
    const listed = await this.outreach.listTemplates(tenantId);
    if (listed.status !== 200 || !Array.isArray(listed.body)) return null;
    const template = (listed.body as TemplateDto[]).find(
      (candidate) => candidate.name === input.templateName && candidate.language === input.language,
    );
    if (template === undefined) return null;

    const contact = await this.outreach.upsertContact(tenantId, { phone: input.to });
    if (contact.status !== 200) return contact;
    const contactId = (contact.body as ContactDto).id;
    const recorded = await this.outreach.recordConsent(tenantId, {
      contactId,
      channel: "whatsapp",
      purpose: template.category === "MARKETING" ? "marketing" : "transactional",
      action: "grant",
      source: "admin",
      evidence: `test send attestation by ${principal.id}`,
    });
    return recorded.status === 200 ? null : recorded;
  }
}
