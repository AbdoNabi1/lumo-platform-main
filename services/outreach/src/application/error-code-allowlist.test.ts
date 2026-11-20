import { describe, expect, it } from "vitest";
import { MetaApiError } from "../infrastructure/meta-graph-client";
import {
  createOutreachKit,
  seedConnection,
  seedSendScenario,
  seedTemplate,
  T1,
} from "../testing/outreach-kit";
import { errorOf, okValue } from "../testing/result-helpers";
import { messagesPayload, seconds, statusItem } from "../testing/webhook-fixtures";
import { ConnectWhatsApp } from "./connect-whatsapp.use-case";
import { RefreshWhatsAppStatus } from "./connection.use-cases";
import { connectionDto, sendResultDto, templateDto } from "./dto";
import { SendEmail, SendWhatsAppTemplate } from "./send.use-cases";
import { SyncTemplates } from "./template.use-cases";
import { ProcessWhatsAppWebhook } from "./webhook.use-case";

/** A six-digit PIN and an uppercase secret-shaped token: both are "code-shaped" yet neither is a provider code. */
const PIN = "987654";
const TOKEN = "EAABSECRETTOKEN";

const sendTemplate = (kit: ReturnType<typeof createOutreachKit>, key = "k1") =>
  new SendWhatsAppTemplate(kit.deps).execute({
    tenantId: T1,
    to: "01012345678",
    templateName: "cod_confirmation_ar",
    language: "ar",
    values: { body: ["Sara"] },
    idempotencyKey: key,
  });

const everything = (kit: ReturnType<typeof createOutreachKit>): string =>
  JSON.stringify([
    kit.mem.store.outbound.values(),
    kit.mem.store.statusEvents.values(),
    kit.mem.store.connections.values(),
    kit.events.calls,
  ]);

