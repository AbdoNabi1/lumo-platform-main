import { EnvelopeCipher, KeyAliasRegistry } from "@platform/secrets";
import { LocalKeyWrapCipher } from "@platform/secrets/testing";
import {
  EMAIL_CREDENTIALS_KEY_ALIAS,
  EnvelopeEmailConnectionVault,
} from "../infrastructure/envelope-email-connection-vault";

/** TEST DOUBLES ONLY for the email connection suites. The cipher is `@platform/secrets/testing`'s shared one. */
export const TEST_EMAIL_KEK = "test-email-kek-not-a-real-secret";

/** A real envelope vault over a local AES cipher: genuine encryption, a test KEK, its own alias. */
export function testEmailVault(kek: string = TEST_EMAIL_KEK): EnvelopeEmailConnectionVault {
  const aliases = new KeyAliasRegistry();
  aliases.set(EMAIL_CREDENTIALS_KEY_ALIAS, kek);
  return new EnvelopeEmailConnectionVault(
    new EnvelopeCipher(new LocalKeyWrapCipher(), aliases),
    EMAIL_CREDENTIALS_KEY_ALIAS,
  );
}
