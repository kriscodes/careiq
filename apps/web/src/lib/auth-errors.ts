/** Deliberate, fixed UI validation messages, distinct from provider diagnostics. */
export class AccessActionError extends Error {}
const messages: Record<string, string> = {
  form_identifier_not_found: "The email or password is incorrect. Try again.",
  form_password_incorrect: "The email or password is incorrect. Try again.",
  form_code_incorrect: "That code is incorrect. Check it and try again.",
  verification_expired: "That verification step has expired. Request a new code or start again.",
  verification_failed: "We couldn’t verify that code. Request a new one and try again.",
  form_password_pwned: "Choose a different password. This one has appeared in a data breach.",
  form_password_length_too_short: "Choose a stronger password that meets your account requirements.",
  form_password_validation_failed: "Choose a stronger password that meets your account requirements.",
  form_identifier_exists: "An account may already use this email. Sign in or reset your password.",
  form_param_format_invalid: "Check the information you entered and try again.",
  too_many_requests: "Too many attempts. Wait a little before trying again.",
  rate_limit_exceeded: "Too many attempts. Wait a little before trying again.",
  session_exists: "An account is already signed in. Continue with it or use another account.",
};
export function authErrorCodes(error: unknown, depth = 0): string[] {
  if (!error || typeof error !== "object" || depth > 2) return [];
  const candidate = error as { code?: unknown; errors?: { code?: unknown }[]; cause?: unknown };
  return [...[candidate.code, ...(Array.isArray(candidate.errors) ? candidate.errors.map(item => item?.code) : [])].filter((code): code is string => typeof code === "string"), ...authErrorCodes(candidate.cause, depth + 1)];
}
export function isUnknownAccountError(error: unknown): boolean { return authErrorCodes(error).some(code => code === "form_identifier_not_found" || code === "identifier_not_found"); }
export function authErrorMessage(error: unknown): string {
  if (error instanceof AccessActionError) return error.message;
  for (const code of authErrorCodes(error)) if (messages[code]) return messages[code];
  return "We couldn’t complete this step. Please try again. If it continues, contact your CareIQ administrator.";
}
