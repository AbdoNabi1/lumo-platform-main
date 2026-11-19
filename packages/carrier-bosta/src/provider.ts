import { EGYPT_COUNTRY_ID, type BostaCityDirectory } from "./cities";
import type { BostaClient, BostaDeliveryRef } from "./client";
import type { BostaConfig } from "./config";
import {
  buildDeliveryPayload,
  checkParcel,
  type BostaParcel,
  type BostaProblem,
} from "./delivery-request";
import { BostaApiError } from "./errors";
import { matchBostaCity, type BostaCity } from "./governorates";
import { mapBostaState, type BostaTarget } from "./states";

export interface BostaProviderOptions {
  readonly client: BostaClient;
  readonly cities: BostaCityDirectory;
  readonly config: BostaConfig;
  readonly webhookUrl: string | null;
  readonly webhookHeaders: Readonly<Record<string, string>>;
}

/** Satisfies @platform/shipping's CarrierProvider structurally (Ruling 20). */
export class BostaCarrierProvider {
  readonly key = "bosta" as const;
  private readonly client: BostaClient;
  private readonly directory: BostaCityDirectory;
  private readonly config: BostaConfig;
  private readonly webhookUrl: string | null;
  private readonly webhookHeaders: Readonly<Record<string, string>>;

  constructor(options: BostaProviderOptions) {
    this.client = options.client;
    this.directory = options.cities;
    this.config = options.config;
    this.webhookUrl = options.webhookUrl;
    this.webhookHeaders = options.webhookHeaders;
  }

  async prepare(parcel: BostaParcel): Promise<BostaProblem | null> {
    return (await this.resolve(parcel)).problem;
  }

  async createDelivery(
    request: BostaParcel & { readonly reference: string },
  ): Promise<BostaDeliveryRef> {
    const { problem, city } = await this.resolve(request);
    if (problem !== null || city === null) {
      throw new BostaApiError({
        carrierFailure: "rejected",
        status: 0,
        message: "Bosta delivery refused before sending",
        code: problem?.code ?? "CARRIER_REJECTED",
        ...(problem?.reason === undefined ? {} : { reason: problem.reason }),
      });
    }
    return this.client.createDelivery(
      buildDeliveryPayload({
        parcel: request,
        reference: request.reference,
        city,
        config: this.config,
        webhookUrl: this.webhookUrl,
        webhookHeaders: this.webhookHeaders,
      }),
    );
  }

  findDeliveriesByReference(reference: string): Promise<readonly BostaDeliveryRef[]> {
    return this.client.searchByBusinessReference(reference);
  }

  cancelDelivery(trackingNumber: string): Promise<"cancelled" | "not_found"> {
    return this.client.terminate(trackingNumber);
  }

  printAwbs(
    trackingNumbers: readonly string[],
    options: { format?: "A4" | "A6"; lang?: "ar" | "en" },
  ): Promise<Uint8Array> {
    return this.client.massAwb(
      trackingNumbers,
      options.format ?? this.config.awbFormat,
      options.lang ?? this.config.awbLanguage,
    );
  }

  async getDelivery(trackingNumber: string): Promise<{
    trackingNumber: string;
    stateCode: number;
    stateLabel: string;
    target: BostaTarget | null;
  }> {
    const delivery = await this.client.getDelivery(trackingNumber);
    const mapped = mapBostaState(delivery.stateCode, delivery.type);
    return {
      trackingNumber: delivery.trackingNumber,
      stateCode: delivery.stateCode,
      stateLabel: mapped.label,
      target: mapped.target,
    };
  }

  verifyCredentials(): Promise<void> {
    return this.client.verifyKey();
  }

  private async resolve(
    parcel: BostaParcel,
  ): Promise<{ problem: BostaProblem | null; city: BostaCity | null }> {
    const problem = checkParcel(parcel, this.config);
    if (problem !== null) return { problem, city: null };
    const cities = await this.directory.cities(EGYPT_COUNTRY_ID, () =>
      this.client.listCities(EGYPT_COUNTRY_ID),
    );
    const city = matchBostaCity(parcel.address.province ?? "", cities);
    if (city === null)
      return { problem: { code: "ADDRESS_NOT_SHIPPABLE", reason: "CITY_NOT_FOUND" }, city: null };
    return { problem: null, city };
  }
}
