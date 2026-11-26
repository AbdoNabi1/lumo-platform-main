import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, DomainError, ValidationError } from "@platform/utils";
import type {
  NotificationSettingsRepository,
  TemplateOverride,
  TemplateOverrideRepository,
} from "../domain/messaging/messaging-repositories";
import {
  effectiveNotificationSettings,
  validateTemplateCopy,
  validateTemplateRef,
} from "../domain/messaging/notification-settings";
import {
  isTemplateEnabled,
  TEMPLATE_CATALOGUE,
  TEMPLATE_KEYS,
  TEMPLATE_LOCALES,
  type TemplateKey,
  type TemplateLocale,
  type TemplateVariable,
} from "../domain/messaging/template-catalogue";
import {
  copyFor,
  loadSenderContext,
  renderSample,
  type SenderContextDeps,
} from "./messaging-support";
import type { EmailDeliveryPort } from "./messaging-ports";

export interface TemplateDeps extends SenderContextDeps {
  readonly overrides: TemplateOverrideRepository;
  readonly settings: NotificationSettingsRepository;
}

export interface TemplateVariableView {
  readonly name: string;
  readonly kind: TemplateVariable["kind"];
}

export interface TemplateLocaleView {
  readonly subject: string;
  readonly body: string;
  /** true when the merchant saved their own copy for this language. */
  readonly customized: boolean;
}

export interface TemplateView {
  readonly key: TemplateKey;
  readonly audience: "customer" | "staff";
  readonly enabled: boolean;
  readonly variables: readonly TemplateVariableView[];
  readonly locales: Readonly<Record<TemplateLocale, TemplateLocaleView>>;
}

export interface TemplateDetailView extends TemplateView {
  readonly locale: TemplateLocale;
  readonly defaults: { readonly subject: string; readonly body: string };
}

function viewOf(
  key: TemplateKey,
  disabled: readonly string[],
  overrides: readonly TemplateOverride[],
): TemplateView {
  const definition = TEMPLATE_CATALOGUE[key];
  const locales = {} as Record<TemplateLocale, TemplateLocaleView>;
  for (const locale of TEMPLATE_LOCALES) {
    const override = overrides.find((o) => o.key === key && o.locale === locale) ?? null;
    const copy = copyFor(key, locale, override);
    locales[locale] = { subject: copy.subject, body: copy.body, customized: override !== null };
  }
  return {
    key,
    audience: definition.audience,
    enabled: isTemplateEnabled(key, disabled),
    variables: definition.variables.map(({ name, kind }) => ({ name, kind })),
    locales,
  };
}

export interface ListTemplatesInput {
  readonly tenantId: string;
}

export class ListNotificationTemplates implements UseCase<
  ListTemplatesInput,
  { readonly templates: readonly TemplateView[] },
  DomainError
> {
  private readonly deps: TemplateDeps;

  constructor(deps: TemplateDeps) {
    this.deps = deps;
  }

  async execute(
    input: ListTemplatesInput,
  ): Promise<Result<{ readonly templates: readonly TemplateView[] }, DomainError>> {
    const [stored, overrides] = await Promise.all([
      this.deps.settings.find(input.tenantId),
      this.deps.overrides.list(input.tenantId),
    ]);
    const disabled = effectiveNotificationSettings(stored).disabledTemplates;
    return ok({ templates: TEMPLATE_KEYS.map((key) => viewOf(key, disabled, overrides)) });
  }
}

export interface TemplateRefInput {
  readonly tenantId: string;
  readonly key: string;
  readonly locale: string;
}

async function detail(
  deps: TemplateDeps,
  tenantId: string,
  key: TemplateKey,
  locale: TemplateLocale,
): Promise<TemplateDetailView> {
  const [stored, overrides] = await Promise.all([
    deps.settings.find(tenantId),
    deps.overrides.list(tenantId),
  ]);
  return {
    ...viewOf(key, effectiveNotificationSettings(stored).disabledTemplates, overrides),
    locale,
    defaults: { ...TEMPLATE_CATALOGUE[key].defaults[locale] },
  };
}

export class GetNotificationTemplate implements UseCase<
  TemplateRefInput,
  TemplateDetailView,
  DomainError
> {
  private readonly deps: TemplateDeps;

  constructor(deps: TemplateDeps) {
    this.deps = deps;
  }

  async execute(input: TemplateRefInput): Promise<Result<TemplateDetailView, DomainError>> {
    const ref = validateTemplateRef(input.key, input.locale);
    if (!ref.ok) return err(ref.error);
    return ok(await detail(this.deps, input.tenantId, ref.value.key, ref.value.locale));
  }
}

export interface PutTemplateInput extends TemplateRefInput {
  readonly subject: unknown;
  readonly body: unknown;
}

export class PutNotificationTemplate implements UseCase<
  PutTemplateInput,
  TemplateDetailView,
  DomainError
> {
  private readonly deps: TemplateDeps;

  constructor(deps: TemplateDeps) {
    this.deps = deps;
  }

  async execute(input: PutTemplateInput): Promise<Result<TemplateDetailView, DomainError>> {
    const ref = validateTemplateRef(input.key, input.locale);
    if (!ref.ok) return err(ref.error);
    const copy = validateTemplateCopy(input);
    if (!copy.ok) return err(copy.error);
    await this.deps.overrides.upsert(input.tenantId, {
      key: ref.value.key,
      locale: ref.value.locale,
      subject: copy.value.subject,
      body: copy.value.body,
    });
    return ok(await detail(this.deps, input.tenantId, ref.value.key, ref.value.locale));
  }
}

