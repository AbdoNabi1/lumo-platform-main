# Infrastructure Diagram

> H-5 — the full infrastructure topology (compose parity of production), including the H-5 monitoring
> additions (Alertmanager, provisioned dashboards, recording/alerting rules). Networks are
> least-privilege planes: `data`, `messaging`, `observability`, `tools`.

```mermaid
flowchart LR
  subgraph data["network: data"]
    PG[(PostgreSQL 16<br/>logical WAL)]
    RD[(Redis 7)]
    RTA[runtime-api]
    RTS[runtime-scheduler]
    CH[(ClickHouse)]
    MINIO[(MinIO / object store)]
  end

  subgraph messaging["network: messaging"]
    RP[(Redpanda)]
    DBZ[Debezium]
    RTW[runtime-worker]
  end

  subgraph obs["network: observability"]
    OTEL[OTel Collector]
    PROM[Prometheus<br/>+ recording/alert rules]
    AM[Alertmanager<br/>page / ticket routing]
    GRAF[Grafana<br/>provisioned dashboards]
    LOKI[(Loki)]
    TEMPO[(Tempo)]
  end

  subgraph identity["Ory"]
    HYDRA[Hydra OIDC]
    KRATOS[Kratos]
    KETO[Keto ReBAC]
  end

  RTA --> PG & RD
  RTA --> KETO & HYDRA
  RTS --> PG & RD
  PG --> DBZ --> RP --> RTW
  RTW --> PG & CH
  RTA & RTW & RTS -. /metrics .-> PROM
  OTEL --> PROM
  OTEL --> TEMPO
  OTEL --> LOKI
  PROM --> AM
  PROM --> GRAF
  LOKI --> GRAF
  TEMPO --> GRAF
  RTA -. traces/logs/metrics .-> OTEL
```

## Notes

- **Metrics**: runtime processes expose a native `/metrics` (scraped by the `lumo-runtime` job);
  OTel-instrumented security telemetry flows via the Collector's Prometheus exporter.
- **Alerting**: recording rules compute the SLIs, alerting rules fire against them, Alertmanager
  routes `page`/`ticket` (see [monitoring config](../../../infrastructure/docker/prometheus)).
- **Correlation**: Grafana cross-links traces ↔ logs ↔ metrics by trace id.
- **Isolation**: operator UIs (`tools` plane, omitted above) never join the messaging plane unless
  they operate it; observability services never touch application data stores.
