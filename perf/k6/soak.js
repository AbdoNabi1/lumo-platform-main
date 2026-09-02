// H-5 — SOAK test. Moderate, steady load held for hours to surface slow leaks: memory growth
// (nodejs_heap_used_bytes climbing), connection-pool exhaustion, or gradual latency creep. Watch the
// Grafana Overview dashboard alongside.  Run:  k6 run -e SOAK_DURATION=2h perf/k6/soak.js
import { sleep } from "k6";
import { apiRequest, slo } from "./lib/common.js";

const DURATION = __ENV.SOAK_DURATION || "2h";

export const options = {
  scenarios: {
    endurance: {
      executor: "constant-vus",
      vus: 25,
      duration: DURATION,
    },
  },
  // SLOs must hold for the WHOLE window — a leak shows up as a late-window threshold breach.
  thresholds: slo,
};

export default function () {
  apiRequest();
  sleep(1);
}
