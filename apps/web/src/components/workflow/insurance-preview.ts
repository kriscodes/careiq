import { type InsuranceAdapter, type InsuranceCase, type InsuranceDetail, type InsuranceEvidence, type InsuranceReceipt } from "@/lib/api/insurance";
import { type WorkflowSnapshot, patientName } from "@/lib/api/workflow";

/** Synthetic data is reachable only from the existing explicit workflow preview. */
export function createInsurancePreviewAdapter(snapshot: () => WorkflowSnapshot): InsuranceAdapter {
  const records: InsuranceDetail[] = [];
  const attempts = new Map<string, InsuranceReceipt>();
  const clone = <T,>(value: T): T => structuredClone(value);
  const caps = { read: true, manage: true, evidence: true, activity: true };
  function ensure() {
    if (records.length) return;
    snapshot().appointments.filter(item => item.status !== "cancelled").slice(0, 2).forEach((appointment, index) => {
      const item: InsuranceCase = { id: `synthetic-insurance-${index + 1}`, patientId: appointment.patientId, appointmentId: appointment.id, patientName: patientName(snapshot().patients.find(patient => patient.id === appointment.patientId)), scheduledAt: appointment.scheduledAt, payerName: "Synthetic health plan", memberIdMasked: "•••• 0123", assigneeUserId: null, dueAt: null, status: "unverified", revision: 1, currentEvidenceId: null, allowedActions: ["evidence", "follow_up"] };
      records.push({ case: item, evidence: [], activity: [{ id: `synthetic-case-event-${index}`, action: "insurance.case.created", summary: "", occurredAt: snapshot().asOf, actorLabel: "Synthetic staff" }] });
    });
  }
  function find(id: string) { ensure(); const item = records.find(record => record.case.id === id); if (!item) throw new Error("This synthetic insurance case is unavailable."); return item; }
  const scoped = (from: string, to: string) => { ensure(); return records.filter(item => { const day = new Intl.DateTimeFormat("en-CA", { timeZone: snapshot().timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(item.case.scheduledAt)); return day >= from && day <= to; }); };
  return {
    preview: true,
    async cases(from, to) { return { data: clone(scoped(from, to).map(item => item.case)), pagination: { hasMore: false, nextCursor: null }, meta: { capabilities: caps } }; },
    async detail(id) { return clone(find(id)); },
    async evidencePage() { return { data: [], pagination: { hasMore: false, nextCursor: null } }; },
    async activityPage() { return { data: [], pagination: { hasMore: false, nextCursor: null } }; },
    async assignees() { return [{ id: "synthetic-staff", label: "preview" }]; },
    async exportSummary(from, to) {
      const group = scoped(from, to).map(item => item.case);
      return { from, to, asOf: new Date().toISOString(), timeZone: snapshot().timeZone, summary: { appointments: snapshot().appointments.length, tracked: group.length, untracked: Math.max(0, snapshot().appointments.length - group.length), active: group.filter(item => item.status === "active").length, inactive: group.filter(item => item.status === "inactive").length, unverified: group.filter(item => item.status === "unverified").length, needsFollowUp: group.filter(item => item.status === "needs_follow_up").length, overdue: 0, unassigned: group.filter(item => !item.assigneeUserId && item.status !== "active").length, stale: 0 } };
    },
    async manager(from, to) {
      const group = scoped(from, to).map(item => item.case);
      const totalAppointments = snapshot().appointments.filter(appointment => appointment.status !== "cancelled" && new Intl.DateTimeFormat("en-CA", { timeZone: snapshot().timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(appointment.scheduledAt)) === from).length;
      return { from, to, totalAppointments, totalCases: group.length, reviewed: group.filter(item => ["active", "inactive"].includes(item.status)).length, needsAttention: group.filter(item => item.status !== "active").length, unassigned: group.filter(item => !item.assigneeUserId && item.status !== "active").length, withoutCase: Math.max(0, totalAppointments - group.length), workload: [...new Set(group.map(item => item.assigneeUserId))].map(id => ({ assigneeUserId: id, label: id ? "preview" : "", total: group.filter(item => item.assigneeUserId === id && item.status !== "active").length, needsAttention: 0 })) };
    },
    async coverage(id, input, options) {
      if (attempts.has(options.key)) return clone(attempts.get(options.key)!);
      const record = find(id); if (options.revision !== record.case.revision) throw new Error("Refresh this synthetic case before saving again.");
      record.case.payerName = input.payerName; if (input.memberId !== undefined) record.case.memberIdMasked = input.memberId ? `•••• ${input.memberId.slice(-4)}` : null;
      record.case.status = "unverified"; record.case.currentEvidenceId = null; record.case.revision++;
      record.activity.unshift({ id: crypto.randomUUID(), action: "insurance.coverage.revised", summary: "", occurredAt: new Date().toISOString(), actorLabel: "Synthetic staff" });
      const receipt = { id, revision: record.case.revision, state: record.case.status }; attempts.set(options.key, receipt); return clone(receipt);
    },
    async create(input, options) {
      if (attempts.has(options.key)) return clone(attempts.get(options.key)!);
      ensure(); const appointment = snapshot().appointments.find(item => item.id === input.appointmentId);
      if (!appointment || records.some(item => item.case.appointmentId === appointment.id)) throw new Error("Choose another synthetic appointment.");
      const item: InsuranceCase = { id: crypto.randomUUID(), appointmentId: appointment.id, patientId: appointment.patientId, patientName: patientName(snapshot().patients.find(patient => patient.id === appointment.patientId)), scheduledAt: appointment.scheduledAt, payerName: input.payerName, memberIdMasked: input.memberId ? `•••• ${input.memberId.slice(-4)}` : null, assigneeUserId: input.assigneeUserId ?? null, dueAt: input.dueAt ?? null, status: "unverified", revision: 1, currentEvidenceId: null, allowedActions: ["evidence", "follow_up"] };
      records.push({ case: item, evidence: [], activity: [{ id: crypto.randomUUID(), action: "insurance.case.created", summary: "", occurredAt: new Date().toISOString(), actorLabel: "Synthetic staff" }] });
      const receipt = { id: item.id, revision: item.revision, state: item.status }; attempts.set(options.key, receipt); return clone(receipt);
    },
    async evidence(id, input, options) {
      if (attempts.has(options.key)) return clone(attempts.get(options.key)!);
      const record = find(id);
      if (options.revision !== record.case.revision) throw new Error("Refresh this synthetic case before saving again.");
      const evidence: InsuranceEvidence = { ...input, id: crypto.randomUUID(), recordedAt: new Date().toISOString(), copayCents: input.copayCents ?? null, deductibleRemainingCents: input.deductibleRemainingCents ?? null, coinsurancePercent: input.coinsurancePercent ?? null, supersedesEvidenceId: input.supersedesEvidenceId ?? null, actorLabel: "preview" };
      record.evidence.unshift(evidence); record.case.currentEvidenceId = evidence.id; record.case.status = evidence.outcome; record.case.revision++;
      record.activity.unshift({ id: crypto.randomUUID(), action: input.reasonCode === "correction" ? "insurance.evidence.corrected" : "insurance.evidence.recorded", summary: "", occurredAt: evidence.recordedAt, actorLabel: "Synthetic staff" });
      const receipt = { id, revision: record.case.revision, state: record.case.status, evidenceId: evidence.id }; attempts.set(options.key, receipt); return clone(receipt);
    },
    async followUp(id, input, options) {
      if (attempts.has(options.key)) return clone(attempts.get(options.key)!);
      const record = find(id); if (options.revision !== record.case.revision) throw new Error("Refresh this synthetic case before saving again.");
      record.case.assigneeUserId = input.assigneeUserId; record.case.dueAt = input.dueAt; record.case.revision++;
      record.activity.unshift({ id: crypto.randomUUID(), action: "insurance.follow_up.updated", summary: "", occurredAt: new Date().toISOString(), actorLabel: "Synthetic staff" });
      const receipt = { id, revision: record.case.revision, state: record.case.status }; attempts.set(options.key, receipt); return clone(receipt);
    },
  };
}
