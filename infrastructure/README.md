# infrastructure/

Infrastructure-as-code and operational config, per
[`docs/architecture/15`](../docs/architecture/15-scalability-and-deployment.md).

Sprint 0.1 includes only:

- `docker/` — `web.Dockerfile` (multi-stage, production-ready) and `docker-compose.yml` (local dev).

Later phases add: `terraform/`, `kubernetes/`, `argocd/`, `observability/`, `database/`.
GitHub Actions pipelines live at the repo root in `.github/workflows/`.
