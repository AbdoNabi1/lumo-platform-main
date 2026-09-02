import { describe, expect, it } from "vitest";
import { RiskEngine } from "./risk-engine";

describe("RiskEngine (explainable)", () => {
  const engine = new RiskEngine();

  it("returns zero risk with no signals", () => {
    const evaluation = engine.evaluate({});
    expect(evaluation.score.value).toBe(0);
    expect(evaluation.score.band).toBe("low");
    expect(evaluation.factors).toEqual([]);
  });

  it("attributes each factor and sums the score", () => {
    const evaluation = engine.evaluate({ tor: true, ipReputation: 100, failedAuthCount: 2 });
    const codes = evaluation.factors.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["tor", "ip_reputation", "failed_auth"]));
    // tor 35 + ip 25 + failed 20 = 80 → high
    expect(evaluation.score.value).toBe(80);
    expect(evaluation.score.band).toBe("high");
  });

  it("raises risk for low device reputation", () => {
    const evaluation = engine.evaluate({ deviceReputation: 0 });
    expect(
      evaluation.factors.some((f) => f.code === "device_reputation" && f.contribution === 15),
    ).toBe(true);
  });

  it("caps individual factor contributions", () => {
    const evaluation = engine.evaluate({ failedAuthCount: 100 });
    expect(evaluation.factors.find((f) => f.code === "failed_auth")?.contribution).toBe(30);
  });
});
