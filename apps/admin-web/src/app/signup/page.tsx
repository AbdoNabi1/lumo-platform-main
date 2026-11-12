import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, Input, Label } from "@platform/ui";
import { BrandMark } from "@/components/brand-mark";
import { signupEnabled } from "@/lib/auth/merchant";
import { isNativeAuth } from "@/lib/auth/native";
import { SignupSubmitButton } from "./signup-submit-button";

/** The public "Open your store" page. Only exists when native sign-in AND ADMIN_SIGNUP_ENABLED are on. */
const ERROR_TEXT: Readonly<Record<string, string>> = {
  taken:
    "This email already has a store — sign in instead / الإيميل ده عنده متجر بالفعل، سجّل دخول",
  limited: "Too many attempts, try again later / محاولات كتير، حاول تاني بعدين",
  invalid:
    "Check your details: store name 2–60 characters, a valid email, password at least 8 characters / راجع بياناتك: اسم المتجر من 2 لـ 60 حرف، إيميل صحيح، وكلمة سر 8 حروف على الأقل",
  unavailable:
    "Opening new stores isn't available right now — try again later / فتح متاجر جديدة مش متاح دلوقتي، حاول تاني بعدين",
};

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-10 w-full rounded-xl border px-3.5 text-sm transition-colors ease-out";

export default async function SignupPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly error?: string }>;
}) {
  if (!isNativeAuth() || !signupEnabled()) notFound();
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
          <p className="text-muted-foreground -mt-4 mb-6 text-sm">Open your store / افتح متجرك</p>

          {message !== undefined && (
            <div
              role="alert"
              className="bg-destructive-subtle text-destructive-subtle-foreground mb-4 rounded-xl px-3.5 py-2.5 text-sm"
            >
              <p>{message}</p>
            </div>
          )}

          <form action="/auth/signup" method="post" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="storeName">Store name / اسم المتجر</Label>
              <Input
                id="storeName"
                type="text"
                name="storeName"
                required
                minLength={2}
                maxLength={60}
                autoComplete="organization"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email / الإيميل</Label>
              <Input id="email" type="email" name="email" required autoComplete="username" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">
                Password (8+ characters) / كلمة السر (8 حروف على الأقل)
              </Label>
              <Input
                id="password"
                type="password"
                name="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="country">Country / البلد</Label>
              <select id="country" name="country" defaultValue="EG" className={SELECT_CLASS}>
                <option value="EG">Egypt / مصر</option>
                <option value="SA">Saudi Arabia / السعودية</option>
                <option value="AE">UAE / الإمارات</option>
              </select>
            </div>
            <SignupSubmitButton pendingLabel="Creating your store… / بنجهّز متجرك…">
              Create store / افتح المتجر
            </SignupSubmitButton>
          </form>
          <p className="mt-4 text-center text-sm">
            <Link href="/login" className="text-muted-foreground underline">
              Already have a store? Sign in / عندك متجر؟ سجّل دخول
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
