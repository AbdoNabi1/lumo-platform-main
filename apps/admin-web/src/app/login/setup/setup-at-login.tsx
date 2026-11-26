"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Card, CardContent, Label } from "@platform/ui";
import { AuthCodeInput, useAuthCode } from "@/components/auth/auth-code-input";
import { BackupCodesBlock, type BackupCodesLabels } from "@/components/auth/backup-codes-block";
import { SetupKeyBlock, type SetupKeyLabels } from "@/components/auth/setup-key-block";
import { BrandMark } from "@/components/brand-mark";
import { isBackupCodesBody, isTwoStepSetup, type TwoStepSetup } from "@/lib/staff/two-step";

/**
 * Every line carries both languages, like the other sign-in pages (nobody here has a locale cookie yet).
 * The sentences the plan fixed: "Your store requires two-step verification. Set it up now." and the three
 * answers to a code (wrong, too many, expired).
 */
const TEXT = {
  intro:
    "Your store requires two-step verification. Set it up now. / متجرك بيطلب التحقق بخطوتين. جهّزه دلوقتي.",
  loading: "Preparing your setup… / بنجهّز الإعداد…",
  step1:
    "Add this key to an authenticator app such as Google Authenticator, 1Password or Authy. / ضيف المفتاح ده في تطبيق مصادقة زي Google Authenticator أو 1Password أو Authy.",
  step2:
    "Then enter the 6-digit code the app shows. / بعدها اكتب الكود المكوّن من 6 أرقام اللي بيظهر في التطبيق.",
  codeLabel: "Authentication code / كود المصادقة",
  hint: "The 6-digit number from your app — not the setup key / الرقم المكوّن من 6 أرقام من تطبيقك — مش مفتاح الإعداد",
  keyWarning:
    "This looks like the setup key. Enter the 6-digit number your app shows. / ده شكله مفتاح الإعداد. اكتب الرقم المكوّن من 6 أرقام اللي بيظهره التطبيق.",
  confirm: "Confirm / تأكيد",
  confirming: "Checking… / بنتحقق…",
  wrongCode:
    "That code didn't work. Enter the 6-digit number your app shows now. / الكود ده مش صح. اكتب الرقم المكوّن من 6 أرقام اللي بيظهره التطبيق دلوقتي.",
  limited:
    "Too many attempts. Wait a few minutes and try again. / محاولات كتير. استنى كام دقيقة وجرّب تاني.",
  unavailable: "Sign-in is temporarily unavailable / الدخول غير متاح مؤقتاً",
  retry: "Try again / جرّب تاني",
  back: "Back to sign in / رجوع لتسجيل الدخول",
  codesTitle: "Save your backup codes / احفظ أكواد الطوارئ",
  codesBody:
    "Each code works once if you can't use your authenticator app. They won't be shown again. / كل كود بيشتغل مرة واحدة لو مقدرتش تستخدم تطبيق المصادقة. مش هتظهر تاني.",
  leaving: "Taking you to your dashboard… / بنوديك للوحة التحكم…",
} as const;

const KEY_LABELS: SetupKeyLabels = {
  keyLabel: "Setup key / مفتاح الإعداد",
  copy: "Copy key / انسخ المفتاح",
  copied: "Copied / اتنسخ",
  openInApp: "Open in authenticator app / افتح في تطبيق المصادقة",
};

const CODES_LABELS: BackupCodesLabels = {
  listLabel: "Backup codes / أكواد الطوارئ",
  copyAll: "Copy all / انسخ الكل",
  copied: "Copied / اتنسخ",
  download: "Download .txt / نزّل .txt",
  fileHeading: "Morbeh backup codes / أكواد طوارئ مربح",
  savedLabel: "I saved my backup codes / حفظت أكواد الطوارئ",
  done: "Continue to dashboard / كمّل للوحة التحكم",
};

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "setup"; readonly setup: TwoStepSetup }
  | { readonly kind: "codes"; readonly codes: readonly string[] }
  | { readonly kind: "leaving" };

const START_URL = "/auth/native-login/setup/start";
const CONFIRM_URL = "/auth/native-login/setup/confirm";

function goTo(url: string): void {
  window.location.assign(url);
}

/** What the route handler said went wrong: its `error` kind, read leniently. */
async function errorKindOf(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const kind =
    typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null;
  return typeof kind === "string" ? kind : "unavailable";
}

async function post(url: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return null;
  }
}

/**
 * Wave 1f: the setup-at-sign-in screen. Step 1 fetches the key from the start route handler (the signed
 * setup challenge never leaves its httpOnly cookie) and shows it with the link and the code field; step 2
 * shows the 10 backup codes once. The confirm route handler sets the session cookie itself and returns only
 * the backup codes, so no access token ever reaches this component; "Continue" just navigates. The key
 * and the codes live only in this component's state and are dropped the moment it leaves.
 */
