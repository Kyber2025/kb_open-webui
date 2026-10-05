// Client-side checks for the email-code sign-up and password-reset forms. The
// account service applies the same rules; checking first keeps a typo from
// spending a code attempt.
export const PASSWORD_MIN = 8;
export const RESEND_FALLBACK_SEC = 60;

export const isEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** Keep only the digits of a pasted or typed code, at most six. */
export const codeDigits = (value: string) =>
  value.replace(/\D/g, "").slice(0, 6);

export function verifyProblem(form: {
  code: string;
  password: string;
  confirm: string;
}): string | null {
  if (!/^\d{6}$/.test(form.code))
    return "Enter the 6-digit code from the email.";
  if (form.password.length < PASSWORD_MIN)
    return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (form.password !== form.confirm) return "Passwords do not match.";
  return null;
}
