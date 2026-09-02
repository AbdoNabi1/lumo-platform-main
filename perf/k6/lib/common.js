// H-5 — shared k6 helpers. All scenarios target the same runtime and share thresholds so the
// pass/fail bar is defined once. BASE_URL / API_TOKEN come from the environment (never hardcoded).
import http from "k6/http";
import { check } from "k6";
import { Trend, Rate } from "k6/metrics";

export const BASE_URL = __ENV.BASE_URL || "http://localhost:3080";
export const API_TOKEN = __ENV.API_TOKEN || "";

// Custom metrics so every scenario reports the same SLI-aligned numbers.
export const apiLatency = new Trend("api_latency_ms", true);
export const apiErrors = new Rate("api_error_rate");

// Thresholds mirror the SLOs (docs/operations/SLO_SLI.md): 99.9% availability, latency budget.
export const slo = {
  http_req_failed: ["rate<0.001"], // ≥ 99.9% success
  api_error_rate: ["rate<0.001"],
  api_latency_ms: ["p(95)<300", "p(99)<800"],
};

function headers() {
  const h = { "Content-Type": "application/json" };
  if (API_TOKEN) h["Authorization"] = `Bearer ${API_TOKEN}`;
  return h;
}

// A representative read against the API surface. `/readyz` is always present and cheap; when an
// API_PATH is provided we exercise a real business route instead.
export function apiRequest() {
  const path = __ENV.API_PATH || "/readyz";
  const res = http.get(`${BASE_URL}${path}`, { headers: headers(), tags: { name: path } });
  apiLatency.add(res.timings.duration);
  const ok = check(res, { "status is 2xx/3xx": (r) => r.status >= 200 && r.status < 400 });
  apiErrors.add(!ok);
  return res;
}
