// H-5 — LOAD test. Sustained, expected-peak traffic to confirm the platform meets its SLOs under
// normal production load.  Run:  k6 run -e BASE_URL=https://api… -e API_TOKEN=… perf/k6/load.js
import { sleep } from "k6";
import { apiRequest, slo } from "./lib/common.js";

export const options = {
  scenarios: {
    steady: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 }, // ramp to expected peak
        { duration: "5m", target: 50 }, // hold
        { duration: "1m", target: 0 }, // ramp down
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: slo,
};

export default function () {
  apiRequest();
  sleep(1); // ~1 req/s per VU → 50 rps at peak
}
