import type { OnlineStoreController } from "@platform/online-store";
import type { StoreProfile, StoreProfilePort } from "@platform/notifications";
import type { TenancyController } from "@platform/tenancy";

/**
 * Wave 2b: the store's name, contact email and default language for a mail, read through the owning
 * contexts' own controllers (Tenancy's store settings; Online store's preferences). A read that fails
 * degrades to an empty name / no contact / no language: a mail is still sent, only less personal.
 */
export class StoreProfileAdapter implements StoreProfilePort {
  private readonly tenancy: Pick<TenancyController, "getStoreSettings">;
  private readonly onlineStore: Pick<OnlineStoreController, "getPreferences">;

  constructor(
    tenancy: Pick<TenancyController, "getStoreSettings">,
    onlineStore: Pick<OnlineStoreController, "getPreferences">,
  ) {
    this.tenancy = tenancy;
    this.onlineStore = onlineStore;
  }

  async get(tenantId: string): Promise<StoreProfile> {
    const [settings, preferences] = await Promise.all([
      this.tenancy.getStoreSettings(tenantId).catch(() => null),
      this.onlineStore.getPreferences({ tenantId }).catch(() => null),
    ]);
    const store = settings?.status === 200 ? (settings.body as Record<string, unknown>) : {};
    const prefs = preferences?.status === 200 ? (preferences.body as Record<string, unknown>) : {};
    const name = [store["storeName"], prefs["storeName"]].find(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    );
    const contact = store["contactEmail"];
    const locale = prefs["defaultLocale"];
    return {
      storeName: name ?? "",
      contactEmail: typeof contact === "string" && contact.trim() !== "" ? contact : null,
      defaultLocale: typeof locale === "string" ? locale : null,
    };
  }
}
