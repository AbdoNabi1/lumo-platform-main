import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import {
  hashPreviewToken,
  isWellFormedPreviewToken,
  mintPreviewToken,
  PREVIEW_TOKEN_TTL_MS,
} from "../domain/preview-token";
import type { OnlineStoreDeps } from "./deps";
import { inUnitOfWork } from "./guarded";

export interface PreviewTokenView {
  readonly token: string;
  readonly expiresAt: string;
  readonly url: string | null;
}

/** Spec 1.6. The token exists once: in this result. Only its SHA-256 is stored. */
export class IssuePreviewToken {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly createdBy: string;
    readonly tenantId: string;
  }): Promise<Result<PreviewTokenView, DomainError>> {
    const token = mintPreviewToken();
    const now = this.deps.clock.now();
    const expiresAt = new Date(now.getTime() + PREVIEW_TOKEN_TTL_MS);
    const stored = await inUnitOfWork(this.deps, async (tx) => {
      await this.deps.previewTokens.deleteExpired(input.tenantId, now, tx);
      await this.deps.previewTokens.insert(
        {
          id: this.deps.idGenerator.generate(),
          tokenHash: hashPreviewToken(token),
          expiresAt,
          createdBy: input.createdBy,
          createdAt: now,
        },
        input.tenantId,
        tx,
      );
      return ok(undefined);
    });
    if (!stored.ok) return stored;
    let host: string | null = null;
    try {
      host = await this.deps.shopHost.primaryHostname(input.tenantId);
    } catch {
      host = null; // admin-web falls back to STOREFRONT_URL
    }
    return ok({
      token,
      expiresAt: expiresAt.toISOString(),
      url: host === null ? null : `https://${host}/?preview=${encodeURIComponent(token)}`,
    });
  }
}

/** The expiry when usable, else null — no reason detail. Another shop's token is unknown here. */
export class ResolvePreviewToken {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly token: string;
    readonly tenantId: string;
  }): Promise<Date | null> {
    if (!isWellFormedPreviewToken(input.token)) return null;
    const found = await this.deps.previewTokens.findActive(
      hashPreviewToken(input.token),
      input.tenantId,
      this.deps.clock.now(),
    );
    return found === null ? null : found.expiresAt;
  }
}
