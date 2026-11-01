import type { TenantContext } from "../middleware/tenant-context.js";
import type { QueryClient } from "./transaction.js";
import { body, id, isoDate, WorkflowError } from "./policy.js";

export type AvailabilityInput = { providerId: string; date: string; durationMinutes: number; excludeAppointmentId?: string };
export function availabilityInput(value: unknown): AvailabilityInput {
  const input = body(value, ["providerId", "date", "durationMinutes", "excludeAppointmentId"]);
  if (typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new WorkflowError("INVALID_DATE");
  const durationMinutes = typeof input.durationMinutes === "string" && /^\d{1,3}$/.test(input.durationMinutes) ? Number(input.durationMinutes) : input.durationMinutes;
  if (!Number.isInteger(durationMinutes) || Number(durationMinutes) < 5 || Number(durationMinutes) > 480) throw new WorkflowError("INVALID_DURATION");
  return { providerId: id(input.providerId, "providerId"), date: isoDate(input.date), durationMinutes: Number(durationMinutes), ...(input.excludeAppointmentId === undefined ? {} : { excludeAppointmentId: id(input.excludeAppointmentId, "excludeAppointmentId") }) };
}

/** Shared by booking validation and slot suggestions; all substitutions below are code constants. */
export const providerSlotChecks = `SELECT slot.starts_at,slot.ends_at,
 EXISTS(SELECT 1 FROM provider_availability_exceptions e WHERE e.practice_id=$1 AND e.location_id=$2 AND e.provider_id=$3 AND e.active AND e.kind='unavailable' AND e.starts_at<slot.ends_at AND e.ends_at>slot.starts_at) AS blocked,
 (EXISTS(SELECT 1 FROM provider_availability_rules r WHERE r.practice_id=$1 AND r.location_id=$2 AND r.provider_id=$3 AND r.active
 AND extract(isodow FROM slot.starts_at AT TIME ZONE l.time_zone)=r.iso_weekday
 AND (slot.starts_at AT TIME ZONE l.time_zone)::date>=r.effective_from AND (r.effective_until IS NULL OR (slot.starts_at AT TIME ZONE l.time_zone)::date<=r.effective_until)
 AND (slot.starts_at AT TIME ZONE l.time_zone)::date=(slot.ends_at AT TIME ZONE l.time_zone)::date
 AND (slot.starts_at AT TIME ZONE l.time_zone)::time>=r.starts_at_local AND (slot.ends_at AT TIME ZONE l.time_zone)::time<=r.ends_at_local)
 OR EXISTS(SELECT 1 FROM provider_availability_exceptions e WHERE e.practice_id=$1 AND e.location_id=$2 AND e.provider_id=$3 AND e.active AND e.kind='available' AND e.starts_at<=slot.starts_at AND e.ends_at>=slot.ends_at)) AS configured,
 public.careiq_provider_slot_busy($3::uuid,slot.starts_at,slot.ends_at,$4::uuid) AS conflict
 FROM candidates slot JOIN locations l ON l.id=$2 AND l.practice_id=$1`;

/** A single day has at most 96 local-clock candidates, independent of clinic volume. */
export async function availableSlots(client: QueryClient, tenant: TenantContext, input: AvailabilityInput) {
  const result = await client.query(`WITH local_candidates AS (
 SELECT candidate, l.time_zone FROM locations l CROSS JOIN LATERAL generate_series($5::date::timestamp,($5::date+1)::timestamp-interval '15 minutes',interval '15 minutes') candidate
 WHERE l.id=$2 AND l.practice_id=$1
 ), candidates AS (
 SELECT candidate AT TIME ZONE time_zone AS starts_at,(candidate AT TIME ZONE time_zone)+make_interval(mins=>$6::int) AS ends_at FROM local_candidates
 WHERE (candidate AT TIME ZONE time_zone) AT TIME ZONE time_zone=candidate
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[-180,-120,-90,-60,-30,30,60,90,120,180]) shift(minutes)
 WHERE ((candidate AT TIME ZONE time_zone)+make_interval(mins=>shift.minutes)) AT TIME ZONE time_zone=candidate)
 ), checks AS (${providerSlotChecks}) SELECT starts_at,ends_at FROM checks WHERE NOT blocked AND configured AND NOT conflict ORDER BY starts_at LIMIT 96`,
    [tenant.practiceId, tenant.locationId, input.providerId, input.excludeAppointmentId ?? null, input.date, input.durationMinutes]);
  return result.rows.map(slot => ({ startsAt: new Date(slot.starts_at).toISOString(), endsAt: new Date(slot.ends_at).toISOString() }));
}
