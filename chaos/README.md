# Chaos Engineering

> H-5 production readiness. Controlled fault-injection experiments that validate the platform's
> resilience claims — readiness fails **closed**, dependencies **retry/backoff**, and Kubernetes
> **self-heals** within the PDB. Every experiment records a hypothesis, injects a time-boxed fault,
> observes, and **always restores** (EXIT trap / built-in revert). Reuses the existing stack — no new
> infrastructure.

## Golden rules

1. **Never run against production** without an approved game-day plan and a rollback owner.
2. Start from a **known steady state** (`/readyz == 200`, dashboards green).
3. One variable at a time; time-box the fault; watch Grafana throughout.
4. If an experiment can't restore, it fails loudly rather than leaving the stack degraded.

## Local experiments (Docker Compose)

Bring up the stack (`docker compose … up -d`) then:

| Experiment          | Script                                                                  | Validates                                                                   |
| ------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Database outage     | `chaos/scripts/database-outage.sh`                                      | readiness fails closed (503) + self-heals                                   |
| Dependency failure  | `chaos/scripts/dependency-failure.sh <redis\|redpanda\|keto\|hydra>`    | graceful degradation, no crash                                              |
| Network degradation | `chaos/scripts/network-degradation.sh [container] [delay] [loss] [dur]` | latency/loss tolerance (needs [pumba](https://github.com/alexei-led/pumba)) |

## Kubernetes experiments

| Experiment   | How                                                      | Validates                                                                                       |
| ------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Pod fault    | `NS=morbeh-runtime chaos/k8s/pod-fault.sh`               | PDB + rolling replace keep availability (plain kubectl)                                         |
| Full library | `kubectl apply -f chaos/k8s/chaos-mesh-experiments.yaml` | pod-kill / net-latency / partition / memory-stress (needs [Chaos Mesh](https://chaos-mesh.org)) |

## What "pass" looks like

- **DB outage / dependency partition** → `/readyz` returns 503 while down (no traffic routed),
  returns to 200 within ~60s of recovery, container never exits.
- **Pod fault** → Service availability never drops (PDB `minAvailable: 1`); ready count self-heals.
- **Network degradation** → latency rises but requests still succeed; recovers to baseline.
- **Memory stress** → container stays within its limit or OOMKills and is replaced; HPA reacts.

## Game-day cadence

Quarterly, per the [maintenance calendar](../docs/operations/OPERATIONS_GUIDE.md#routine-maintenance-calendar).
Capture findings as action items and, where they reveal a gap, add a runbook or an alert.