describe("error codes are an allowlist, not a shape (I9)", () => {
  it("a provider rejection with a PIN or a secret-shaped code is stored and shown as a generic code", async () => {
    expect.hasAssertions();
    for (const canary of [PIN, TOKEN]) {
      const kit = createOutreachKit();
      await seedSendScenario(kit);
      kit.whatsapp.set("sendTemplate", () => ({
        kind: "rejected",
        code: canary,
        message: canary,
        retryable: false,
      }));
      const dto = okValue(await sendTemplate(kit));
      expect(dto).toMatchObject({ status: "failed", errorCode: "PROVIDER_ERROR" });
      expect(JSON.stringify(dto)).not.toContain(canary);
      expect(everything(kit)).not.toContain(canary);
    }
  });

  it("known adapter, HTTP and Meta numeric codes pass through unchanged", async () => {
    expect.hasAssertions();
    for (const code of ["131026", "190", "HTTP_429", "TIMEOUT", "INVALID_RESPONSE"]) {
      const kit = createOutreachKit();
      await seedSendScenario(kit);
      kit.whatsapp.set("sendTemplate", () => ({
        kind: "rejected",
        code,
        message: "x",
        retryable: false,
      }));
      expect(okValue(await sendTemplate(kit)).errorCode).toBe(code);
    }
  });

  it("known lowercase provider reasons survive; unknown lowercase tokens become generic", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.email.respond(() => ({
      kind: "rejected",
      code: "validation_error",
      message: "x",
      retryable: false,
    }));
    const known = okValue(
      await new SendEmail(kit.deps).execute({
        tenantId: T1,
        to: "a@b.test",
        subject: "s",
        html: "<p>x</p>",
        text: "x",
        purpose: "transactional",
        idempotencyKey: "known",
      }),
    );
    expect(known.errorCode).toBe("validation_error");
    kit.email.respond(() => ({
      kind: "rejected",
      code: "my_secret_token_value",
      message: "x",
      retryable: false,
    }));
    const unknown = okValue(
      await new SendEmail(kit.deps).execute({
        tenantId: T1,
        to: "a@b.test",
        subject: "s",
        html: "<p>x</p>",
        text: "x",
        purpose: "transactional",
        idempotencyKey: "unknown",
      }),
    );
    expect(unknown.errorCode).toBe("PROVIDER_ERROR");
  });

  it("a failed status callback with a code-shaped canary never reaches the row, the marker or an event", async () => {
    expect.hasAssertions();
    for (const canary of [PIN, TOKEN]) {
      const kit = createOutreachKit();
      await seedSendScenario(kit);
      okValue(await sendTemplate(kit));
      const row = kit.mem.store.outbound.values()[0];
      await new ProcessWhatsAppWebhook(kit.deps).execute({
        payload: messagesPayload("phone-1", {
          statuses: [
            {
              ...statusItem({
                id: row?.providerMessageId ?? "",
                status: "failed",
                timestamp: seconds(kit.clock.now()),
                recipient: "201012345678",
              }),
              errors: [{ code: canary, title: canary }],
            },
          ],
        }),
      });
      expect(kit.mem.store.outbound.values()[0]).toMatchObject({
        status: "failed",
        errorCode: "PROVIDER_ERROR",
      });
      expect(everything(kit)).not.toContain(canary);
    }
  });

  it("a numeric Meta code in the failed status raw is kept (131026) and a string non-code is not", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    okValue(await sendTemplate(kit));
    const row = kit.mem.store.outbound.values()[0];
    await new ProcessWhatsAppWebhook(kit.deps).execute({
      payload: messagesPayload("phone-1", {
        statuses: [
          statusItem({
            id: row?.providerMessageId ?? "",
            status: "failed",
            timestamp: seconds(kit.clock.now()),
            recipient: "201012345678",
            errorCode: 131026,
          }),
        ],
      }),
    });
    expect(kit.mem.store.statusEvents.values()[0]?.raw).toMatchObject({ errorCode: "131026" });
  });

  it("DTOs show a stored canary as a generic code and an unknown rejection reason as null", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const conn = await seedConnection(kit);
    const dto = connectionDto({ ...conn, lastError: TOKEN, onboardingFailure: PIN }, true);
    expect(dto).toMatchObject({ lastError: "PROVIDER_ERROR", onboardingFailure: "PROVIDER_ERROR" });
    expect(JSON.stringify(dto)).not.toContain(TOKEN);
    expect(JSON.stringify(dto)).not.toContain(PIN);
    const tpl = await seedTemplate(createOutreachKit(), { name: "other_tpl" });
    expect(templateDto({ ...tpl, rejectedReason: TOKEN }).rejectedReason).toBeNull();
    expect(templateDto({ ...tpl, rejectedReason: "INVALID_FORMAT" }).rejectedReason).toBe(
      "INVALID_FORMAT",
    );
    const sendKit = createOutreachKit();
    await seedSendScenario(sendKit);
    okValue(await sendTemplate(sendKit));
    const stored = sendKit.mem.store.outbound.values()[0];
    expect(
      sendResultDto({
        ...(stored as NonNullable<typeof stored>),
        status: "failed",
        errorCode: PIN,
      }).errorCode,
    ).toBe("PROVIDER_ERROR");
  });

  it("a Meta error envelope never carries a canary: META_ERROR for an unknown code, META_<code> for a real one", async () => {
    expect.hasAssertions();
    for (const canary of [PIN, TOKEN]) {
      const kit = createOutreachKit();
      await seedConnection(kit);
      kit.whatsapp.set("listTemplates", () => {
        throw new MetaApiError(canary, "provider text", 400);
      });
      const error = errorOf(await new SyncTemplates(kit.deps).execute({ tenantId: T1 }));
      expect(error.message).toBe("META_ERROR");
      expect(JSON.stringify(error)).not.toContain(canary);
    }
    const kit = createOutreachKit();
    await seedConnection(kit);
    kit.whatsapp.set("listTemplates", () => {
      throw new MetaApiError("190", "provider text", 401);
    });
    expect(errorOf(await new SyncTemplates(kit.deps).execute({ tenantId: T1 })).message).toBe(
      "META_190",
    );
  });

  it("a refresh failure and an onboarding failure store META_ERROR, not the canary", async () => {
    expect.hasAssertions();
    const refreshKit = createOutreachKit();
    await seedConnection(refreshKit);
    refreshKit.whatsapp.set("getPhone", () => {
      throw new MetaApiError(TOKEN, "provider text", 400);
    });
    errorOf(await new RefreshWhatsAppStatus(refreshKit.deps).execute({ tenantId: T1 }));
    expect(refreshKit.mem.store.connections.values()[0]?.lastError).toBe("META_ERROR");
    expect(everything(refreshKit)).not.toContain(TOKEN);

    const connectKit = createOutreachKit();
    connectKit.whatsapp.set("exchangeCode", () => {
      throw new MetaApiError(PIN, "provider text", 400);
    });
    const failed = errorOf(
      await new ConnectWhatsApp(connectKit.deps).execute({
        tenantId: T1,
        code: "c",
        wabaId: "waba-1",
        phoneNumberId: "phone-1",
      }),
    );
    expect(failed.message).toBe("META_ERROR");
    expect(everything(connectKit)).not.toContain(PIN);
  });
});
