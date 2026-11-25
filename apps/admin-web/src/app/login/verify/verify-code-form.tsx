"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, Card, CardContent, Input, Label } from "@platform/ui";
import { BrandMark } from "@/components/brand-mark";

/** Errors by `?error=`. The sign-in pages are not locale-switched: every line carries both languages. */
const ERROR_TEXT: Readonly<Record<string, string>> = {
  code: "That code didn't work. Try again. / الكود ده مش صح. جرّب تاني.",
  limited:
    "Too many attempts. Wait a few minutes and try again. / محاولات كتير. استنى كام دقيقة وجرّب تاني.",
  unavailable: "Sign-in is temporarily unavailable / الدخول غير متاح مؤقتاً",
};

/**
 * Wave 1e: the one-field code form. The authenticator code is numeric (`one-time-code` lets the phone
 * offer it); a backup code is typed as text (`xxxx-xxxx-xxxx`). The form posts to the route handler,
 * which reads the signed challenge from its httpOnly cookie: nothing secret is in this markup.
 */
export function VerifyCodeForm({
  error,
  returnTo,
}: {
  readonly error: string | undefined;
  readonly returnTo: string | undefined;
}) {
  const [backup, setBackup] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The one field is the whole page: focus it on arrival and whenever the kind of code changes.
  useEffect(() => {
    input.current?.focus();
  }, [backup]);
  const message = error === undefined ? undefined : ERROR_TEXT[error];
  return (
    <main className="lumo-canvas flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-8">
          <div className="mb-6 flex items-center gap-2.5">
            <BrandMark />
            <span className="text-foreground text-xl font-semibold tracking-tight">
              Morbeh Admin
            </span>
          </div>
          <p className="text-muted-foreground -mt-4 mb-6 text-sm">
            {backup
              ? "Enter one of your backup codes. / اكتب واحد من أكواد الطوارئ."
              : "Enter the code from your authenticator app. / اكتب الكود من تطبيق المصادقة."}
          </p>

          {message !== undefined && (
            <div
              role="alert"
              className="bg-destructive-subtle text-destructive-subtle-foreground mb-4 rounded-xl px-3.5 py-2.5 text-sm"
            >
              <p>{message}</p>
            </div>
          )}

          <form action="/auth/native-login/verify" method="post" className="flex flex-col gap-4">
            <input type="hidden" name="return_to" defaultValue={returnTo ?? "/"} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="code">
                {backup ? "Backup code / كود الطوارئ" : "Authentication code / كود المصادقة"}
              </Label>
              <Input
                key={backup ? "backup" : "totp"}
                ref={input}
                id="code"
                name="code"
                required
                dir="ltr"
                {...(backup
                  ? { type: "text", autoComplete: "off", maxLength: 32, spellCheck: false }
                  : {
                      type: "text",
                      inputMode: "numeric" as const,
                      autoComplete: "one-time-code",
                      maxLength: 8,
                      pattern: "[0-9 ]*",
                    })}
              />
            </div>
            <Button type="submit" className="mt-2 w-full">
              Verify / تأكيد
            </Button>
          </form>
          <p className="mt-4 text-center text-sm">
            <button
              type="button"
              aria-pressed={backup}
              className="text-muted-foreground underline"
              onClick={() => setBackup((current) => !current)}
            >
              {backup
                ? "Use the authenticator app instead / استخدم تطبيق المصادقة بدلاً من كده"
                : "Use a backup code / استخدم كود طوارئ"}
            </button>
          </p>
          <p className="mt-2 text-center text-sm">
            <Link href="/login" className="text-muted-foreground underline">
              Back to sign in / رجوع لتسجيل الدخول
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
