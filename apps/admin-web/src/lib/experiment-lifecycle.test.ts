import { describe, expect, it } from "vitest";
import {
  advanceableExperimentStatusesFrom,
  EXPERIMENT_LIFECYCLE_TRANSITIONS,
} from "./experiment-lifecycle";

describe("advanceableExperimentStatusesFrom", () => {
  it("offers only running from draft", () => {
    expect(advanceableExperimentStatusesFrom("draft")).toEqual(["running"]);
  });

  it("offers paused and completed from running", () => {
    expect(advanceableExperimentStatusesFrom("running")).toEqual(["paused", "completed"]);
  });

  it("offers running and completed from paused — a paused experiment can resume", () => {
    expect(advanceableExperimentStatusesFrom("paused")).toEqual(["running", "completed"]);
  });

  it("offers only archived from completed", () => {
    expect(advanceableExperimentStatusesFrom("completed")).toEqual(["archived"]);
  });

  it("returns an empty array for the terminal archived status", () => {
    expect(advanceableExperimentStatusesFrom("archived")).toEqual([]);
  });

  it("returns an empty array for an unrecognized status rather than throwing", () => {
    expect(advanceableExperimentStatusesFrom("not-a-real-status")).toEqual([]);
  });

  it("every status in the hand-kept table has an entry (no key silently missing)", () => {
    for (const status of Object.keys(EXPERIMENT_LIFECYCLE_TRANSITIONS)) {
      expect(() => advanceableExperimentStatusesFrom(status)).not.toThrow();
    }
  });
});
