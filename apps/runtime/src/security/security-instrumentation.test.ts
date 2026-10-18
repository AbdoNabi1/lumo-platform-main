import type { Meter, Span, Tracer } from "@opentelemetry/api";
import type { Logger } from "@platform/utils";
import { describe, expect, it, vi } from "vitest";
import { SecurityInstrumentation } from "./security-instrumentation";
import { OtelSecurityTelemetry } from "./security-telemetry-otel";

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

function fakeMeter(): { meter: Meter; records: { instrument: string; value: number }[] } {
  const records: { instrument: string; value: number }[] = [];
  const make = (instrument: string) => ({
    add: (value: number) => records.push({ instrument, value }),
    record: (value: number) => records.push({ instrument, value }),
  });
  // Deliberately partial mock (only the 3 instrument factories this suite uses) — needs the
  // `unknown` hop since it has no structural overlap with the full OTel `Meter` interface.
  const meter = {
    createCounter: (n: string) => make(n),
    createHistogram: (n: string) => make(n),
    createUpDownCounter: (n: string) => make(n),
  } as unknown as Meter;
  return { meter, records };
}

function fakeTracer(): {
  tracer: Tracer;
  attributes: Record<string, unknown>;
  exceptions: unknown[];
} {
  const attributes: Record<string, unknown> = {};
  const exceptions: unknown[] = [];
  // Deliberately partial mock (only the span methods this suite uses) — needs the `unknown` hop
  // since it has no structural overlap with the full OTel `Span` interface.
  const span = {
    setAttribute: (k: string, v: unknown) => {
      attributes[k] = v;
    },
    setStatus: () => undefined,
    recordException: (e: unknown) => exceptions.push(e),
    end: () => undefined,
    spanContext: () => ({ traceId: "t".repeat(32), spanId: "s".repeat(16), traceFlags: 1 }),
  } as unknown as Span;
  const tracer = {
    startActiveSpan: (_name: string, fn: (s: Span) => unknown) => fn(span),
  } as Tracer;
  return { tracer, attributes, exceptions };
}

function build(now: () => number): {
  instr: SecurityInstrumentation;
  records: { instrument: string; value: number }[];
  attributes: Record<string, unknown>;
  exceptions: unknown[];
} {
  const { meter, records } = fakeMeter();
  const { tracer, attributes, exceptions } = fakeTracer();
  const instr = new SecurityInstrumentation({
    telemetry: new OtelSecurityTelemetry(meter),
    logger: silent,
    tracer,
    now,
  });
  return { instr, records, attributes, exceptions };
}

describe("SecurityInstrumentation", () => {
  it("wraps authentication in a span and records the latency metric", async () => {
    let clock = 100;
    const { instr, records, attributes } = build(() => clock);
    const result = await instr.authentication({ principalId: "p-1" }, async () => {
      clock = 112;
      return "authed";
    });
    expect(result).toBe("authed");
    expect(attributes["security.operation"]).toBe("authentication");
    expect(records.find((r) => r.instrument === "authentication_latency")?.value).toBe(12);
  });

  it("records KMS latency with provider + operation attributes", async () => {
    let clock = 0;
    const { instr, records, attributes } = build(() => clock);
    await instr.kms({ principalId: "svc" }, "vault", "encrypt", async () => {
      clock = 30;
      return "ct";
    });
    expect(records.find((r) => r.instrument === "kms_latency")?.value).toBe(30);
    expect(attributes["provider"]).toBe("vault");
    expect(attributes["kms.operation"]).toBe("encrypt");
  });

  it("records the exception on the span and still re-throws", async () => {
    const { instr, exceptions } = build(() => 0);
    await expect(
      instr.authorization({ principalId: "p-1" }, async () => {
        throw new Error("denied hard");
      }),
    ).rejects.toThrow("denied hard");
    expect(exceptions).toHaveLength(1);
  });
});

