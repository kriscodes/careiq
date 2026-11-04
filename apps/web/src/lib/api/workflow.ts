import { createInsuranceAdapter, type InsuranceAdapter } from './insurance';
import { apiRequest, ApiError, type ApiRequestOptions } from './client';
import { apiRequestUrl } from '../web-config';
import { translate } from '../../../../../packages/i18n';

export type Concurrency = { revision: number; ifMatch: string };
export type WorkflowRecord = {
  id: string;
  revision?: number;
  concurrency?: Concurrency;
  allowedActions?: string[];
};
export type WorkflowPatient = WorkflowRecord & {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth?: string | null;
  preferredContactMethod?: string;
  status?: string;
};
export type Requirement = WorkflowRecord & {
  patientId?: string;
  appointmentId?: string;
  labelSnapshot?: string;
  progressState?: string;
  lifecycleState?: string;
  label?: string;
  name?: string;
  documentTypeId?: string;
  state?: string;
  status?: string;
  reason?: string;
  reasonCodes?: string[];
  reviewRequired?: boolean;
  signatureRequired?: boolean;
  candidateVersionId?: string | null;
  candidateDocumentId?: string | null;
  selectedEvidence?: {
    id?: string;
    documentId?: string | null;
    documentVersionId: string;
    acceptedReviewId?: string | null;
  } | null;
  evidenceVersionId?: string | null;
  documentVersionId?: string | null;
};
export type Readiness = {
  requiredCount?: number;
  satisfiedCount?: number;
  waivedCount?: number;
  needsReviewCount?: number;
  missingCount?: number;
  state?: string;
  status?: string;
  ready?: number;
  total?: number;
  satisfied?: number;
  missing?: number;
  pendingReview?: number;
  label?: string;
};
export type WorkflowAppointment = WorkflowRecord & {
  patientId: string;
  providerId?: string | null;
  visitTypeId?: string | null;
  scheduledAt: string;
  endsAt?: string | null;
  durationMinutes?: number;
  status: string;
  reason: string | null;
  patient?: Partial<WorkflowPatient> & { id: string; displayName?: string };
  provider?: { id: string; name?: string; displayName?: string };
  readiness?: Readiness;
  requirements?: Requirement[];
};
export type DocumentVersion = WorkflowRecord & {
  versionNumber?: number;
  originalFilename?: string;
  contentType?: string;
  review?: { decision: string; id?: string } | null;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt?: string;
  scanStatus?: string;
  reviewStatus?: string;
  status?: string;
  contentHash?: string;
};
export type WorkflowDocument = WorkflowRecord & {
  patientId: string;
  documentTypeId?: string;
  title?: string;
  name?: string;
  status?: string;
  reviewStatus?: string;
  scanStatus?: string;
  archivedAt?: string | null;
  currentVersionId?: string | null;
  candidateVersionId?: string | null;
  currentVersion?: DocumentVersion | null;
  candidateVersion?: DocumentVersion | null;
  versions?: DocumentVersion[];
  createdAt?: string;
  updatedAt?: string;
};
export type TemplateField = {
  id?: string;
  key: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  sectionId?: string;
  helpText?: string;
  placeholder?: string;
  signerRole?: string;
  maxLength?: number;
  min?: number;
  max?: number;
};
export type FormRule = {
  id: string;
  targetFieldKey: string;
  sourceFieldKey: string;
  operator: 'equals' | 'not_equals' | 'checked' | 'not_checked' | 'has_value';
  value?: string | boolean | number;
};
export type FormSection = {
  id: string;
  title: string;
  description?: string;
  repeatable?: boolean;
  minItems?: number;
  maxItems?: number;
};
export type FormSchema = {
  documentTitle?: string;
  mode: 'guided';
  defaultLocale: 'en' | 'es';
  completionPolicy: 'form_only' | 'form_then_sign';
  sections: FormSection[];
  rules: FormRule[];
  bindings: Array<{
    fieldKey: string;
    destination:
      | 'patient.preferredName'
      | 'patient.email'
      | 'patient.phone'
      | 'patient.dateOfBirth';
    reviewRequired: true;
  }>;
  signing: {
    roles: Array<{ key: string; label: string; required: boolean }>;
    consentText: string;
    consentTextVersion: string;
  };
  delivery: { emailCopy: boolean };
};
export type TemplateVersion = WorkflowRecord & {
  versionNumber?: number;
  state?: string;
  fieldSchema?: TemplateField[];
  schemaVersion?: number;
  formSchema?: FormSchema;
  status?: string;
  fields?: TemplateField[];
  content?: string;
  contentHash?: string;
  publishedAt?: string;
};
export type WorkflowTemplate = WorkflowRecord & {
  name: string;
  title?: string;
  description?: string;
  documentTypeId?: string;
  status?: string;
  version?: number;
  versionId?: string;
  publishedVersionId?: string | null;
  fields?: TemplateField[];
  content?: string;
  versions?: TemplateVersion[];
};
export type WorkflowRequest = WorkflowRecord & {
  patientId: string;
  appointmentId?: string | null;
  purpose?: string;
  state?: string;
  status: string;
  recipientName?: string;
  recipientChannel?: string;
  deliveryState?: string;
  recipientEmail?: string;
  recipient?: { email?: string; name?: string };
  dueAt?: string | null;
  expiresAt?: string | null;
  deliveryStatus?: string;
  items?: Array<{
    requirementId?: string;
    documentTypeId?: string;
    templateVersionId?: string;
    label?: string;
    status?: string;
  }>;
  patientUrl?: string;
  localReviewPath?: string;
};
export type WorkItem = WorkflowRecord & {
  patientId?: string;
  appointmentId?: string;
  documentId?: string;
  title?: string;
  kind: string;
  state?: string;
  status?: string;
  priority?: string;
  dueAt?: string | null;
  assigneeUserId?: string | null;
  assigneeId?: string | null;
};
export type Lookup = WorkflowRecord & {
  name: string;
  displayName?: string;
  defaultDurationMinutes?: number;
  durationMinutes?: number;
  status?: string;
};
export type WorkflowActivity = {
  id: string;
  action: string;
  createdAt?: string;
  occurredAt?: string;
  actorLabel?: string;
  summary?: string;
  outcome?: string;
};
export type WorkflowPagination = {
  hasMore: boolean;
  nextCursor: string | null;
  limit?: number;
  total?: number;
};
export type WorkflowSnapshot = {
  relatedPagination?: {
    documentVersions?: Record<string, WorkflowPagination>;
    templateVersions?: Record<string, WorkflowPagination>;
  };
  pagination?: Record<string, WorkflowPagination>;
  location?: { id: string; name: string; timeZone?: string };
  timeZone: string;
  patients: WorkflowPatient[];
  appointments: WorkflowAppointment[];
  documents: WorkflowDocument[];
  templates: WorkflowTemplate[];
  requests: WorkflowRequest[];
  workItems: WorkItem[];
  providers: Lookup[];
  visitTypes: Lookup[];
  documentTypes: Lookup[];
  summary?: Record<string, number>;
  capabilities?: Record<string, unknown>;
  asOf: string;
};
export type WorkflowAdapter = {
  insurance?: InsuranceAdapter;
  preview?: boolean;
  load(date: string, signal?: AbortSignal, options?: { q?: string }): Promise<WorkflowSnapshot>;
  page<T>(
    resource: string,
    signal?: AbortSignal,
  ): Promise<{ data: T[]; pagination: WorkflowPagination }>;
  detail<T>(resource: string, signal?: AbortSignal): Promise<T>;
  command<T>(
    resource: string,
    body: unknown,
    options?: { method?: 'POST' | 'PATCH'; revision?: string; key?: string; signal?: AbortSignal },
  ): Promise<T>;
  file(versionId: string, purpose?: string, signal?: AbortSignal): Promise<Blob>;
  templatePreview?(
    version: TemplateVersion,
    answers?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Blob>;
  upload(
    patientId: string,
    file: File,
    input: Record<string, unknown>,
    key: string,
    signal?: AbortSignal,
  ): Promise<unknown>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function workflowPath(locationId: string, resource = '') {
  if (!uuid.test(locationId)) {
    throw new Error('Choose a valid location before opening records.');
  }
  if (resource.startsWith('/') || resource.includes('..')) {
    throw new Error('Invalid workflow resource.');
  }
  return `/api/v1/locations/${locationId}/workflow${resource ? `${resource.startsWith('?') ? '' : '/'}${resource}` : ''}`;
}
export function concurrencyOf(record?: WorkflowRecord) {
  return record?.concurrency?.ifMatch ?? `"${record?.revision ?? 1}"`;
}
export function patientName(
  patient?: { firstName?: string; lastName?: string; displayName?: string },
  locale = 'en',
) {
  return (
    patient?.displayName ||
    [patient?.firstName, patient?.lastName].filter(Boolean).join(' ') ||
    translate(locale, 'common.patientUnavailable')
  );
}
export function readinessLabel(readiness?: Readiness, locale = 'en') {
  if (!readiness) {
    return translate(locale, 'workflow.readiness.unavailable');
  }
  if (readiness.label) {
    return readiness.label;
  }
  const state = readiness.state ?? readiness.status;
  if (state === 'ready' || state === 'complete') {
    return translate(locale, 'workflow.readiness.ready');
  }
  if (state === 'not_required') {
    return translate(locale, 'workflow.readiness.notRequired');
  }
  if (state === 'needs_review' || readiness.pendingReview || readiness.needsReviewCount) {
    return translate(locale, 'workflow.readiness.review');
  }
  return translate(locale, 'workflow.readiness.attention');
}
export function allowed(
  record: WorkflowRecord | undefined,
  action: string,
  capabilities?: Record<string, unknown>,
) {
  const keys: Record<string, string> = {
    'patient.create': 'patientsCreate',
    'patient.update': 'patientsUpdate',
    'appointment.create': 'appointmentsCreate',
    'appointment.update': 'appointmentsUpdate',
    'document.upload': 'documentsUpload',
    'document.review': 'documentsReview',
    'document.archive': 'documentsArchive',
    'request.send': 'requestsSend',
    'requirement.waive': 'requirementsWaive',
    'configuration.manage': 'configurationManage',
    'activity.read': 'activityRead',
  };
  if (capabilities?.[keys[action] ?? action] === false) {
    return false;
  }
  if (record?.allowedActions) {
    const names: Record<string, string[]> = {
      'appointment.update': ['edit', 'cancel'],
      'document.review': ['review'],
      'document.archive': ['archive', 'restore'],
      'requirement.waive': ['waive', 'revoke_waiver'],
      'request.send': ['remind', 'reissue', 'cancel'],
    };
    return (
      record.allowedActions.includes(action) ||
      record.allowedActions.includes('*') ||
      (names[action] ?? []).some((name) => record.allowedActions!.includes(name))
    );
  }
  return capabilities?.[keys[action] ?? action] === true;
}
/** Keep private search values out of URLs while retaining the adapter's resource API. */
function readTransport(resource: string, signal?: AbortSignal) {
  const [path, query] = resource.split('?');
  const parameters = new URLSearchParams(query);
  if (parameters.get('q') === '') {
    parameters.delete('q');
  }
  const privateKeys = [
    'q',
    'patientId',
    'appointmentId',
    'documentId',
    'templateId',
    'requestId',
    'excludeAppointmentId',
  ];
  if (path !== 'availability' && !privateKeys.some((key) => parameters.has(key))) {
    return {
      resource: `${path}${parameters.size ? '?' + parameters.toString() : ''}`,
      options: { signal } as ApiRequestOptions,
    };
  }
  if ([...parameters.keys()].some((key) => parameters.getAll(key).length !== 1)) {
    throw new Error('Duplicate workflow filter.');
  }
  return {
    resource: `${path ? path + '/' : ''}query`,
    options: {
      method: 'POST',
      signal,
      readOnly: true,
      body: JSON.stringify(Object.fromEntries(parameters)),
    } as ApiRequestOptions,
  };
}

export function createWorkflowAdapter(
  locationId: string,
  getToken: () => Promise<string>,
  onAccessDenied: () => void,
): WorkflowAdapter {
  const uploadAttempts = new Map<
    string,
    { id: string; uploaded: boolean; completionKey: string }
  >();
  const request = async <T>(resource: string, options: ApiRequestOptions = {}) => {
    try {
      return (
        await apiRequest<{ data: T }>(workflowPath(locationId, resource), await getToken(), options)
      ).data;
    } catch (error) {
      if (
        error instanceof ApiError &&
        [401, 403].includes(error.status) &&
        error.code !== 'RECENT_AUTHENTICATION_REQUIRED'
      ) {
        onAccessDenied();
      }
      throw error;
    }
  };
  return {
    insurance: createInsuranceAdapter(locationId, getToken, onAccessDenied),
    load: async (date, signal, options) => {
      const transport = readTransport(
        `?date=${encodeURIComponent(date)}${options?.q ? `&q=${encodeURIComponent(options.q)}` : ''}`,
        signal,
      );
      return normalizeSnapshot(
        await request<WorkflowSnapshot>(transport.resource, transport.options),
      );
    },
    async page<T>(resource: string, signal?: AbortSignal) {
      const transport = readTransport(resource, signal);
      try {
        return await apiRequest<{ data: T[]; pagination: WorkflowPagination }>(
          workflowPath(locationId, transport.resource),
          await getToken(),
          transport.options,
        );
      } catch (error) {
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          onAccessDenied();
        }
        throw error;
      }
    },
    detail: <T>(resource: string, signal?: AbortSignal) => {
      const transport = readTransport(resource, signal);
      return request<T>(transport.resource, transport.options);
    },
    command: <T>(
      resource: string,
      body: unknown,
      options = {} as {
        method?: 'POST' | 'PATCH';
        revision?: string;
        key?: string;
        signal?: AbortSignal;
      },
    ) =>
      request<T>(resource, {
        method: options.method ?? 'POST',
        signal: options.signal,
        headers: {
          'Idempotency-Key': options.key ?? crypto.randomUUID(),
          ...(options.revision ? { 'If-Match': options.revision } : {}),
        },
        body: JSON.stringify(body),
      }),
    async templatePreview(version, answers = {}, signal) {
      const response = await fetch(
        apiRequestUrl(
          process.env.NEXT_PUBLIC_API_URL,
          workflowPath(locationId, `template-versions/${version.id}/preview`),
        ),
        {
          method: 'POST',
          signal,
          headers: {
            Authorization: `Bearer ${await getToken()}`,
            'Content-Type': 'application/json',
            'If-Match': concurrencyOf(version),
          },
          body: JSON.stringify({ answers }),
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
        },
      );
      if (!response.ok) {
        if ([401, 403].includes(response.status)) {
          onAccessDenied();
        }
        throw new ApiError(response.status, 'PREVIEW_UNAVAILABLE', 'PREVIEW_UNAVAILABLE');
      }
      const blob = await response.blob();
      if (!blob.type.startsWith('application/pdf') || !blob.size) {
        throw new Error('PREVIEW_UNAVAILABLE');
      }
      return blob;
    },
    async file(versionId, purpose = 'view', signal) {
      const response = await fetch(
        apiRequestUrl(
          process.env.NEXT_PUBLIC_API_URL,
          workflowPath(
            locationId,
            `document-versions/${versionId}/content?purpose=${encodeURIComponent(purpose)}`,
          ),
        ),
        {
          signal,
          headers: { Authorization: `Bearer ${await getToken()}` },
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
        },
      );
      if (!response.ok) {
        if ([401, 403].includes(response.status)) {
          onAccessDenied();
        }
        throw new ApiError(
          response.status,
          'FILE_UNAVAILABLE',
          translate('en', 'common.error.fileUnavailable'),
        );
      }
      const blob = await response.blob();
      if (
        !['application/pdf', 'image/jpeg', 'image/png'].some((type) => blob.type.startsWith(type))
      ) {
        throw new Error('The document format is not supported for secure viewing.');
      }
      return blob;
    },
    async upload(patientId, file, input, key, signal) {
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
      let attempt = uploadAttempts.get(key);
      if (!attempt) {
        const reservation = await request<{ uploadSessionId: string }>(
          `patients/${patientId}/uploads`,
          {
            method: 'POST',
            signal,
            headers: { 'Idempotency-Key': key },
            body: JSON.stringify({
              documentTypeId: input.documentTypeId,
              ...(input.requirementId ? { requirementId: input.requirementId } : {}),
              ...(input.existingDocumentId
                ? {
                    existingDocumentId: input.existingDocumentId,
                    baseVersionId: input.baseVersionId,
                  }
                : {}),
              file: { name: file.name, contentType: file.type, sizeBytes: file.size, sha256: hash },
            }),
          },
        );
        if (!reservation.uploadSessionId) {
          throw new Error('The upload reservation was incomplete. Retry your upload.');
        }
        attempt = {
          id: reservation.uploadSessionId,
          uploaded: false,
          completionKey: await deriveMutationKey(key, 'upload-completion'),
        };
        uploadAttempts.set(key, attempt);
      }
      if (!attempt.uploaded) {
        const response = await fetch(
          apiRequestUrl(
            process.env.NEXT_PUBLIC_API_URL,
            workflowPath(locationId, `upload-sessions/${attempt.id}/content`),
          ),
          {
            method: 'PUT',
            signal,
            headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': file.type },
            body: file,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            redirect: 'error',
          },
        );
        if (!response.ok) {
          if ([401, 403].includes(response.status)) {
            onAccessDenied();
          }
          throw new ApiError(
            response.status,
            'UPLOAD_FAILED',
            translate('en', 'common.error.uploadFailed'),
          );
        }
        attempt.uploaded = true;
      }
      return request(`upload-sessions/${attempt.id}/completion`, {
        method: 'POST',
        signal,
        headers: { 'Idempotency-Key': attempt.completionKey },
        body: JSON.stringify({ sizeBytes: file.size, sha256: hash }),
      });
    },
  };
}

export function normalizeSnapshot(input: WorkflowSnapshot): WorkflowSnapshot {
  return {
    ...input,
    timeZone: input.timeZone ?? input.location?.timeZone ?? 'UTC',
    patients: input.patients ?? [],
    appointments: input.appointments ?? [],
    documents: (input.documents ?? []).map((doc) => {
      const versions = [...(doc.versions ?? [])].sort(
        (a, b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0),
      );
      return {
        ...doc,
        versions,
        candidateVersion:
          doc.candidateVersion ??
          versions.find((v) => (v.versionNumber ?? 0) > (doc.currentVersion?.versionNumber ?? 0)) ??
          null,
      };
    }),
    templates: (input.templates ?? []).map((template) => ({
      ...template,
      name: template.name ?? template.title ?? 'Untitled Template',
      versions: [...(template.versions ?? [])].sort(
        (a, b) => (a.versionNumber ?? 0) - (b.versionNumber ?? 0),
      ),
    })),
    requests: (input.requests ?? []).map((request) => ({
      ...request,
      status: request.status ?? request.state ?? 'open',
    })),
    workItems: input.workItems ?? [],
    providers: (input.providers ?? []).map((provider) => ({
      ...provider,
      name: provider.name ?? provider.displayName ?? 'Provider',
    })),
    visitTypes: input.visitTypes ?? [],
    documentTypes: input.documentTypes ?? [],
  };
}

export type WorkflowAvailabilityInput = {
  providerId: string;
  date: string;
  durationMinutes: number;
  excludeAppointmentId?: string;
};
export type WorkflowAvailability = WorkflowAvailabilityInput & {
  timeZone: string;
  slots: Array<{ startsAt: string; endsAt: string }>;
};

/** Slots are suggestions from the same server policy that validates a booking. */
export function loadWorkflowAvailability(
  adapter: WorkflowAdapter,
  input: WorkflowAvailabilityInput,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    providerId: input.providerId,
    date: input.date,
    durationMinutes: String(input.durationMinutes),
  });
  if (input.excludeAppointmentId) {
    query.set('excludeAppointmentId', input.excludeAppointmentId);
  }
  return adapter.detail<WorkflowAvailability>(`availability?${query}`, signal);
}

