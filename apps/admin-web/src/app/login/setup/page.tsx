import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MFA_SETUP_COOKIE } from "@/lib/auth/mfa-cookies";
import { isNativeAuth } from "@/lib/auth/native";
import { safeReturnTo } from "@/lib/auth/safe-return-to";
import { SetupAtLogin } from "./setup-at-login";

/** The page shows the setup key and the backup codes: nothing here may leave in a Referer header. */
export const metadata = { referrer: "no-referrer" };

/** `safeReturnTo` needs an origin to compare against; a root-relative path has none to leak. */
const LOCAL_ORIGIN = "http://localhost";

/**
 * Wave 1f: two-step setup at sign-in. Reached only after the password was right, the member has no
 * two-step and the platform requires it: the signed SETUP challenge sits in an httpOnly cookie (never in
 * this URL or this HTML). Without that cookie there is nothing to continue, so the person goes back to the
 * form; `?error=expired` is the same dead end with a message. The key is fetched by the client component
 * from the setup route handler, so it exists only in that component's state.
 */
export default async function LoginSetupPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly error?: string; readonly return_to?: string }>;
}) {
  if (!isNativeAuth()) redirect("/login");
  const { error, return_to: returnTo } = await searchParams;
  if (error === "expired") redirect("/login?error=expired");
  const challenge = (await cookies()).get(MFA_SETUP_COOKIE)?.value;
  if (challenge === undefined || challenge.length === 0) redirect("/login");
  return <SetupAtLogin returnTo={safeReturnTo(returnTo, LOCAL_ORIGIN)} />;
}
