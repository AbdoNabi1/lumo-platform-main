import type {
  EmailConnectionDto,
  EmailConnectionSnapshot,
  NotificationSettingsSnapshot,
  TemplateDetailDto,
  TemplateDto,
} from "@/lib/notification-settings-model";

/** Shapes the committed backend answers with, for the Wave 2b component and action tests. */

export const SETTINGS: NotificationSettingsSnapshot = {
  values: { senderEmail: "orders@shop.example", staffRecipients: [], disabledTemplates: [] },
  version: 3,
  deliveryConfigured: true,
  emailConnection: "connected",
  storeName: "Nusuj Store",
  contactEmail: "hello@shop.example",
  sender: { mode: "store_connection", effectiveEmail: "orders@shop.example", freeMail: false },
};

/** A store that has not connected an email account: customer emails are off. */
export const SETTINGS_NOT_CONNECTED: NotificationSettingsSnapshot = {
  ...SETTINGS,
  deliveryConfigured: false,
  emailConnection: "none",
  sender: { mode: "not_connected", effectiveEmail: null, freeMail: false },
};

export const CONNECTION: EmailConnectionDto = {
  kind: "resend",
  fromEmail: "orders@shop.example",
  secretLast4: "1234",
  enabled: true,
  status: "connected",
  state: "connected",
  lastError: null,
  lastErrorAt: null,
  verifiedAt: "2026-11-26T10:00:00.000Z",
  version: 2,
};

export const EMAIL_NONE: EmailConnectionSnapshot = {
  credentialsConfigured: true,
  connection: null,
};
export const EMAIL_CONNECTED: EmailConnectionSnapshot = {
  credentialsConfigured: true,
  connection: CONNECTION,
};
export const EMAIL_FAILED: EmailConnectionSnapshot = {
  credentialsConfigured: true,
  connection: {
    ...CONNECTION,
    status: "failed",
    state: "failed",
    verifiedAt: null,
    lastError: "The domain shop.example is not verified in Resend",
    lastErrorAt: "2026-11-26T11:00:00.000Z",
  },
};
export const EMAIL_OFF: EmailConnectionSnapshot = {
  credentialsConfigured: true,
  connection: { ...CONNECTION, enabled: false, state: "disabled", version: 3 },
};
export const EMAIL_UNAVAILABLE: EmailConnectionSnapshot = {
  credentialsConfigured: false,
  connection: null,
};

export function template(overrides: Partial<TemplateDto> = {}): TemplateDto {
  return {
    key: "order_confirmation",
    audience: "customer",
    enabled: true,
    variables: [
      { name: "customer_name", kind: "text" },
      { name: "order_number", kind: "text" },
      { name: "line_items", kind: "block" },
    ],
    locales: {
      en: {
        subject: "Order {{order_number}} confirmed",
        body: "Hi {{customer_name}}",
        customized: false,
      },
      ar: {
        subject: "تم تأكيد الطلب {{order_number}}",
        body: "أهلاً {{customer_name}}",
        customized: false,
      },
    },
    ...overrides,
  };
}

export const TEMPLATES: readonly TemplateDto[] = [
  template(),
  template({ key: "order_canceled" }),
  template({ key: "order_refunded" }),
  template({ key: "shipping_confirmation" }),
  template({ key: "draft_order_invoice" }),
  template({ key: "staff_new_order", audience: "staff" }),
];

export function detail(base: TemplateDto, locale: "en" | "ar"): TemplateDetailDto {
  return {
    ...base,
    locale,
    defaults: { subject: base.locales[locale].subject, body: base.locales[locale].body },
  };
}
