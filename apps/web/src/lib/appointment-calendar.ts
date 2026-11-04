import type { WorkflowAppointment } from './api/workflow';

/** Calendar dates are civil dates in the practice zone, never browser-local instants. */
function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Invalid calendar date.');
  }
  const result = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid calendar date.');
  }
  return result;
}

export function shiftAppointmentDate(value: string, days: number) {
  const result = calendarDate(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function appointmentWeekDates(value: string): string[] {
  const day = calendarDate(value).getUTCDay();
  const monday = shiftAppointmentDate(value, -((day + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => shiftAppointmentDate(monday, index));
}

export function appointmentDateKey(value: string | number | Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (key: string) => parts.find((item) => item.type === key)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function minuteOfDay(value: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (key: string) => Number(parts.find((item) => item.type === key)!.value);
  return part('hour') * 60 + part('minute') + part('second') / 60;
}

export function appointmentEnd(appointment: WorkflowAppointment) {
  const start = Date.parse(appointment.scheduledAt);
  const explicit = appointment.endsAt ? Date.parse(appointment.endsAt) : NaN;
  if (Number.isFinite(explicit) && explicit > start) {
    return { instant: explicit, known: true };
  }
  const duration = appointment.durationMinutes;
  const known = typeof duration === 'number' && Number.isFinite(duration) && duration > 0;
  // Older records can omit a duration. Give their start a visible marker without claiming an end time.
  return { instant: start + (known ? duration : 15) * 60_000, known };
}

export type AppointmentCalendarSegment = {
  appointment: WorkflowAppointment;
  date: string;
  startMinute: number;
  endMinute: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  lane: number;
  laneCount: number;
};

/** Split overnight visits and allocate a lane within each connected overlap group. */
export function appointmentCalendarSegments(
  appointments: WorkflowAppointment[],
  dates: string[],
  timeZone: string,
): AppointmentCalendarSegment[] {
  const result: AppointmentCalendarSegment[] = [];
  for (const appointment of appointments) {
    const startsAt = Date.parse(appointment.scheduledAt);
    if (!Number.isFinite(startsAt)) {
      continue;
    }
    const endsAt = appointmentEnd(appointment).instant;
    const startDate = appointmentDateKey(startsAt, timeZone);
    const endDate = appointmentDateKey(endsAt, timeZone);
    for (const date of dates) {
      if (date < startDate || date > endDate) {
        continue;
      }
      const startMinute = date === startDate ? minuteOfDay(startsAt, timeZone) : 0;
      let endMinute = date === endDate ? minuteOfDay(endsAt, timeZone) : 1440;
      if (date !== startDate && endMinute === 0) {
        continue;
      }
      // A fall-back visit may end at the same displayed time. Preserve its elapsed duration and its label shows both zone offsets.
      if (endMinute <= startMinute) {
        endMinute = Math.min(1440, startMinute + (endsAt - startsAt) / 60_000);
      }
      result.push({
        appointment,
        date,
        startMinute,
        endMinute,
        continuesBefore: date > startDate,
        continuesAfter: date < endDate,
        lane: 0,
        laneCount: 1,
      });
    }
  }
  for (const date of dates) {
    const ordered = result
      .filter((segment) => segment.date === date)
      .sort(
        (left, right) =>
          left.startMinute - right.startMinute ||
          right.endMinute - left.endMinute ||
          left.appointment.id.localeCompare(right.appointment.id),
      );
    let group: AppointmentCalendarSegment[] = [];
    let groupEnd = -1;
    let laneEnds: number[] = [];
    const finishGroup = () => {
      for (const item of group) {
        item.laneCount = laneEnds.length;
      }
    };
    for (const segment of ordered) {
      if (segment.startMinute >= groupEnd) {
        finishGroup();
        group = [];
        laneEnds = [];
      }
      let lane = laneEnds.findIndex((end) => end <= segment.startMinute);
      if (lane < 0) {
        lane = laneEnds.length;
      }
      laneEnds[lane] = segment.endMinute;
      segment.lane = lane;
      group.push(segment);
      groupEnd = Math.max(...group.map((item) => item.endMinute));
    }
    finishGroup();
  }
  return result;
}
