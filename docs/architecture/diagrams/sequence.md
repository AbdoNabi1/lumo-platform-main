# Sequence Diagrams

> H-5 — the two flows that most define the platform's runtime behavior: an authorized write that
> emits an event via the transactional outbox, and the async consumer path with at-least-once +
> idempotent inbox. These reflect the implemented architecture (outbox/CDC, inbox dedupe, zero-trust
> edge).

## 1 — Authorized write → outbox (synchronous request path)

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant I as Ingress (TLS/headers)
  participant A as runtime-api
  participant E as Edge zero-trust guard
  participant O as Ory (Keto/Hydra)
  participant M as Context module (e.g. Orders)
  participant P as PostgreSQL

  C->>I: POST /api/orders (Bearer JWT)
  I->>A: forward (+ security headers on response)
  A->>E: EvaluateAccess(subject, action, resource)
  E->>O: verify token / check relation (cached)
  O-->>E: permit
  E-->>A: allow
  A->>M: createOrder(cmd)
  M->>P: BEGIN; insert order; insert platform.outbox; COMMIT
  P-->>M: ok (single transaction — no dual-write)
  M-->>A: OrderCreated (id)
  A-->>C: 201 Created
  Note over P: Debezium tails the outbox via logical replication (CDC)
```

## 2 — Async consumer (at-least-once + idempotent inbox)

```mermaid
sequenceDiagram
  autonumber
  participant D as Debezium (CDC)
  participant R as Redpanda
  participant W as runtime-worker
  participant IB as Inbox (dedupe)
  participant H as Event handler
  participant P as PostgreSQL
  participant MX as Metrics

  D->>R: publish order.created (from outbox)
  R->>W: deliver (consumer group)
  W->>IB: seen(messageId)?
  alt duplicate
    IB-->>W: yes
    W->>MX: messaging_messages_duplicate_total++
    W-->>R: commit offset (skip)
  else new
    IB-->>W: no
    W->>H: handle(event)
    H->>P: update projection / react
    alt success
      H-->>W: ok
      W->>MX: messaging_messages_processed_total++
      W-->>R: commit offset
    else handler error
      H-->>W: throw
      W->>MX: messaging_messages_failed_total++ / retried++
      Note over W: retry w/ backoff → dead-letter after max attempts (dead_lettered++)
    end
  end
```
