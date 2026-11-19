import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { canSend } from "../domain/consent";
import { toE164 } from "../domain/phone";
import type { TemplateCategoryValue } from "../domain/repositories";
import {
  buildTemplateSendComponents,
  shapeOfStoredTemplate,
  validateSessionInput,
  type TemplateSendValues,
} from "../domain/template-send";
import { consentStateOf, findOrCreateContact } from "./contact-support";
import { type SendResultDto, sendResultDto } from "./dto";
import type { OutreachDeps } from "./outreach-deps";
import { type FinalCheck, type ReserveGo, runSend } from "./send-core";
import { conflict, emailDisplayName, normalizeEmail, sessionWindowOpen } from "./support";
import {
  fetchedFromMeta,
  loadActiveConnection,
  emitTemplateTransition,
  normalizeLanguage,
  openToken,
} from "./template-support";

const EXPIRED: FinalCheck = { ok: false, code: "AUTHORIZATION_EXPIRED" };
const KEY_MAX = 200;

function invalid(field: string, message: string): Result<never, DomainError> {
  return err(new ValidationError("Invalid input", [{ field, message }]));
}

function keyIssue(key: unknown): Result<never, DomainError> | null {
  return typeof key !== "string" || key.trim() === "" || key.length > KEY_MAX
    ? invalid("idempotencyKey", "idempotency_key_invalid")
    : null;
}

function requireWhatsApp(deps: OutreachDeps): Result<never, DomainError> | null {
  return deps.whatsapp === undefined || deps.vault === undefined
    ? err(conflict("WHATSAPP_NOT_CONFIGURED"))
    : null;
}

async function replay(
  deps: OutreachDeps,
  tenantId: string,
  key: string,
): Promise<SendResultDto | null> {
  const stored = await deps.outbound.findByIdempotencyKey(tenantId, key);
  return stored === null ? null : sendResultDto(stored);
}

interface ConnectionAuth {
  version: number;
  phoneNumberId: string;
  wabaId: string;
}

/** Connection state at reservation: not connected → WHATSAPP_NOT_CONNECTED, any change since the snapshot → CONNECTION_CHANGED. */
async function reserveConnectionRefusal(
  deps: OutreachDeps,
  tenantId: string,
  auth: ConnectionAuth,
  tx: unknown,
): Promise<DomainError | null> {
  const conn = await deps.connections.get(tenantId, tx);
  if (conn === null || conn.status !== "connected") return conflict("WHATSAPP_NOT_CONNECTED");
  if (
    conn.version !== auth.version ||
    conn.phoneNumberId !== auth.phoneNumberId ||
    conn.wabaId !== auth.wabaId
  ) {
    return conflict("CONNECTION_CHANGED");
  }
  return null;
}

/** Immediately-before-dispatch connection check: status, version and the dispatched assets. */
async function connectionStillAuthorized(
  deps: OutreachDeps,
  tenantId: string,
  auth: ConnectionAuth,
): Promise<{ token: string } | "expired" | "credentials"> {
  const conn = await deps.connections.get(tenantId);
  if (
    conn === null ||
    conn.status !== "connected" ||
    conn.version !== auth.version ||
    conn.phoneNumberId !== auth.phoneNumberId ||
    conn.wabaId !== auth.wabaId
  ) {
    return "expired";
  }
  const token = await openToken(deps, tenantId, conn.sealedCredentials);
  return token === null ? "credentials" : { token };
}

export interface SendWhatsAppTemplateInput {
  tenantId: string;
  to: string;
  templateName: string;
  language: string;
  values: TemplateSendValues;
  idempotencyKey: string;
  contextRef?: string;
}

/**
 * Sends an APPROVED template. The consent purpose comes from the stored (freshly reconciled) template category, never
 * from the caller. Order: replay → connection → local template → input validation → per-send freshness (Meta fetch)
 * → reservation → final check → dispatch → settle.
 */
