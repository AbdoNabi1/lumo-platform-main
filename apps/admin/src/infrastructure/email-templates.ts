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
