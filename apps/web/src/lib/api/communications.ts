import { apiRequest, ApiError } from "./client";

export type CommunicationCommand = { key: string; revision?: number; signal?: AbortSignal };
export type DeliveryIntent = {
  id: string; patientId: string; requestId: string | null; documentVersionId?: string | null; libraryItemId?: string | null; purpose: string; channel: string; maskedDestination: string;
  state: string; failureCode?: string | null; createdAt: string; updatedAt: string; revision: number; allowedActions: string[];
};
export type DeliveryDetail = DeliveryIntent & {
  attempts: Array<{ id: string; state: string; providerId?: string; failureCode?: string | null; submittedAt?: string | null; completedAt?: string | null; maskedDestination?: string }>;
  events: Array<{ id: string; eventType?: string; safeCode?: string | null; state?: string; createdAt?: string; occurredAt?: string }>;
};
export type CommunicationEndpoint = { id: string; revision?: number; channel: "email" | "sms"; maskedDestination: string; status: string; verifiedAt: string | null; timeZone: string | null; permissions: { request: boolean; reminder: boolean; paperwork: boolean } };
export type PatientCommunicationPreferences = { patientId: string; endpoints: CommunicationEndpoint[] };
export type SenderReadiness = { enabled: boolean; channels: { email: { ready: boolean }; sms: { ready: boolean } }; reasonCode?: string };
export type MessageTemplate = { purpose: string; channel: string; locale: string; version: string; subject?: string; body: string };
export type ReminderPolicy = { revision: number; enabled: boolean; slotsHours: number[]; windowStart: number; windowEnd: number; maxLifetime?: number; cooldownHours?: number; allowedActions?: string[] };
export type StaffNotification = {
  id: string; eventKind: string; createdAt: string; readAt: string | null; archivedAt: string | null; snoozedUntil: string | null; revision: number;
  concurrency: { revision: number; ifMatch: string }; subjectState: "current" | "reassigned" | "resolved"; allowedActions: string[];
  workItem: { id: string; patientId?: string; appointmentId?: string; kind: string; state: string; assigneeUserId: string | null; dueAt: string | null; revision: number } | null;
};
export type StaffInbox = { items: StaffNotification[]; unreadCount: number; attentionCount: number; asOf: string; snapshotToken: string; pagination: { nextCursor: string | null; hasMore: boolean } };
export type StaffNotificationPreferences = { revision: number; locale: string; confirmedTimeZone: string | null; emailMode: "off" | "immediate" | "digest"; assignmentEmail: boolean; overdueEmail: boolean; quietStart: string; quietEnd: string; digestTime: string; concurrency: { revision: number; ifMatch: string } };
export type StaffNotificationPolicy = { revision: number; assignmentsEnabled: boolean; overdueEnabled: boolean; overdueAfterMinutes: number; escalationEnabled: boolean; escalationBusinessMinutes: number; queueUserIds: string[]; escalationUserIds: string[]; holidays: string[]; concurrency: { revision: number; ifMatch: string }; eligibleRecipients: Array<{ userId: string; displayName: string }>; allowedActions: string[] };
export type CommunicationsAdapter = {
  deliveries(signal?: AbortSignal, before?: string | null): Promise<{ items: DeliveryIntent[]; asOf: string; nextCursor?: string | null }>;
  delivery(id: string, signal?: AbortSignal): Promise<DeliveryDetail>;
  readiness(signal?: AbortSignal): Promise<SenderReadiness>;
  templates(signal?: AbortSignal): Promise<{ items: MessageTemplate[] }>;
  patientPreferences(id: string, signal?: AbortSignal): Promise<PatientCommunicationPreferences>;
  registerEndpoint(patientId: string, body: { channel: "email" | "sms"; address: string; confirmed: true; verificationReference: string; timeZone: string | null; permissions: CommunicationEndpoint["permissions"] }, options: CommunicationCommand): Promise<{ id: string; revision: number; state: string }>;
  updateEndpointPermissions(endpointId: string, body: { permissions: CommunicationEndpoint["permissions"]; verificationReference: string }, options: CommunicationCommand): Promise<{ id: string; revision: number; state: string }>;
  queue(requestId: string, body: { purpose: "initial" | "reminder" | "reissue"; endpointIds: string[]; reasonCode?: string }, options: CommunicationCommand): Promise<{ id: string; state: string; intents: DeliveryIntent[] }>;
  cancel(id: string, options: CommunicationCommand): Promise<unknown>;
  check(id: string, options: CommunicationCommand): Promise<unknown>;
  reminderPolicy(signal?: AbortSignal): Promise<ReminderPolicy>;
  saveReminderPolicy(body: Pick<ReminderPolicy, "enabled" | "slotsHours" | "windowStart" | "windowEnd">, options: CommunicationCommand): Promise<ReminderPolicy>;
  inbox(filter: string, cursor?: string | null, signal?: AbortSignal): Promise<StaffInbox>;
  notification(id: string, signal?: AbortSignal): Promise<StaffNotification>;
  read(id: string, read: boolean, options: CommunicationCommand): Promise<{ id: string; readAt: string | null; revision: number }>;
  readAll(snapshotToken: string, options: CommunicationCommand): Promise<{ updatedCount: number; unreadCount: number }>;
  notificationPolicy(signal?: AbortSignal): Promise<StaffNotificationPolicy>;
  saveNotificationPolicy(body: Pick<StaffNotificationPolicy, "assignmentsEnabled" | "overdueEnabled" | "overdueAfterMinutes" | "escalationEnabled" | "escalationBusinessMinutes" | "queueUserIds" | "escalationUserIds" | "holidays">, options: CommunicationCommand): Promise<StaffNotificationPolicy>;
  staffPreferences(signal?: AbortSignal): Promise<StaffNotificationPreferences>;
  saveStaffPreferences(body: Omit<StaffNotificationPreferences, "revision" | "concurrency">, options: CommunicationCommand): Promise<StaffNotificationPreferences>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function communicationPath(locationId: string, resource: string, staff = false) {
  if (!uuid.test(locationId) || resource.startsWith("/") || resource.includes("..") || resource.includes("#")) throw new Error("Invalid communication resource.");
  return `/api/v1/locations/${locationId}/${staff ? "workflow" : "communications"}/${resource}`;
}
export function createCommunicationsAdapter(locationId: string, getToken: () => Promise<string>, onAccessDenied: () => void): CommunicationsAdapter {
  const pendingSends = new Map<string, { fingerprint: string; key: string; revision?: number }>();
  async function request<T>(resource: string, options: RequestInit = {}, staff = false): Promise<T> {
    try { return (await apiRequest<{ data: T }>(communicationPath(locationId, resource, staff), await getToken(), options)).data; }
    catch (cause) { if (cause instanceof ApiError && [401, 403].includes(cause.status)) onAccessDenied(); throw cause; }
  }
  function command<T>(resource: string, body: unknown, options: CommunicationCommand, method = "POST", staff = false) {
    return request<T>(resource, { method, signal: options.signal, body: JSON.stringify(body), headers: { "Idempotency-Key": options.key, ...(options.revision === undefined ? {} : { "If-Match": `"${options.revision}"` }) } }, staff);
  }
  return {
    deliveries: (signal, before) => request(`deliveries${before ? `?before=${encodeURIComponent(before)}` : ""}`, { signal }), delivery: (id, signal) => request(`deliveries/${encodeURIComponent(id)}`, { signal }),
    readiness: signal => request("readiness", { signal }), templates: signal => request("templates", { signal }),
    patientPreferences: (id, signal) => request(`patients/${encodeURIComponent(id)}/preferences`, { signal }),
    registerEndpoint: (id, body, options) => command(`patients/${encodeURIComponent(id)}/endpoints`, body, options, "PUT"),
    updateEndpointPermissions: (id, body, options) => command(`endpoints/${encodeURIComponent(id)}/permissions`, body, options),
    async queue(id, body, options) {
      const fingerprint = JSON.stringify({ purpose: body.purpose, endpointIds: [...body.endpointIds].sort(), reasonCode: body.reasonCode });
      const pending = pendingSends.get(id);
      if (pending && pending.fingerprint !== fingerprint) throw new ApiError(409, "SEND_RESULT_UNKNOWN", "Check the original send before changing its recipient or purpose.");
      const attempt = pending ?? { fingerprint, key: options.key, revision: options.revision };
      pendingSends.set(id, attempt);
      try {
        const receipt = await command<{ id: string; state: string; intents: DeliveryIntent[] }>(`requests/${encodeURIComponent(id)}/deliveries`, body, { ...options, key: attempt.key, revision: attempt.revision });
        pendingSends.delete(id); return receipt;
      } catch (cause) {
        // A transport error, interrupted response or server failure can follow a durable commit.
        if (cause instanceof ApiError && cause.status > 0 && cause.status < 500) pendingSends.delete(id);
        throw cause;
      }
    },
    cancel: (id, options) => command(`deliveries/${encodeURIComponent(id)}/cancel`, {}, options),
    check: (id, options) => command(`deliveries/${encodeURIComponent(id)}/check`, {}, options),
    reminderPolicy: signal => request("reminder-policy", { signal }), saveReminderPolicy: (body, options) => command("reminder-policy", body, options, "PUT"),
    inbox: (filter, cursor, signal) => request(`notifications?filter=${encodeURIComponent(filter)}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal }, true),
    notification: (id, signal) => request(`notifications/${encodeURIComponent(id)}`, { signal }, true),
    read: (id, read, options) => command(`notifications/${encodeURIComponent(id)}/read`, { read }, options, "POST", true),
    readAll: (snapshotToken, options) => command("notifications/read-all", { snapshotToken }, options, "POST", true),
    notificationPolicy: signal => request("notification-policy", { signal }, true),
    saveNotificationPolicy: (body, options) => command("notification-policy", body, options, "PATCH", true),
    staffPreferences: signal => request("notification-preferences", { signal }, true),
    saveStaffPreferences: (body, options) => command("notification-preferences", body, options, "PATCH", true),
  };
}

/** Channel permissions remain independent; current server checks still decide dispatch eligibility. */
export function eligibleCommunicationEndpoints(endpoints: CommunicationEndpoint[], purpose: "initial" | "reminder" | "reissue") {
  return endpoints.filter(endpoint => !!endpoint.verifiedAt && endpoint.status === "active" && endpoint.permissions[purpose === "reminder" ? "reminder" : "request"] === true);
}
export function deliveryNeedsAttention(item: DeliveryIntent) { return ["failed", "unknown", "bounced", "suppressed", "permanent_failure"].includes(item.state); }

/** This narrows the display choices only. The server compares the complete verified destination again. */
export function boundCommunicationEndpoints(endpoints: CommunicationEndpoint[], request: { recipientEmail?: string | null; recipientPhone?: string | null; recipient?: { email?: string } }) {
  const email = (request.recipientEmail ?? request.recipient?.email)?.trim().toLowerCase();
  const phone = request.recipientPhone?.trim();
  return endpoints.filter(endpoint => {
    if (endpoint.channel === "email") { if (!email?.includes("@")) return false; const [local, domain] = email.split("@"); return endpoint.maskedDestination === `${local.slice(0, 1)}•••@${domain}`; }
    return !!phone && endpoint.maskedDestination === `••• ••• ${phone.slice(-4)}`;
  });
}
