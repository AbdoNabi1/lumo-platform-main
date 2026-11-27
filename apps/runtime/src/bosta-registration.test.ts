import { beforeEach, describe, expect, it } from "vitest";
import { BostaCityDirectory } from "@platform/carrier-bosta";
import { bostaRegistration, bostaWebhookUrl, BOSTA_WEBHOOK_PATH } from "./bosta-registration";

beforeEach(() => {
  expect.hasAssertions();
});

describe("bosta registration", () => {
  it("webhook URL is the public origin plus the route, trailing slash trimmed", () => {
    expect(BOSTA_WEBHOOK_PATH).toBe("/api/v1/public/shipping/webhook/bosta");
    expect(bostaWebhookUrl("https://api.x.com/")).toBe(
      "https://api.x.com/api/v1/public/shipping/webhook/bosta",
    );
    expect(bostaWebhookUrl("https://api.x.com")).toBe(
      "https://api.x.com/api/v1/public/shipping/webhook/bosta",
    );
  });

  it("declares bosta as a real, credentialed carrier with the webhook URL", () => {
    const registration = bostaRegistration({
      webhookUrl: "https://api.x.com/api/v1/public/shipping/webhook/bosta",
      cities: new BostaCityDirectory(),
    });
    expect(registration.key).toBe("bosta");
    expect(registration.displayName).toBe("Bosta");
    expect(registration.backing).toBe("real");
    expect(registration.credentialFields).toEqual(["apiKey"]);
    expect(registration.capabilities).toEqual({
      cod: true,
      awb: true,
      webhooks: true,
      cancel: true,
    });
    expect(registration.webhookUrl).toBe("https://api.x.com/api/v1/public/shipping/webhook/bosta");
  });

  it("create builds a provider with key bosta and the tenant's headers", () => {
    const registration = bostaRegistration({
      webhookUrl: "https://api.x.com/api/v1/public/shipping/webhook/bosta",
      cities: new BostaCityDirectory(),
    });
    const provider = registration.create({
      config: {},
      credentials: { apiKey: "k" },
      webhookHeaders: { "x-tenant-id": "t-1", Authorization: "s" },
    });
    expect(provider.key).toBe("bosta");
  });

  it("parseConfig fills A6/ar/false", () => {
    const registration = bostaRegistration({
      webhookUrl: "https://api.x.com/api/v1/public/shipping/webhook/bosta",
      cities: new BostaCityDirectory(),
    });
    expect(registration.parseConfig(undefined)).toEqual({
      ok: true,
      value: { awbFormat: "A6", awbLanguage: "ar", allowToOpenPackage: false },
    });
  });
});