export class SendWhatsAppTemplate implements UseCase<
  SendWhatsAppTemplateInput,
  SendResultDto,
  DomainError
> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: SendWhatsAppTemplateInput): Promise<Result<SendResultDto, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    const to = toE164(input.to);
    if (to === null) return invalid("to", "phone_invalid");
    if (typeof input.templateName !== "string" || input.templateName.trim() === "") {
      return invalid("templateName", "template_name_required");
    }
    if (typeof input.language !== "string" || input.language.trim() === "") {
      return invalid("language", "language_required");
    }
    const keyProblem = keyIssue(input.idempotencyKey);
    if (keyProblem !== null) return keyProblem;
    const notConfigured = requireWhatsApp(deps);
    if (notConfigured !== null) return notConfigured;
    const whatsapp = deps.whatsapp;
    if (whatsapp === undefined) return err(conflict("WHATSAPP_NOT_CONFIGURED"));

    const replayed = await replay(deps, tenantId, input.idempotencyKey);
    if (replayed !== null) return ok(replayed);

    const active = await loadActiveConnection(deps, tenantId);
    if (!active.ok) return active;
    const { snapshot, token } = active.value;
    const language = normalizeLanguage(input.language);

    const stored = await deps.templates.findByNameLanguage(
      tenantId,
      snapshot.wabaId,
      input.templateName,
      language,
    );
    if (stored === null) return err(conflict("TEMPLATE_NOT_APPROVED"));
    if (stored.status === "UNKNOWN" || stored.metaTemplateId === null) {
      return err(conflict("TEMPLATE_STATUS_UNCERTAIN"));
    }
    if (stored.status !== "APPROVED") return err(conflict("TEMPLATE_NOT_APPROVED"));
    if (stored.category === "AUTHENTICATION") return err(conflict("TEMPLATE_UNSUPPORTED"));
    const shape = shapeOfStoredTemplate(stored.components);
    if (!shape.supported) return err(conflict("TEMPLATE_UNSUPPORTED"));
    const early = buildTemplateSendComponents(shape, input.values, (i) => `btn:${i}`);
    if (!early.ok) {
      return err(
        new ValidationError(
          "Invalid template values",
          early.issues.map((i) => ({ field: i.field, message: i.code })),
        ),
      );
    }

    // Per-send freshness, bound to the dispatched assets and the template revision (R3-B03).
    const auth = {
      ...snapshot,
      metaTemplateId: stored.metaTemplateId,
      revisionAtFetchStart: stored.revision,
    };
    const fetchStartedAt = deps.clock.now();
    // An uncertain freshness is answered by the stored row when a same-key sender already reserved.
    const uncertain = async (): Promise<Result<SendResultDto, DomainError>> => {
      const winner = await replay(deps, tenantId, input.idempotencyKey);
      return winner === null ? err(conflict("TEMPLATE_STATUS_UNCERTAIN")) : ok(winner);
    };
    let remote;
    try {
      remote = await whatsapp.getTemplate(auth.metaTemplateId, token);
    } catch {
      return uncertain();
    }
    if (
      remote.id !== auth.metaTemplateId ||
      remote.name !== stored.name ||
      normalizeLanguage(remote.language) !== stored.language
    ) {
      return uncertain();
    }
    const fetched = fetchedFromMeta(deps, remote);
    // Fenced read → apply → compare → emit in ONE unit of work: a material status/category change is committed WITH its
    // `template.status_changed` event (and rolled back with it), even when the send is then refused.
    const applied = await deps.unitOfWork.run(tenantId, async (tx) => {
      const before = await deps.templates.findByNameLanguage(
        tenantId,
        auth.wabaId,
        stored.name,
        stored.language,
        tx,
      );
      if (
        before === null ||
        before.id !== stored.id ||
        before.metaTemplateId !== auth.metaTemplateId ||
        before.revision !== auth.revisionAtFetchStart
      ) {
        return "raced" as const;
      }
      const result = await deps.templates.applyFetched(
        tenantId,
        auth.wabaId,
        fetched,
        { revisionAtFetchStart: auth.revisionAtFetchStart, fetchStartedAt },
        tx,
      );
      if (result !== "applied") return result;
      // The revision fence makes `before` exactly the row this write replaced (every write bumps the revision).
      const after = await deps.templates.findByNameLanguage(
        tenantId,
        auth.wabaId,
        stored.name,
        stored.language,
        tx,
      );
      if (after !== null) await emitTemplateTransition(deps, tx, tenantId, before, after);
      return result;
    });
    if (applied !== "applied" || fetched.status !== "APPROVED") return uncertain();

    let reservedCategory: TemplateCategoryValue | null = null;
    return runSend(deps, {
      tenantId,
      idempotencyKey: input.idempotencyKey,
      decide: async (tx): Promise<{ refuse: DomainError } | ReserveGo> => {
        const connRefusal = await reserveConnectionRefusal(deps, tenantId, auth, tx);
        if (connRefusal !== null) return { refuse: connRefusal };
        const tpl = await deps.templates.findByNameLanguage(
          tenantId,
          auth.wabaId,
          stored.name,
          stored.language,
          tx,
        );
        if (
          tpl === null ||
          tpl.metaTemplateId !== auth.metaTemplateId ||
          tpl.revision !== auth.revisionAtFetchStart + 1 ||
          tpl.status !== "APPROVED"
        ) {
          return { refuse: conflict("TEMPLATE_STATUS_UNCERTAIN") };
        }
        if (tpl.category === "AUTHENTICATION") return { refuse: conflict("TEMPLATE_UNSUPPORTED") };
        const built = buildTemplateSendComponents(
          shapeOfStoredTemplate(tpl.components),
          input.values,
          (i) => `btn:${i}`,
        );
        if (!built.ok) {
          return {
            refuse: new ValidationError(
              "Invalid template values",
              built.issues.map((i) => ({ field: i.field, message: i.code })),
            ),
          };
        }
        const purpose = tpl.category === "MARKETING" ? "marketing" : "utility";
        const contact = await findOrCreateContact(deps, tx, tenantId, { phoneE164: to });
        reservedCategory = tpl.category;
        return {
          contactId: contact.id,
          suppressed: !canSend(consentStateOf(contact), "whatsapp", purpose),
          base: {
            channel: "whatsapp",
            kind: "template",
            recipient: to,
            templateName: tpl.name,
            templateLanguage: tpl.language,
            templateRevision: tpl.revision,
            purpose,
            payload: { componentTypes: built.components.map((c) => (c as { type: string }).type) },
            contextRef: input.contextRef ?? null,
            dispatchPhoneNumberId: auth.phoneNumberId,
            dispatchWabaId: auth.wabaId,
          },
        };
      },
      finalCheck: async (record): Promise<FinalCheck> => {
        const conn = await connectionStillAuthorized(deps, tenantId, auth);
        if (conn === "expired") return EXPIRED;
        if (conn === "credentials") return { ok: false, code: "CREDENTIALS_UNAVAILABLE" };
        const tpl = await deps.templates.findByNameLanguage(
          tenantId,
          auth.wabaId,
          stored.name,
          stored.language,
        );
        if (
          tpl === null ||
          tpl.status !== "APPROVED" ||
          tpl.category !== reservedCategory ||
          tpl.revision !== record.templateRevision ||
          tpl.metaTemplateId !== auth.metaTemplateId
        ) {
          return EXPIRED;
        }
        const contact =
          record.contactId === null
            ? null
            : await deps.contacts.findById(tenantId, record.contactId);
        if (contact === null || !canSend(consentStateOf(contact), "whatsapp", record.purpose)) {
          return EXPIRED;
        }
        const built = buildTemplateSendComponents(
          shapeOfStoredTemplate(tpl.components),
          input.values,
          (i) => `btn:${i}`,
        );
        if (!built.ok) return EXPIRED;
        return {
          ok: true,
          send: () =>
            whatsapp.sendTemplate(auth.phoneNumberId, conn.token, {
              to,
              name: tpl.name,
              language: tpl.language,
              components: built.components,
              correlationId: record.correlationId,
            }),
        };
      },
    });
  }
}

