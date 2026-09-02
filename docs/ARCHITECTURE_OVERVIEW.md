# ARCHITECTURE_OVERVIEW — diagrams (Sprint 3.0A)

> Generated views of the frozen architecture. Canonical prose: `architecture/` docs 01–26 +
> ADR-0001…0013. If a diagram disagrees with the code, the code + fitness functions win.

## Dependency graph (enforced by dependency-cruiser)

```mermaid
graph TD
  types["types/utils (kernel)"] --> domain["@platform/domain"]
  domain --> svc_domain["services/*/domain"]
  svc_domain --> svc_app["services/*/application"]
  contracts["@platform/contracts (ports)"] --> svc_app
  svc_app --> svc_infra["services/*/infrastructure"]
  messaging["@platform/messaging"] --> svc_infra
  db["db / redis / kafka / storage / auth"] --> svc_infra
  svc_infra --> apps["apps/* (composition roots)"]
```

## Runtime graph (Sprint 2.9)

```mermaid
graph LR
  api["runtime: api<br/>(HTTP pipeline)"] --> pg[(Postgres)]
  api --> rds[(Redis)]
  worker["runtime: worker<br/>(ConsumerSupervisor)"] --> rp[(Redpanda)]
  worker --> pg
  sched["runtime: scheduler<br/>(lock-guarded jobs)"] --> pg
  sched --> rds
  pg -- "platform.outbox CDC" --> dbz[Debezium] --> rp
  rp --> worker
  api --> ory[Ory Kratos/Keto]
  all-.->otel[OTel Collector]-.->lgtm[Prometheus/Loki/Tempo/Grafana]
```

## Request lifecycle (D-047, fixed order)

```mermaid
sequenceDiagram
  participant C as Client
  participant T as Transport (@platform/http)
  participant G as AdminGuard (PEP)
  participant U as Use case
  C->>T: request (+bearer, +idempotency-key)
  T->>T: requestId/correlation/trace echo
  T->>T: authenticate (JWKS/Kratos) → 401
  T->>T: tenant-resolution-FIRST (claim→header→domain) → 403
  T->>G: authorize + audit → 403
  T->>T: rate limit (Redis, fail-closed) → 429
  T->>T: zod parse → 422
  T->>T: idempotency claim/replay
  T->>U: parsed input + context
  U-->>T: Result → presenter → envelope
```

## Event flow (ADR-0003/0005, doc 26 §3)

```mermaid
graph LR
  agg[Aggregate + outbox row<br/>ONE transaction] --> cdc[Debezium EventRouter<br/>byte-identical] --> topic[topic.v1]
  topic --> cons[KafkaConsumerRuntime<br/>inbox has→handle→recordIfNew]
  cons -- fail --> retry[topic.v1.retry<br/>5s→30s→2m→10m→1h]
  retry --> cons
  cons -- exhausted --> dlq[topic.v1.dlq + dead_letters row]
```

## Purchase flow (ADR-0012)

```mermaid
graph TD
  q[price quote] --> r[reserve stock TTL] --> i[create payment intent] --> w{await capture SIGNAL<br/>webhook→event→signal, 15m}
  w -- captured --> o[place order] --> cm[commit reservation] --> cc[complete checkout] --> cf[confirm]
  w -- failed/timeout --> ci[cancel intent] --> rl[release] --> f[fail checkout]
  o -- fails after capture --> rf[REFUND] --> rl2[release] --> f2[fail] --> al[operator alert]
```

## Authentication flow (D-048)

```mermaid
graph LR
  tok[Bearer token] --> jv[JwtVerifier<br/>JWKS iss/aud/exp] --> p[Principal + claims]
  sess[Session token] --> kr[Kratos whoami<br/>15s cache] --> p
  p --> keto[Keto check<br/>fail-closed, 30s cache] --> allow{allow/deny → audited}
```

## Package relationships

Kernel (`types/utils/domain/contracts`) ← contexts (`services/*`) ← infrastructure adapters
(`db/redis/kafka/storage/auth/http/grpc/temporal/messaging`) ← composition (`apps/admin`,
`apps/runtime`). Cross-context: integration events only (doc 20 §1.1); shared kernel = `Money` +
`ProductRef` (rule of three, D-029).
