import { BostaApiError, type BostaRejectionCode } from "./errors";
import type { BostaCity } from "./governorates";
import { BOSTA_BASE_URL, DEFAULT_TIMEOUT_MS, type HttpFetch } from "./http";

export const MASS_AWB_MAX = 50;

export interface BostaClientOptions {
  readonly apiKey: string;
  readonly fetch: HttpFetch;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
}
export interface BostaDeliveryRef {
  readonly deliveryId: string;
  readonly trackingNumber: string;
}

type Json = Record<string, unknown>;

interface Reply {
  readonly status: number;
  readonly json?: unknown;
  readonly bytes?: Uint8Array;
  readonly notFound?: boolean;
}
interface RequestOptions {
  readonly body?: unknown;
  /** Noun used in the fixed English refusal sentence; never response text. */
  readonly label: string;
  readonly mode?: "json" | "bytes" | "discard";
  /** A 2xx `success:false` envelope is handed to the caller's parser instead of rejected. */
  readonly passSuccessFalse?: boolean;
  /** Rejections on this request are cancel refusals (Ruling 1). */
  readonly cancel?: boolean;
  /** A 404 carrying this errorCode is returned as `notFound` instead of throwing. */
  readonly notFoundCode?: number;
}

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

function unavailable(message: string, status = 0, timedOut = false): BostaApiError {
  return new BostaApiError({ carrierFailure: "unavailable", status, message, timedOut });
}
function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return value !== "" && Number.isFinite(parsed) ? parsed : null;
}
/** `undefined` means the body was not JSON at all (never a documented refusal). */
function errorCodeOf(text: string): number | null | undefined {
  try {
    const body: unknown = JSON.parse(text);
    return isObject(body) ? numberOrNull(body.errorCode) : null;
  } catch {
    return undefined;
  }
}
function trackingOf(value: unknown): string | null {
  if (nonEmptyString(value)) return value;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

const REJECTIONS: Readonly<
  Record<number, { readonly code: BostaRejectionCode; readonly reason?: string }>
> = {
  3001: { code: "ADDRESS_NOT_SHIPPABLE", reason: "CITY_NOT_FOUND" },
  3002: { code: "ADDRESS_NOT_SHIPPABLE", reason: "ZONE_NOT_FOUND" },
  3003: { code: "ADDRESS_NOT_SHIPPABLE", reason: "DISTRICT_NOT_FOUND" },
  3004: { code: "ADDRESS_NOT_SHIPPABLE", reason: "STREET_NOT_FOUND" },
  3009: { code: "ADDRESS_NOT_SHIPPABLE", reason: "ADDRESS_INCOMPLETE" },
  3007: { code: "COD_ABOVE_CARRIER_LIMIT" },
  2150: { code: "OPEN_PACKAGE_NEEDS_IMAGES" },
  2151: { code: "OPEN_PACKAGE_NEEDS_IMAGES" },
  2152: { code: "OPEN_PACKAGE_NEEDS_IMAGES" },
  1073: { code: "CARRIER_REJECTED", reason: "NO_BUSINESS_LOCATION" },
};

function rejection(
  status: number,
  errorCode: number | null,
  options: RequestOptions,
): BostaApiError {
  const suffix = `(HTTP ${status}${errorCode === null ? "" : `, errorCode ${errorCode}`})`;
  const message = `Bosta refused the ${options.label} ${suffix}`;
  if (options.cancel) {
    return new BostaApiError({
      carrierFailure: "rejected",
      status,
      message,
      code: "CARRIER_CANCEL_REFUSED",
    });
  }
  const mapped = (errorCode === null ? undefined : REJECTIONS[errorCode]) ?? {
    code: "CARRIER_REJECTED" as const,
  };
  return new BostaApiError({
    carrierFailure: "rejected",
    status,
    message,
    code: mapped.code,
    ...("reason" in mapped ? { reason: mapped.reason } : {}),
  });
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
function decodeBase64(value: string): Uint8Array | null {
  const clean = value.replace(/\s/g, "");
  if (clean.length === 0 || clean.length % 4 !== 0 || !BASE64.test(clean)) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - padding);
  let written = 0;
  for (let i = 0; i < clean.length; i += 4) {
    let chunk = 0;
    for (let j = 0; j < 4; j += 1) {
      const char = clean.charAt(i + j);
      chunk = (chunk << 6) | (char === "=" ? 0 : alphabet.indexOf(char));
    }
    for (const shift of [16, 8, 0]) {
      if (written < out.length) out[written++] = (chunk >> shift) & 0xff;
    }
  }
  return out;
}
const startsWithPdf = (bytes: Uint8Array): boolean =>
  new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";

/** U1: where the mass-AWB PDF lives is not documented; accept the plausible shapes only. */
export function parseAwbResponse(bytes: Uint8Array): Uint8Array {
  const notPdf = (): BostaApiError => unavailable("Bosta AWB response was not a PDF");
  if (startsWithPdf(bytes)) return bytes;
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw notPdf();
  }
  const data = isObject(body) ? body.data : undefined;
  const encoded = typeof data === "string" ? data : isObject(data) ? data.data : undefined;
  if (typeof encoded !== "string") throw notPdf();
  const decoded = decodeBase64(encoded.replace(/^data:application\/pdf;base64,/, ""));
  if (decoded === null || !startsWithPdf(decoded)) throw notPdf();
  return decoded;
}

