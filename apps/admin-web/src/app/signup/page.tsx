import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, Input, Label, cn, focusRing } from "@platform/ui";
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
  "site-type": "Choose what you're building / اختار نوع موقعك",
  unavailable:
    "Opening new stores isn't available right now — try again later / فتح متاجر جديدة مش متاح دلوقتي، حاول تاني بعدين",
};

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-10 w-full rounded-xl border px-3.5 text-sm transition-colors ease-out";

const SITE_TYPE_OPTIONS = [
  {
    value: "store",
    title: "Online store / متجر إلكتروني",
    help: "Sell products with a cart and cash on delivery / بيع منتجات بسلة ودفع عند الاستلام",
  },
  {
    value: "lead_site",
    title: "Lead website / موقع لجمع العملاء",
    help: "Collect enquiries through a form, WhatsApp and calls / استقبل طلبات العملاء من فورم وواتساب واتصال",
  },
] as const;

/** One bordered card per option; the whole card is the label. Checked = thicker primary border plus the filled radio dot. */
const SITE_TYPE_CARD_CLASS =
  "border-border bg-card hover:border-foreground/40 has-[:checked]:border-primary has-[:checked]:ring-primary duration-(--duration-fast) flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-start leading-normal transition-colors ease-out has-[:checked]:ring-1";

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
            <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className="text-foreground mb-2 p-0 text-base font-medium">
                What are you building? / بتعمل إيه؟
              </legend>
              {SITE_TYPE_OPTIONS.map((option, index) => (
                <Label key={option.value} className={SITE_TYPE_CARD_CLASS}>
                  <input
                    type="radio"
                    name="siteType"
                    value={option.value}
                    required={index === 0}
                    aria-labelledby={`siteType-${option.value}-title`}
                    aria-describedby={`siteType-${option.value}-help`}
                    className={cn("accent-primary mt-0.5 size-4 shrink-0", focusRing)}
                  />
                  <span className="flex flex-col gap-1">
                    <span id={`siteType-${option.value}-title`} className="text-sm font-medium">
                      {option.title}
                    </span>
                    <span
                      id={`siteType-${option.value}-help`}
                      className="text-muted-foreground text-sm font-normal"
                    >
                      {option.help}
                    </span>
                  </span>
                </Label>
              ))}
              <p className="text-muted-foreground text-sm">
                You can&apos;t change this later / مش هتقدر تغيّر النوع بعد كده
              </p>
            </fieldset>
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
