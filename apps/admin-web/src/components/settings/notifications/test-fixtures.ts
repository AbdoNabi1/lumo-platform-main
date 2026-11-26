import type {
  NotificationSettingsSnapshot,
  SenderDomainDto,
  TemplateDetailDto,
  TemplateDto,
} from "@/lib/notification-settings-model";

/** Shapes the committed backend answers with, for the Wave 2b component and action tests. */

export const SETTINGS: NotificationSettingsSnapshot = {
  values: { senderEmail: "orders@shop.example", staffRecipients: [], disabledTemplates: [] },
  version: 3,
  deliveryConfigured: true,
  storeName: "Nusuj Store",
  contactEmail: "hello@shop.example",
  sender: { mode: "reply_to", effectiveEmail: "orders@shop.example", freeMail: false },
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

export const DOMAIN_NONE: SenderDomainDto = {
  available: true,
  domain: null,
  suggestion: { domain: "shop.example", freeMail: false },
};

export const DOMAIN_PENDING: SenderDomainDto = {
  available: true,
  domain: {
    domain: "shop.example",
    status: "pending",
    verified: false,
    verifiedAt: null,
    records: [
      {
        record: "DKIM",
        name: "resend._domainkey",
        type: "TXT",
        value: "p=MIGfMA0GCSq",
        ttl: "Auto",
        status: "not_started",
        priority: null,
      },
      {
        record: "Receiving",
        name: "send",
        type: "MX",
        value: "feedback-smtp.example.com",
        ttl: "Auto",
        status: "not_started",
        priority: 10,
      },
    ],
  },
  suggestion: { domain: "shop.example", freeMail: false },
};

export const DOMAIN_VERIFIED: SenderDomainDto = {
  ...DOMAIN_PENDING,
  domain: {
    ...DOMAIN_PENDING.domain!,
    status: "verified",
    verified: true,
    verifiedAt: "2026-11-26T10:00:00.000Z",
  },
};
