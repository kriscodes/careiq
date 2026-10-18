import { apiRequestUrl } from "@/lib/web-config";
export class PatientLinkError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function patientApi<T>(path: string, body?: unknown, key?: string, signal?: AbortSignal, options?: { method?: "POST" | "PUT"; revision?: number }): Promise<T> {
  const response = await fetch(apiRequestUrl(process.env.NEXT_PUBLIC_API_URL, `/api/v1/patient-workflows/${path}`), { method: body === undefined ? "GET" : options?.method ?? "POST", credentials: "include", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal, headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}), ...(options?.revision !== undefined ? { "If-Match": `"${options.revision}"` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new PatientLinkError(response.status, [401, 403, 404, 410].includes(response.status) ? "workflow.text.thisSecureLinkIsUnavailableOrHasExpiredContactYourCareTeamForANewLink" : response.status === 412 ? "workflow.text.thisRequestHasChangedReloadItBeforeTryingAgain" : result?.error?.code === "REQUIRED_FIELD" ? "workflow.studio.requiredAnswers" : "workflow.text.weCouldnTSaveThatChangeYourEntriesAreStillHerePleaseTryAgain");
  if (!result?.data) throw new PatientLinkError(502, "workflow.text.weCouldnTOpenThisRequestPleaseTryAgain");
  return result.data as T;
}
