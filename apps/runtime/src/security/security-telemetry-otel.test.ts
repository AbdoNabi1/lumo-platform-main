import type { Meter } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { OtelSecurityTelemetry } from "./security-telemetry-otel";

/** A minimal OTel Meter double capturing every instrument write. */
function fakeMeter(): {
  meter: Meter;
  records: { instrument: string; value: number; attrs?: Readonly<Record<string, unknown>> }[];
} {
  const records: {
    instrument: string;
    value: number;
    attrs?: Readonly<Record<string, unknown>>;
  }[] = [];
  const make = (instrument: string) => ({
    add: (value: number, attrs?: Readonly<Record<string, unknown>>) =>
      records.push({ instrument, value, attrs }),
    record: (value: number, attrs?: Readonly<Record<string, unknown>>) =>
      records.push({ instrument, value, attrs }),
  });
  // Deliberately partial mock (only the 3 instrument factories this suite uses) — needs the
  // `unknown` hop since it has no structural overlap with the full OTel `Meter` interface.
  const meter = {
    createCounter: (name: string) => make(name),
    createHistogram: (name: string) => make(name),
    createUpDownCounter: (name: string) => make(name),
  } as unknown as Meter;
  return { meter, records };
}

describe("OtelSecurityTelemetry", () => {
  it("routes the SecurityTelemetryPort contract to OTel instruments", () => {
    const { meter, records } = fakeMeter();
    const telemetry = new OtelSecurityTelemetry(meter);

    telemetry.increment("security.login.failed", { tenant: "t-1" });
    telemetry.increment("security.access.denied");
    telemetry.increment("security.session.established");
    telemetry.increment("security.session.revoked");
    telemetry.recordRiskBand("high");

    const names = records.map((r) => r.instrument);
    expect(names).toContain("security_events_total");
    expect(names).toContain("failed_logins");
    expect(names).toContain("security_requests_total");
    expect(names).toContain("risk_score_distribution");
    // active_sessions receives +1 then -1.
    const sessionDeltas = records
      .filter((r) => r.instrument === "active_sessions")
      .map((r) => r.value);
    expect(sessionDeltas).toEqual([1, -1]);
  });

  it("records the named production latency metrics", () => {
    const { meter, records } = fakeMeter();
    const telemetry = new OtelSecurityTelemetry(meter);

    telemetry.recordAuthenticationLatency(12, "success");
    telemetry.recordAuthorizationLatency(8, "allow");
    telemetry.recordKmsLatency(30, "vault", "encrypt");
    telemetry.recordThreatProviderLatency(45, "virustotal");
    telemetry.recordAuditAppendLatency(3);
    telemetry.recordStepUpChallenge("totp");
    telemetry.recordDeviceTrust(true);
    telemetry.recordPolicyCacheHit(false);

    const byName = new Set(records.map((r) => r.instrument));
    for (const metric of [
      "authentication_latency",
      "authorization_latency",
      "kms_latency",
      "threat_provider_latency",
      "audit_append_latency",
      "step_up_challenges",
      "device_trust_distribution",
      "policy_cache_hits",
    ]) {
      expect(byName.has(metric)).toBe(true);
    }
  });
});