/** "Revert to default" is deleting the merchant's row; reverting what was never changed is fine. */
export class RevertNotificationTemplate implements UseCase<
  TemplateRefInput,
  TemplateDetailView,
  DomainError
> {
  private readonly deps: TemplateDeps;

  constructor(deps: TemplateDeps) {
    this.deps = deps;
  }

  async execute(input: TemplateRefInput): Promise<Result<TemplateDetailView, DomainError>> {
    const ref = validateTemplateRef(input.key, input.locale);
    if (!ref.ok) return err(ref.error);
    await this.deps.overrides.remove(input.tenantId, ref.value.key, ref.value.locale);
    return ok(await detail(this.deps, input.tenantId, ref.value.key, ref.value.locale));
  }
}

export interface PreviewTemplateInput {
  readonly tenantId: string;
  readonly key: string;
  readonly locale?: string;
  /** The unsaved draft the editor shows; absent = what is saved (or the default). */
  readonly subject?: unknown;
  readonly body?: unknown;
}

export interface PreviewOutput {
  readonly subject: string;
  readonly html: string;
  readonly unknownVariables: readonly string[];
}

async function previewCopy(
  deps: TemplateDeps,
  input: PreviewTemplateInput,
  key: TemplateKey,
  locale: TemplateLocale,
): Promise<Result<{ subject: string; body: string }, ValidationError>> {
  if (input.subject !== undefined || input.body !== undefined) {
    return validateTemplateCopy({ subject: input.subject, body: input.body });
  }
  const override = await deps.overrides.find(input.tenantId, key, locale);
  const copy = copyFor(key, locale, override);
  return ok({ subject: copy.subject, body: copy.body });
}

/** Renders a template with sample data. HTML only: the admin shows it in a sandboxed iframe. */
export class PreviewNotificationTemplate implements UseCase<
  PreviewTemplateInput,
  PreviewOutput,
  DomainError
> {
  private readonly deps: TemplateDeps;

  constructor(deps: TemplateDeps) {
    this.deps = deps;
  }

  async execute(input: PreviewTemplateInput): Promise<Result<PreviewOutput, DomainError>> {
    const ref = validateTemplateRef(input.key, input.locale);
    if (!ref.ok) return err(ref.error);
    const copy = await previewCopy(this.deps, input, ref.value.key, ref.value.locale);
    if (!copy.ok) return err(copy.error);
    const context = await loadSenderContext(this.deps, input.tenantId);
    const rendered = renderSample(
      ref.value.key,
      ref.value.locale,
      copy.value,
      context.profile.storeName,
    );
    return ok({
      subject: rendered.subject,
      html: rendered.html,
      unknownVariables: rendered.unknownVariables,
    });
  }
}

export interface SendTestEmailInput {
  readonly tenantId: string;
  readonly key: string;
  readonly locale?: string;
  readonly subject?: unknown;
  readonly body?: unknown;
  /**
   * The acting staff member's own address, resolved SERVER-SIDE from the signed-in principal by the
   * caller. It is never a request field: a test mail can only ever go to yourself.
   */
  readonly actorEmail: string | null;
}

export interface SendTestEmailDeps extends TemplateDeps {
  readonly delivery: EmailDeliveryPort;
}

/** "The server can't send mail": the presenter maps `NOT_CONFIGURED` to 503. */
export class EmailNotConfiguredError extends DomainError {
  readonly retryable = false;
  constructor() {
    super("Email isn't set up on this server, so no email can be sent", {
      code: "NOT_CONFIGURED",
    });
  }
}

/**
 * Sends the template, rendered with sample data, to the signed-in staff member's OWN address. The
 * test mail uses the real sender resolution, so it shows exactly what a customer would see.
 */
export class SendTestEmail implements UseCase<
  SendTestEmailInput,
  { readonly sent: true },
  DomainError
> {
  private readonly deps: SendTestEmailDeps;

  constructor(deps: SendTestEmailDeps) {
    this.deps = deps;
  }

  async execute(input: SendTestEmailInput): Promise<Result<{ readonly sent: true }, DomainError>> {
    const ref = validateTemplateRef(input.key, input.locale);
    if (!ref.ok) return err(ref.error);
    if (!this.deps.delivery.deliveryConfigured) return err(new EmailNotConfiguredError());
    if (input.actorEmail === null || input.actorEmail === "") {
      return err(
        new ValidationError("We can't find an email address for your account", [
          { field: "actor", message: "no email address" },
        ]),
      );
    }
    const copy = await previewCopy(this.deps, input, ref.value.key, ref.value.locale);
    if (!copy.ok) return err(copy.error);
    const context = await loadSenderContext(this.deps, input.tenantId);
    const rendered = renderSample(
      ref.value.key,
      ref.value.locale,
      copy.value,
      context.profile.storeName,
    );
    try {
      await this.deps.delivery.send({
        to: input.actorEmail,
        subject: rendered.subject === "" ? "Test email" : `[Test] ${rendered.subject}`,
        text: rendered.text,
        html: rendered.html,
        from: context.sender.from,
        ...(context.sender.replyTo === undefined ? {} : { replyTo: context.sender.replyTo }),
      });
    } catch {
      return err(new BusinessRuleError("The test email could not be sent. Try again in a moment."));
    }
    return ok({ sent: true });
  }
}