/** U2: a recognised shape or an `unavailable` throw; an unknown shape is never "no match". */
export function parseSearchResponse(body: unknown, reference: string): readonly BostaDeliveryRef[] {
  const unknownShape = (): BostaApiError =>
    unavailable("Bosta search response not recognised", 200);
  if (!isObject(body) || body.success === false) throw unknownShape();
  const data = body.data;
  let list: readonly unknown[];
  if (Array.isArray(data)) list = data;
  else if (isObject(data) && Array.isArray(data.deliveries)) list = data.deliveries;
  else if (isObject(data) && typeof data._id === "string") list = [data];
  else throw unknownShape();
  const matches: BostaDeliveryRef[] = [];
  for (const item of list) {
    if (!isObject(item) || typeof item.businessReference !== "string") throw unknownShape();
    if (item.businessReference !== reference) continue;
    const trackingNumber = trackingOf(item.trackingNumber);
    if (!nonEmptyString(item._id) || trackingNumber === null) throw unknownShape();
    matches.push({ deliveryId: item._id, trackingNumber });
  }
  return matches;
}

export class BostaClient {
  private readonly apiKey: string;
  private readonly doFetch: HttpFetch;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(options: BostaClientOptions) {
    this.apiKey = options.apiKey;
    this.doFetch = options.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.baseUrl = (options.baseUrl ?? BOSTA_BASE_URL).replace(/\/+$/, "");
  }

  async createDelivery(payload: Record<string, unknown>): Promise<BostaDeliveryRef> {
    const reply = await this.request("POST", "/deliveries?apiVersion=1", {
      body: payload,
      label: "delivery",
    });
    const data = isObject(reply.json) ? reply.json.data : undefined;
    const trackingNumber = isObject(data) ? trackingOf(data.trackingNumber) : null;
    if (!isObject(data) || !nonEmptyString(data._id) || trackingNumber === null)
      throw unavailable("Bosta create response not recognised", reply.status);
    return { deliveryId: data._id, trackingNumber };
  }

  async searchByBusinessReference(reference: string): Promise<readonly BostaDeliveryRef[]> {
    const reply = await this.request("POST", "/deliveries/search", {
      body: { businessReference: reference },
      label: "search",
      passSuccessFalse: true,
    });
    return parseSearchResponse(reply.json, reference);
  }

  async terminate(trackingNumber: string): Promise<"cancelled" | "not_found"> {
    const reply = await this.request(
      "DELETE",
      `/deliveries/business/${encodeURIComponent(trackingNumber)}/terminate`,
      { label: "cancellation", cancel: true, notFoundCode: 1066 },
    );
    return reply.notFound ? "not_found" : "cancelled";
  }

  async getDelivery(trackingNumber: string): Promise<{
    trackingNumber: string;
    stateCode: number;
    stateLabel: string;
    type?: string;
  }> {
    const reply = await this.request(
      "GET",
      `/deliveries/business/${encodeURIComponent(trackingNumber)}`,
      { label: "lookup" },
    );
    const data = isObject(reply.json) ? reply.json.data : undefined;
    const state = isObject(data) ? data.state : undefined;
    const tracking = isObject(data) ? trackingOf(data.trackingNumber) : null;
    if (
      !isObject(data) ||
      !isObject(state) ||
      typeof state.code !== "number" ||
      typeof state.value !== "string" ||
      tracking === null
    )
      throw unavailable("Bosta delivery response not recognised", reply.status);
    const rawType = isObject(data.type) ? data.type.value : data.type;
    const type = typeof rawType === "string" ? rawType.toUpperCase() : undefined;
    return {
      trackingNumber: tracking,
      stateCode: state.code,
      stateLabel: state.value,
      ...(type === undefined ? {} : { type }),
    };
  }

