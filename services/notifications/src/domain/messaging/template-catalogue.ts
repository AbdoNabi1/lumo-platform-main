/**
 * Wave 2b (D39): the merchant-editable notification templates. The DEFAULTS live here, in code:
 * "revert to default" is deleting the merchant's override row. A template is a subject and a body
 * per language (en, ar) with `{{variable}}` placeholders; two purpose-built block variables
 * (`{{line_items}}`, `{{order_totals}}`) are rendered by code, there is no Liquid.
 */

export const TEMPLATE_KEYS = [
  "order_confirmation",
  "order_canceled",
  "order_refunded",
  "shipping_confirmation",
  "draft_order_invoice",
  "staff_new_order",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const TEMPLATE_LOCALES = ["en", "ar"] as const;
export type TemplateLocale = (typeof TEMPLATE_LOCALES)[number];

export type TemplateAudience = "customer" | "staff";

export type VariableKind = "text" | "url" | "block";

export interface TemplateVariable {
  readonly name: string;
  readonly kind: VariableKind;
  /** What the preview shows for it. */
  readonly sample: string;
}

export interface TemplateCopy {
  readonly subject: string;
  readonly body: string;
}

export interface TemplateDefinition {
  readonly key: TemplateKey;
  readonly audience: TemplateAudience;
  readonly variables: readonly TemplateVariable[];
  readonly defaults: Readonly<Record<TemplateLocale, TemplateCopy>>;
}

const STORE_NAME: TemplateVariable = { name: "store_name", kind: "text", sample: "Nusuj Store" };
const CUSTOMER_NAME: TemplateVariable = { name: "customer_name", kind: "text", sample: "Sara" };
const ORDER_NUMBER: TemplateVariable = { name: "order_number", kind: "text", sample: "#1042" };
const ORDER_TOTAL: TemplateVariable = { name: "order_total", kind: "text", sample: "EGP 1,250.00" };
const LINE_ITEMS: TemplateVariable = { name: "line_items", kind: "block", sample: "" };
const ORDER_TOTALS: TemplateVariable = { name: "order_totals", kind: "block", sample: "" };

export const TEMPLATE_CATALOGUE: Readonly<Record<TemplateKey, TemplateDefinition>> = {
  order_confirmation: {
    key: "order_confirmation",
    audience: "customer",
    variables: [CUSTOMER_NAME, ORDER_NUMBER, STORE_NAME, ORDER_TOTAL, LINE_ITEMS, ORDER_TOTALS],
    defaults: {
      en: {
        subject: "Order {{order_number}} confirmed",
        body: "Hi {{customer_name}},\n\nThanks for your order from {{store_name}}. We have received order {{order_number}} and will let you know when it ships.\n\n{{line_items}}\n\n{{order_totals}}\n\nQuestions? Just reply to this email.",
      },
      ar: {
        subject: "تم تأكيد طلبك {{order_number}}",
        body: "أهلاً {{customer_name}}،\n\nشكراً لطلبك من {{store_name}}. استلمنا طلبك رقم {{order_number}} وسنخبرك عند شحنه.\n\n{{line_items}}\n\n{{order_totals}}\n\nلأي استفسار، ردّ على هذه الرسالة.",
      },
    },
  },
  order_canceled: {
    key: "order_canceled",
    audience: "customer",
    variables: [CUSTOMER_NAME, ORDER_NUMBER, STORE_NAME, ORDER_TOTAL],
    defaults: {
      en: {
        subject: "Order {{order_number}} was canceled",
        body: "Hi {{customer_name}},\n\nYour order {{order_number}} from {{store_name}} was canceled.\n\nIf you did not ask for this or you have questions, just reply to this email.",
      },
      ar: {
        subject: "تم إلغاء طلبك {{order_number}}",
        body: "أهلاً {{customer_name}}،\n\nتم إلغاء طلبك رقم {{order_number}} من {{store_name}}.\n\nإذا لم تطلب الإلغاء أو لديك أي استفسار، ردّ على هذه الرسالة.",
      },
    },
  },
  order_refunded: {
    key: "order_refunded",
    audience: "customer",
    variables: [
      CUSTOMER_NAME,
      ORDER_NUMBER,
      STORE_NAME,
      { name: "refund_amount", kind: "text", sample: "EGP 350.00" },
    ],
    defaults: {
      en: {
        subject: "Refund for order {{order_number}}",
        body: "Hi {{customer_name}},\n\nWe refunded {{refund_amount}} for your order {{order_number}} from {{store_name}}. It can take a few days to show on your statement.",
      },
      ar: {
        subject: "استرداد مبلغ للطلب {{order_number}}",
        body: "أهلاً {{customer_name}}،\n\nقمنا باسترداد مبلغ {{refund_amount}} لطلبك رقم {{order_number}} من {{store_name}}. قد يستغرق ظهوره في كشف حسابك بضعة أيام.",
      },
    },
  },
  shipping_confirmation: {
    key: "shipping_confirmation",
    audience: "customer",
    variables: [
      CUSTOMER_NAME,
      ORDER_NUMBER,
      STORE_NAME,
      { name: "tracking_number", kind: "text", sample: "EG123456789" },
      { name: "tracking_url", kind: "url", sample: "https://example.com/track/EG123456789" },
      { name: "carrier", kind: "text", sample: "Bosta" },
    ],
    defaults: {
      en: {
        subject: "Your order {{order_number}} is on its way",
        body: "Hi {{customer_name}},\n\nGood news: your order {{order_number}} from {{store_name}} has shipped.\n\nTracking number: {{tracking_number}}\n{{tracking_url}}",
      },
      ar: {
        subject: "طلبك {{order_number}} في الطريق إليك",
        body: "أهلاً {{customer_name}}،\n\nأخبار سارة: تم شحن طلبك رقم {{order_number}} من {{store_name}}.\n\nرقم التتبع: {{tracking_number}}\n{{tracking_url}}",
      },
    },
  },
  draft_order_invoice: {
    key: "draft_order_invoice",
    audience: "customer",
    variables: [
      CUSTOMER_NAME,
      STORE_NAME,
      ORDER_TOTAL,
      { name: "invoice_url", kind: "url", sample: "https://example.com/c/sample-link" },
      LINE_ITEMS,
      ORDER_TOTALS,
    ],
    defaults: {
      en: {
        subject: "Your invoice from {{store_name}}",
        body: "Hi {{customer_name}},\n\n{{store_name}} sent you an invoice for {{order_total}}.\n\n{{line_items}}\n\n{{order_totals}}\n\nPay securely here:\n{{invoice_url}}",
      },
      ar: {
        subject: "فاتورتك من {{store_name}}",
        body: "أهلاً {{customer_name}}،\n\nأرسل لك {{store_name}} فاتورة بمبلغ {{order_total}}.\n\n{{line_items}}\n\n{{order_totals}}\n\nادفع بأمان من هنا:\n{{invoice_url}}",
      },
    },
  },
  staff_new_order: {
    key: "staff_new_order",
    audience: "staff",
    variables: [CUSTOMER_NAME, ORDER_NUMBER, STORE_NAME, ORDER_TOTAL, LINE_ITEMS, ORDER_TOTALS],
    defaults: {
      en: {
        subject: "New order {{order_number}} on {{store_name}}",
        body: "{{customer_name}} placed order {{order_number}} for {{order_total}}.\n\n{{line_items}}\n\n{{order_totals}}",
      },
      ar: {
        subject: "طلب جديد {{order_number}} في {{store_name}}",
        body: "قدّم {{customer_name}} الطلب رقم {{order_number}} بمبلغ {{order_total}}.\n\n{{line_items}}\n\n{{order_totals}}",
      },
    },
  },
};

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === "string" && (TEMPLATE_KEYS as readonly string[]).includes(value);
}

export function isTemplateLocale(value: unknown): value is TemplateLocale {
  return typeof value === "string" && (TEMPLATE_LOCALES as readonly string[]).includes(value);
}

/** The locale a mail is written in: the customer's language, else the store's default, else English. */
export function chooseLocale(
  customerLanguage: string | null | undefined,
  storeDefault: string | null | undefined,
): TemplateLocale {
  for (const candidate of [customerLanguage, storeDefault]) {
    const code = candidate?.trim().toLowerCase().split(/[-_]/)[0];
    if (isTemplateLocale(code)) return code;
  }
  return "en";
}

/** Whether the template is on for the shop (all default on, D39). */
export function isTemplateEnabled(key: TemplateKey, disabledTemplates: readonly string[]): boolean {
  return !disabledTemplates.includes(key);
}
