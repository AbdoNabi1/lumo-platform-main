# C-03 — `deploy.yml` and `release.yml` call three reusable workflows that do not exist on `main`

| Field                      | Value                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**               | Critical                                                                                                                         |
| **Area**                   | CI/CD / Supply chain                                                                                                             |
| **Baseline**               | `main` @ `756bce3`                                                                                                               |
| **Blocker verdict**        | **True blocker.** Not a deferral — six files were dropped during history reconstruction and are preserved verbatim in `de46df9`. |
| **Public contract change** | **No.**                                                                                                                          |

---

## 1. Location

| File                            | Line       | Reference                                        |
| ------------------------------- | ---------- | ------------------------------------------------ |
| `.github/workflows/deploy.yml`  | 29         | `uses: ./.github/workflows/validate.yml`         |
| `.github/workflows/release.yml` | 18         | `uses: ./.github/workflows/validate.yml`         |
| `.github/workflows/release.yml` | 21         | `uses: ./.github/workflows/security.yml`         |
| `.github/workflows/release.yml` | 25         | `uses: ./.github/workflows/build.yml`            |
| `.github/workflows/release.yml` | 47, 70, 71 | Consumes `needs.build.outputs.digest` / `.image` |

`git ls-files .github` returns exactly three files:

```
.github/workflows/ci.yml
.github/workflows/deploy.yml
.github/workflows/release.yml
```

`validate.yml`, `security.yml`, `build.yml`, `db-integration.yml`, `ory-integration.yml`, and `.github/actions/setup/action.yml` are **absent**. They are not gitignored — `git check-ignore -v .github/workflows/ci.yml` exits 1.

---

## 2. Current implementation

`release.yml` is a four-stage pipeline whose first three stages call files that do not exist:

```yaml
# .github/workflows/release.yml:16-29
jobs:
  validate:
    uses: ./.github/workflows/validate.yml # ← missing

  security:
    uses: ./.github/workflows/security.yml # ← missing

  build:
    needs: [validate, security]
    uses: ./.github/workflows/build.yml # ← missing
    with:
      push: true
    secrets: inherit
```

and then consumes an output only the missing `build.yml` produces:

```yaml
# .github/workflows/release.yml:47
run: cosign sign --yes ghcr.io/${{ github.repository }}/runtime@${{ needs.build.outputs.digest }}
```

`deploy.yml` has the same problem at its first gate:

```yaml
# .github/workflows/deploy.yml:27-33
jobs:
  validate:
    uses: ./.github/workflows/validate.yml      # ← missing

  scan:
    name: scan target image
    ...
```

The only workflow that actually runs on `main` is `ci.yml`, a single linear job: install → lint → typecheck → build → test → arch → audit (non-blocking). It builds no image and pushes nothing.

---

## 3. Why it is incorrect

GitHub Actions resolves `uses: ./.github/workflows/<name>.yml` at workflow-parse time. A missing local reusable workflow is a **hard startup failure**, not a skipped job. Both `release.yml` and `deploy.yml` therefore fail before executing a single step.

The consequence is that the entire H-5 supply-chain design — which is genuinely well built — is unreachable:

- **Trivy scan of the deploy target** (`deploy.yml:35–46`, `severity: HIGH,CRITICAL`, `exit-code: "1"`) — never runs, because `validate` fails first.
- **Cosign keyless signing of the immutable digest** (`release.yml:38–47`) — never runs.
- **Signature verification bound to this repository's workflow identity** (`deploy.yml:48–63`, `--certificate-identity-regexp "https://github.com/${{ github.repository }}/.github/workflows/.+"`) — never runs.
- **GitHub Environment approval gates** (`deploy.yml:66`, `environment: ${{ inputs.environment }}`) — never reached.

All six missing files exist in `de46df9` and are substantive. `validate.yml` is a six-gate fail-fast matrix:

```yaml
# de46df9:.github/workflows/validate.yml
strategy:
  fail-fast: true
  matrix:
    gate: [typecheck, lint, arch, test, governance, dup]
steps:
  - uses: actions/checkout@v4
  - uses: ./.github/actions/setup
  - name: pnpm ${{ matrix.gate }}
    run: pnpm ${{ matrix.gate }}
```

`build.yml` invokes exactly the Dockerfile that C-02 identifies as missing, with provenance and SBOM attestation:

