"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@platform/ui";
import { completeAccountSignup } from "@/app/account/actions";
import type { Dictionary } from "@/messages/en";

/**
 * The signup-completion form (G-72): reads the token from the URL (passed in as a prop by the
 * Server Component page, never rendered into a link or logged from here) and collects only a name
 * and a password — the two fields `completeAccountSignup` needs. Same discipline as `AuthForm`:
 * the password lives in React state for exactly as long as the input is mounted, is sent straight
 * to a Server Action, and is never stored, echoed, or put in the URL.
 */
export function SignupCompleteForm({
  token,
  t,
}: {
  readonly token: string;
  readonly t: Dictionary;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function messageFor(
    reason: "invalid-token" | "credentials" | "conflict" | "validation" | "mfa" | "network",
  ): string {
    return reason === "invalid-token" ? t.account.errors.invalidToken : t.account.errors[reason];
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await completeAccountSignup(token, name, password);
      if (!result.ok) {
        setError(messageFor(result.reason));
        return;
      }
      setPassword("");
      router.push("/account");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-complete-name">{t.account.signup.nameLabel}</Label>
        <Input
          id="signup-complete-name"
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-complete-password">{t.account.signup.passwordLabel}</Label>
        <Input
          id="signup-complete-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="text-muted-foreground text-xs">{t.account.signup.passwordHint}</p>
      </div>

      {error !== null && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={isPending} loading={isPending}>
        {isPending ? t.account.signup.submitting : t.account.signup.submit}
      </Button>
    </form>
  );
}
