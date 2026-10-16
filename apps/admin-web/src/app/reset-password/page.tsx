import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, CardContent, Input, Label } from "@platform/ui";
import { BrandMark } from "@/components/brand-mark";
import { isNativeAuth } from "@/lib/auth/native";

/** The link carries a secret token in its query string: never send it on as a Referer header. */
export const metadata = { referrer: "no-referrer" };

/** Plan 1C: set a new password with the emailed token. Native sign-in only. */
const ERROR_TEXT: Readonly<Record<string, string>> = {
  invalid: "This link is invalid or has expired / اللينك غلط أو انتهت صلاحيته",
  mismatch: "The two passwords do not match / كلمتا السر مش متطابقتين",
  weak: "Password must be 8–256 characters / كلمة السر لازم تكون من 8 لـ 256 حرف",
  limited: "Too many attempts, try again later / محاولات كتير، حاول تاني بعدين",
  unavailable: "Try again later / حاول تاني بعدين",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly token?: string; readonly error?: string }>;
}) {
  if (!isNativeAuth()) redirect("/login");
  const { token, error } = await searchParams;
  const missingToken = token === undefined || token.length === 0;
  const message = missingToken
    ? ERROR_TEXT["invalid"]
    : error === undefined
      ? undefined
      : ERROR_TEXT[error];
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
            Choose a new password. / اختار كلمة سر جديدة.
          </p>

          {message !== undefined && (
            <div
              role="alert"
              className="bg-destructive-subtle text-destructive-subtle-foreground mb-4 rounded-xl px-3.5 py-2.5 text-sm"
            >
              <p>{message}</p>
            </div>
          )}

          {missingToken ? (
            <p className="text-center text-sm">
              <Link href="/forgot-password" className="text-muted-foreground underline">
                Request a new link / اطلب لينك جديد
              </Link>
            </p>
          ) : (
            <form action="/auth/reset" method="post" className="flex flex-col gap-4">
              <input type="hidden" name="token" defaultValue={token} />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">New password / كلمة السر الجديدة</Label>
                <Input
                  id="password"
                  type="password"
                  name="password"
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
              <Button type="submit" className="mt-2 w-full">
                Change password / غيّر كلمة السر
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
