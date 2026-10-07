import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, CardContent, Input, Label } from "@platform/ui";
import { BrandMark } from "@/components/brand-mark";
import { isNativeAuth } from "@/lib/auth/native";

/** Plan 1C: "forgot password". Native sign-in only; always answers with the same neutral notice. */
const ERROR_TEXT: Readonly<Record<string, string>> = {
  limited: "Too many requests, try again later / طلبات كتير، حاول تاني بعدين",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly error?: string }>;
}) {
  if (!isNativeAuth()) redirect("/login");
  const { error } = await searchParams;
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
            Enter your email and we will send a reset link, if the account exists. / اكتب إيميلك
            وهنبعتلك لينك إعادة التعيين لو الحساب موجود.
          </p>

          {message !== undefined && (
            <div
              role="alert"
              className="bg-destructive-subtle text-destructive-subtle-foreground mb-4 rounded-xl px-3.5 py-2.5 text-sm"
            >
              <p>{message}</p>
            </div>
          )}

          <form action="/auth/forgot" method="post" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" name="email" required autoComplete="username" />
            </div>
            <Button type="submit" className="mt-2 w-full">
              Send reset link / ابعت اللينك
            </Button>
          </form>
          <p className="mt-4 text-center text-sm">
            <Link href="/login" className="text-muted-foreground underline">
              Back to sign in / رجوع للدخول
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
