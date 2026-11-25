import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { describe, expect, it } from "vitest";
import { wireSecurity } from "../composition";

const T = "shop-a";
const CODE = "123456";
let now = new Date("2026-11-27T10:00:10.000Z");
const clock: Clock = { now: () => now };

function wire(mfaConfigured: boolean) {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  return wireSecurity({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    knownSubjects: ["p-sam", "p-mona"],
    mfaConfigured,
  });
}

async function seed(wired: ReturnType<typeof wire>, externalId: string) {
  await wired.security.registerPrincipal({
    tenantId: T,
    externalId,
    kind: "human",
    displayName: externalId,
    subjectRef: externalId,
    tenantRef: T,
  });
}

const body = <V>(r: { body: unknown }): V => r.body as V;

describe("SecurityController — own two-step and the sign-in code step", () => {
  it("start 201 → confirm 200 → status → regenerate → verify login → disable, through the controller", async () => {
    now = new Date("2026-11-27T10:00:10.000Z");
    const wired = wire(true);
    await seed(wired, "p-sam");
    const { security } = wired;

    const started = await security.startOwnTwoStep({
      tenantId: T,
      principalExternalId: "p-sam",
      email: "sam@x.com",
    });
    expect(started.status).toBe(201);
    const enrollmentId = body<{ enrollmentId: string }>(started).enrollmentId;
    expect(Object.keys(started.body as object).sort()).toEqual([
      "enrollmentId",
      "manualKey",
      "provisioningUri",
    ]);

    const confirmed = await security.confirmOwnTwoStep({
      tenantId: T,
      principalExternalId: "p-sam",
      enrollmentId,
      code: CODE,
      now,
    });
    expect(confirmed.status).toBe(200);
    const codes = body<{ backupCodes: string[] }>(confirmed).backupCodes;
    expect(codes).toHaveLength(10);

    const status = await security.getOwnTwoStep({ tenantId: T, principalExternalId: "p-sam" });
    expect(status.status).toBe(200);
    expect(body<{ enabled: boolean; backupCodesLeft: number }>(status)).toMatchObject({
      enabled: true,
      backupCodesLeft: 10,
    });

    now = new Date(now.getTime() + 60_000);
    const verified = await security.verifyMfaLogin({
      tenantId: T,
      principalExternalId: "p-sam",
      code: codes[0]!,
      now,
    });
    expect(verified.status).toBe(200);
    expect(verified.body).toEqual({ principalExternalId: "p-sam", method: "backup" });

    const regenerated = await security.regenerateOwnBackupCodes({
      tenantId: T,
      principalExternalId: "p-sam",
      code: CODE,
      now,
    });
    expect(regenerated.status).toBe(200);
    expect(body<{ backupCodes: string[] }>(regenerated).backupCodes).toHaveLength(10);

    const disabled = await security.disableOwnTwoStep({
      tenantId: T,
      principalExternalId: "p-sam",
      now,
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body).toEqual({ enabled: false });
  });

  it("a wrong sign-in code is ONE 401 envelope; an unknown member answers the same", async () => {
    now = new Date("2026-11-27T10:00:10.000Z");
    const wired = wire(true);
    await seed(wired, "p-sam");
    const start = body<{ enrollmentId: string }>(
      await wired.security.startOwnTwoStep({
        tenantId: T,
        principalExternalId: "p-sam",
        email: "sam@x.com",
      }),
    );
    await wired.security.confirmOwnTwoStep({
      tenantId: T,
      principalExternalId: "p-sam",
      enrollmentId: start.enrollmentId,
      code: CODE,
      now,
    });

    const wrong = await wired.security.verifyMfaLogin({
      tenantId: T,
      principalExternalId: "p-sam",
      code: "000000",
      now,
    });
    const unknown = await wired.security.verifyMfaLogin({
      tenantId: T,
      principalExternalId: "nobody",
      code: "000000",
      now,
    });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(body<{ code: string; message: string }>(wrong)).toMatchObject({
      code: "UNAUTHENTICATED",
      message: "Invalid code",
    });
  });

  it("start without a real provider configured answers 503 NOT_CONFIGURED", async () => {
    const wired = wire(false);
    await seed(wired, "p-sam");

    const response = await wired.security.startOwnTwoStep({
      tenantId: T,
      principalExternalId: "p-sam",
      email: "sam@x.com",
    });

    expect(response.status).toBe(503);
    expect(body<{ code: string }>(response).code).toBe("NOT_CONFIGURED");
  });

  it("refusals are 409 with the use-case message; a foreign enrolment id is 404", async () => {
    now = new Date("2026-11-27T10:00:10.000Z");
    const wired = wire(true);
    await seed(wired, "p-sam");
    await seed(wired, "p-mona");
    const monas = body<{ enrollmentId: string }>(
      await wired.security.startOwnTwoStep({
        tenantId: T,
        principalExternalId: "p-mona",
        email: "mona@x.com",
      }),
    );

    const foreign = await wired.security.confirmOwnTwoStep({
      tenantId: T,
      principalExternalId: "p-sam",
      enrollmentId: monas.enrollmentId,
      code: CODE,
      now,
    });
    const wrong = await wired.security.confirmOwnTwoStep({
      tenantId: T,
      principalExternalId: "p-mona",
      enrollmentId: monas.enrollmentId,
      code: "000000",
      now,
    });
    const off = await wired.security.disableOwnTwoStep({
      tenantId: T,
      principalExternalId: "p-sam",
      now,
    });

    expect(foreign.status).toBe(404);
    expect(wrong.status).toBe(409);
    expect(body<{ message: string }>(wrong).message).toBe("That code didn't work. Try again.");
    expect(off.status).toBe(409);
    expect(body<{ message: string }>(off).message).toBe("Two-step verification isn't on");
  });
});
