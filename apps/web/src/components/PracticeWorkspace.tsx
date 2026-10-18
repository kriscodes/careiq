"use client";

import { useI18n } from "@/i18n/provider";
import { localizeAccessText, accessStatusLabel, accessZoneLabel } from "@/components/access/display";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import { UserButton, useAuth, useUser, useSession } from "@clerk/nextjs";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AuthenticatedWorkflow } from "./workflow/AuthenticatedWorkflow";
import { ApiError } from "@/lib/api/client";
import type { AccessContext } from "@/lib/api/practice";
import { PracticeAccess, PracticePicker, type AccessView } from "./PracticeAccess";
import { AuthScreen } from "./access/AuthScreen";
import { SessionTasks } from "./access/SessionTasks";
import { NO_CAPABILITIES, practiceCapabilities, type PracticeCapabilities } from "@/lib/capabilities";
import { createSubmissionAttempt } from "@/lib/submission-attempt";
import { createPatient, getPatients, type CreatePatientInput, type Patient } from "@/lib/api/patients";
import { createAppointment, getAppointments, type Appointment, type CreateAppointmentInput } from "@/lib/api/appointments";
import { dateFromKey, localDateKey, shiftDate, weekDates } from "@/lib/interview-dates";
import { InterviewIcon as Icon } from "./InterviewIcon";
import { BookingForm, PatientForm, type BookingDraft } from "./InterviewForms";
import { InterviewModal } from "./InterviewModal";
import { InterviewArchitectureNotes, InterviewReviewerBar } from "./InterviewNotes";

const fullName = (patient?: Patient) => patient ? `${patient.firstName} ${patient.lastName}` : "";
const initials = (patient?: Patient) => patient ? `${patient.firstName.slice(0, 1)}${patient.lastName.slice(0, 1)}` : "–";
const sortPatients = (a: Patient, b: Patient) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
const sortAppointments = (a: Appointment, b: Appointment) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt);


function Logo() {

  return <div className="cq-logo" aria-label="CareIQ"><span className="cq-symbol" aria-hidden="true" />careiq</div>;
}

export function PracticeWorkspace({ interviewMode = false, initialView = "entry", returnTo, intendedOrganizationId }: { interviewMode?: boolean; initialView?: AccessView; returnTo?: string; intendedOrganizationId?: string }) {
  const { t } = useI18n();
  const { isLoaded, isSignedIn, userId, orgId } = useAuth();
  const { session } = useSession();
  const [notesOpen, setNotesOpen] = useState(false);
  return <div>
    {interviewMode && <InterviewReviewerBar onOpen={() => setNotesOpen(true)} />}
    {!isLoaded ? <AuthScreen returnTo={returnTo} /> : session?.currentTask ? <SessionTasks returnTo={returnTo} /> : !isSignedIn ? <AuthScreen returnTo={returnTo} /> :
      <PracticeAccess key={`${userId}:${orgId ?? "new"}`} orgId={orgId} initialView={initialView} intendedOrganizationId={intendedOrganizationId}>{(context, locationId, onAccessDenied) => locationId ? <AuthenticatedWorkflow key={`${userId}:${orgId}:${locationId}`} orgId={orgId!} locationId={locationId} practiceName={context.practice?.name ?? t("access.copy.your_practice")} onAccessDenied={onAccessDenied} /> : <PracticeData key={`${userId}:${orgId}:legacy`} orgId={orgId!} context={context} onAccessDenied={onAccessDenied} />}</PracticeAccess>}
    {notesOpen && <InterviewModal title={t("access.copy.behind_the_front_desk")} description={t("access.copy.architecture_notes_for_interview_reviewers_separate_from_the_staff_applica")} onClose={() => setNotesOpen(false)} developerNotes><InterviewArchitectureNotes /></InterviewModal>}
  </div>;
}

