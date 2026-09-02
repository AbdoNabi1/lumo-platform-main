import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

/**
 * Per-surface upload constraints, enforced BEFORE any byte reaches storage (defense in depth —
 * the content scanner hook is the second gate, D-045). Allowlists, never denylists.
 */
export interface UploadPolicy {
  readonly maxSizeBytes: number;
  /** Exact media types (compared case-insensitively; parameters stripped). */
  readonly allowedContentTypes: readonly string[];
  /** Lowercase extensions without dot; empty list = extensionless only. */
  readonly allowedExtensions: readonly string[];
}

export interface UploadCandidate {
  readonly filename?: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

/** Validates an upload candidate against a policy. Pure — fully unit-tested without storage. */
export function validateUpload(
  policy: UploadPolicy,
  candidate: UploadCandidate,
): Result<void, ValidationError> {
  const issues: { readonly field: string; readonly message: string }[] = [];

  if (!Number.isInteger(candidate.sizeBytes) || candidate.sizeBytes <= 0) {
    issues.push({ field: "sizeBytes", message: "must be a positive integer" });
  } else if (candidate.sizeBytes > policy.maxSizeBytes) {
    issues.push({
      field: "sizeBytes",
      message: `exceeds the limit of ${policy.maxSizeBytes} bytes`,
    });
  }

  const mediaType = candidate.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!policy.allowedContentTypes.some((allowed) => allowed.toLowerCase() === mediaType)) {
    issues.push({ field: "contentType", message: `"${mediaType}" is not allowed` });
  }

  if (candidate.filename !== undefined) {
    const dot = candidate.filename.lastIndexOf(".");
    const ext =
      dot > 0 && dot < candidate.filename.length - 1
        ? candidate.filename.slice(dot + 1).toLowerCase()
        : "";
    if (ext !== "" && !policy.allowedExtensions.includes(ext)) {
      issues.push({ field: "filename", message: `extension ".${ext}" is not allowed` });
    }
  }

  if (issues.length > 0) {
    return err(new ValidationError("Upload rejected by policy", issues));
  }
  return ok(undefined);
}