```yaml
# de46df9:.github/workflows/build.yml
- uses: docker/build-push-action@v6
  with:
    context: .
    file: infrastructure/docker/runtime.Dockerfile
    push: ${{ inputs.push }}
    provenance: true # build provenance attestation
    sbom: true # SBOM attestation
```

---

## 4. Production impact

**There is no working release or deploy path.**

- Pushing tag `v1.0.0` → `release.yml` fails at parse. No image, no signature, no GitHub Release.
- Manually dispatching `Deploy` → fails at parse. Even the Trivy scan and cosign verification never execute.
- The only gate that runs is `ci.yml`, whose dependency audit is explicitly non-blocking (`.github/workflows/ci.yml:52`, `continue-on-error: true`).
- Because `db-integration.yml` is also missing, **no integration test has ever executed in CI** (see H-09) — the persistence layer that C-01 and C-04 depend on is entirely unverified.
- The supply-chain controls that exist on paper (signing, scanning, digest pinning, environment approvals) provide **zero** actual protection today.

---

## 5. Smallest additive fix

**Restore six files plus two `package.json` scripts and one config — in one commit, because they are interdependent.**

```bash
git checkout de46df9 -- \
  .github/actions/setup/action.yml \
  .github/workflows/build.yml \
  .github/workflows/validate.yml \
  .github/workflows/security.yml \
  .github/workflows/db-integration.yml \
  .github/workflows/ory-integration.yml \
  scripts/governance \
  .jscpd.json
```

Then add the two root scripts that `validate.yml`'s matrix invokes — `main`'s `package.json` has neither:

```json
"governance": "node scripts/governance/run.mjs",
"dup": "jscpd",
```

### ⚠ Do not restore `validate.yml` in isolation

Its matrix includes `governance` and `dup`. On `main` today:

- `package.json` has **no** `governance` or `dup` script,
- `scripts/governance/**` does **not exist** (15 files, present in `de46df9`),
- `.jscpd.json` does **not exist**.

Restoring the workflow alone converts one broken pipeline into a different broken pipeline. Either restore the harness together with the workflow, **or** trim the matrix to `[typecheck, lint, arch, test]` as an interim step and restore governance separately.

### Review checklist before merging

1. `.github/actions/setup/action.yml` — confirm its pnpm/Node versions match `package.json` (`pnpm@11.9.0`) and `.nvmrc`.
2. `security.yml` — read it; it likely contains the SBOM/scan steps that `ci.yml` currently marks `continue-on-error`.
3. `db-integration.yml` — verified good: it provisions `postgres:16` as a service and sets both `DATABASE_URL` and `DATABASE_URL_TEST`, which is precisely what unblocks H-09.
4. `ory-integration.yml` — pairs with the Kratos/Keto/Hydra configs also missing from `main` (see C-09).

---

## 6. Public contract impact

**None.** These are CI configuration files and build tooling. No TypeScript signature, HTTP route, event schema, or package export changes.

The two new `package.json` scripts are additive; they add capabilities without altering `build`, `test`, `lint`, `typecheck`, or `arch`.

---

## 7. Blocker or intentional deferral?

**True blocker, and explicitly _not_ a deferral.**

`docs/KNOWN_GAPS.md` defers CI _coverage_ gating (G-21) and the _dependency-audit_ gate (G-31) — it does not defer having a release pipeline. The opposite is true: `deploy.yml` and `release.yml` were written **assuming these files exist**, and their comments reference the missing workflows' behaviour directly (`deploy.yml:1-5`: _"Deploys an already-built, scanned image (by digest) … The quality gate (validate) runs first"_).

The reconstruction commit `de46df9` was created, in its own words, _"so that none of it is lost when `main` is fast-forwarded"_. These six files were preserved for recovery and were never recovered. This is a **file-loss defect**, and the cheapest fix in the entire audit.

---

## 8. How this was verified

- `git ls-files .github` → 3 files.
- `git check-ignore -v .github/workflows/ci.yml` → exit 1 (not ignored).
- `git log --oneline --all -- .github/workflows/build.yml` → only `de46df9` and its index commit.
- `git ls-tree -r --name-only de46df9 -- .github` → 9 files.
- `git show de46df9:.github/workflows/{build,validate,db-integration}.yml` read.
- `git show de46df9:package.json` → confirms `governance` and `dup` scripts; `main`'s `package.json` confirms their absence.
- File-set diff `de46df9` vs `main` → `scripts/governance` (15 files) and `.jscpd.json` absent from `main`.
- No code was modified.