export interface SendWhatsAppSessionMessageInput {
  tenantId: string;
  to: string;
  text?: string;
  buttons?: { id: string; title: string }[];
  contextMessageId?: string;
  idempotencyKey: string;
  contextRef?: string;
}

/** A free-form message inside the 24 h customer-service window. Buttons present → an interactive reply-button message. */
export class SendWhatsAppSessionMessage implements UseCase<
  SendWhatsAppSessionMessageInput,
  SendResultDto,
  DomainError
> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(
    input: SendWhatsAppSessionMessageInput,
  ): Promise<Result<SendResultDto, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    const to = toE164(input.to);
    if (to === null) return invalid("to", "phone_invalid");
    const keyProblem = keyIssue(input.idempotencyKey);
    if (keyProblem !== null) return keyProblem;
    const issues = validateSessionInput({
      text: input.text ?? "",
      ...(input.buttons === undefined ? {} : { buttons: input.buttons }),
    });
    if (issues.length > 0) {
      return err(
        new ValidationError(
          "Invalid message",
          issues.map((i) => ({ field: i.field, message: i.code })),
        ),
      );
    }
    const notConfigured = requireWhatsApp(deps);
    if (notConfigured !== null) return notConfigured;
    const whatsapp = deps.whatsapp;
    if (whatsapp === undefined) return err(conflict("WHATSAPP_NOT_CONFIGURED"));

    const replayed = await replay(deps, tenantId, input.idempotencyKey);
    if (replayed !== null) return ok(replayed);

    const active = await loadActiveConnection(deps, tenantId);
    if (!active.ok) return active;
    const auth = active.value.snapshot;
    const text = input.text ?? "";
    const buttons = input.buttons;
    const interactive = buttons !== undefined;

    return runSend(deps, {
      tenantId,
      idempotencyKey: input.idempotencyKey,
      decide: async (tx): Promise<{ refuse: DomainError } | ReserveGo> => {
        const connRefusal = await reserveConnectionRefusal(deps, tenantId, auth, tx);
        if (connRefusal !== null) return { refuse: connRefusal };
        const contact = await deps.contacts.findByPhone(tenantId, to, tx);
        if (contact === null || !sessionWindowOpen(contact.lastInboundAt, deps.clock.now())) {
          return { refuse: conflict("SESSION_WINDOW_CLOSED") };
        }
        return {
          contactId: contact.id,
          suppressed: !canSend(consentStateOf(contact), "whatsapp", "transactional"),
          base: {
            channel: "whatsapp",
            kind: interactive ? "session_interactive" : "session_text",
            recipient: to,
            templateName: null,
            templateLanguage: null,
            templateRevision: null,
            purpose: "transactional",
            payload: { textLength: text.length, buttonCount: buttons?.length ?? 0 },
            contextRef: input.contextRef ?? null,
            dispatchPhoneNumberId: auth.phoneNumberId,
            dispatchWabaId: auth.wabaId,
          },
        };
      },
      finalCheck: async (record): Promise<FinalCheck> => {
        const conn = await connectionStillAuthorized(deps, tenantId, auth);
        if (conn === "expired") return EXPIRED;
        if (conn === "credentials") return { ok: false, code: "CREDENTIALS_UNAVAILABLE" };
        const contact =
          record.contactId === null
            ? null
            : await deps.contacts.findById(tenantId, record.contactId);
        if (
          contact === null ||
          !canSend(consentStateOf(contact), "whatsapp", "transactional") ||
          !sessionWindowOpen(contact.lastInboundAt, deps.clock.now())
        ) {
          return EXPIRED;
        }
        const context =
          input.contextMessageId === undefined ? {} : { contextMessageId: input.contextMessageId };
        return {
          ok: true,
          send: () =>
            buttons !== undefined
              ? whatsapp.sendButtons(auth.phoneNumberId, conn.token, {
                  to,
                  body: text,
                  buttons,
                  ...context,
                  correlationId: record.correlationId,
                })
              : whatsapp.sendText(auth.phoneNumberId, conn.token, {
                  to,
                  text,
                  ...context,
                  correlationId: record.correlationId,
                }),
        };
      },
    });
  }
}

