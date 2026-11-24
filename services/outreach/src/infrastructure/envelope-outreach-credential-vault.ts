import type { EnvelopeCipher, SealedEnvelope } from "@platform/secrets";
import type { OutreachCredentialVault } from "../application/ports";

/** Dedicated KEK alias for outreach credentials. */
export const OUTREACH_CREDENTIALS_KEY_ALIAS = "outreach-credentials";

const OPEN_FAILED = "Outreach credentials could not be opened";

interface Payload {
  readonly v: 1;
  /** The tenant and purpose the secrets were sealed for. */
  readonly t: string;
  readonly p: string;
  readonly s: Readonly<Record<string, string>>;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

/** The tenant and purpose are sealed inside the encrypted payload and checked on open. */
export class EnvelopeOutreachCredentialVault implements OutreachCredentialVault {
  readonly backing = "real" as const;
  private readonly cipher: EnvelopeCipher;
  private readonly alias: string;

  constructor(cipher: EnvelopeCipher, alias: string) {
    this.cipher = cipher;
    this.alias = alias;
  }

  async seal(
    tenantId: string,
    purpose: "whatsapp",
    secrets: Readonly<Record<string, string>>,
  ): Promise<string> {
    const payload: Payload = { v: 1, t: tenantId, p: purpose, s: secrets };
    const envelope = await this.cipher.seal(JSON.stringify(payload), this.alias);
    return JSON.stringify(envelope);
  }

  async open(
    tenantId: string,
    purpose: "whatsapp",
    sealed: string,
  ): Promise<Readonly<Record<string, string>>> {
    let payload: Payload;
    try {
      const envelope = JSON.parse(sealed) as SealedEnvelope;
      payload = JSON.parse(await this.cipher.open(envelope)) as Payload;
    } catch {
      throw new Error(OPEN_FAILED);
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      payload.v !== 1 ||
      payload.t !== tenantId ||
      payload.p !== purpose ||
      !isStringRecord(payload.s)
    ) {
      throw new Error(OPEN_FAILED);
    }
    return payload.s;
  }
}

/** Offline/test stand-in, not encryption; still checks tenant and purpose. */
export class InMemoryOutreachCredentialVault implements OutreachCredentialVault {
  readonly backing = "stub" as const;

  seal(
    tenantId: string,
    purpose: "whatsapp",
    secrets: Readonly<Record<string, string>>,
  ): Promise<string> {
    const body = Buffer.from(JSON.stringify({ t: tenantId, p: purpose, s: secrets })).toString(
      "base64",
    );
    return Promise.resolve(`stub:${body}`);
  }

  open(
    tenantId: string,
    purpose: "whatsapp",
    sealed: string,
  ): Promise<Readonly<Record<string, string>>> {
    let parsed: { t?: unknown; p?: unknown; s?: unknown };
    try {
      parsed = JSON.parse(
        Buffer.from(sealed.replace(/^stub:/, ""), "base64").toString("utf8"),
      ) as typeof parsed;
    } catch {
      return Promise.reject(new Error(OPEN_FAILED));
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.t !== tenantId ||
      parsed.p !== purpose ||
      !isStringRecord(parsed.s)
    ) {
      return Promise.reject(new Error(OPEN_FAILED));
    }
    return Promise.resolve(parsed.s);
  }
}
