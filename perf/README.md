# Performance & Benchmark Suite

> H-5 production readiness. Four complementary tools, all pointed at the **existing** runtime
> `/api` + `/readyz` surface and aligned to the SLOs in
> [`docs/operations/SLO_SLI.md`](../docs/operations/SLO_SLI.md). Thresholds are defined once in
> [`k6/lib/common.js`](k6/lib/common.js).

## Prerequisites

Bring the runtime up (local parity) with the monitoring stack so you can watch the dashboards while
tests run:

```bash
docker compose -f infrastructure/docker/docker-compose.yml \
               -f infrastructure/docker/docker-compose.runtime.yml up -d
```

Set the target: `export BASE_URL=http://localhost:3080` (and `API_TOKEN=…`, `API_PATH=/api/…` to
exercise a real authenticated route instead of `/readyz`).

## The four tests

| Test          | Tool           | Question it answers                                    | Command                                      |
| ------------- | -------------- | ------------------------------------------------------ | -------------------------------------------- |
| **Load**      | k6             | Do we meet SLOs at expected peak?                      | `k6 run perf/k6/load.js`                     |
| **Stress**    | k6             | Where's the knee, does the HPA save us, do we recover? | `k6 run perf/k6/stress.js`                   |
| **Soak**      | k6             | Any leaks/creep over hours?                            | `k6 run -e SOAK_DURATION=2h perf/k6/soak.js` |
| **Benchmark** | Node (no deps) | Repeatable latency baseline / CI perf gate             | `node perf/bench/http-bench.mjs`             |

The k6 scenarios need [k6](https://k6.io) installed. The benchmark harness needs **only Node**, so it
runs anywhere (including CI) without extra tooling and exits non-zero on a threshold breach:

```bash
node perf/bench/http-bench.mjs --url $BASE_URL/readyz --requests 2000 --concurrency 50 --p95 300 --p99 800
```

## Reading results

- k6 prints per-threshold pass/fail; a red `http_req_failed` or `api_latency_ms` threshold = SLO miss.
- During any run, watch **Grafana → Lumo / Platform Overview (SLO)**: availability, burn rate,
  latency, and `nodejs_heap_used_bytes` (the soak leak signal).
- Stress: confirm `kubectl -n lumo-runtime get hpa` shows replicas rising, then falling on recovery.

## Interpreting against SLOs

Load and soak **must** pass the shared `slo` thresholds (99.9 % success, p95 < 300 ms). Stress uses
advisory thresholds — its job is to _locate_ the limit, and to prove the system returns to health
after the load drops, not to pass a fixed bar.
