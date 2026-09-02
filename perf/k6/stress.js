// H-5 — STRESS test. Push past expected peak to find the breaking point and confirm the HPA scales
// and the system degrades gracefully (no cascading failure). Thresholds are ADVISORY here — the goal
// is to observe the knee, not to pass a fixed bar.  Run:  k6 run perf/k6/stress.js
import { sleep } from "k6";
import { apiRequest } from "./lib/common.js";

export const options = {
  scenarios: {
    ramp_to_break: {
      executor: "ramping-arrival-rate",
      startRate: 50,
      timeUnit: "1s",
      preAllocatedVUs: 100,
      maxVUs: 1000,
      stages: [
        { duration: "2m", target: 200 }, // 4x peak
        { duration: "2m", target: 500 }, // 10x peak — expect HPA to scale
        { duration: "2m", target: 1000 }, // find the knee
        { duration: "2m", target: 0 }, // recovery — confirm it returns to health
      ],
    },
  },
  // Record where latency/errors cross the line without failing the run.
  thresholds: {
    api_latency_ms: [{ threshold: "p(95)<1500", abortOnFail: false }],
    api_error_rate: [{ threshold: "rate<0.05", abortOnFail: false }],
  },
};

export default function () {
  apiRequest();
  sleep(0.2);
}
