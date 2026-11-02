"use client";

import { AccessLoading } from "@/components/access/AccessLoading";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/i18n/provider";
import { InterviewIcon } from "@/components/InterviewIcon";
import { patientName as workflowPatientName, type Lookup, type WorkflowAppointment, type WorkflowPatient } from "@/lib/api/workflow";
import { appointmentCalendarSegments, appointmentDateKey, appointmentEnd, appointmentWeekDates, shiftAppointmentDate } from "@/lib/appointment-calendar";
import { workflowStatus } from "./workflow-i18n";
import "./appointment-planner.css";

const english = {
  week: "Week View", previous: "Previous Week", next: "Next Week", current: "Current Week", jump: "Jump To Date",
  provider: "Provider", allProviders: "All Providers", unavailableProvider: "Provider Not Assigned", unavailablePatient: "Patient Unavailable", visit: "Appointment",
  findTime: "Find A Time", findHint: "Choose a provider, date and visit length to check their availability.", date: "Date", duration: "Duration In Minutes", chooseProvider: "Choose A Provider", check: "Check Availability", checking: "Checking…", close: "Close Availability",
  noSlots: "No available times match this search. Try another date or provider.", available: "Available Times", bookTime: "Book This Time", availabilityHint: "Times reflect provider hours and existing bookings. Availability is checked again when you book.",
  calendar: "Weekly Appointment Calendar", agenda: "Appointments This Week", empty: "No Appointments This Week", emptyProvider: "No Appointments For This Provider This Week", emptyDay: "No Appointments", emptyHint: "Use Find a time to check provider availability.",
  loading: "Loading The Week…", incomplete: "More appointments are available. Load the remaining appointments to complete this week.", loadMore: "Load More Appointments", loaded: "appointments loaded", singular: "appointment", plural: "appointments", selectedHint: "Select a visit to view its details or reschedule.", locationTime: "Location Time", unknownDuration: "Duration Not Recorded", minutes: "min", continues: "Continues", until: "until",
} as const;
const spanish: Record<keyof typeof english, string> = {
  week: "Vista Semanal", previous: "Semana Anterior", next: "Semana Siguiente", current: "Semana Actual", jump: "Ir A La Fecha",
  provider: "Proveedor", allProviders: "Todos Los Proveedores", unavailableProvider: "Sin Proveedor Asignado", unavailablePatient: "Paciente No Disponible", visit: "Cita",
  findTime: "Buscar Horario", findHint: "Seleccione un proveedor, la fecha y la duración para consultar su disponibilidad.", date: "Fecha", duration: "Duración En Minutos", chooseProvider: "Seleccione Un Proveedor", check: "Consultar Disponibilidad", checking: "Consultando…", close: "Cerrar Disponibilidad",
  noSlots: "No hay horarios disponibles para esta búsqueda. Pruebe otra fecha u otro proveedor.", available: "Horarios Disponibles", bookTime: "Reservar Este Horario", availabilityHint: "Los horarios consideran la disponibilidad del proveedor y las citas existentes. Se verifican de nuevo al reservar.",
  calendar: "Calendario Semanal De Citas", agenda: "Citas De Esta Semana", empty: "No Hay Citas Esta Semana", emptyProvider: "Este Proveedor No Tiene Citas Esta Semana", emptyDay: "Sin Citas", emptyHint: "Use Buscar horario para consultar la disponibilidad del proveedor.",
  loading: "Cargando La Semana…", incomplete: "Hay más citas disponibles. Cargue las restantes para completar esta semana.", loadMore: "Cargar Más Citas", loaded: "citas cargadas", singular: "cita", plural: "citas", selectedHint: "Seleccione una cita para ver sus detalles o reprogramarla.", locationTime: "Hora Local", unknownDuration: "Duración No Registrada", minutes: "min", continues: "Continúa", until: "hasta",
};

