import { apiRequest, ApiError } from "./client";

export type InsuranceSource = "payer_portal" | "phone" | "document";
export type InsuranceOutcome = "active" | "inactive" | "needs_follow_up";
export type InsuranceEvidence = {
  id: string; source: InsuranceSource; observedAt: string; recordedAt: string; reference: string;
  outcome: InsuranceOutcome; copayCents: number | null; deductibleRemainingCents: number | null;
  coinsurancePercent: number | null; reasonCode: "manual_verification" | "correction";
  supersedesEvidenceId: string | null; actorLabel?: string;
};
export type InsuranceCase = {
  id: string; patientId: string; appointmentId: string; patientName: string; scheduledAt: string;
  payerName: string; memberIdMasked: string | null; assigneeUserId: string | null; dueAt: string | null;
  status: string; recordedState?: string; reviewState?: "unverified" | "current" | "stale"; reviewReason?: string | null; stale?: boolean; revision: number; currentEvidenceId: string | null; latestEvidence?: InsuranceEvidence | null;
  allowedActions: string[]; updatedAt?: string;
};
export type InsuranceActivity = { id: string; action: string; occurredAt: string; actorLabel: string; summary: string; outcome?: string };
export type InsuranceDetail = { case: InsuranceCase; evidence: InsuranceEvidence[]; activity: InsuranceActivity[]; evidenceHasMore?: boolean; activityHasMore?: boolean; activityCursor?: string | null; evidenceCursor?: string | null };
export type InsuranceCapabilities = { read: boolean; manage: boolean; evidence: boolean; activity: boolean };
export type InsurancePage = { data: InsuranceCase[]; meta?: { capabilities: InsuranceCapabilities; asOf?: string }; pagination: { hasMore: boolean; nextCursor: string | null } };
export type InsuranceAssignee = { id: string; label: string };
export type InsuranceSummary = {
  from: string; to: string; totalAppointments: number; totalCases: number; reviewed: number;
  needsAttention: number; unassigned: number; withoutCase: number;
  workload: Array<{ assigneeUserId: string | null; label: string; total: number; needsAttention: number }>;
};
export type InsuranceExport = { from: string; to: string; asOf: string; timeZone: string; summary: Record<"appointments" | "tracked" | "untracked" | "unverified" | "active" | "inactive" | "needsFollowUp" | "overdue" | "unassigned" | "stale", number> };
export type InsuranceCreate = { appointmentId: string; payerName: string; memberId?: string; assigneeUserId?: string | null; dueAt?: string | null };
export type InsuranceEvidenceInput = Pick<InsuranceEvidence, "source" | "observedAt" | "reference" | "outcome" | "reasonCode"> & {
  copayCents?: number | null; deductibleRemainingCents?: number | null; coinsurancePercent?: number | null;
  supersedesEvidenceId?: string;
};
export type InsuranceFollowUp = { assigneeUserId: string | null; dueAt: string | null; reasonCode: "assignment" | "follow_up" | "correction" };
export type InsuranceReceipt = { id: string; revision: number; state: string; evidenceId?: string };
export type InsuranceHistoryPage<T> = { data: T[]; pagination: { hasMore: boolean; nextCursor: string | null } };
export type InsuranceCommandOptions = { key: string; revision?: number; signal?: AbortSignal };
export type InsuranceAdapter = {
  preview?: boolean;
  exportSummary(from: string, to: string, options?: { key?: string; signal?: AbortSignal }): Promise<InsuranceExport>;
  cases(from: string, to: string, cursor?: string | null, signal?: AbortSignal): Promise<InsurancePage>;
  detail(id: string, signal?: AbortSignal): Promise<InsuranceDetail>;
  evidencePage(id: string, cursor: string, signal?: AbortSignal): Promise<InsuranceHistoryPage<InsuranceEvidence>>;
  activityPage(id: string, cursor: string, signal?: AbortSignal): Promise<InsuranceHistoryPage<InsuranceActivity>>;
  manager(from: string, to: string, signal?: AbortSignal): Promise<InsuranceSummary>;
  assignees(signal?: AbortSignal): Promise<InsuranceAssignee[]>;
  coverage(id: string, input: { payerName: string; memberId?: string | null; reasonCode: "correction" }, options: InsuranceCommandOptions): Promise<InsuranceReceipt>;
  create(input: InsuranceCreate, options: InsuranceCommandOptions): Promise<InsuranceReceipt>;
  evidence(id: string, input: InsuranceEvidenceInput, options: InsuranceCommandOptions): Promise<InsuranceReceipt>;
  followUp(id: string, input: InsuranceFollowUp, options: InsuranceCommandOptions): Promise<InsuranceReceipt>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function insurancePath(locationId: string, resource: string) {
  if (!uuid.test(locationId) || resource.startsWith("/") || resource.includes("..")) throw new Error("Invalid insurance resource.");
  return `/api/v1/locations/${locationId}/insurance/${resource}`;
}
export function insuranceRange(from: string, to: string) { return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`; }
type CaseWire = Omit<InsuranceCase, "status" | "allowedActions"> & { state: string };
type Envelope<T> = { data: T; meta?: { capabilities: InsuranceCapabilities; asOf?: string } };
const normalizeCase = (item: CaseWire, capabilities?: InsuranceCapabilities): InsuranceCase => ({ ...item, status: item.state, allowedActions: [...(capabilities?.manage ? ["follow_up"] : []), ...(capabilities?.evidence ? ["evidence"] : [])] });
export function createInsuranceAdapter(locationId: string, getToken: () => Promise<string>, onAccessDenied: () => void): InsuranceAdapter {
  async function request<T>(resource: string, options: RequestInit = {}): Promise<T> {
    try { return await apiRequest<T>(insurancePath(locationId, resource), await getToken(), options); }
    catch (cause) { if (cause instanceof ApiError && [401, 403].includes(cause.status)) onAccessDenied(); throw cause; }
  }
  async function command(resource: string, body: unknown, options: InsuranceCommandOptions) {
    const result = await request<Envelope<InsuranceReceipt>>(resource, { method: "POST", body: JSON.stringify(body), signal: options.signal,
      headers: { "Idempotency-Key": options.key, ...(options.revision === undefined ? {} : { "If-Match": `"${options.revision}"` }) } });
    return result.data;
  }
  return {
    async cases(from, to, cursor, signal) {
      const result = await request<{ data: CaseWire[]; pagination: InsurancePage["pagination"]; meta?: InsurancePage["meta"] }>(`cases?${insuranceRange(from, to)}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal });
      return { ...result, data: result.data.map(item => normalizeCase(item, result.meta?.capabilities)) };
    },
    async detail(id, signal) {
      const result = await request<Envelope<{ case: CaseWire; evidence: Array<InsuranceEvidence & { createdAt?: string; createdByActorId?: string }>; evidenceHasMore?: boolean; evidencePagination?: { hasMore: boolean; nextCursor: string | null } }>>(`cases/${encodeURIComponent(id)}`, { signal });
      let activity: InsuranceActivity[] = []; let activityHasMore = false; let activityCursor: string | null = null;
      if (result.meta?.capabilities.activity) {
        const history = await request<{ data: Array<{ id: string; action: string; occurredAt: string; actorType: string; actorId?: string; outcome?: string }>; pagination: { hasMore: boolean; nextCursor: string | null } }>(`cases/${encodeURIComponent(id)}/activity?limit=100`, { signal });
        activity = history.data.map(event => ({ ...event, actorLabel: event.actorId ? `${event.actorType} · ${event.actorId.slice(-8)}` : event.actorType, summary: "" }));
        activityHasMore = history.pagination.hasMore; activityCursor = history.pagination.nextCursor;
      }
      return { ...result.data, case: normalizeCase(result.data.case, result.meta?.capabilities), evidence: result.data.evidence.map(item => ({ ...item, recordedAt: item.recordedAt ?? item.createdAt ?? item.observedAt, actorLabel: item.createdByActorId ? item.createdByActorId.slice(-8) : undefined })), activity, activityHasMore, activityCursor, evidenceHasMore: result.data.evidencePagination?.hasMore ?? result.data.evidenceHasMore, evidenceCursor: result.data.evidencePagination?.nextCursor };
    },
    async evidencePage(id, cursor, signal) {
      const result = await request<InsuranceHistoryPage<InsuranceEvidence & { createdAt?: string; createdByActorId?: string }>>(`cases/${encodeURIComponent(id)}/evidence?limit=50&cursor=${encodeURIComponent(cursor)}`, { signal });
      return { ...result, data: result.data.map(item => ({ ...item, recordedAt: item.recordedAt ?? item.createdAt ?? item.observedAt, actorLabel: item.createdByActorId?.slice(-8) })) };
    },
    async activityPage(id, cursor, signal) {
      const result = await request<InsuranceHistoryPage<{ id: string; action: string; occurredAt: string; actorType: string; actorId?: string; outcome?: string }>>(`cases/${encodeURIComponent(id)}/activity?limit=100&cursor=${encodeURIComponent(cursor)}`, { signal });
      return { ...result, data: result.data.map(event => ({ ...event, actorLabel: event.actorId ? `${event.actorType} · ${event.actorId.slice(-8)}` : event.actorType, summary: "" })) };
    },
    async exportSummary(from, to, options) { return (await request<Envelope<InsuranceExport>>(`manager/export?${insuranceRange(from, to)}`, { method: "POST", body: "{}", signal: options?.signal, headers: { "Idempotency-Key": options?.key ?? crypto.randomUUID() } })).data; },
    async manager(from, to, signal) {
      const result = await request<Envelope<{ from: string; to: string; summary: { appointments: number; tracked: number; untracked: number; active: number; inactive: number; unverified: number; needsFollowUp: number; overdue: number; unassigned: number }; team: Array<{ userId: string | null; openCases: number; overdueCases: number }> }>>(`manager?${insuranceRange(from, to)}`, { signal });
      const item = result.data;
      return { from: item.from, to: item.to, totalAppointments: item.summary.appointments, totalCases: item.summary.tracked, reviewed: item.summary.active + item.summary.inactive, needsAttention: item.summary.unverified + item.summary.inactive + item.summary.needsFollowUp, unassigned: item.summary.unassigned, withoutCase: item.summary.untracked, workload: item.team.map(row => ({ assigneeUserId: row.userId, label: row.userId ? row.userId.slice(-8) : "", total: row.openCases, needsAttention: row.overdueCases })) };
    },
    async assignees(signal) { return (await request<Envelope<Array<{ userId: string }>>>("assignees", { signal })).data.map(item => ({ id: item.userId, label: item.userId.slice(-8) })); },
    coverage: (id, input, options) => command(`cases/${encodeURIComponent(id)}/coverage`, input, options),
    create: (input, options) => command("cases", input, options),
    evidence: (id, input, options) => command(`cases/${encodeURIComponent(id)}/evidence`, input, options),
    followUp: (id, input, options) => command(`cases/${encodeURIComponent(id)}/follow-up`, input, options),
  };
}

/** Blank inputs remain unknown; an explicitly entered zero remains a measured zero. */
export function insuranceAmount(value: string, cents = false) {
  if (!value.trim()) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error("INVALID_INSURANCE_AMOUNT");
  const parsed = Number(value);
  if (!Number.isSafeInteger(Math.round(parsed * 100))) throw new Error("INVALID_INSURANCE_AMOUNT");
  return cents ? Math.round(parsed * 100) : parsed;
}
