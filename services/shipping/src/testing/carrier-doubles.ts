import type { Clock, IdGenerator } from "@platform/contracts";
import { EnvelopeCipher, KeyAliasRegistry } from "@platform/secrets";
import { LocalKeyWrapCipher } from "@platform/secrets/testing";
import type {
  AwbOptions,
  CarrierDelivery,
  CarrierDeliveryRequest,
  CarrierDeliveryStatus,
  CarrierParcelRequest,
  CarrierProblem,
  CarrierProvider,
  CarrierRejectionCode,
} from "../application/carrier-provider";
import type { CarrierBuildContext, CarrierRegistration } from "../application/carrier-registry";
import {
  EnvelopeCarrierCredentialVault,
  SHIPPING_CREDENTIALS_KEY_ALIAS,
} from "../infrastructure/envelope-carrier-credential-vault";

/**
 * TEST DOUBLES ONLY for shipping's carrier suites. The cipher is `@platform/secrets/testing`'s
 * shared `LocalKeyWrapCipher` (preflight F10), never a copy.
 */

/** A real envelope vault over a local AES cipher: genuine encryption, test KEK, its own alias. */
export function testCarrierVault(
  kek = "test-shipping-kek-not-a-real-secret",
): EnvelopeCarrierCredentialVault {
  const aliases = new KeyAliasRegistry();
  aliases.set(SHIPPING_CREDENTIALS_KEY_ALIAS, kek);
  return new EnvelopeCarrierCredentialVault(
    new EnvelopeCipher(new LocalKeyWrapCipher(), aliases),
    SHIPPING_CREDENTIALS_KEY_ALIAS,
  );
}

export interface FakeFailure {
  readonly fail: "rejected" | "unavailable" | "credentials_rejected";
  readonly code?: CarrierRejectionCode;
  readonly reason?: string;
  readonly timedOut?: boolean;
}

export interface FakeCarrierScript {
  readonly prepare?: (CarrierProblem | null | FakeFailure)[];
  readonly create?: (CarrierDelivery | FakeFailure)[];
  readonly find?: (readonly CarrierDelivery[] | FakeFailure)[];
  readonly cancel?: ("cancelled" | "not_found" | FakeFailure)[];
  readonly print?: (Uint8Array | FakeFailure)[];
  readonly get?: (CarrierDeliveryStatus | FakeFailure)[];
  readonly verify?: "ok" | "credentials_rejected" | "unavailable";
}

export interface FakeCarrierRecord {
  readonly prepareCalls: {
    readonly request: CarrierParcelRequest;
    readonly openCountAtCall: number;
  }[];
  readonly createCalls: {
    readonly request: CarrierDeliveryRequest;
    readonly openCountAtCall: number;
  }[];
  readonly findCalls: string[];
  readonly findOpenCounts: number[];
  readonly cancelCalls: string[];
  readonly cancelOpenCounts: number[];
  readonly printCalls: [readonly string[], AwbOptions][];
  readonly printOpenCounts: number[];
  readonly getCalls: string[];
  readonly getOpenCounts: number[];
  verifyCalls: number;
  readonly verifyOpenCounts: number[];
}

function answer<T>(value: T | FakeFailure): Promise<T> {
  if (typeof value === "object" && value !== null && "fail" in value) {
    const failure = value;
    const error = Object.assign(new Error("fake carrier failure"), {
      carrierFailure: failure.fail,
      ...(failure.code !== undefined ? { code: failure.code } : {}),
      ...(failure.reason !== undefined ? { reason: failure.reason } : {}),
      ...(failure.timedOut !== undefined ? { timedOut: failure.timedOut } : {}),
    });
    return Promise.reject(error);
  }
  return Promise.resolve(value);
}

/** Queues and records are shared by every provider created by one registration. */
export class FakeCarrierProvider implements CarrierProvider {
  constructor(
    readonly key: string,
    private readonly script: FakeCarrierScript,
    private readonly record: FakeCarrierRecord,
    private readonly openCount: () => number,
  ) {}

  prepare(request: CarrierParcelRequest): Promise<CarrierProblem | null> {
    this.record.prepareCalls.push({ request, openCountAtCall: this.openCount() });
    return answer(this.script.prepare?.shift() ?? null);
  }

