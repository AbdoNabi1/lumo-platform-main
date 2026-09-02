"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@platform/ui";
import { signOut, signOutEverywhere } from "@/app/account/actions";
import type { Dictionary } from "@/messages/en";

/**
 * Sign-out controls (T5.17 Part A). Both call Server Actions that revoke the session on the server
 * FIRST and only then clear the cookie — this component cannot clear it either way, since the cookie
 * is `httpOnly`. That ordering is the whole point: a client-side "log out" that only forgot a token
 * would leave a live, unrevoked session behind.
 *
 * "Sign out of all devices" is `RevokeAllSessions`, reused verbatim from the same Security use case
 * the admin console's `RevokeAllSessionsForm` already drives.
 */
export function SignOutButton({ t }: { readonly t: Dictionary }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [scope, setScope] = useState<"this" | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(everywhere: boolean): void {
    setScope(everywhere ? "all" : "this");
    setError(null);
    startTransition(async () => {
      const result = everywhere ? await signOutEverywhere() : await signOut();
      if (!result.ok) {
        setError(t.account.errors[result.reason]);
        setScope(null);
        return;
      }
      router.push("/account/login");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          loading={isPending && scope === "this"}
          onClick={() => run(false)}
        >
          {isPending && scope === "this" ? t.account.signOut.submitting : t.account.signOut.submit}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          loading={isPending && scope === "all"}
          onClick={() => run(true)}
        >
          {isPending && scope === "all"
            ? t.account.signOut.everywhereSubmitting
            : t.account.signOut.everywhere}
        </Button>
      </div>
      {error !== null && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
