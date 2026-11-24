import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InMemoryOutreachCredentialVault,
  MetaGraphClient,
  ResendEmailClient,
} from "@platform/outreach";
import { logger } from "@platform/utils";
import { loadRuntimeConfig, type RuntimeConfig } from "./config";
import {
  assertProductionOutreachVaultConfigured,
  buildOutreachWiring,
  outreachReadiness,
  type OutreachReadinessConfig,
} from "./outreach-readiness";

const base = {
  DATABASE_URL: "postgresql://u:***@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  AUTH_ISSUER_URL: "https://issuer.example/",
  AUTH_JWKS_URL: "https://issuer.example/.well-known/jwks.json",
} satisfies NodeJS.ProcessEnv;

const whatsappEnv = {
  META_APP_ID: "1234567890",
  META_APP_SECRET: "s".repeat(16),
  META_WHATSAPP_CONFIG_ID: "cfg-1",
  META_WEBHOOK_VERIFY_TOKEN: "v".repeat(16),
  OUTREACH_CREDENTIALS_KEK_REF: "k".repeat(32),
} satisfies NodeJS.ProcessEnv;
const emailEnv = {
  RESEND_API_KEY: "re_fake_key_123",
  OUTREACH_EMAIL_FROM: "no-reply@send.example.com",
} satisfies NodeJS.ProcessEnv;

const config = (env: NodeJS.ProcessEnv = {}): RuntimeConfig =>
  loadRuntimeConfig({ ...base, ...env });
const without = (env: Record<string, string>, key: string): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter(([k]) => k !== key));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("outreachReadiness", () => {
  it("all absent: nothing is ready", () => {
    expect.hasAssertions();
    expect(outreachReadiness(config())).toEqual({ whatsapp: false, email: false });
  });

  it("complete: both channels are ready", () => {
    expect.hasAssertions();
    expect(outreachReadiness(config({ ...whatsappEnv, ...emailEnv }))).toEqual({
      whatsapp: true,
      email: true,
    });
  });

  it.each(Object.keys(whatsappEnv))(
    "WhatsApp is not ready without %s (and email is unaffected)",
    (key) => {
      expect.hasAssertions();
      expect(outreachReadiness(config({ ...without(whatsappEnv, key), ...emailEnv }))).toEqual({
        whatsapp: false,
        email: true,
      });
    },
  );

  it.each(Object.keys(emailEnv))(
    "email is not ready without %s (and WhatsApp is unaffected)",
    (key) => {
      expect.hasAssertions();
      expect(outreachReadiness(config({ ...whatsappEnv, ...without(emailEnv, key) }))).toEqual({
        whatsapp: true,
        email: false,
      });
    },
  );

  it("a blank member counts as missing (defence in depth over the parsed config)", () => {
    expect.hasAssertions();
    const parsed = config({ ...whatsappEnv, ...emailEnv });
    expect(outreachReadiness({ ...parsed, META_APP_ID: "  " }).whatsapp).toBe(false);
    expect(outreachReadiness({ ...parsed, OUTREACH_EMAIL_FROM: "" }).email).toBe(false);
  });

  it("a malformed Graph version is not ready (config parsing rejects it first)", () => {
    expect.hasAssertions();
    expect(() => config({ ...whatsappEnv, META_GRAPH_API_VERSION: "v24" })).toThrow(
      /META_GRAPH_API_VERSION/,
    );
    const parsed = config({ ...whatsappEnv });
    const bad: OutreachReadinessConfig = { ...parsed, META_GRAPH_API_VERSION: "v24" };
    expect(outreachReadiness(bad).whatsapp).toBe(false);
  });
});

