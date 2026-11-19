import { describe, expect, it } from "vitest";
import { EnvelopeCipher, KeyAliasRegistry } from "@platform/secrets";
import {
  EnvelopeOutreachCredentialVault,
  InMemoryOutreachCredentialVault,
  OUTREACH_CREDENTIALS_KEY_ALIAS,
} from "./envelope-outreach-credential-vault";

import { LocalKeyWrapCipher } from "@platform/secrets/testing";

function realVault(): EnvelopeOutreachCredentialVault {
  const aliases = new KeyAliasRegistry();
  aliases.set(OUTREACH_CREDENTIALS_KEY_ALIAS, "test-outreach-key-not-real");
  return new EnvelopeOutreachCredentialVault(
    new EnvelopeCipher(new LocalKeyWrapCipher(), aliases),
    OUTREACH_CREDENTIALS_KEY_ALIAS,
  );
}

describe("outreach vault", () => {
  it("encrypts and verifies tenant, purpose, and envelope integrity", async () => {
    expect.hasAssertions();
    const vault = realVault();
    const sealed = await vault.seal("one", "whatsapp", { token: "secret" });
    expect(vault.backing).toBe("real");
    expect(OUTREACH_CREDENTIALS_KEY_ALIAS).toBe("outreach-credentials");
    expect(sealed).not.toContain("secret");
    expect(await vault.open("one", "whatsapp", sealed)).toEqual({ token: "secret" });
    for (const [tenant, purpose, value] of [
      ["two", "whatsapp", sealed],
      ["one", "other", sealed],
      ["one", "whatsapp", "{}"],
    ] as const) {
      await expect(vault.open(tenant, purpose as "whatsapp", value)).rejects.toThrow(
        "Outreach credentials could not be opened",
      );
    }
    const envelope = JSON.parse(sealed) as Record<string, unknown>;
    await expect(
      vault.open("one", "whatsapp", JSON.stringify({ ...envelope, ciphertext: "tampered" })),
    ).rejects.toThrow("Outreach credentials could not be opened");
  });
  it("isolates stub credentials by tenant and purpose", async () => {
    expect.hasAssertions();
    const vault = new InMemoryOutreachCredentialVault();
    const sealed = await vault.seal("one", "whatsapp", { token: "secret" });
    expect(vault.backing).toBe("stub");
    expect(await vault.open("one", "whatsapp", sealed)).toEqual({ token: "secret" });
    await expect(vault.open("two", "whatsapp", sealed)).rejects.toThrow(
      "Outreach credentials could not be opened",
    );
    await expect(vault.open("one", "other" as "whatsapp", sealed)).rejects.toThrow(
      "Outreach credentials could not be opened",
    );
    await expect(vault.open("one", "whatsapp", "broken")).rejects.toThrow(
      "Outreach credentials could not be opened",
    );
  });
});
