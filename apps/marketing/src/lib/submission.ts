import { parseInterviewRequest, type InterviewFieldErrors, type InterviewRequest } from "@careiq/interview-contract";

export type FormValues = { name: string; email: string; role: string; practiceName: string; website: string };
export type SubmissionResult =
  | { kind: "success" }
  | { kind: "invalid"; fields: InterviewFieldErrors }
  | { kind: "rateLimited" }
  | { kind: "unavailable" }
  | { kind: "error" };
export type Attempt = { fingerprint: string; key: string };

// The reference stays only in component memory and follows the exact entered values.
// A failed request reuses its key; edited contents receive a fresh key.
export function prepareSubmission(values: FormValues, previous: Attempt | null, makeKey: () => string) {
  const fingerprint = JSON.stringify(values);
  const attempt = previous?.fingerprint === fingerprint ? previous : { fingerprint, key: makeKey() };
  return { attempt, parsed: parseInterviewRequest({ ...values, submissionKey: attempt.key }) };
}

export async function submitInterview(apiUrl: string, payload: InterviewRequest, fetcher: typeof fetch = fetch): Promise<SubmissionResult> {
  try {
    const response = await fetcher(`${apiUrl.replace(/\/+$/, "")}/api/v1/public/interview-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 429) return { kind: "rateLimited" };
    if (response.status === 503) return { kind: "unavailable" };
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && isRecord(body) && isRecord(body.data) && body.data.accepted === true) return { kind: "success" };
    if (response.status === 400 && isRecord(body) && isRecord(body.error) && isRecord(body.error.fields)) {
      const fields: InterviewFieldErrors = {};
      for (const field of ["name", "email", "role", "practiceName"] as const) {
        const code = body.error.fields[field];
        if (code === "required" || code === "invalid" || code === "too_long") fields[field] = code;
      }
      if (Object.keys(fields).length) return { kind: "invalid", fields };
    }
    return { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
