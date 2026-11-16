import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appointmentCalendarSegments,
  appointmentDateKey,
  appointmentEnd,
  appointmentWeekDates,
  shiftAppointmentDate,
} from '../src/lib/appointment-calendar';
import type { WorkflowAppointment } from '../src/lib/api/workflow';

const visit = (
  id: string,
  scheduledAt: string,
  durationMinutes = 30,
  endsAt?: string,
): WorkflowAppointment => ({
  id,
  patientId: `patient-${id}`,
  scheduledAt,
  durationMinutes,
  endsAt,
  status: 'scheduled',
  reason: null,
});

test('weekly navigation follows civil dates across DST, month and year boundaries', () => {
  assert.deepEqual(appointmentWeekDates('2026-11-01'), [
    '2026-10-26',
    '2026-10-27',
    '2026-10-28',
    '2026-10-29',
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
  ]);
  assert.equal(shiftAppointmentDate('2026-11-01', 1), '2026-11-02');
  assert.deepEqual(appointmentWeekDates('2027-01-01'), [
    '2026-12-28',
    '2026-12-29',
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
  ]);
  assert.equal(shiftAppointmentDate('2028-02-28', 1), '2028-02-29');
  assert.throws(() => appointmentWeekDates('2026-02-30'));
});

test('appointment dates use the practice zone when the browser date differs', () => {
  assert.equal(appointmentDateKey('2026-11-01T06:30:00Z', 'America/Los_Angeles'), '2026-10-31');
  assert.equal(appointmentDateKey('2026-11-01T06:30:00Z', 'Asia/Tokyo'), '2026-11-01');
});

test('overnight visits split without a phantom visit on an exact-midnight end', () => {
  const visits = [
    visit('overnight', '2026-10-31T06:30:00Z', 90),
    visit('midnight', '2026-11-01T06:30:00Z', 30),
  ];
  const segments = appointmentCalendarSegments(
    visits,
    ['2026-10-30', '2026-10-31', '2026-11-01'],
    'America/Los_Angeles',
  );
  const overnight = segments.filter((item) => item.appointment.id === 'overnight');
  assert.deepEqual(
    overnight.map((item) => [item.date, item.startMinute, item.endMinute]),
    [
      ['2026-10-30', 1410, 1440],
      ['2026-10-31', 0, 60],
    ],
  );
  assert.equal(overnight[0].continuesAfter, true);
  assert.equal(overnight[1].continuesBefore, true);
  assert.deepEqual(
    segments.filter((item) => item.appointment.id === 'midnight').map((item) => item.date),
    ['2026-10-31'],
  );
});

test('overlapping visits receive separate lanes and touching visits reuse them', () => {
  const segments = appointmentCalendarSegments(
    [
      visit('long', '2026-11-02T17:00:00Z', 90),
      visit('overlap', '2026-11-02T17:30:00Z', 30),
      visit('touching', '2026-11-02T18:00:00Z', 30),
      visit('later', '2026-11-02T19:00:00Z', 30),
    ],
    ['2026-11-02'],
    'America/Los_Angeles',
  );
  assert.deepEqual(
    segments.map((item) => [item.appointment.id, item.lane, item.laneCount]),
    [
      ['long', 0, 2],
      ['overlap', 1, 2],
      ['touching', 1, 2],
      ['later', 0, 1],
    ],
  );
  assert.equal(
    segments.find((item) => item.appointment.id === 'long')!.endMinute - segments[0].startMinute,
    90,
  );
});

test('explicit end timestamps take precedence and legacy missing durations are not asserted', () => {
  const appointment = visit('explicit', '2026-11-02T17:00:00Z', 30, '2026-11-02T18:15:00Z');
  assert.equal(appointmentEnd(appointment).instant, Date.parse('2026-11-02T18:15:00Z'));
  const legacy = { ...appointment, endsAt: null, durationMinutes: undefined };
  assert.equal(appointmentEnd(legacy).known, false);
  assert.equal(
    appointmentCalendarSegments([appointment], ['2026-11-02'], 'America/Los_Angeles')[0].endMinute,
    615,
  );
});

test('fall-back visits retain positive geometry when their displayed start and end coincide', () => {
  const segments = appointmentCalendarSegments(
    [visit('repeat', '2026-11-01T08:30:00Z', 60)],
    ['2026-11-01'],
    'America/Los_Angeles',
  );
  assert.equal(segments[0].startMinute, 90);
  assert.equal(segments[0].endMinute, 150);
  assert.equal(appointmentEnd(segments[0].appointment).instant, Date.parse('2026-11-01T09:30:00Z'));
});
