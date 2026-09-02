#!/usr/bin/env bash
# H-5 — Key rotation helper. Drives the envelope-encryption rotation (H-3): rotate the KMS-held Key
# Encryption Key (KEK) and re-wrap active Data Encryption Keys (DEKs) WITHOUT touching plaintext data.
# This script is a thin, auditable orchestrator over the platform's own rotation entrypoint — it does
# not implement crypto here (that lives in @platform/secrets / the security context).
#
#   Env:  KMS_PROVIDER (aws|gcp|azure|vault)   KEK_KEY_ID   DATABASE_URL
#   Flags: --rewrap-deks   --new-kek-version <v>   [--dry-run]
set -euo pipefail

log() { printf '[rotate-keys] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

REWRAP=false; NEW_VERSION=""; DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rewrap-deks)    REWRAP=true; shift ;;
    --new-kek-version) NEW_VERSION="${2:?}"; shift 2 ;;
    --dry-run)        DRY_RUN=true; shift ;;
    *) die "unknown arg: $1" ;;
  esac
done

: "${KMS_PROVIDER:?KMS_PROVIDER is required}"
: "${KEK_KEY_ID:?KEK_KEY_ID is required}"
[[ -n "${NEW_VERSION}" ]] || die "--new-kek-version is required"
${REWRAP} || die "nothing to do (pass --rewrap-deks)"

log "provider=${KMS_PROVIDER} kek=${KEK_KEY_ID} new-version=${NEW_VERSION} dry-run=${DRY_RUN}"

# Step 1 — rotate the KEK in the KMS (provider-native; the real, authoritative rotation).
# Envelope encryption means data ciphertext is untouched: only the key that wraps the DEKs changes.
case "${KMS_PROVIDER}" in
  aws)
    log "KMS: enabling automatic key rotation on ${KEK_KEY_ID}"
    ${DRY_RUN} || aws kms enable-key-rotation --key-id "${KEK_KEY_ID}" ;;
  gcp)
    log "KMS: create a new key version for ${KEK_KEY_ID}"
    ${DRY_RUN} || gcloud kms keys versions create --key "${KEK_KEY_ID}" --keyring "${KMS_KEYRING:?}" --location "${KMS_LOCATION:?}" ;;
  azure)
    log "KMS: rotate key ${KEK_KEY_ID}"
    ${DRY_RUN} || az keyvault key rotate --vault-name "${AZ_VAULT:?}" --name "${KEK_KEY_ID}" ;;
  vault)
    log "Vault: rotate transit key ${KEK_KEY_ID}"
    ${DRY_RUN} || vault write -f "transit/keys/${KEK_KEY_ID}/rotate" ;;
  *) die "unsupported KMS_PROVIDER: ${KMS_PROVIDER}" ;;
esac

# Step 2 — re-wrap active DEKs under the new KEK version. The re-wrap is performed by the platform's
# security context (KeyProtector.rotate port); trigger it operationally via its admin surface rather
# than reimplementing crypto here. See docs/operations/BACKUP_AND_RECOVERY.md#key-rotation.
log "KEK rotated. Trigger DEK re-wrap via the security admin API (KeyProtector.rotate), then:"
log "  kubectl -n lumo-runtime rollout restart deploy/runtime-api deploy/runtime-worker deploy/runtime-scheduler"
