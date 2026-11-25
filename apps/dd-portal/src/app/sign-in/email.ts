export const WORK_EMAIL_FIRST = "Enter your work email first";
export const PASSKEY_FAILED = "That didn't work. Try again, or use an email code.";
export const PASSKEY_WAITING = "Waiting for your passkey…";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SignInStep =
  | { type: "email"; message: typeof WORK_EMAIL_FIRST }
  | { type: "code"; email: string }
  | { type: "passkey"; email: string };

/** Shared gate for both sign-in buttons. An empty or invalid address never leaves the page. */
export function signInStep(kind: "code", value: string): { type: "email"; message: typeof WORK_EMAIL_FIRST } | { type: "code"; email: string };
export function signInStep(kind: "passkey", value: string): { type: "email"; message: typeof WORK_EMAIL_FIRST } | { type: "passkey"; email: string };
export function signInStep(kind: "code" | "passkey", value: string): SignInStep;
export function signInStep(kind: "code" | "passkey", value: string): SignInStep {
  const email = value.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return { type: "email", message: WORK_EMAIL_FIRST };
  return kind === "code" ? { type: "code", email } : { type: "passkey", email };
}
