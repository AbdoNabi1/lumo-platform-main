#!/usr/bin/env node
// H-5 — dependency-free HTTP benchmark harness. A repeatable latency baseline that needs NO external
// tools (unlike the k6 scenarios) — just Node. It fires N requests at a configurable concurrency and
// reports p50/p95/p99/max + throughput, then exits non-zero if a threshold is breached so it can gate
// CI perf regressions.
//
//   node perf/bench/http-bench.mjs --url http://localhost:3080/readyz --requests 2000 --concurrency 50
//   env: BASE_URL, API_TOKEN | flags override env.  Thresholds: --p95 300 --p99 800 (ms)
import { performance } from "node:perf_hooks";
import http from "node:http";
import https from "node:https";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const URL_STR = arg("url", `${process.env.BASE_URL || "http://localhost:3080"}/readyz`);
const TOTAL = Number(arg("requests", "2000"));
const CONCURRENCY = Number(arg("concurrency", "50"));
const P95_MAX = Number(arg("p95", "300"));
const P99_MAX = Number(arg("p99", "800"));
const TOKEN = process.env.API_TOKEN || "";

const url = new URL(URL_STR);
const client = url.protocol === "https:" ? https : http;
const agent = new client.Agent({ keepAlive: true, maxSockets: CONCURRENCY });

const durations = [];
let sent = 0;
let failures = 0;

function once() {
  return new Promise((resolve) => {
    const start = performance.now();
    const req = client.request(
      url,
      { method: "GET", agent, headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {} },
      (res) => {
        res.resume();
        res.on("end", () => {
          durations.push(performance.now() - start);
          if (res.statusCode >= 400) failures++;
          resolve();
        });
      },
    );
    req.on("error", () => {
      failures++;
      durations.push(performance.now() - start);
      resolve();
    });
    req.end();
  });
}

async function worker() {
  while (sent < TOTAL) {
    sent++;
    await once();
  }
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

const wallStart = performance.now();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const wallMs = performance.now() - wallStart;

const sorted = [...durations].sort((a, b) => a - b);
const report = {
  url: URL_STR,
  requests: TOTAL,
  concurrency: CONCURRENCY,
  failures,
  error_rate: Number((failures / TOTAL).toFixed(5)),
  throughput_rps: Number((TOTAL / (wallMs / 1000)).toFixed(1)),
  p50_ms: Number(pct(sorted, 50).toFixed(2)),
  p95_ms: Number(pct(sorted, 95).toFixed(2)),
  p99_ms: Number(pct(sorted, 99).toFixed(2)),
  max_ms: Number(sorted[sorted.length - 1]?.toFixed(2) ?? 0),
};
console.log(JSON.stringify(report, null, 2));

const breaches = [];
if (report.p95_ms > P95_MAX) breaches.push(`p95 ${report.p95_ms}ms > ${P95_MAX}ms`);
if (report.p99_ms > P99_MAX) breaches.push(`p99 ${report.p99_ms}ms > ${P99_MAX}ms`);
if (report.error_rate > 0.001) breaches.push(`error_rate ${report.error_rate} > 0.001`);
if (breaches.length > 0) {
  console.error(`[http-bench] THRESHOLD BREACH: ${breaches.join("; ")}`);
  process.exit(1);
}
console.error("[http-bench] within thresholds");