export interface SendEmailInput {
  tenantId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  purpose: "marketing" | "transactional";
  idempotencyKey: string;
  contextRef?: string;
  /** Reserved for Part 4 (marketing needs durable unsubscribe); ignored while marketing email is blocked. */
  unsubscribeUrl?: string;
}

/** Transactional / test email through Resend. Marketing is `EMAIL_MARKETING_NOT_AVAILABLE` until Part 4. */
export class SendEmail implements UseCase<SendEmailInput, SendResultDto, DomainError> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: SendEmailInput): Promise<Result<SendResultDto, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    const to = normalizeEmail(input.to);
    if (to === null) return invalid("to", "email_invalid");
    if (
      typeof input.subject !== "string" ||
      input.subject.trim() === "" ||
      input.subject.length > 998 ||
      /[\r\n]/.test(input.subject)
    ) {
      return invalid("subject", "subject_invalid");
    }
    if (typeof input.html !== "string" || input.html === "")
      return invalid("html", "html_required");
    if (typeof input.text !== "string" || input.text === "")
      return invalid("text", "text_required");
    const keyProblem = keyIssue(input.idempotencyKey);
    if (keyProblem !== null) return keyProblem;
    if (input.purpose === "marketing") return err(conflict("EMAIL_MARKETING_NOT_AVAILABLE"));
    const email = deps.email;
    const emailFrom = deps.emailFrom;
    if (email === undefined || emailFrom === undefined)
      return err(conflict("EMAIL_NOT_CONFIGURED"));

    const replayed = await replay(deps, tenantId, input.idempotencyKey);
    if (replayed !== null) return ok(replayed);

    const profile = await deps.storeProfile.get(tenantId);
    const from = `${emailDisplayName(profile.storeName)} <${emailFrom}>`;
    const replyTo = normalizeEmail(profile.contactEmail);

    return runSend(deps, {
      tenantId,
      idempotencyKey: input.idempotencyKey,
      emailCaps: deps.emailCaps,
      decide: async (tx): Promise<{ refuse: DomainError } | ReserveGo> => {
        const contact = await findOrCreateContact(deps, tx, tenantId, { email: to });
        return {
          contactId: contact.id,
          suppressed: !canSend(consentStateOf(contact), "email", input.purpose),
          base: {
            channel: "email",
            kind: "email",
            recipient: to,
            templateName: null,
            templateLanguage: null,
            templateRevision: null,
            purpose: "transactional",
            payload: { subjectLength: input.subject.length },
            contextRef: input.contextRef ?? null,
            dispatchPhoneNumberId: null,
            dispatchWabaId: null,
          },
        };
      },
      finalCheck: async (record): Promise<FinalCheck> => {
        const contact =
          record.contactId === null
            ? null
            : await deps.contacts.findById(tenantId, record.contactId);
        if (contact === null || !canSend(consentStateOf(contact), "email", input.purpose)) {
          return EXPIRED;
        }
        return {
          ok: true,
          send: () =>
            email.send({
              from,
              ...(replyTo === null ? {} : { replyTo }),
              to,
              subject: input.subject,
              html: input.html,
              text: input.text,
              idempotencyKey: record.providerIdempotencyKey ?? `outreach/email/${record.id}`,
            }),
        };
      },
    });
  }
}