  createDelivery(request: CarrierDeliveryRequest): Promise<CarrierDelivery> {
    this.record.createCalls.push({ request, openCountAtCall: this.openCount() });
    return answer(
      this.script.create?.shift() ?? {
        deliveryId: `dlv-${request.reference}`,
        trackingNumber: `TN-${request.reference}`,
      },
    );
  }

  findDeliveriesByReference(reference: string): Promise<readonly CarrierDelivery[]> {
    this.record.findCalls.push(reference);
    this.record.findOpenCounts.push(this.openCount());
    return answer(this.script.find?.shift() ?? []);
  }

  cancelDelivery(trackingNumber: string): Promise<"cancelled" | "not_found"> {
    this.record.cancelOpenCounts.push(this.openCount());
    this.record.cancelCalls.push(trackingNumber);
    return answer(this.script.cancel?.shift() ?? "cancelled");
  }

  printAwbs(trackingNumbers: readonly string[], options: AwbOptions): Promise<Uint8Array> {
    this.record.printOpenCounts.push(this.openCount());
    this.record.printCalls.push([trackingNumbers, options]);
    return answer(this.script.print?.shift() ?? new TextEncoder().encode("%PDF-1.4 fake"));
  }

  getDelivery(trackingNumber: string): Promise<CarrierDeliveryStatus> {
    this.record.getOpenCounts.push(this.openCount());
    this.record.getCalls.push(trackingNumber);
    return answer(
      this.script.get?.shift() ?? {
        trackingNumber,
        stateCode: 10,
        stateLabel: "Pickup requested",
        target: null,
      },
    );
  }

  verifyCredentials(): Promise<void> {
    this.record.verifyCalls += 1;
    this.record.verifyOpenCounts.push(this.openCount());
    return this.script.verify === undefined || this.script.verify === "ok"
      ? Promise.resolve()
      : answer<void>({ fail: this.script.verify });
  }
}

export interface FakeRegistration {
  readonly registration: CarrierRegistration;
  readonly created: CarrierBuildContext[];
  readonly providers: FakeCarrierProvider[];
  readonly record: FakeCarrierRecord;
}

export function fakeRegistration(
  options: Partial<Omit<CarrierRegistration, "create">> & {
    readonly script?: FakeCarrierScript;
    readonly openCount?: () => number;
  } = {},
): FakeRegistration {
  const { script = {}, openCount = () => 0, ...declared } = options;
  const created: CarrierBuildContext[] = [];
  const providers: FakeCarrierProvider[] = [];
  const record: FakeCarrierRecord = {
    prepareCalls: [],
    createCalls: [],
    findCalls: [],
    findOpenCounts: [],
    cancelCalls: [],
    cancelOpenCounts: [],
    printCalls: [],
    printOpenCounts: [],
    getCalls: [],
    getOpenCounts: [],
    verifyCalls: 0,
    verifyOpenCounts: [],
  };
  const key = declared.key ?? "bosta";
  const registration: CarrierRegistration = {
    key,
    displayName: "Fake carrier",
    backing: "real",
    credentialFields: ["apiKey"],
    parseConfig: (raw) =>
      raw === undefined || (typeof raw === "object" && raw !== null && !Array.isArray(raw))
        ? { ok: true, value: (raw ?? {}) as Readonly<Record<string, unknown>> }
        : { ok: false, reason: "config must be an object" },
    capabilities: { cod: true, awb: true, webhooks: true, cancel: true },
    webhookUrl: "https://admin.example.test/api/v1/public/shipping/webhook/bosta",
    ...declared,
    create: (context) => {
      created.push(context);
      const provider = new FakeCarrierProvider(key, script, record, openCount);
      providers.push(provider);
      return provider;
    },
  };
  return { registration, created, providers, record };
}

/** A clock fixed at `iso` that tests can move forward. */
export function fixedClock(iso = "2026-11-12T10:00:00.000Z"): Clock & {
  advanceMs(ms: number): void;
  set(next: string | Date): void;
} {
  let now = new Date(iso);
  return {
    now: () => new Date(now.getTime()),
    advanceMs: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    set: (next: string | Date) => {
      now = new Date(next);
    },
  };
}

/** Deterministic, valid UUIDs (`…-000000000001`, `…-000000000002`, …). */
export function sequentialIds(): IdGenerator {
  let n = 0;
  return {
    generate: () => {
      n += 1;
      return `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
    },
  };
}
