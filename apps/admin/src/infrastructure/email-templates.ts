/** Plan 1C: plain-text, bilingual (Arabic first, then English). */
export function passwordResetEmail(link: string): { subject: string; text: string } {
  return {
    subject: "إعادة تعيين كلمة السر / Reset your password",
    text: [
      "طلبت إعادة تعيين كلمة السر للوحة تحكم مربح.",
      "افتح الرابط ده خلال 30 دقيقة (بيشتغل مرة واحدة):",
      link,
      "لو ما طلبتش ده، تجاهل الرسالة وكلمة السر هتفضل زي ما هي.",
      "",
      "You asked to reset your Morbeh admin password.",
      "Open this link within 30 minutes (it works once):",
      link,
      "If you did not ask for this, ignore this email; your password stays the same.",
    ].join("\n"),
  };
}

/**
 * Wave 1d: a teammate invitation. Plain text, Arabic first then English like the other templates.
 * The link is the ONLY place the single-use token appears, and it appears once. `storeName` is
 * `null` today (no store-name lookup), in which case the sentence simply omits it.
 */
export function staffInviteEmail(
  link: string,
  storeName: string | null,
  roleLabelEn: string,
  roleLabelAr: string,
): { subject: string; text: string } {
  const store = storeName === null || storeName.trim() === "" ? null : storeName.trim();
  return {
    subject:
      store === null
        ? "اتدعيت تنضم لفريق مربح / You're invited to join the team"
        : `اتدعيت تنضم لفريق ${store} / You're invited to join ${store}`,
    text: [
      store === null
        ? `اتدعيت تنضم لفريق المتجر على مربح بدور "${roleLabelAr}".`
        : `اتدعيت تنضم لفريق ${store} على مربح بدور "${roleLabelAr}".`,
      "افتح الرابط ده وحدد كلمة السر عشان تفعّل حسابك. الرابط بيشتغل مرة واحدة وينتهي بعد ٧ أيام.",
      "لو ما كنتش متوقع الدعوة دي، تجاهل الرسالة.",
      "",
      store === null
        ? `You've been invited to join the team on Morbeh as ${roleLabelEn}.`
        : `You've been invited to join ${store} on Morbeh as ${roleLabelEn}.`,
      "Open the link below and choose a password to activate your account. It works once and expires in 7 days.",
      "If you weren't expecting this invitation, ignore this email.",
      "",
      link,
    ].join("\n"),
  };
}

export function signupCompleteEmail(link: string): { subject: string; text: string } {
  return {
    subject: "أكمل حسابك / Complete your account",
    text: [
      "اضغط الرابط ده عشان تكمّل حسابك:",
      link,
      "",
      "Use this link to complete your account:",
      link,
    ].join("\n"),
  };
}

export function alreadyRegisteredEmail(): { subject: string; text: string } {
  return {
    subject: "عندك حساب بالفعل / You already have an account",
    text: [
      'فيه حساب بالإيميل ده بالفعل. لو نسيت كلمة السر استخدم "نسيت كلمة السر".',
      "",
      'An account with this email already exists. If you forgot the password, use "Forgot password".',
    ].join("\n"),
  };
}
