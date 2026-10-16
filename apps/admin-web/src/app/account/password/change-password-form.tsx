"use client";

import { useActionState } from "react";
import { Button, Card, CardContent, Input, Label } from "@platform/ui";
import { changePasswordAction, type ChangePasswordState } from "./actions";

const INITIAL_STATE: ChangePasswordState = { status: "idle" };

const ERROR_TEXT = {
  mismatch: "The two new passwords do not match / كلمتا السر الجديدتان مش متطابقتين",
  wrong: "Current password is wrong / كلمة السر الحالية غلط",
  weak: "New password must be 8–256 characters / كلمة السر الجديدة لازم تكون من 8 لـ 256 حرف",
  unavailable: "Try again later / حاول تاني بعدين",
} as const;

export function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState(changePasswordAction, INITIAL_STATE);
  return (
    <Card className="w-full max-w-md">
      <CardContent className="pt-6">
        {state.status === "ok" && (
          <p
            role="status"
            className="bg-success-subtle text-success-foreground mb-4 rounded-xl px-3.5 py-2.5 text-sm"
          >
            Password changed / اتغيرت كلمة السر
          </p>
        )}
        {state.status === "error" && (
          <p
            role="alert"
            className="bg-destructive-subtle text-destructive-subtle-foreground mb-4 rounded-xl px-3.5 py-2.5 text-sm"
          >
            {ERROR_TEXT[state.reason]}
          </p>
        )}
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="currentPassword">Current password / كلمة السر الحالية</Label>
            <Input
              id="currentPassword"
              type="password"
              name="currentPassword"
              required
              autoComplete="current-password"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newPassword">New password / كلمة السر الجديدة</Label>
            <Input
              id="newPassword"
              type="password"
              name="newPassword"
              required
              minLength={8}
              maxLength={256}
              autoComplete="new-password"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm">Confirm / تأكيد</Label>
            <Input
              id="confirm"
              type="password"
              name="confirm"
              required
              minLength={8}
              maxLength={256}
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" loading={isPending} disabled={isPending} className="mt-2">
            Change password / غيّر كلمة السر
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
