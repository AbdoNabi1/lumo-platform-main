import { Button, Card, CardContent, Input, Label } from "@platform/ui";
import { BrandMark } from "@/components/brand-mark";

/** Plan 1B-2: the plain email/password form shown when AUTH_MODE=native (no Ory, no Kratos flow). */
const ERROR_TEXT: Readonly<Record<string, string>> = {
  invalid: "Email or password is incorrect / الإيميل أو كلمة السر غلط",
  mfa: "Two-step verification is required / مطلوب تحقق بخطوتين",
  unavailable: "Sign-in is temporarily unavailable / الدخول غير متاح مؤقتاً",
};

export function NativeLoginForm({
  error,
  returnTo,
}: {
  readonly error: string | undefined;
  readonly returnTo: string | undefined;
}) {
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
          <p className="text-muted-foreground -mt-4 mb-6 text-sm">Sign in to continue.</p>

          {message !== undefined && (
            <div
              role="alert"
              className="bg-destructive-subtle text-destructive-subtle-foreground mb-4 rounded-xl px-3.5 py-2.5 text-sm"
            >
              <p>{message}</p>
            </div>
          )}

          <form action="/auth/native-login" method="post" className="flex flex-col gap-4">
            <input type="hidden" name="return_to" defaultValue={returnTo ?? "/"} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" name="email" required autoComplete="username" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                name="password"
                required
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="mt-2 w-full">
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
