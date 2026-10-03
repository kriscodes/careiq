export const INTERVIEW_ROLES: readonly ["practice_owner", "practice_manager", "administrative_staff", "provider", "other"];
export type InterviewRole = typeof INTERVIEW_ROLES[number];
export const FIELD_LIMITS: Readonly<{ name: 120; email: 254; practiceName: 160 }>;
export const PRIVACY_NOTICE_VERSION: "2026-10-02";
export type InterviewField = "name" | "email" | "role" | "practiceName" | "submissionKey" | "website" | "_form";
export type InterviewFieldError = "required" | "invalid" | "too_long";
export type InterviewFieldErrors = Partial<Record<InterviewField, InterviewFieldError>>;
export type InterviewRequest = {
  name: string; email: string; role: InterviewRole; practiceName?: string; submissionKey: string; website: string;
};
export function parseInterviewRequest(value: unknown):
  | { ok: true; data: InterviewRequest }
  | { ok: false; fields: InterviewFieldErrors };