function PracticeData({ orgId, context, locationId, onAccessDenied }: { orgId: string; context: AccessContext; locationId?: string; onAccessDenied: () => void }) {
  const { t, uiError, locale, formatDate, formatNumber } = useI18n();
  // Translation changes update notifications without restarting access checks or clearing form drafts.
  const onLoadText = useEffectEvent((value: unknown, fallback?: string) => typeof value === "string" ? t(value) : uiError(value, fallback));
  const { getToken } = useAuth();
  const { user } = useUser();
  const active = useRef(true);
  const lifetime = useRef<AbortController | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const practiceName = context.practice?.name ?? t("access.copy.your_practice");
  const [capabilities, setCapabilities] = useState<PracticeCapabilities>(NO_CAPABILITIES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<"schedule" | "patients">("schedule");
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
  const [selectedAppointment, setSelectedAppointment] = useState<string | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"patient" | "booking" | null>(null);
  const [busy, setBusy] = useState(false);
  const [continueBooking, setContinueBooking] = useState(false);
  const [bookingAttempt, setBookingAttempt] = useState(() => createSubmissionAttempt());
  const [draft, setDraft] = useState<BookingDraft>({ patientId: "", date: selectedDate, time: "09:00", reason: "" });
  const [toast, setToast] = useState("");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dayLabel = (key: string) => formatDate(dateFromKey(key), { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const timeLabel = (timestamp: string) => formatDate(timestamp, { hour: "numeric", minute: "2-digit" });

  useEffect(() => {
    active.current = true;
    const controller = new AbortController(); lifetime.current = controller;
    return () => { active.current = false; controller.abort(); };
  }, []);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    async function load() {
      try {
        const token = await getToken({ organizationId: orgId, skipCache: true });
        if (!current) return;
        if (!token) throw new Error(onLoadText("access.copy.your_session_has_expired_please_sign_in_again"));
        const access = practiceCapabilities(context.capabilities);
        const [patientData, appointmentData] = await Promise.all([
          access.patients.read ? getPatients(token, locationId, controller.signal) : [],
          access.appointments.read ? getAppointments(token, locationId, controller.signal) : [],
        ]);
        if (!current) return;
        setCapabilities(access);
        setPatients(patientData.sort(sortPatients));
        setAppointments(appointmentData.sort(sortAppointments));
        setError(null);
      } catch (cause) {
        if (current) { setPatients([]); setAppointments([]); setModal(null); setSearch(""); setSelectedPatient(null); setSelectedAppointment(null); setDraft(value => ({ ...value, patientId: "", reason: "" })); setCapabilities(NO_CAPABILITIES); setError(onLoadText(cause, "access.copy.unable_to_load_this_practice")); }
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => { current = false; controller.abort(); };
  }, [getToken, orgId, context.capabilities, locationId, attempt]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function mutationToken() {
    const token = await getToken({ organizationId: orgId, skipCache: true });
    // A practice change remounts the workspace. Never send its old draft in the new context.
    if (!active.current) throw new Error(t("access.copy.the_active_practice_changed_open_the_form_again"));
    if (!token) throw new Error(t("access.copy.your_session_has_expired_please_sign_in_again"));
    return token;
  }

  function openBooking(patientId = "") {
    if (!capabilities.appointments.create || !capabilities.patients.read) return;
    setBookingAttempt(createSubmissionAttempt());
    setDraft({ patientId, date: selectedDate, time: "09:00", reason: "" });
    setContinueBooking(false);
    setModal("booking");
  }

  function openPatient() { if (!capabilities.patients.create) return; setContinueBooking(false); setModal("patient"); }
  function closeModal() { if (!busy) { setModal(null); setContinueBooking(false); } }

  async function savePatient(input: CreatePatientInput, idempotencyKey: string) {
    if (!capabilities.patients.create) throw new Error(t("access.copy.your_practice_role_cannot_create_patients_ask_a_practice_administrator_for"));
    const patient = await createPatient(await mutationToken(), input, idempotencyKey, locationId, lifetime.current?.signal).catch(cause => {
      if (active.current && cause instanceof ApiError && [401, 403, 409].includes(cause.status)) {
        setPatients([]); setAppointments([]); setModal(null); setCapabilities(NO_CAPABILITIES); onAccessDenied();
      }
      throw cause;
    });
    if (!active.current) return;
    setPatients(current => [...current, patient].sort(sortPatients));
    setSelectedPatient(patient.id);
    setSearch("");
    setToast(t("access.copy.patient_created"));
    if (continueBooking) {
      setDraft(current => ({ ...current, patientId: patient.id }));
      setContinueBooking(false);
      setModal("booking");
    } else {
      setView("patients");
      setModal(null);
    }
  }

  async function saveAppointment(input: CreateAppointmentInput, idempotencyKey: string) {
    if (!capabilities.appointments.create) throw new Error(t("access.copy.your_practice_role_cannot_schedule_appointments_ask_a_practice_administrat"));
    const appointment = await createAppointment(await mutationToken(), input, idempotencyKey, locationId, lifetime.current?.signal).catch(cause => {
      if (active.current && cause instanceof ApiError && [401, 403, 409].includes(cause.status)) {
        setPatients([]); setAppointments([]); setModal(null); setCapabilities(NO_CAPABILITIES); onAccessDenied();
      }
      throw cause;
    });
    if (!active.current) return;
    setAppointments(current => [...current, appointment].sort(sortAppointments));
    setSelectedAppointment(appointment.id);
    setSelectedDate(localDateKey(new Date(appointment.scheduledAt)));
    setView("schedule");
    setModal(null);
    setToast(t("access.copy.appointment_scheduled"));
  }

  const visits = appointments.filter(appointment => localDateKey(new Date(appointment.scheduledAt)) === selectedDate);
  const query = search.trim().toLocaleLowerCase();
  const filteredPatients = patients.filter(patient => [fullName(patient), patient.email, patient.phone].some(value => value?.toLocaleLowerCase().includes(query)));
  const visit = visits.find(appointment => appointment.id === selectedAppointment) ?? visits[0];
  const patient = view === "schedule" ? patients.find(item => item.id === visit?.patientId) : filteredPatients.find(item => item.id === selectedPatient) ?? filteredPatients[0];
  const days = weekDates(selectedDate);
  const visibleCount = view === "schedule" ? visits.length : filteredPatients.length;
  const canSchedule = capabilities.appointments.create && capabilities.patients.read;
  const canReadView = view === "schedule" ? capabilities.appointments.read : capabilities.patients.read;

  return <div className="cq-shell">
    <aside className="cq-sidebar">
      <Logo /><PracticePicker />
      <nav className="cq-nav" aria-label={t("access.copy.practice_navigation")}>
        <button className="cq-navbutton" aria-current={view === "schedule" ? "page" : undefined} onClick={() => setView("schedule")}><Icon name="calendar" />{t("access.copy.schedule")}</button>
        <button className="cq-navbutton" aria-current={view === "patients" ? "page" : undefined} onClick={() => setView("patients")}><Icon name="users" />{t("access.copy.patients")}{!loading && !error && <span className="cq-count">{formatNumber(patients.length)}</span>}</button>
      </nav>
      <div className="cq-account"><UserButton /><div><strong>{user?.firstName || t("access.copy.your_account")}</strong><span>{t("access.copy.practice_workspace")}</span></div></div>
    </aside>
    <div className="cq-workspace">
      <header className="cq-topbar"><div className="cq-breadcrumb"><Icon name="building" /><span>{practiceName || t("access.copy.your_practice")}</span>{locationId && <><span aria-hidden="true">/</span><span>{context.locations.find(location => location.id === locationId)?.name}</span></>}<span aria-hidden="true">/</span><strong>{view === "schedule" ? t("access.copy.schedule") : t("access.copy.patients")}</strong></div><LanguageSelector /></header>
      <main className="cq-main" data-cq-dialog-focus-fallback>
        {loading ? <div className="cq-empty" role="status"><Icon name="calendar" /><h1>{t("access.copy.opening_your_front_desk")}</h1><p>{t("access.copy.loading_your_practice_patients_and_appointments")}</p></div> : error ? <div className="cq-empty"><h1>{t("access.copy.we_couldn_t_open_this_practice")}</h1><p className="cq-error" role="alert">{localizeAccessText(t, error)}</p><button className="cq-button" onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>{t("access.copy.try_again")}</button></div> : <>
          {!capabilities.patients.create && !capabilities.appointments.create && <p className="cq-access-note" role="status">{t("access.copy.your_current_role_does_not_allow_creating_patients_or_appointments_ask_you")}</p>}
          <div className="cq-heading"><div><p className="cq-kicker">{t("access.copy.your_front_desk_in_focus")}</p><h1>{view === "schedule" ? t("access.copy.a_little_more_room_to_care") : t("access.copy.good_care_starts_with_people")}</h1><p>{view === "schedule" ? dayLabel(selectedDate) : t("access.copy.a_familiar_face_the_right_details_all_in_one_place")}</p></div><div className="cq-actions"><button className="cq-button" disabled={!capabilities.patients.create} onClick={openPatient}><Icon name="user-plus" />{t("access.copy.new_patient")}</button><button className="cq-button cq-primary" disabled={!canSchedule} onClick={() => openBooking()}><Icon name="plus" />{t("access.copy.schedule_visit")}</button></div></div>
          {view === "schedule" && <><div className="cq-calendar-tools"><div><button className="cq-iconbutton" aria-label={t("access.copy.previous_week")} onClick={() => setSelectedDate(shiftDate(selectedDate, -7))}><Icon name="chevron-left" /></button><button className="cq-iconbutton" aria-label={t("access.copy.next_week")} onClick={() => setSelectedDate(shiftDate(selectedDate, 7))}><Icon name="chevron-right" /></button><button className="cq-button cq-today" onClick={() => setSelectedDate(localDateKey(new Date()))}>{t("access.copy.today")}</button></div><label className="cq-date-jump">{t("access.copy.go_to_date")}<input className="cq-input" aria-label={t("access.copy.go_to_date")} type="date" value={selectedDate} onChange={event => { if (event.target.value) setSelectedDate(event.target.value); }} /></label></div><div className="cq-days" role="group" aria-label={t("access.copy.choose_a_day")}>{days.map(day => <button key={day} className="cq-day" aria-label={dayLabel(day)} aria-pressed={day === selectedDate} onClick={() => setSelectedDate(day)}><span>{formatDate(dateFromKey(day), { weekday: "short" })}</span><strong>{formatNumber(dateFromKey(day).getDate())}</strong></button>)}</div></>}
          <div className="cq-contentgrid">
            <section className="cq-surface" aria-label={view === "schedule" ? t("access.copy.appointments") : t("access.copy.patient_directory")}>
              <div className="cq-section-head"><h2>{view === "schedule" ? t("access.copy.appointments") : t("access.copy.your_patients")}</h2><span className="cq-muted">{t(view === "schedule" ? "access.workspace.appointmentCount" : "access.workspace.patientCount", { count: visibleCount })}</span></div>
              {view === "patients" && <div className="cq-patient-tools"><label className="cq-field">{t("access.copy.find_a_patient")}<input type="search" className="cq-input" placeholder={t("access.copy.search_name_email_or_phone")} value={search} onChange={event => setSearch(event.target.value)} /></label></div>}
              {!canReadView ? <div className="cq-empty"><h3>{t("access.copy.access_is_not_available")}</h3><p>{t("access.copy.your_practice_role_does_not_have_permission_to_view_these_records_ask_a_pr")}</p></div> : !visibleCount ? <div className="cq-empty"><Icon name={view === "schedule" ? "calendar" : "users"} /><h3>{view === "schedule" ? t("access.copy.a_little_breathing_room") : query ? t("access.copy.no_matching_patients") : t("access.copy.welcome_your_first_patient")}</h3><p>{view === "schedule" ? t("access.copy.no_appointments_on_this_day") : query ? t("access.copy.try_a_different_name_email_or_phone_number") : t("access.copy.create_a_patient_to_start_scheduling_visits")}</p>{view === "schedule" ? <button className="cq-button cq-primary" disabled={!canSchedule} onClick={() => openBooking()}>{t("access.copy.schedule_a_visit")}</button> : !query && <button className="cq-button cq-primary" disabled={!capabilities.patients.create} onClick={openPatient}>{t("access.copy.new_patient")}</button>}</div> : view === "schedule" ? visits.map(item => { const person = patients.find(value => value.id === item.patientId); return <button key={item.id} className="cq-row" aria-pressed={visit?.id === item.id} onClick={() => setSelectedAppointment(item.id)}><span className="cq-time">{timeLabel(item.scheduledAt)}</span><span className="cq-avatar" aria-hidden="true">{initials(person)}</span><span><span className="cq-row-name">{fullName(person) || t("access.copy.patient_unavailable")}</span><span className="cq-row-reason">{item.reason || t("access.copy.appointment")}</span></span><Icon name="chevron-right" /></button>; }) : filteredPatients.map(item => <button key={item.id} className="cq-row cq-patient-row" aria-pressed={patient?.id === item.id} onClick={() => setSelectedPatient(item.id)}><span className="cq-avatar" aria-hidden="true">{initials(item)}</span><span><span className="cq-row-name">{fullName(item)}</span><span className="cq-row-reason">{item.email || item.phone || t("access.copy.no_contact_details_added")}</span></span><Icon name="chevron-right" /></button>)}
              <div className="cq-list-foot"><Icon name={view === "schedule" ? "clock" : "building"} />{view === "schedule" ? t("access.workspace.localTime", { timeZone: accessZoneLabel(locale, timeZone) }) : practiceName}</div>
            </section>
            <aside className="cq-surface cq-detail" aria-label={view === "schedule" ? t("access.copy.selected_appointment") : t("access.copy.selected_patient")}>
              {patient ? <><div className="cq-detail-top"><span className="cq-kicker">{view === "schedule" ? t("access.copy.visit_details") : t("access.copy.patient_details")}</span>{view === "schedule" && visit && <span className="cq-status">{accessStatusLabel(t, visit.status)}</span>}</div><div className="cq-profile-avatar" aria-hidden="true">{initials(patient)}</div><h2 className="cq-profile-name">{fullName(patient)}</h2><p className="cq-muted cq-profile-subtitle">{view === "schedule" ? visit?.reason || t("access.copy.appointment") : t("access.patient.atPractice", { practice: practiceName })}</p>
              {view === "schedule" && visit && <div className="cq-detail-line"><Icon name="calendar" /><div><strong>{dayLabel(selectedDate)}</strong><span>{timeLabel(visit.scheduledAt)} · {timeZone}</span></div></div>}
              <hr /><div className="cq-detail-line"><Icon name="mail" /><div><strong>{t("access.copy.email")}</strong><span>{patient.email || t("access.copy.not_provided")}</span></div></div><div className="cq-detail-line"><Icon name="phone" /><div><strong>{t("access.copy.phone")}</strong><span>{patient.phone || t("access.copy.not_provided")}</span></div></div><hr />
              {view === "schedule" ? <button className="cq-button cq-widebutton" onClick={() => { setSelectedPatient(patient.id); setSearch(""); setView("patients"); }}>{t("access.copy.view_patient")}<Icon name="arrow" /></button> : <button className="cq-button cq-widebutton" disabled={!canSchedule} onClick={() => openBooking(patient.id)}><Icon name="plus" />{t("access.copy.schedule_a_visit")}</button>}</> : <div className="cq-empty"><Icon name="users" /><h3>{t("access.copy.a_fresh_start")}</h3><p>{t("access.copy.select_a_patient_or_schedule_a_visit")}</p></div>}
            </aside>
          </div>
        </>}
        <div className="cq-notification" role="status" aria-live="polite">{toast && <span><Icon name="check" />{localizeAccessText(t, toast)}</span>}</div>
      </main>
    </div>
    {modal && <InterviewModal key={modal} title={modal === "patient" ? t("access.copy.a_new_face_a_warm_welcome") : t("access.copy.make_room_for_good_care")} description={modal === "patient" ? t("access.copy.add_a_patient_to_your_practice") : t("access.copy.schedule_an_appointment_with_the_details_below")} onClose={closeModal} busy={busy}>
      {modal === "patient" ? <PatientForm canCreate={capabilities.patients.create} practiceName={practiceName} onSubmit={savePatient} onBusyChange={setBusy} continueBooking={continueBooking} onCancel={() => { if (continueBooking) { setContinueBooking(false); setModal("booking"); } else closeModal(); }} /> : <BookingForm submissionAttempt={bookingAttempt} canCreate={canSchedule} canAddPatient={capabilities.patients.create} patients={patients} practiceName={practiceName} timeZone={timeZone} draft={draft} onChange={setDraft} onSubmit={saveAppointment} onBusyChange={setBusy} onCancel={closeModal} onAddPatient={() => { if (!capabilities.patients.create) return; setContinueBooking(true); setModal("patient"); }} />}
    </InterviewModal>}
  </div>;
}
