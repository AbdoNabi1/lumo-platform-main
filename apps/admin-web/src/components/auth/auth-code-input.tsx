"use client";

import { useState, type Ref } from "react";
import { Input } from "@platform/ui";
import { CODE_LENGTH, CODE_PLACEHOLDER, readCodeInput } from "@/lib/auth/code-input";

/** The state of one authenticator-code field (see `lib/auth/code-input.ts`). */
export interface AuthCode {
  readonly value: string;
  /** Letters were typed or pasted: it is the setup key, not the code. Never submit while true. */
  readonly looksLikeKey: boolean;
  /** Exactly six digits and no pasted key. */
  readonly ready: boolean;
  readonly onChange: (raw: string) => void;
  readonly clear: () => void;
}

export function useAuthCode(): AuthCode {
  const [state, setState] = useState({ value: "", looksLikeKey: false });
  return {
    value: state.value,
    looksLikeKey: state.looksLikeKey,
    ready: state.value.length === CODE_LENGTH && !state.looksLikeKey,
    onChange: (raw) => setState(readCodeInput(raw)),
    clear: () => setState({ value: "", looksLikeKey: false }),
  };
}

/**
 * The authenticator-code input everywhere a six-digit code is typed: digits only (anything else is
 * stripped as it arrives, max 6), placeholder `123456`, a helper line under the field, and an inline
 * alert when what arrived contained letters (a pasted setup key). The label is the caller's; the two
 * sentences come in as strings so the bilingual sign-in pages and the locale dictionary both use it.
 */
export function AuthCodeInput({
  id,
  name,
  code,
  hint,
  keyWarning,
  required,
  inputRef,
}: {
  readonly id: string;
  readonly name?: string;
  readonly code: AuthCode;
  /** "The 6-digit number from your app — not the setup key". */
  readonly hint: string;
  /** "This looks like the setup key. Enter the 6-digit number your app shows." */
  readonly keyWarning: string;
  readonly required?: boolean;
  readonly inputRef?: Ref<HTMLInputElement>;
}) {
  const hintId = `${id}-hint`;
  const warningId = `${id}-key-warning`;
  return (
    <>
      <Input
        ref={inputRef}
        id={id}
        {...(name === undefined ? {} : { name })}
        type="text"
        dir="ltr"
        inputMode="numeric"
        autoComplete="one-time-code"
        spellCheck={false}
        placeholder={CODE_PLACEHOLDER}
        required={required === true}
        value={code.value}
        aria-invalid={code.looksLikeKey ? true : undefined}
        aria-describedby={code.looksLikeKey ? `${hintId} ${warningId}` : hintId}
        onChange={(event) => code.onChange(event.target.value)}
      />
      <p id={hintId} className="text-muted-foreground text-xs">
        {hint}
      </p>
      {code.looksLikeKey && (
        <p id={warningId} role="alert" className="text-destructive text-xs">
          {keyWarning}
        </p>
      )}
    </>
  );
}
