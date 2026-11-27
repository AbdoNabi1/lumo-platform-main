import { EnvelopeCipher, KeyAliasRegistry } from "@platform/secrets";
import { LocalKeyWrapCipher } from "@platform/secrets/testing";
import { EnvelopePaymentCredentialVault } from "../infrastructure/envelope-payment-credential-vault";

/**
 * A real envelope vault over `@platform/secrets/testing`'s local AES cipher — genuine encryption,
 * test KEK. TEST DOUBLE ONLY.
 */
export function testEnvelopeVault(
  kek = "test-kek-not-a-real-secret",
): EnvelopePaymentCredentialVault {
  const aliases = new KeyAliasRegistry();
  aliases.set("payments-credentials", kek);
  return new EnvelopePaymentCredentialVault(
    new EnvelopeCipher(new LocalKeyWrapCipher(), aliases),
    "payments-credentials",
  );
}