  async massAwb(
    trackingNumbers: readonly string[],
    format: "A6" | "A4",
    lang: "ar" | "en",
  ): Promise<Uint8Array> {
    if (trackingNumbers.length === 0 || trackingNumbers.length > MASS_AWB_MAX)
      throw new Error(`Mass AWB takes 1 to ${MASS_AWB_MAX} tracking numbers`);
    const reply = await this.request("POST", "/deliveries/mass-awb", {
      body: { trackingNumbers: trackingNumbers.join(","), requestedAwbType: format, lang },
      label: "waybill request",
      mode: "bytes",
    });
    return parseAwbResponse(reply.bytes ?? new Uint8Array());
  }

  async listCities(countryId: string): Promise<readonly BostaCity[]> {
    const reply = await this.request("GET", `/cities?countryId=${encodeURIComponent(countryId)}`, {
      label: "city list request",
    });
    const data = isObject(reply.json) ? reply.json.data : undefined;
    const list = isObject(data) ? data.list : undefined;
    if (!Array.isArray(list)) throw unavailable("Bosta city list not recognised", reply.status);
    const cities: BostaCity[] = [];
    for (const row of list as unknown[]) {
      if (!isObject(row) || !nonEmptyString(row._id) || typeof row.name !== "string") continue;
      cities.push({
        _id: row._id,
        name: row.name,
        ...(typeof row.nameAr === "string" ? { nameAr: row.nameAr } : {}),
        ...(typeof row.alias === "string" ? { alias: row.alias } : {}),
        ...(typeof row.code === "string" ? { code: row.code } : {}),
        ...(typeof row.dropOffAvailability === "boolean"
          ? { dropOffAvailability: row.dropOffAvailability }
          : {}),
      });
    }
    return cities;
  }

  /** Ruling 8: status-only. Exactly 200 is valid; 401/403 reject the key; all else is unavailable. The body is never read. */
  async verifyKey(): Promise<void> {
    await this.request("GET", "/pickup-locations", { label: "key check", mode: "discard" });
  }

  private async request(method: string, path: string, options: RequestOptions): Promise<Reply> {
    const mode = options.mode ?? "json";
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    let status: number;
    let text = "";
    let bytes = new Uint8Array();
    try {
      const response = await this.doFetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: this.apiKey, "Content-Type": "application/json" },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      });
      status = response.status;
      const success = status >= 200 && status < 300;
      if (mode !== "discard") {
        if (mode === "bytes") {
          bytes = new Uint8Array(await response.arrayBuffer());
          if (!(success && startsWithPdf(bytes))) text = new TextDecoder().decode(bytes);
        } else text = await response.text();
      }
    } catch {
      throw controller.signal.aborted
        ? unavailable("Bosta request timed out", 0, true)
        : unavailable("Bosta request failed");
    } finally {
      clearTimeout(timer);
    }
    return this.classify(status, text, bytes, options, mode);
  }

  private credentialsRejected(status: number): BostaApiError {
    return new BostaApiError({
      carrierFailure: "credentials_rejected",
      status,
      message: `Bosta rejected the API key (HTTP ${status})`,
    });
  }

  private classify(
    status: number,
    text: string,
    bytes: Uint8Array,
    options: RequestOptions,
    mode: "json" | "bytes" | "discard",
  ): Reply {
    if (mode === "discard") {
      if (status === 200) return { status };
      if (status === 401 || status === 403) throw this.credentialsRejected(status);
      throw unavailable(`Bosta is unavailable (HTTP ${status})`, status);
    }
    if (status >= 200 && status < 300) {
      if (mode === "bytes" && startsWithPdf(bytes)) return { status, bytes };
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        if (mode === "bytes") return { status, bytes };
        throw unavailable("Bosta response was not JSON", status);
      }
      if (isObject(json) && json.success === false && options.passSuccessFalse !== true)
        throw rejection(status, numberOrNull(json.errorCode), options);
      return mode === "bytes" ? { status, bytes } : { status, json };
    }
    if (status === 401 || status === 403) {
      throw this.credentialsRejected(status);
    }
    const errorCode = errorCodeOf(text);
    if (errorCode === undefined) throw unavailable(`Bosta is unavailable (HTTP ${status})`, status);
    if (status === 404 && options.notFoundCode !== undefined && errorCode === options.notFoundCode)
      return { status, notFound: true };
    if (status >= 400 && status < 500 && status !== 408 && status !== 429)
      throw rejection(status, errorCode, options);
    throw unavailable(`Bosta is unavailable (HTTP ${status})`, status);
  }
}
