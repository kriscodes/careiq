import { translate } from "../../../../packages/i18n";
/** Deliberate, fixed UI validation messages, distinct from provider diagnostics. */
export class AccessActionError extends Error {}
const messages: Record<string, string> = {
  form_identifier_not_found: "access.auth.invalidCredentials",
  form_password_incorrect: "access.auth.invalidCredentials",
  form_code_incorrect: "access.auth.invalidCode",
  verification_expired: "access.auth.expiredVerification",
  verification_failed: "access.copy.we_couldn_t_verify_that_code_request_a_new_one_and_try_again",
  form_password_pwned: "access.auth.compromisedPassword",
  form_password_length_too_short: "access.auth.strongerPassword",
  form_password_validation_failed: "access.auth.strongerPassword",
  form_identifier_exists: "access.auth.accountExists",
  form_param_format_invalid: "access.auth.invalidInformation",
  too_many_requests: "access.auth.tooManyAttempts",
  rate_limit_exceeded: "access.auth.tooManyAttempts",
  verification_code_rate_limit_exceeded: "access.auth.tooManyAttempts",
  session_exists: "access.auth.alreadySignedIn",
};
export function authErrorCodes(error: unknown, depth = 0): string[] {
  if (!error || typeof error !== "object" || depth > 2) return [];
  const candidate = error as { code?: unknown; errors?: { code?: unknown }[]; cause?: unknown };
  return [...[candidate.code, ...(Array.isArray(candidate.errors) ? candidate.errors.map(item => item?.code) : [])].filter((code): code is string => typeof code === "string"), ...authErrorCodes(candidate.cause, depth + 1)];
}
export function isUnknownAccountError(error: unknown): boolean { return authErrorCodes(error).some(code => code === "form_identifier_not_found" || code === "identifier_not_found"); }
export function authErrorMessage(error: unknown, t: (key: string) => string = key => translate("en", key)): string {
  if (error instanceof AccessActionError) return error.message;
  for (const code of authErrorCodes(error)) if (messages[code]) return t(messages[code]);
  return t("access.auth.unexpected");
}
