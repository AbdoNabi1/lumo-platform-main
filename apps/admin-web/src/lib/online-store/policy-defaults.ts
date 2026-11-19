import type { PolicyTemplateInputsDto } from "@/lib/api/online-store";

/**
 * The template dialog's starting answers (Ruling 20): the store name from Online Store
 * preferences, the contact email from store settings only when that read succeeded (admins), and
 * spec 2.3's defaults for the rest: a 14-day return window (Egyptian law), the customer pays return
 * shipping, refunds to the original payment method, cash on delivery offered, delivery in 2 to 5
 * days, no shipping abroad. The merchant can change every answer before generating.
 */
export function policyTemplateDefaults(
  preferences: { readonly storeName: string } | null,
  storeSettings: { readonly contactEmail: string | null } | null,
): PolicyTemplateInputsDto {
  return {
    storeName: preferences?.storeName ?? "",
    contactEmail: storeSettings?.contactEmail ?? "",
    contactPhone: "",
    businessAddress: "",
    returnWindowDays: 14,
    returnShippingPaidBy: "customer",
    refundMethod: "original",
    cashOnDelivery: true,
    deliveryDays: { min: 2, max: 5 },
    shipsInternationally: false,
  };
}