export type AppointmentPlannerAvailabilityInput = { date: string; providerId: string; durationMinutes: number; signal?: AbortSignal };
export type AppointmentPlannerSlot = { startsAt: string; endsAt?: string };
export type AppointmentPlannerBooking = { scheduledAt: string; providerId?: string; durationMinutes?: number };
export type AppointmentPlannerProps = {
  date: string;
  timeZone: string;
  appointments: WorkflowAppointment[];
  patients: WorkflowPatient[];
  providers: Lookup[];
  visitTypes: Lookup[];
  selectedAppointmentId?: string | null;
  loading?: boolean;
  error?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  busy?: boolean;
  canBook: boolean;
  availabilityScope?: object;
  onDateChange: (date: string) => void;
  onSelect: (appointment: WorkflowAppointment) => void;
  onBook: (booking: AppointmentPlannerBooking) => void;
  onLoadMore?: () => void;
  onCheckAvailability?: (input: AppointmentPlannerAvailabilityInput) => Promise<{ slots: AppointmentPlannerSlot[] }>;
};

const pixelsPerMinute = 1.6;
const dateInstant = (value: string) => new Date(`${value}T12:00:00Z`);

export function AppointmentPlanner({ date, timeZone, appointments, patients, providers, visitTypes, selectedAppointmentId, loading = false, error, hasMore = false, loadingMore = false, busy = false, canBook, availabilityScope, onDateChange, onSelect, onBook, onLoadMore, onCheckAvailability }: AppointmentPlannerProps) {
  const { locale, formatNumber, uiError } = useI18n();
  const text = locale === "es" ? spanish : english;
  const [providerId, setProviderId] = useState("");
  const [findingTime, setFindingTime] = useState(false);
  const [availableDate, setAvailableDate] = useState(date);
  const [availableProvider, setAvailableProvider] = useState("");
  const [duration, setDuration] = useState("30");
  const [availability, setAvailability] = useState<{ key: string; scope?: object; appointments?: WorkflowAppointment[]; loading?: boolean; slots?: AppointmentPlannerSlot[]; error?: string }>({ key: "" });
  const availabilityRequest = useRef<AbortController | null>(null);
  const availabilitySequence = useRef(0);
  useEffect(() => () => { availabilityRequest.current?.abort(); availabilitySequence.current++; }, [date, timeZone, canBook, availabilityScope, appointments, loading]);

  const dates = appointmentWeekDates(date);
  const today = appointmentDateKey(new Date(), timeZone);
  const visibleAppointments = appointments.filter(appointment => !providerId || appointment.providerId === providerId);
  const segments = appointmentCalendarSegments(visibleAppointments, dates, timeZone);
  const visibleIds = new Set(segments.map(segment => segment.appointment.id));
  const weekAppointments = visibleAppointments.filter(appointment => visibleIds.has(appointment.id)).sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt) || left.id.localeCompare(right.id));
  const startMinute = Math.max(0, Math.min(8 * 60, ...segments.map(segment => Math.floor(segment.startMinute / 60) * 60)));
  const endMinute = Math.min(1440, Math.max(18 * 60, ...segments.map(segment => Math.ceil(segment.endMinute / 60) * 60)));
  const hours = Array.from({ length: Math.ceil((endMinute - startMinute) / 60) }, (_, index) => startMinute + index * 60);
  const weekRange = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).formatRange(dateInstant(dates[0]), dateInstant(dates[6]));
  const calendarDate = (value: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(dateInstant(value));
  const time = (value: string | number, includeZone = false) => new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit", ...(includeZone ? { timeZoneName: "short" as const } : {}) }).format(new Date(value));
  const providerName = (appointment: WorkflowAppointment) => providers.find(provider => provider.id === appointment.providerId)?.name ?? appointment.provider?.displayName ?? appointment.provider?.name ?? text.unavailableProvider;
  const patientName = (appointment: WorkflowAppointment) => {
    const patient = patients.find(item => item.id === appointment.patientId) ?? appointment.patient;
    return workflowPatientName(patient, locale);
  };
  const visitName = (appointment: WorkflowAppointment) => visitTypes.find(visit => visit.id === appointment.visitTypeId)?.name ?? text.visit;
  const timeRange = (appointment: WorkflowAppointment, includeZone = false) => {
    const end = appointmentEnd(appointment);
    return `${time(appointment.scheduledAt, includeZone)}${end.known ? `–${time(end.instant, includeZone)}` : ""}`;
  };
  const accessibleName = (appointment: WorkflowAppointment) => `${patientName(appointment)}, ${new Intl.DateTimeFormat(locale, { timeZone, weekday: "long", month: "long", day: "numeric" }).format(new Date(appointment.scheduledAt))}, ${timeRange(appointment, true)}, ${providerName(appointment)}, ${visitName(appointment)}, ${workflowStatus(locale, appointment.status)}`;
  const colorFor = (id?: string | null) => id ? Math.max(0, providers.findIndex(provider => provider.id === id)) % 6 : 6;
  const queryKey = `${date}|${timeZone}|${availableDate}|${availableProvider}|${duration}`;
  const currentAvailability = !loading && availability.key === queryKey && availability.scope === availabilityScope && availability.appointments === appointments ? availability : undefined;
  const canSearch = /^\d{4}-\d{2}-\d{2}$/.test(availableDate) && providers.some(provider => provider.id === availableProvider && provider.status !== "inactive") && Number.isInteger(Number(duration)) && Number(duration) >= 5 && Number(duration) <= 480;
  const cancelAvailability = () => { availabilityRequest.current?.abort(); availabilitySequence.current++; setAvailability({ key: "" }); };
  const navigate = (next: string) => { cancelAvailability(); setFindingTime(false); onDateChange(next); };
  async function checkAvailability() {
    if (!canBook || !onCheckAvailability || !canSearch || busy || loading) return;
    availabilityRequest.current?.abort();
    const controller = new AbortController(); availabilityRequest.current = controller;
    const sequence = ++availabilitySequence.current;
    const requestedKey = queryKey;
    setAvailability({ key: requestedKey, scope: availabilityScope, appointments, loading: true });
    try {
      const result = await onCheckAvailability({ date: availableDate, providerId: availableProvider, durationMinutes: Number(duration), signal: controller.signal });
      if (!controller.signal.aborted && sequence === availabilitySequence.current) setAvailability({ key: requestedKey, scope: availabilityScope, appointments, slots: result.slots.filter(slot => Number.isFinite(Date.parse(slot.startsAt)) && appointmentDateKey(slot.startsAt, timeZone) === availableDate) });
    } catch (cause) {
      if (!controller.signal.aborted && sequence === availabilitySequence.current) setAvailability({ key: requestedKey, scope: availabilityScope, appointments, error: uiError(cause, "workflow.text.availabilityCouldNotBeLoaded") });
    }
  }

  return <section className="wf-planner" aria-label={text.calendar} aria-busy={loading}>
    <div className="wf-planner-toolbar">
      <div className="wf-planner-navigation">
        <div className="wf-planner-arrows"><button type="button" className="wf-button wf-planner-arrow" aria-label={text.previous} onClick={() => navigate(shiftAppointmentDate(date, -7))} disabled={busy}><InterviewIcon name="chevron-left" /></button><button type="button" className="wf-button wf-planner-arrow" aria-label={text.next} onClick={() => navigate(shiftAppointmentDate(date, 7))} disabled={busy}><InterviewIcon name="chevron-right" /></button></div>
        <div><h2>{weekRange}</h2><span className="wf-planner-view">{text.week}</span></div>
        <button type="button" className="wf-button wf-planner-current" onClick={() => navigate(today)} disabled={busy}>{text.current}</button>
        <label className="wf-planner-jump"><span className="wf-planner-sr">{text.jump}</span><input type="date" value={date} aria-label={text.jump} disabled={busy} onChange={event => { if (event.target.value) navigate(event.target.value); }} /></label>
      </div>
      <div className="wf-planner-controls"><label className="wf-planner-provider"><span className="wf-planner-sr">{text.provider}</span><select aria-label={text.provider} value={providerId} disabled={busy} onChange={event => { cancelAvailability(); setProviderId(event.target.value); }}><option value="">{text.allProviders}</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>{canBook && onCheckAvailability && <button type="button" className="wf-button wf-planner-find" aria-expanded={findingTime} aria-controls="appointment-availability" disabled={busy || loading} onClick={() => { cancelAvailability(); setFindingTime(value => !value); setAvailableDate(date); setAvailableProvider(providerId || (providers.length === 1 ? providers[0].id : "")); }}><InterviewIcon name="clock" />{text.findTime}</button>}</div>
    </div>
    {canBook && findingTime && onCheckAvailability && <section id="appointment-availability" className="wf-planner-availability" aria-label={text.findTime}>
      <div className="wf-planner-availability-heading"><div><h3>{text.findTime}</h3><p>{text.findHint}</p></div><button type="button" className="wf-button" aria-label={text.close} onClick={() => { cancelAvailability(); setFindingTime(false); }}>×</button></div>
      <form className="wf-planner-availability-form" onSubmit={event => { event.preventDefault(); void checkAvailability(); }}>
        <label className="wf-field"><span>{text.provider}</span><select required value={availableProvider} disabled={busy} onChange={event => { cancelAvailability(); setAvailableProvider(event.target.value); }}><option value="">{text.chooseProvider}</option>{providers.filter(provider => provider.status !== "inactive").map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
        <label className="wf-field"><span>{text.date}</span><input type="date" required value={availableDate} disabled={busy} onChange={event => { cancelAvailability(); setAvailableDate(event.target.value); }} /></label>
        <label className="wf-field"><span>{text.duration}</span><input type="number" min="5" max="480" step="1" required value={duration} disabled={busy} onChange={event => { cancelAvailability(); setDuration(event.target.value); }} /></label>
        <button type="submit" className="wf-button" disabled={!canSearch || busy || loading || !!currentAvailability?.loading}>{currentAvailability?.loading ? <AccessLoading label={text.checking} inline /> : text.check}</button>
      </form>
      <div aria-live="polite">{currentAvailability?.error && <p className="wf-notice wf-error" role="alert">{currentAvailability.error}</p>}{currentAvailability?.slots && (currentAvailability.slots.length ? <div className="wf-planner-slots" aria-label={text.available}>{currentAvailability.slots.map(slot => <button type="button" className="wf-button" key={slot.startsAt} disabled={busy || loading} aria-label={`${text.bookTime}: ${time(slot.startsAt, true)}`} onClick={() => onBook({ scheduledAt: slot.startsAt, providerId: availableProvider, durationMinutes: Number(duration) })}>{time(slot.startsAt)}</button>)}</div> : <p className="wf-planner-no-slots">{text.noSlots}</p>)}</div>
      <p className="wf-planner-availability-note">{text.availabilityHint}</p>
    </section>}
    {error && <p className="wf-notice wf-error" role="alert">{error}</p>}
    {loading ? <AccessLoading label={text.loading} panel /> : !error && <>
      {hasMore && <div className="wf-planner-incomplete"><p role="status">{text.incomplete}</p>{onLoadMore && <button type="button" className="wf-button" disabled={loadingMore || busy} onClick={onLoadMore}>{loadingMore ? <AccessLoading label={text.loading} inline /> : text.loadMore}</button>}</div>}
      <div className="wf-planner-calendar">
        <div className="wf-planner-desktop"><div className="wf-planner-scroll">
          <div className="wf-planner-week-header"><div className="wf-planner-time-corner"><InterviewIcon name="clock" /></div>{dates.map(day => <div key={day} data-today={day === today}><span>{calendarDate(day, { weekday: "short" })}</span><strong>{calendarDate(day, { day: "numeric" })}</strong></div>)}</div>
          <div className="wf-planner-grid" style={{ height: (endMinute - startMinute) * pixelsPerMinute }}>
            <div className="wf-planner-time-axis">{hours.map(minute => <span key={minute} style={{ top: (minute - startMinute) * pixelsPerMinute }}>{new Intl.DateTimeFormat(locale, { timeZone: "UTC", hour: "numeric" }).format(new Date(Date.UTC(2026, 0, 1, minute / 60)))}</span>)}</div>
            {dates.map(day => <div key={day} className="wf-planner-day" data-today={day === today} style={{ "--planner-hour-height": `${60 * pixelsPerMinute}px` } as CSSProperties} aria-label={calendarDate(day, { weekday: "long", month: "long", day: "numeric" })}>{segments.filter(segment => segment.date === day).map(segment => {
              const appointment = segment.appointment;
              return <button type="button" key={appointment.id} className="wf-planner-event" data-color={colorFor(appointment.providerId)} data-status={appointment.status} data-selected={appointment.id === selectedAppointmentId} data-compact={segment.endMinute - segment.startMinute < 40} data-short={segment.endMinute - segment.startMinute < 25} aria-pressed={appointment.id === selectedAppointmentId} aria-label={accessibleName(appointment)} title={accessibleName(appointment)} disabled={busy} style={{ top: (segment.startMinute - startMinute) * pixelsPerMinute, height: Math.max(12, (segment.endMinute - segment.startMinute) * pixelsPerMinute - 3), insetInlineStart: `calc(${segment.lane * 100 / segment.laneCount}% + 3px)`, width: `calc(${100 / segment.laneCount}% - 6px)` }} onClick={() => onSelect(appointment)}><strong>{patientName(appointment)}</strong><span>{segment.continuesBefore ? `${text.continues} · ` : ""}{timeRange(appointment)}</span><small>{visitName(appointment)}</small><small className="wf-planner-event-provider">{providerName(appointment)}</small>{["cancelled", "no_show"].includes(appointment.status) && <small>{workflowStatus(locale, appointment.status)}</small>}</button>;
            })}</div>)}
            {weekAppointments.length === 0 && <div className="wf-planner-empty"><InterviewIcon name="calendar" /><h3>{providerId ? text.emptyProvider : text.empty}</h3>{canBook && onCheckAvailability && <p>{text.emptyHint}</p>}</div>}
          </div>
        </div></div>
        <div className="wf-planner-agenda" aria-label={text.agenda}>{dates.map(day => {
          const dayAppointments = weekAppointments.filter(appointment => segments.some(segment => segment.date === day && segment.appointment.id === appointment.id));
          return <section key={day} className="wf-planner-agenda-day" data-today={day === today}><h3>{calendarDate(day, { weekday: "long", month: "short", day: "numeric" })}<small>{formatNumber(dayAppointments.length)}</small></h3>{dayAppointments.length ? dayAppointments.map(appointment => <button type="button" className="wf-planner-agenda-event" key={appointment.id} data-color={colorFor(appointment.providerId)} data-selected={appointment.id === selectedAppointmentId} aria-pressed={appointment.id === selectedAppointmentId} disabled={busy} aria-label={accessibleName(appointment)} onClick={() => onSelect(appointment)}><span className="wf-planner-agenda-time">{appointmentDateKey(appointment.scheduledAt, timeZone) < day ? text.continues : time(appointment.scheduledAt)}</span><span><strong>{patientName(appointment)}</strong><span>{visitName(appointment)} · {providerName(appointment)}</span><small>{timeRange(appointment, true)} · {workflowStatus(locale, appointment.status)}{!appointmentEnd(appointment).known ? ` · ${text.unknownDuration}` : ""}</small></span><InterviewIcon name="chevron-right" /></button>) : <p>{text.emptyDay}</p>}</section>;
        })}</div>
        <div className="wf-planner-footer"><span>{text.locationTime} · {timeZone}</span><span>{formatNumber(weekAppointments.length)} {hasMore ? text.loaded : weekAppointments.length === 1 ? text.singular : text.plural}</span><div className="wf-planner-legend">{providers.filter(provider => !providerId || provider.id === providerId).map(provider => <span key={provider.id}><i data-color={colorFor(provider.id)} aria-hidden="true" />{provider.name}</span>)}</div></div>
      </div>
      <p className="wf-planner-hint"><InterviewIcon name="calendar" />{text.selectedHint}</p>
    </>}
  </section>;
}
