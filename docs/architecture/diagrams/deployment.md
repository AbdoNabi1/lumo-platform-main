# Deployment Diagram

> H-5 — how the runtime is deployed on Kubernetes with the hardening controls from
> [`infrastructure/k8s`](../../../infrastructure/k8s). Zero-downtime rollout, HPA, PDB, NetworkPolicy,
> non-root read-only pods.

```mermaid
flowchart TB
  subgraph Internet
    U[Clients]
  end

  subgraph Edge["Ingress (nginx)"]
    ING["Ingress runtime-api<br/>TLS1.2/1.3 · HSTS · CSP · security headers<br/>routes /api only"]
  end

  subgraph K8s["Kubernetes — namespace lumo-runtime"]
    subgraph apiset["Deployment runtime-api (HPA 2–10, PDB min 1)"]
      A1["pod (non-root, ro-rootfs,<br/>drop ALL caps, seccomp)"]
      A2["pod"]
    end
    subgraph wset["Deployment runtime-worker (HPA 2–6, PDB min 1)"]
      W1[pod]
      W2[pod]
    end
    SCH["Deployment runtime-scheduler<br/>(singleton, Redis lock, PDB maxUnavail 1)"]
    SVC["Service runtime-api (ClusterIP)"]
    CM[ConfigMap]
    SEC[Secret ← secret manager/Vault]
    NP["NetworkPolicy (least privilege)"]
    PROM["Prometheus<br/>scrapes /metrics"]
    DBZ["debezium-connect (Deployment)<br/>+ register Job (P2.0.1)<br/>outbox → Kafka CDC"]
  end

  subgraph Data["Stateful plane"]
    PG[(PostgreSQL 16<br/>WAL archive → PITR)]
    RD[(Redis)]
    RP[(Redpanda)]
    CH[(ClickHouse)]
  end

  U -->|HTTPS| ING --> SVC --> A1 & A2
  A1 --- CM & SEC
  A1 -->|SQL + audit_events| PG
  A1 -->|cache/lock| RD
  PG -->|outbox CDC| DBZ --> RP --> W1 & W2
  W1 --> PG
  W1 --> CH
  SCH --> PG
  PROM -.scrape.-> A1 & W1 & SCH
  A1 & W1 & SCH -. OTLP traces+metrics .-> OTELC[OTel Collector]
  NP -. guards .- apiset
```

## Rollout properties

- **Zero-downtime**: `maxUnavailable: 0`, `maxSurge: 1`, `preStop` drain, 30s grace (10s bounded shutdown).
- **Resilience**: PDBs hold `minAvailable: 1` during node drains; topology spread + anti-affinity.
- **Isolation**: NetworkPolicy restricts pod traffic; ops endpoints never leave the cluster.
- **Verification gate**: images are cosign-verified in `deploy.yml` before `kubectl apply`.