export function SetupAtLogin({
  returnTo,
  navigate = goTo,
}: {
  readonly returnTo: string;
  /** Where Continue goes; the browser's own navigation unless a test supplies one. */
  readonly navigate?: (url: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const confirmingRef = useRef(false);
  const started = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const code = useAuthCode();

  function expired(): void {
    navigate("/login?error=expired");
  }

  async function start(): Promise<void> {
    setPhase({ kind: "loading" });
    const response = await post(START_URL, {});
    if (response === null) return setPhase({ kind: "failed", message: TEXT.unavailable });
    if (response.ok) {
      const body: unknown = await response.json().catch(() => null);
      if (isTwoStepSetup(body)) return setPhase({ kind: "setup", setup: body });
      return setPhase({ kind: "failed", message: TEXT.unavailable });
    }
    const kind = await errorKindOf(response);
    if (kind === "expired") return expired();
    setPhase({ kind: "failed", message: kind === "limited" ? TEXT.limited : TEXT.unavailable });
  }

  const startNow = useRef(start);
  startNow.current = start;
  useEffect(() => {
    // One start per visit: a second one would leave the first enrolment pending and spend the limit.
    if (started.current) return;
    started.current = true;
    void startNow.current();
  }, []);

  useEffect(() => {
    if (phase.kind === "codes") heading.current?.focus();
  }, [phase.kind]);

  async function confirm(setup: TwoStepSetup): Promise<void> {
    if (confirmingRef.current || !code.ready) return;
    confirmingRef.current = true;
    setConfirming(true);
    setError(null);
    const response = await post(CONFIRM_URL, {
      enrollmentId: setup.enrollmentId,
      code: code.value,
    });
    confirmingRef.current = false;
    setConfirming(false);
    if (response === null) return setError(TEXT.unavailable);
    if (response.ok) {
      const body: unknown = await response.json().catch(() => null);
      code.clear();
      if (isBackupCodesBody(body)) return setPhase({ kind: "codes", codes: body.backupCodes });
      // The session cookie is already set but the codes did not arrive: say so rather than show nothing.
      return setPhase({ kind: "failed", message: TEXT.unavailable });
    }
    const kind = await errorKindOf(response);
    if (kind === "expired") return expired();
    code.clear();
    setError(
      kind === "limited"
        ? TEXT.limited
        : kind === "unavailable"
          ? TEXT.unavailable
          : TEXT.wrongCode,
    );
  }

  function carryOn(): void {
    // Drop the codes from the page before leaving it; the session cookie is already set.
    setPhase({ kind: "leaving" });
    navigate(returnTo);
  }

  return (
    <main className="lumo-canvas flex min-h-dvh items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col gap-4 pt-8">
          <div className="mb-2 flex items-center gap-2.5">
            <BrandMark />
            <span className="text-foreground text-xl font-semibold tracking-tight">
              Morbeh Admin
            </span>
          </div>

          {phase.kind === "loading" && (
            <p role="status" className="text-muted-foreground text-sm">
              {TEXT.loading}
            </p>
          )}

          {phase.kind === "failed" && (
            <>
              <div
                role="alert"
                className="bg-destructive-subtle text-destructive-subtle-foreground rounded-xl px-3.5 py-2.5 text-sm"
              >
                <p>{phase.message}</p>
              </div>
              <div>
                <Button type="button" variant="outline" onClick={() => void start()}>
                  {TEXT.retry}
                </Button>
              </div>
            </>
          )}

          {phase.kind === "setup" && (
            <>
              <p className="text-sm font-medium">{TEXT.intro}</p>
              <p className="text-sm">{TEXT.step1}</p>
              <SetupKeyBlock setup={phase.setup} labels={KEY_LABELS} />
              <p className="text-sm">{TEXT.step2}</p>
              <form
                className="flex flex-col gap-3"
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  void confirm(phase.setup);
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="setup-code">{TEXT.codeLabel}</Label>
                  <AuthCodeInput
                    id="setup-code"
                    code={code}
                    hint={TEXT.hint}
                    keyWarning={TEXT.keyWarning}
                  />
                </div>
                {error !== null && (
                  <p role="alert" className="text-destructive text-sm">
                    {error}
                  </p>
                )}
                <Button type="submit" loading={confirming} disabled={confirming || !code.ready}>
                  {confirming ? TEXT.confirming : TEXT.confirm}
                </Button>
              </form>
            </>
          )}

          {phase.kind === "codes" && (
            <>
              <h1 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
                {TEXT.codesTitle}
              </h1>
              <p className="text-sm">{TEXT.codesBody}</p>
              <BackupCodesBlock codes={phase.codes} labels={CODES_LABELS} onDone={carryOn} />
            </>
          )}

          {phase.kind === "leaving" && (
            <p role="status" className="text-muted-foreground text-sm">
              {TEXT.leaving}
            </p>
          )}

          {phase.kind !== "codes" && phase.kind !== "leaving" && (
            <p className="text-center text-sm">
              <Link href="/login" className="text-muted-foreground underline">
                {TEXT.back}
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