/** Drain visible dates and the previous boundary day so overnight visits remain visible. */
export async function loadWorkflowSchedule(
  adapter: WorkflowAdapter,
  dates: string[],
  signal?: AbortSignal,
): Promise<WorkflowSnapshot> {
  const uniqueDates = [...new Set(dates)].sort();
  if (
    !uniqueDates.length ||
    uniqueDates.length > 7 ||
    uniqueDates.some(
      (date) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date,
    )
  ) {
    throw new Error('Choose up to seven consecutive valid schedule dates.');
  }
  const previousDay = new Date(`${uniqueDates[0]}T00:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const boundaryDate = previousDay.toISOString().slice(0, 10);
  if (
    uniqueDates.some(
      (date, index) =>
        index > 0 &&
        Date.parse(`${date}T00:00:00Z`) - Date.parse(`${uniqueDates[index - 1]}T00:00:00Z`) !==
          86400000,
    )
  ) {
    throw new Error('Choose consecutive schedule dates.');
  }
  signal?.throwIfAborted();
  const snapshots = await Promise.all(uniqueDates.map((date) => adapter.load(date, signal)));
  signal?.throwIfAborted();
  if (snapshots.some((snapshot) => snapshot.capabilities?.appointmentsRead !== true)) {
    throw new ApiError(403, 'FORBIDDEN', 'FORBIDDEN');
  }
  const base = snapshots[0];
  if (
    snapshots.some(
      (snapshot) =>
        snapshot.location?.id !== base.location?.id || snapshot.timeZone !== base.timeZone,
    )
  ) {
    throw new Error('The schedule location changed. Refresh before continuing.');
  }
  async function complete<T extends WorkflowRecord>(
    resource: string,
    initial: T[],
    pagination: WorkflowPagination | undefined,
    date: string,
  ) {
    const items = new Map(initial.map((item) => [item.id, item]));
    const cursors = new Set<string>();
    let page = pagination;
    while (page?.hasMore) {
      signal?.throwIfAborted();
      if (!page.nextCursor || cursors.has(page.nextCursor) || cursors.size >= 100) {
        throw new Error('The complete schedule could not be loaded. Refresh before continuing.');
      }
      cursors.add(page.nextCursor);
      const query = new URLSearchParams({
        date,
        limit: String(page.limit ?? pagination?.limit ?? 50),
        cursor: page.nextCursor,
      });
      const next = await adapter.page<T>(`${resource}?${query}`, signal);
      signal?.throwIfAborted();
      for (const item of next.data) {
        items.set(item.id, item);
      }
      page = next.pagination;
    }
    return [...items.values()];
  }
  const [days, providers, visitTypes, boundary] = await Promise.all([
    Promise.all(
      snapshots.map((snapshot, index) =>
        complete(
          'appointments',
          snapshot.appointments,
          snapshot.pagination?.appointments,
          uniqueDates[index],
        ),
      ),
    ),
    complete(
      'providers',
      snapshots.flatMap((snapshot) => snapshot.providers),
      base.pagination?.providers,
      uniqueDates[0],
    ),
    complete(
      'visit-types',
      snapshots.flatMap((snapshot) => snapshot.visitTypes),
      base.pagination?.visitTypes,
      uniqueDates[0],
    ),
    adapter
      .page<WorkflowAppointment>(
        `appointments?${new URLSearchParams({ date: boundaryDate, limit: '50' })}`,
        signal,
      )
      .then((page) => complete('appointments', page.data, page.pagination, boundaryDate)),
  ]);
  signal?.throwIfAborted();
  const merge = <T extends WorkflowRecord>(items: T[]) => {
    const records = new Map<string, T>();
    for (const item of items) {
      const existing = records.get(item.id);
      if (
        !existing ||
        (item.revision ?? item.concurrency?.revision ?? 0) >=
          (existing.revision ?? existing.concurrency?.revision ?? 0)
      ) {
        records.set(item.id, item);
      }
    }
    return [...records.values()];
  };
  const localStamp = (instant: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: base.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const value = (type: string) => parts.find((part) => part.type === type)?.value;
    return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}`;
  };
  const nextDay = new Date(`${uniqueDates.at(-1)}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const rangeStart = `${uniqueDates[0]}T00:00:00`;
  const rangeEnd = `${nextDay.toISOString().slice(0, 10)}T00:00:00`;
  return normalizeSnapshot({
    ...base,
    asOf:
      snapshots
        .map((snapshot) => snapshot.asOf)
        .sort()
        .at(-1) ?? base.asOf,
    summary: undefined,
    appointments: merge([...days.flat(), ...boundary]).filter(
      (appointment) =>
        localStamp(appointment.scheduledAt) < rangeEnd &&
        localStamp(
          appointment.endsAt ??
            new Date(
              Date.parse(appointment.scheduledAt) + (appointment.durationMinutes ?? 30) * 60000,
            ).toISOString(),
        ) > rangeStart,
    ),
    capabilities: Object.fromEntries(
      [...new Set(snapshots.flatMap((snapshot) => Object.keys(snapshot.capabilities ?? {})))].map(
        (key) => [key, snapshots.every((snapshot) => snapshot.capabilities?.[key] === true)],
      ),
    ),
    patients: merge(snapshots.flatMap((snapshot) => snapshot.patients)),
    providers,
    visitTypes,
    documents: merge(snapshots.flatMap((snapshot) => snapshot.documents)),
    requests: merge(snapshots.flatMap((snapshot) => snapshot.requests)),
    workItems: merge(snapshots.flatMap((snapshot) => snapshot.workItems)),
    documentTypes: merge(snapshots.flatMap((snapshot) => snapshot.documentTypes)),
    templates: merge(snapshots.flatMap((snapshot) => snapshot.templates)),
    relatedPagination: {
      documentVersions: Object.assign(
        {},
        ...[...snapshots]
          .sort((a, b) => a.asOf.localeCompare(b.asOf))
          .map((snapshot) => snapshot.relatedPagination?.documentVersions),
      ),
      templateVersions: Object.assign(
        {},
        ...[...snapshots]
          .sort((a, b) => a.asOf.localeCompare(b.asOf))
          .map((snapshot) => snapshot.relatedPagination?.templateVersions),
      ),
    },
    pagination: {
      ...base.pagination,
      appointments: { hasMore: false, nextCursor: null },
      providers: { hasMore: false, nextCursor: null },
      visitTypes: { hasMore: false, nextCursor: null },
    },
  });
}

/** Multi-stage operations retain stable, distinct UUID keys for each server command. */
export async function deriveMutationKey(base: string, stage: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${base}:${stage}`)),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
