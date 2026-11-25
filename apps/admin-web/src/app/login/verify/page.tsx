import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MFA_CHALLENGE_COOKIE } from "@/lib/auth/mfa-cookies";
import { isNativeAuth } from "@/lib/auth/native";
import { VerifyCodeForm } from "./verify-code-form";

/** Defence in depth: the page never carries a secret in its URL, but nothing here needs a Referer either. */
export const metadata = { referrer: "no-referrer" };

/**
 * Wave 1e: the sign-in code step. Reached only after the password was right and the member has two-step
 * on: the signed challenge sits in an httpOnly cookie (never in this URL or this HTML). Without that
 * cookie there is nothing to continue, so the person goes back to the form; `?error=expired` is the
 * same dead end with a message.
 */
export default async function LoginVerifyPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly error?: string; readonly return_to?: string }>;
}) {
  if (!isNativeAuth()) redirect("/login");
  const { error, return_to: returnTo } = await searchParams;
  if (error === "expired") redirect("/login?error=expired");
  const challenge = (await cookies()).get(MFA_CHALLENGE_COOKIE)?.value;
  if (challenge === undefined || challenge.length === 0) redirect("/login");
  return <VerifyCodeForm error={error} returnTo={returnTo} />;
}
