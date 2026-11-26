import { effectiveNotificationSettings } from "../domain/messaging/notification-settings";
import type {
  NotificationSettingsRepository,
  TemplateOverride,
} from "../domain/messaging/messaging-repositories";
import { emailDomain, isFreeMailDomain } from "../domain/messaging/sender-resolution";
import {
  isTemplateEnabled,
  TEMPLATE_CATALOGUE,
  type TemplateCopy,
  type TemplateKey,
  type TemplateLocale,
} from "../domain/messaging/template-catalogue";
import {
  renderTemplate,
  type OrderBlockData,
  type RenderedMail,
} from "../domain/messaging/template-renderer";
import type { StoreProfile, StoreProfilePort } from "./messaging-ports";

/** The merchant's override when there is one, else the code default. */
export function copyFor(
  key: TemplateKey,
  locale: TemplateLocale,
  override: Pick<TemplateOverride, "subject" | "body"> | null,
): TemplateCopy {
  return override ?? TEMPLATE_CATALOGUE[key].defaults[locale];
}

export interface StoreContext {
  readonly profile: StoreProfile;
  readonly disabledTemplates: readonly string[];
}

export interface StoreContextDeps {
  readonly settings: NotificationSettingsRepository;
  readonly store: StoreProfilePort;
}

/** What a mail needs to know about the store: its name and language, and which templates are switched off. */
export async function loadStoreContext(
  deps: StoreContextDeps,
  tenantId: string,
): Promise<StoreContext> {
  const [stored, profile] = await Promise.all([
    deps.settings.find(tenantId),
    deps.store.get(tenantId),
  ]);
  return { profile, disabledTemplates: effectiveNotificationSettings(stored).disabledTemplates };
}

export function isFreeMailAddress(email: string | null): boolean {
  return email !== null && isFreeMailDomain(emailDomain(email));
}

export { isTemplateEnabled };

/** Sample order for the preview and the test mail: fixed, no real customer data. */
export const SAMPLE_ORDER: OrderBlockData = {
  currency: "EGP",
  lines: [
    { name: "Linen shirt", variantTitle: "M / Blue", quantity: 2, unitAmountMinor: 45000 },
    { name: "Cotton scarf", variantTitle: null, quantity: 1, unitAmountMinor: 25000 },
  ],
  subtotalMinor: 115000,
  shippingMinor: 10000,
  taxMinor: 0,
  totalMinor: 125000,
};

export function renderSample(
  key: TemplateKey,
  locale: TemplateLocale,
  copy: TemplateCopy,
  storeName: string,
): RenderedMail {
  const definition = TEMPLATE_CATALOGUE[key];
  const variables: Record<string, string> = {};
  for (const variable of definition.variables) variables[variable.name] = variable.sample;
  variables["store_name"] = storeName === "" ? (variables["store_name"] ?? "") : storeName;
  return renderTemplate({
    subject: copy.subject,
    body: copy.body,
    locale,
    storeName: variables["store_name"] ?? storeName,
    variables,
    catalogueVariables: definition.variables,
    order: SAMPLE_ORDER,
  });
}
