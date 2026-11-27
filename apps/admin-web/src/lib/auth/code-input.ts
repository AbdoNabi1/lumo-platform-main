/**
 * Wave 1f — the authenticator-code field. The code is exactly six digits; anything else typed or pasted
 * is dropped as it arrives. A value that contained LETTERS is the signature of a pasted setup key (the
 * mistake seen in production on 2026-11-26): the caller shows "this looks like the setup key" and does
 * not submit until the field changes again. Pure: shared by every code input (sign-in code step, account
 * setup, setup at sign-in, new backup codes).
 */
export const CODE_LENGTH = 6;

/** Placeholder for the authenticator-code field (digits, so identical in every locale). */
export const CODE_PLACEHOLDER = "123456";

export interface CodeInputState {
  /** At most six digits, nothing else. */
  readonly value: string;
  /** The raw input held letters: a pasted setup key, not a code. */
  readonly looksLikeKey: boolean;
}

/** Arabic-Indic and Persian digits, as a keyboard in those layouts types them, to Latin digits. */
function latinDigits(raw: string): string {
  return raw.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

export function readCodeInput(raw: string): CodeInputState {
  const latin = latinDigits(raw);
  return {
    value: latin.replace(/\D/g, "").slice(0, CODE_LENGTH),
    looksLikeKey: /\p{L}/u.test(latin),
  };
}
