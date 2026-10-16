import type { EnvelopeCipher, SealedEnvelope } from "@platform/secrets";
import type { PaymentCredentialVault, ProviderBacking } from "../application/ports";
import type { PaymentProviderKey } from "../domain/value-objects/payment-provider-key";

interface Payload {
  readonly v: 1;
  /** The tenant and provider the secrets were sealed for — checked on open. */
  readonly t: string;
  readonly p: string;
  readonly s: Readonly<Record<string, string>>;
}

/**
 * The real {@link PaymentCredentialVault}: `@platform/secrets`' envelope encryption (a fresh data key
 * per payload, wrapped by a KEK that never leaves its backend). What reaches Postgres is only the
 * sealed envelope JSON.
 *
 * The tenant and provider are sealed INSIDE the payload and re-checked on open, so an envelope
 * copied from one merchant's row into another's does not decrypt to a usable credential
 * (`EnvelopeCipher` has no associated-data channel of its own).
 *
 * Error messages never include plaintext, ciphertext or the payload.
 */
export class EnvelopePaymentCredentialVault implements PaymentCredentialVault {
  readonly backing: ProviderBacking = "real";
  private readonly cipher: EnvelopeCipher;
  private readonly alias: string;

  constructor(cipher: EnvelopeCipher, alias: string) {
    this.cipher = cipher;
    this.alias = alias;
  }

  async seal(
    tenantId: string,
    provider: PaymentProviderKey,
    secrets: Readonly<Record<string, string>>,
  ): Promise<string> {
    const payload: Payload = { v: 1, t: tenantId, p: provider, s: secrets };
    const envelope = await this.cipher.seal(JSON.stringify(payload), this.alias);
    return JSON.stringify(envelope);
  }

  async open(
    tenantId: string,
    provider: PaymentProviderKey,
    sealed: string,
  ): Promise<Readonly<Record<string, string>>> {
    let payload: Payload;
    try {
      const envelope = JSON.parse(sealed) as SealedEnvelope;
      payload = JSON.parse(await this.cipher.open(envelope)) as Payload;
    } catch {
      throw new Error("Merchant payment credentials could not be opened");
    }
    if (payload.v !== 1 || payload.t !== tenantId || payload.p !== provider) {
      throw new Error("Merchant payment credentials could not be opened");
    }
    return payload.s;
  }
}

/**
 * NOT encryption. Offline/test stand-in so `wirePayments` composes without a KEK; reports itself as
 * `stub`, which `assertProductionPaymentProviderConfigured` refuses outside `local`.
 */
export class InMemoryPaymentCredentialVault implements PaymentCredentialVault {
  readonly backing: ProviderBacking = "stub";

  seal(
    tenantId: string,
    provider: PaymentProviderKey,
    secrets: Readonly<Record<string, string>>,
  ): Promise<string> {
    const body = Buffer.from(JSON.stringify({ tenantId, provider, secrets })).toString("base64");
    return Promise.resolve(`stub:${body}`);
  }

  open(
    tenantId: string,
    provider: PaymentProviderKey,
    sealed: string,
  ): Promise<Readonly<Record<string, string>>> {
    const parsed = JSON.parse(Buffer.from(sealed.replace(/^stub:/, ""), "base64").toString()) as {
      tenantId: string;
      provider: string;
      secrets: Record<string, string>;
    };
    if (parsed.tenantId !== tenantId || parsed.provider !== provider) {
      return Promise.reject(new Error("Merchant payment credentials could not be opened"));
    }
    return Promise.resolve(parsed.secrets);
  }
}