describe("buildOutreachWiring", () => {
  it("not ready: no ports, no vault, no signup, no webhook secrets — only the numeric settings", () => {
    expect.hasAssertions();
    const wiring = buildOutreachWiring(config());
    expect(wiring.whatsapp).toBeUndefined();
    expect(wiring.vault).toBeUndefined();
    expect(wiring.email).toBeUndefined();
    expect(wiring.emailFrom).toBeUndefined();
    expect(wiring.signup).toBeUndefined();
    expect(wiring.webhook).toBeUndefined();
    expect(wiring.emailCaps).toEqual({ perHour: 200, perDay: 2000 });
    expect(wiring.unresolvedAfterMs).toBe(300_000);
  });

  it("half-configured WhatsApp builds nothing for WhatsApp, even with the secret set", () => {
    expect.hasAssertions();
    const wiring = buildOutreachWiring(config(without(whatsappEnv, "META_WEBHOOK_VERIFY_TOKEN")));
    expect(wiring.whatsapp).toBeUndefined();
    expect(wiring.vault).toBeUndefined();
    expect(wiring.webhook).toBeUndefined();
  });

  it("ready: a Meta client, a REAL vault, the signup values and the webhook secrets", () => {
    expect.hasAssertions();
    const wiring = buildOutreachWiring(config({ ...whatsappEnv, ...emailEnv }));
    expect(wiring.whatsapp).toBeInstanceOf(MetaGraphClient);
    expect(wiring.vault?.backing).toBe("real");
    expect(wiring.email).toBeInstanceOf(ResendEmailClient);
    expect(wiring.emailFrom).toBe("no-reply@send.example.com");
    expect(wiring.signup).toEqual({
      appId: "1234567890",
      configId: "cfg-1",
      graphApiVersion: "v24.0",
    });
    expect(wiring.webhook).toEqual({
      appSecret: whatsappEnv.META_APP_SECRET,
      verifyToken: whatsappEnv.META_WEBHOOK_VERIFY_TOKEN,
    });
  });

  it("the signup object carries only {appId, configId, graphApiVersion}", () => {
    expect.hasAssertions();
    const signup = buildOutreachWiring(config({ ...whatsappEnv })).signup;
    expect(Object.keys(signup ?? {}).sort()).toEqual(["appId", "configId", "graphApiVersion"]);
    expect(JSON.stringify(signup)).not.toContain(whatsappEnv.META_APP_SECRET);
    expect(JSON.stringify(signup)).not.toContain(whatsappEnv.META_WEBHOOK_VERIFY_TOKEN);
  });

  it("the caps and the sweep age come from the config", () => {
    expect.hasAssertions();
    const wiring = buildOutreachWiring(
      config({
        OUTREACH_EMAIL_CAP_PER_HOUR: "7",
        OUTREACH_EMAIL_CAP_PER_DAY: "70",
        OUTREACH_UNRESOLVED_AFTER_MS: "90000",
      }),
    );
    expect(wiring.emailCaps).toEqual({ perHour: 7, perDay: 70 });
    expect(wiring.unresolvedAfterMs).toBe(90_000);
  });

  it("the Meta and Resend clients use only the injected fetch (never the network)", async () => {
    expect.hasAssertions();
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ access_token: "tok" }), { status: 200 }),
    );
    const wiring = buildOutreachWiring(config({ ...whatsappEnv, ...emailEnv }), fetchImpl);
    await wiring.whatsapp?.exchangeCode("code-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("https://graph.facebook.com/v24.0/");
  });
});

describe("assertProductionOutreachVaultConfigured", () => {
  const real = { backing: "real" } as const;
  const stub = new InMemoryOutreachCredentialVault();

  it.each([
    ["absent", undefined, "local", false],
    ["absent", undefined, "production", false],
    ["real", real, "local", false],
    ["real", real, "production", false],
    ["stub", stub, "local", false],
    ["stub", stub, "production", true],
    ["stub", stub, "staging", true],
  ] as const)("%s vault in %s throws=%s", (_name, vault, appEnv, throws) => {
    expect.hasAssertions();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const cfg = { APP_ENV: appEnv } as Pick<RuntimeConfig, "APP_ENV">;
    if (throws) {
      expect(() => assertProductionOutreachVaultConfigured(cfg, vault)).toThrow(
        /outreach credential vault/,
      );
    } else {
      expect(() => assertProductionOutreachVaultConfigured(cfg, vault)).not.toThrow();
    }
    // A stub in `local` stays visible as a warning; nothing else warns.
    expect(warn).toHaveBeenCalledTimes(vault?.backing === "stub" && appEnv === "local" ? 1 : 0);
  });
});
