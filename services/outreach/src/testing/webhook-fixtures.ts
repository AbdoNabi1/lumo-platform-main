/** Meta webhook payload builders for tests (shapes follow Meta's documented WhatsApp Cloud API webhooks). */

export const seconds = (d: Date): number => Math.floor(d.getTime() / 1000);

export interface StatusItem {
  id: string;
  status: string;
  timestamp: number | string;
  recipient: string;
  correlation?: string;
  errorCode?: number;
}

export function statusItem(s: StatusItem): Record<string, unknown> {
  return {
    id: s.id,
    status: s.status,
    timestamp: String(s.timestamp),
    recipient_id: s.recipient,
    ...(s.correlation === undefined ? {} : { biz_opaque_callback_data: s.correlation }),
    ...(s.errorCode === undefined
      ? {}
      : { errors: [{ code: s.errorCode, title: "provider text that must never be stored" }] }),
  };
}

export function textMessage(m: {
  id: string;
  from: string;
  timestamp: number | string;
  body: string;
  contextId?: string;
}): Record<string, unknown> {
  return {
    id: m.id,
    from: m.from,
    timestamp: String(m.timestamp),
    type: "text",
    text: { body: m.body },
    ...(m.contextId === undefined ? {} : { context: { id: m.contextId } }),
  };
}

export function messagesPayload(
  phoneNumberId: string,
  value: {
    statuses?: unknown[];
    messages?: unknown[];
    contacts?: unknown[];
  },
  wabaId = "waba-1",
): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "201012345678", phone_number_id: phoneNumberId },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

export function templateStatusPayload(t: {
  wabaId?: string;
  time: number;
  metaTemplateId: string;
  event: string;
  name?: string;
  language?: string;
  reason?: string;
  category?: string;
}): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: t.wabaId ?? "waba-1",
        time: t.time,
        changes: [
          {
            field: "message_template_status_update",
            value: {
              event: t.event,
              message_template_id: t.metaTemplateId,
              message_template_name: t.name ?? "cod_confirmation_ar",
              message_template_language: t.language ?? "ar",
              reason: t.reason ?? "NONE",
              message_template_category: t.category ?? "UTILITY",
            },
          },
        ],
      },
    ],
  };
}

export function templateCategoryPayload(t: {
  wabaId?: string;
  time: number;
  metaTemplateId: string;
  newCategory?: string;
  correctCategory?: string;
}): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: t.wabaId ?? "waba-1",
        time: t.time,
        changes: [
          {
            field: "template_category_update",
            value: {
              message_template_id: t.metaTemplateId,
              message_template_name: "cod_confirmation_ar",
              message_template_language: "ar",
              previous_category: "UTILITY",
              ...(t.newCategory === undefined ? {} : { new_category: t.newCategory }),
              ...(t.correctCategory === undefined ? {} : { correct_category: t.correctCategory }),
            },
          },
        ],
      },
    ],
  };
}
