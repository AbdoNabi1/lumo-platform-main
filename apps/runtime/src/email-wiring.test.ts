import { describe, expect, it } from "vitest";
import {
  EmailSignupEmailAdapter,
  LoggingEmailSender,
  ResendEmailSender,
  ResendSenderDomainProvider,
  wireAdmin,
} from "@platform/admin";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { JsonEventSerializer } from "@platform/domain-events";
import { PLATFORM_ADMIN_ROLE } from "@platform/security";
import { resolveEmailWiring, senderDomainDelivery, staffInviteDelivery } from "./email-wiring";

describe("resolveEmailWiring (Plan 1C)", () => {
  it("without a key: a logging sender and NO signup adapter (the G-72 guard keeps refusing)", () => {
    const wiring = resolveEmailWiring({ RESEND_API_KEY: undefined, EMAIL_FROM: "x@y.test" });
    expect(wiring.emailSender).toBeInstanceOf(LoggingEmailSender);
    expect(wiring.signupEmail).toBeUndefined();
  });

  it("with a key: a Resend sender and a real signup adapter", () => {
    const wiring = resolveEmailWiring({
      RESEND_API_KEY: "re_fake_key_123",
      EMAIL_FROM: "Morbeh <onboarding@resend.dev>",
    });
    expect(wiring.emailSender).toBeInstanceOf(ResendEmailSender);
    expect(wiring.signupEmail).toBeInstanceOf(EmailSignupEmailAdapter);
  });
});

