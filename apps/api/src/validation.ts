export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function parseScheduledAt(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const result = new Date(value);
  const day = Number(value.slice(8, 10));
  const month = Number(value.slice(5, 7));
  const year = Number(value.slice(0, 4));
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Number.isNaN(result.getTime()) || year < 1000 || month < 1 || month > 12 || day < 1 || day > maxDay ? null : result;
}

export const CLINICAL_FIELD_LIMITS = { firstName: 120, lastName: 120, email: 254, phone: 40, reason: 1000 } as const;
const controlCharacters = /[\u0000-\u001f\u007f]/u;
const multilineControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function text(value: unknown, maximum: number, required = false, multiline = false): string | undefined | null {
  if (value === undefined || value === null) return required ? null : undefined;
  if (typeof value !== "string" || value.length > maximum || (multiline ? multilineControls : controlCharacters).test(value)) return null;
  const normalized = value.trim();
  return normalized || (required ? null : undefined);
}

export function parsePatientInput(value: unknown) {
  if (!isRecord(value)) return null;
  const firstName = text(value.firstName, CLINICAL_FIELD_LIMITS.firstName, true);
  const lastName = text(value.lastName, CLINICAL_FIELD_LIMITS.lastName, true);
  const email = text(value.email, CLINICAL_FIELD_LIMITS.email);
  const phone = text(value.phone, CLINICAL_FIELD_LIMITS.phone);
  if (!firstName || !lastName || email === null || phone === null) return null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return null;
  // International phone numbers and extensions remain supported; never infer a country.
  if (phone && (!/^[+\d\s().#xX\-extEXT]+$/u.test(phone) || !/\d/u.test(phone))) return null;
  return { firstName, lastName, email, phone };
}

export function parseAppointmentInput(value: unknown) {
  if (!isRecord(value)) return null;
  const patientId = typeof value.patientId === "string" ? value.patientId.trim() : "";
  const scheduledAt = parseScheduledAt(value.scheduledAt);
  const reason = text(value.reason, CLINICAL_FIELD_LIMITS.reason, false, true);
  if (!isUuid(patientId) || !scheduledAt || reason === null) return null;
  return { patientId, scheduledAt, reason };
}

export function parseIdempotencyKey(value: string | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}

export function parsePagination(query: Record<string, unknown>): { limit: number; offset: number } | null {
  const number = (value: unknown, fallback: number) => value === undefined ? fallback : typeof value === "string" && /^\d{1,9}$/.test(value) ? Number(value) : NaN;
  const limit = number(query.limit, 100);
  const offset = number(query.offset, 0);
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 && Number.isSafeInteger(offset) && offset >= 0 && offset <= 1_000_000 ? { limit, offset } : null;
}
