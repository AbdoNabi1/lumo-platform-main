import type { EnvelopeCipher, SealedEnvelope } from "@platform/secrets";
import type { EmailConnectionVault } from "../application/email-connection-ports";
import type { EmailConnectionKind } from "../domain/messaging/email-connection";

/** The KEK alias email credentials are sealed under: its own, never payments' or shipping's. */
export const EMAIL_CREDENTIALS_KEY_ALIAS = "email-credentials";

const OPEN_FAILED = "Email credentials could not be opened";
const SEAL_FAILED = "Email credentials could not be sealed";
const STORED_KEYS = ["alias", "ciphertext", "v", "wrappedDek"];

interface Payload {
  readonly v: 1;
  /** The tenant and connection kind the secrets were sealed for, checked on open. */
  readonly t: string;
  readonly k: string;
  readonly s: Readonly<Record<string, string>>;
}

/** The trusted, configured alias → key reference lookup (`undefined` for an unknown alias). */
export type KekRefResolver = (alias: string) => string | undefined;

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

/**
 * The real {@link EmailConnectionVault} (D48): `@platform/secrets`' envelope encryption (a fresh data
 * key per payload, wrapped by a KEK that never leaves its backend). What reaches Postgres is only
 * `{ v, alias, wrappedDek, ciphertext }`.
 *
 * The key reference is NEVER stored: with the stock `NodeCrypto` it is the secret the KEK is derived
 * from, so a row carrying it would carry its own decryption key. It is resolved on open from the
 * vault's own trusted, configured alias registry (`resolveKekRef`), never from the row. A stored row
 * that has a `kekRef` property at all, or names an unknown alias, is refused. (Rotating the KEK behind
 * the same alias strands old rows; rotation needs a versioned, non-secret key id and a trusted
 * historical-key registry: out of scope here.)
 *
 * The tenant and connection kind are sealed INSIDE the payload and re-checked on open
 * (`EnvelopeCipher` has no associated-data channel of its own). Every failure, whatever its cause, is
 * the same message with no `cause`: it names no tenant, key, plaintext or ciphertext.
 */
export class EnvelopeEmailConnectionVault implements EmailConnectionVault {
  readonly backing = "real" as const;
  private readonly cipher: EnvelopeCipher;
  private readonly alias: string;
  private readonly resolveKekRef: KekRefResolver;

  constructor(cipher: EnvelopeCipher, alias: string, resolveKekRef: KekRefResolver) {
    this.cipher = cipher;
    this.alias = alias;
    this.resolveKekRef = resolveKekRef;
  }

  async seal(
    tenantId: string,
    kind: EmailConnectionKind,
    secrets: Readonly<Record<string, string>>,
  ): Promise<string> {
    const payload: Payload = { v: 1, t: tenantId, k: kind, s: secrets };
    try {
      const envelope = await this.cipher.seal(JSON.stringify(payload), this.alias);
      return JSON.stringify({
        v: envelope.v,
        alias: envelope.alias,
        wrappedDek: envelope.wrappedDek,
        ciphertext: envelope.ciphertext,
      });
    } catch {
      throw new Error(SEAL_FAILED);
    }
  }

  async open(
    tenantId: string,
    kind: EmailConnectionKind,
    sealed: string,
  ): Promise<Readonly<Record<string, string>>> {
    try {
      const parsed: unknown = JSON.parse(sealed);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("shape");
      }
      const row = parsed as Record<string, unknown>;
      // Exactly the four stored fields (so any own `kekRef`, even null, is refused) with the right types.
      const keys = Object.keys(row).sort();
      if (keys.length !== STORED_KEYS.length || keys.some((key, i) => key !== STORED_KEYS[i])) {
        throw new Error("shape");
      }
      const { v, alias, wrappedDek, ciphertext } = row;
      if (
        typeof v !== "number" ||
        typeof alias !== "string" ||
        typeof wrappedDek !== "string" ||
        typeof ciphertext !== "string"
      ) {
        throw new Error("shape");
      }
      const kekRef = this.resolveKekRef(alias);
      if (typeof kekRef !== "string" || kekRef.length === 0) throw new Error("alias");
      const envelope: SealedEnvelope = { v, alias, kekRef, wrappedDek, ciphertext };
      const decrypted: unknown = JSON.parse(await this.cipher.open(envelope));
      if (typeof decrypted !== "object" || decrypted === null) throw new Error("payload");
      const payload = decrypted as Partial<Payload>;
      if (
        payload.v !== 1 ||
        payload.t !== tenantId ||
        payload.k !== kind ||
        !isStringRecord(payload.s)
      ) {
        throw new Error("payload");
      }
      return payload.s;
    } catch {
      throw new Error(OPEN_FAILED);
    }
  }
}

/**
 * NOT encryption. The offline/local stand-in so the context composes without a KEK. It reports itself
 * as `stub`, which the runtime boot guard refuses outside `APP_ENV=local`. It still re-checks the
 * tenant and kind, so tests built on it keep the isolation property.
 */
export class InMemoryEmailConnectionVault implements EmailConnectionVault {
  readonly backing = "stub" as const;

  seal(
    tenantId: string,
    kind: EmailConnectionKind,
    secrets: Readonly<Record<string, string>>,
  ): Promise<string> {
    const body = Buffer.from(JSON.stringify({ t: tenantId, k: kind, s: secrets })).toString(
      "base64",
    );
    return Promise.resolve(`stub:${body}`);
  }

  open(
    tenantId: string,
    kind: EmailConnectionKind,
    sealed: string,
  ): Promise<Readonly<Record<string, string>>> {
    let parsed: { t?: unknown; k?: unknown; s?: unknown };
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
      parsed.k !== kind ||
      !isStringRecord(parsed.s)
    ) {
      return Promise.reject(new Error(OPEN_FAILED));
    }
    return Promise.resolve(parsed.s);
  }
}