describe("staff invitation delivery capability (Wave 1d, R1)", () => {
  it("without RESEND_API_KEY: deliveryConfigured is false (the logging fallback is NOT a delivery)", () => {
    const wiring = resolveEmailWiring({ RESEND_API_KEY: undefined, EMAIL_FROM: "x@y.test" });
    expect(wiring.deliveryConfigured).toBe(false);
    expect(wiring.emailSender).toBeInstanceOf(LoggingEmailSender);
  });

  it("with RESEND_API_KEY: deliveryConfigured is true", () => {
    const wiring = resolveEmailWiring({
      RESEND_API_KEY: "re_fake_key_123",
      EMAIL_FROM: "Morbeh <onboarding@resend.dev>",
    });
    expect(wiring.deliveryConfigured).toBe(true);
  });

  it("staffInviteDelivery passes the sender ONLY with a real delivery AND ADMIN_PUBLIC_URL", () => {
    const real = resolveEmailWiring({ RESEND_API_KEY: "re_fake_key_123", EMAIL_FROM: "a@b.test" });
    const logging = resolveEmailWiring({ RESEND_API_KEY: undefined, EMAIL_FROM: "a@b.test" });
    const url = "https://admin.test";
    expect(staffInviteDelivery(real, { ADMIN_PUBLIC_URL: url })).toEqual({
      staffInviteEmailSender: real.emailSender,
    });
    expect(staffInviteDelivery(real, { ADMIN_PUBLIC_URL: undefined })).toEqual({});
    expect(staffInviteDelivery(logging, { ADMIN_PUBLIC_URL: url })).toEqual({});
    expect(staffInviteDelivery(logging, { ADMIN_PUBLIC_URL: undefined })).toEqual({});
  });

  describe("the admin composed the way the runtime composes it", () => {
    const clock: Clock = { now: () => new Date("2026-11-24T10:00:00.000Z") };
    let n = 0;
    const idGenerator: IdGenerator = {
      generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
    };
    const owner: Principal = { id: "owner-1", kind: "staff", roles: ["admin"], tenantId: "t-1" };

    /** The signed-in owner exists in Security (the live access check looks them up), like after sign-up. */
    async function seedOwner(admin: ReturnType<typeof wireAdmin>): Promise<void> {
      const { security, identityDirectory } = admin.securityWiring;
      identityDirectory.register("owner-1");
      await security.registerPrincipal({
        tenantId: "t-1",
        externalId: "owner-1",
        kind: "human",
        displayName: "owner@example.test",
        subjectRef: "owner-1",
      });
      await security.defineRole({
        tenantId: "t-1",
        key: PLATFORM_ADMIN_ROLE,
        name: PLATFORM_ADMIN_ROLE,
        permissions: ["*:*"],
      });
      await security.assignRole({
        tenantId: "t-1",
        principalExternalId: "owner-1",
        roleKey: PLATFORM_ADMIN_ROLE,
        grantedBy: "test",
      });
    }

    function compose(
      config: {
        RESEND_API_KEY: string | undefined;
        ADMIN_PUBLIC_URL: string | undefined;
      },
      fetchImpl?: typeof fetch,
    ) {
      const email = resolveEmailWiring(
        { RESEND_API_KEY: config.RESEND_API_KEY, EMAIL_FROM: "a@b.test" },
        fetchImpl,
      );
      return wireAdmin({
        serializer: new JsonEventSerializer(),
        idGenerator,
        clock,
        emailSender: email.emailSender,
        ...(config.ADMIN_PUBLIC_URL === undefined
          ? {}
          : { adminPublicUrl: config.ADMIN_PUBLIC_URL }),
        ...staffInviteDelivery(email, config),
      });
    }

    it("no key: inviting answers 503 NOT_CONFIGURED and writes nothing", async () => {
      const admin = compose({ RESEND_API_KEY: undefined, ADMIN_PUBLIC_URL: "https://admin.test" });
      await seedOwner(admin);
      const res = await admin.staff.invite(owner, "t-1", {
        email: "sam@example.test",
        role: "viewer",
      });
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        code: "NOT_CONFIGURED",
        message: "Email isn't set up, so invitations can't be sent",
      });
      const list = await admin.staff.list(owner, "t-1");
      expect((list.body as { items: { email: string }[] }).items.map((i) => i.email)).toEqual([]);
    });

    it("a key but no ADMIN_PUBLIC_URL: 503 as well", async () => {
      const admin = compose({ RESEND_API_KEY: "re_fake_key_123", ADMIN_PUBLIC_URL: undefined });
      await seedOwner(admin);
      const res = await admin.staff.invite(owner, "t-1", {
        email: "sam@example.test",
        role: "viewer",
      });
      expect(res.status).toBe(503);
    });

    it("a key and ADMIN_PUBLIC_URL: the invitation is saved and Resend gets the one email", async () => {
      const calls: { url: string; body: string }[] = [];
      const fetchImpl = (async (url: string, init: { body: string }) => {
        calls.push({ url, body: init.body });
        return { ok: true, status: 200 } as Response;
      }) as unknown as typeof fetch;
      const admin = compose(
        { RESEND_API_KEY: "re_fake_key_123", ADMIN_PUBLIC_URL: "https://admin.test" },
        fetchImpl,
      );
      await seedOwner(admin);
      const res = await admin.staff.invite(owner, "t-1", {
        email: "sam@example.test",
        role: "viewer",
      });
      expect(res.status).toBe(201);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://api.resend.com/emails");
      expect(calls[0]?.body).toContain("accept-invite?token=");
    });
  });
});

describe("senderDomainDelivery (Wave 2b, D43)", () => {
  it("without RESEND_DOMAINS_API_KEY: no provider, so authenticating a domain answers NOT_CONFIGURED", () => {
    expect(senderDomainDelivery({ RESEND_DOMAINS_API_KEY: undefined })).toEqual({});
  });

  it("with the full-access key: the Resend Domains provider, using that key only", async () => {
    const seen: string[] = [];
    const wiring = senderDomainDelivery({ RESEND_DOMAINS_API_KEY: "re_full_access_1" }, ((
      _url: string,
      init: RequestInit,
    ) => {
      seen.push((init.headers as Record<string, string>)["authorization"] ?? "");
      return Promise.resolve(
        new Response(JSON.stringify({ id: "d1", status: "pending", records: [] }), {
          status: 200,
        }),
      );
    }) as typeof fetch);
    expect(wiring.senderDomainProvider).toBeInstanceOf(ResendSenderDomainProvider);
    await wiring.senderDomainProvider?.get("d1");
    expect(seen).toEqual(["Bearer re_full_access_1"]);
  });
});
