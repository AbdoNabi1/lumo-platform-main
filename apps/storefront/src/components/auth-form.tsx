"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@platform/ui";
import { registerAccount, signIn } from "@/app/account/actions";
import type { Dictionary } from "@/messages/en";

/**
 * The storefront's sign-in / create-account form (T5.17 Part A). One component for both modes: they
 * differ by exactly one field and which Server Action they call, and splitting them would duplicate
 * the state, error mapping and submit handling three ways for no benefit.
 *
 * A Client Component only because it needs pending/error state — it holds NO session state of its
 * own. The password lives in React state for exactly as long as the input is mounted, is sent to a
 * Server Action, and is never stored, echoed, or put in the URL. The form deliberately does not
 * `console.log` its input, and the actions it calls never return it.
 *
 * The session cookie is written by the Server Action, server-side — this component never receives a
 * session id, which is what keeps the cookie `httpOnly` and unreachable from browser JavaScript.
 */
export function AuthForm({
  mode,
  t,
}: {
  readonly mode: "sign-in" | "register";
  readonly t: Dictionary;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** G-72: set when `registerAccount` returns the D2 "check your email" outcome — the shopper is not signed in yet, so the form gives way to a notice instead of redirecting. */
  const [checkEmailSent, setCheckEmailSent] = useState(false);

  const copy = mode === "sign-in" ? t.account.signIn : t.account.register;

  function messageFor(
    reason: "credentials" | "conflict" | "validation" | "mfa" | "network",
  ): string {
    return t.account.errors[reason];
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result =
        mode === "register"
          ? await registerAccount(email, name, password)
          : await signIn(email, password);

      if (!result.ok) {
        setError(messageFor(result.reason));
        return;
      }
      // Clear the credential from client memory the moment it is no longer needed.
      setPassword("");
      if ("checkEmail" in result && result.checkEmail) {
        setCheckEmailSent(true);
        return;
      }
      router.push("/account");
      router.refresh();
    });
  }

  if (checkEmailSent) {
    return (
      <div className="flex flex-col gap-2" role="status">
        <h2 className="text-lg font-medium">{t.account.signup.checkEmailTitle}</h2>
        <p className="text-muted-foreground text-sm">{t.account.signup.checkEmailBody}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {mode === "register" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-name">{t.account.register.nameLabel}</Label>
          <Input
            id="account-name"
            name="name"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="account-email">{copy.emailLabel}</Label>
        <Input
          id="account-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="account-password">{copy.passwordLabel}</Label>
        <Input
          id="account-password"
          name="password"
          type="password"
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {mode === "register" && (
          <p className="text-muted-foreground text-xs">{t.account.register.passwordHint}</p>
        )}
      </div>

      {error !== null && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={isPending} loading={isPending}>
        {isPending ? copy.submitting : copy.submit}
      </Button>

      <p className="text-muted-foreground text-sm">
        {mode === "sign-in" ? t.account.signIn.noAccount : t.account.register.hasAccount}{" "}
        <Link
          href={mode === "sign-in" ? "/account/register" : "/account/login"}
          className="text-foreground underline"
        >
          {mode === "sign-in" ? t.account.signIn.registerLink : t.account.register.signInLink}
        </Link>
      </p>
    </form>
  );
}