describe("SecurityInstrumentation operation wrappers", () => {
  function spied(now: () => number) {
    const telemetry = {
      recordAuthenticationLatency: vi.fn(),
      recordAuthorizationLatency: vi.fn(),
      recordKmsLatency: vi.fn(),
      recordThreatProviderLatency: vi.fn(),
      recordAuditAppendLatency: vi.fn(),
      recordOperationLatency: vi.fn(),
    };
    const debug = vi.fn();
    const { tracer, attributes } = fakeTracer();
    const instr = new SecurityInstrumentation({
      telemetry: telemetry as unknown as OtelSecurityTelemetry,
      logger: { ...silent, debug },
      tracer,
      now,
    });
    return { instr, telemetry, debug, attributes };
  }

  const ctx = { principalId: "p-1", tenantId: "tenant-a" };
  const ok = async () => "done";

  it("records a failed authentication as a failure outcome", async () => {
    const { instr, telemetry } = spied(() => 0);
    await expect(
      instr.authentication(ctx, async () => {
        throw new Error("bad password");
      }),
    ).rejects.toThrow("bad password");
    expect(telemetry.recordAuthenticationLatency).toHaveBeenCalledWith(0, "failure");
  });

  it("labels authorization latency with the effect attribute, or unknown", async () => {
    const { instr, telemetry, attributes } = spied(() => 0);
    await instr.authorization(ctx, ok, { effect: "allow" });
    await instr.authorization(ctx, ok);
    expect(telemetry.recordAuthorizationLatency.mock.calls).toEqual([
      [0, "allow"],
      [0, "unknown"],
    ]);
    expect(attributes["effect"]).toBe("allow");
  });

  it("routes each operation to its own latency recorder", async () => {
    const { instr, telemetry, attributes } = spied(() => 0);
    await instr.policyEvaluation(ctx, ok);
    await instr.hsm(ctx, "cloudhsm", "sign", ok);
    expect(attributes["hsm.operation"]).toBe("sign");
    await instr.threatIntel(ctx, "abuseipdb", ok);
    await instr.session(ctx, "revoke", ok);
    expect(attributes["session.action"]).toBe("revoke");
    await instr.audit(ctx, ok);
    await instr.machineIdentity(ctx, "rotate", ok);
    expect(attributes["machine.action"]).toBe("rotate");
    await instr.aiGovernance(ctx, "review", ok);
    expect(attributes["ai.action"]).toBe("review");

    expect(telemetry.recordKmsLatency).toHaveBeenCalledWith(0, "cloudhsm", "hsm.sign");
    expect(telemetry.recordThreatProviderLatency).toHaveBeenCalledWith(0, "abuseipdb");
    expect(telemetry.recordAuditAppendLatency).toHaveBeenCalledWith(0);
    expect(telemetry.recordOperationLatency.mock.calls.map(([op]) => op)).toEqual([
      "policy-evaluation",
      "session",
      "machine-identity",
      "ai-governance",
    ]);
  });

  it("logs a trace-correlated completion line with the outcome and duration", async () => {
    let clock = 10;
    const { instr, debug } = spied(() => clock);
    await instr.audit(ctx, async () => {
      clock = 25;
    });
    expect(debug).toHaveBeenCalledWith(
      "security audit complete",
      expect.objectContaining({
        principalId: "p-1",
        tenantId: "tenant-a",
        operation: "audit",
        durationMs: 15,
        ok: true,
      }),
    );
  });

  it("defaults to the platform tracer and wall clock when none are injected", async () => {
    const telemetry = { recordAuditAppendLatency: vi.fn() };
    const instr = new SecurityInstrumentation({
      telemetry: telemetry as unknown as OtelSecurityTelemetry,
      logger: silent,
    });
    await expect(instr.audit(ctx, ok)).resolves.toBe("done");
    expect(telemetry.recordAuditAppendLatency).toHaveBeenCalledTimes(1);
  });
});
