import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, CardContent, Input, Label } from "@platform/ui";
import { BrandMark } from "@/components/brand-mark";
import { isNativeAuth } from "@/lib/auth/native";

/** The link carries a secret token in its query string: never send it on as a Referer header. */
export const metadata = { referrer: "no-referrer" };

/** Wave 1d: an invited staff member chooses a password with the emailed single-use link. Native sign-in only. */
const ERROR_TEXT: Readonly<Record<string, string>> = {
  invalid:
    "This invitation link is invalid or has expired. Ask the store admin to resend it. / رابط الدعوة غير صالح أو انتهت صلاحيته. اطلب من مدير المتجر إعادة إرساله.",
  mismatch: "The two passwords do not match / كلمتا السر مش متطابقتين",
  weak: "Password must be 8–256 characters / كلمة السر لازم تكون من 8 لـ 256 حرف",
  limited: "Too many attempts. Try again later. / محاولات كتير، حاول تاني بعدين",
  unavailable: "Try again later / حاول تاني بعدين",
};

export default async function AcceptInvitePage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly token?: string;
    readonly store?: string;
    readonly error?: string;
  }>;
}) {
  if (!isNativeAuth()) redirect("/login");
  const { token, store, error } = await searchParams;
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
            You&apos;re invited. Choose a password. / تمت دعوتك. اختار كلمة سر.
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
              <Link href="/login" className="text-muted-foreground underline">
                Sign in / تسجيل الدخول
              </Link>
            </p>
          ) : (
            <form action="/accept-invite/submit" method="post" className="flex flex-col gap-4">
              <input type="hidden" name="token" defaultValue={token} />
              {store !== undefined && store.length > 0 && (
                <input type="hidden" name="store" defaultValue={store} />
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password / كلمة السر</Label>
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
                Create my account / أنشئ حسابي
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
