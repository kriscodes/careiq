"use client";

import { SignInButton, SignUpButton, UserButton, useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import type { AccessContext } from "@/lib/api/practice";
import { PracticeAccess, PracticePicker } from "./PracticeAccess";
import { NO_CAPABILITIES, practiceCapabilities, type PracticeCapabilities } from "@/lib/capabilities";
import { createSubmissionAttempt } from "@/lib/submission-attempt";
import { createPatient, getPatients, type CreatePatientInput, type Patient } from "@/lib/api/patients";
import { createAppointment, getAppointments, type Appointment, type CreateAppointmentInput } from "@/lib/api/appointments";
import { dateFromKey, localDateKey, shiftDate, weekDates } from "@/lib/interview-dates";
import { InterviewIcon as Icon } from "./InterviewIcon";
import { BookingForm, PatientForm, type BookingDraft } from "./InterviewForms";
import { InterviewModal } from "./InterviewModal";
import { InterviewArchitectureNotes, InterviewReviewerBar } from "./InterviewNotes";

const fullName = (patient?: Patient) => patient ? `${patient.firstName} ${patient.lastName}` : "Patient unavailable";
const initials = (patient?: Patient) => patient ? `${patient.firstName.slice(0, 1)}${patient.lastName.slice(0, 1)}` : "–";
const sortPatients = (a: Patient, b: Patient) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
const sortAppointments = (a: Appointment, b: Appointment) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt);
const dayLabel = (key: string) => dateFromKey(key).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const timeLabel = (timestamp: string) => new Date(timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function Logo() {
  return <div className="cq-logo" aria-label="CareIQ"><span className="cq-symbol" aria-hidden="true" />careiq</div>;
}

export function PracticeWorkspace({ interviewMode = false }: { interviewMode?: boolean }) {
  const { isLoaded, isSignedIn, userId, orgId } = useAuth();
  const [notesOpen, setNotesOpen] = useState(false);
  return <div className="careiq">
    {interviewMode && <InterviewReviewerBar onOpen={() => setNotesOpen(true)} />}
    {!isLoaded ? <main className="cq-welcome"><Logo /><p role="status">Loading your workspace…</p></main> : !isSignedIn ?
      <main className="cq-welcome"><Logo /><span className="cq-kicker">A little more room to care</span><h1>A calmer day at the front desk.</h1><p>Your patients and appointments, together in one thoughtful workspace.</p><div className="cq-actions"><SignInButton mode="modal"><button className="cq-button cq-primary">Sign in<Icon name="arrow" /></button></SignInButton><SignUpButton mode="modal"><button className="cq-button">Create an account</button></SignUpButton></div></main> :
        <PracticeAccess key={`${userId}:${orgId ?? "new"}`} orgId={orgId}>{(context, locationId, onAccessDenied) => <PracticeData key={`${userId}:${orgId}:${locationId ?? "legacy"}`} orgId={orgId!} context={context} locationId={locationId} onAccessDenied={onAccessDenied} />}</PracticeAccess>}
    {notesOpen && <InterviewModal title="Behind the front desk" description="Architecture notes for interview reviewers. Separate from the staff application." onClose={() => setNotesOpen(false)} developerNotes><InterviewArchitectureNotes /></InterviewModal>}
  </div>;
}

function PracticeData({ orgId, context, locationId, onAccessDenied }: { orgId: string; context: AccessContext; locationId?: string; onAccessDenied: () => void }) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const active = useRef(true);
  const lifetime = useRef<AbortController | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const practiceName = context.practice?.name ?? "Your practice";
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
        if (!token) throw new Error("Your session has expired. Please sign in again.");
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
        if (current) { setPatients([]); setAppointments([]); setModal(null); setSearch(""); setSelectedPatient(null); setSelectedAppointment(null); setDraft(value => ({ ...value, patientId: "", reason: "" })); setCapabilities(NO_CAPABILITIES); setError(cause instanceof Error ? cause.message : "Unable to load this practice."); }
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
    if (!active.current) throw new Error("The active practice changed. Open the form again.");
    if (!token) throw new Error("Your session has expired. Please sign in again.");
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
    if (!capabilities.patients.create) throw new Error("Your practice role cannot create patients. Ask a practice administrator for access.");
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
    setToast("Patient created.");
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
    if (!capabilities.appointments.create) throw new Error("Your practice role cannot schedule appointments. Ask a practice administrator for access.");
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
    setToast("Appointment scheduled.");
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
      <nav className="cq-nav" aria-label="Practice navigation">
        <button className="cq-navbutton" aria-current={view === "schedule" ? "page" : undefined} onClick={() => setView("schedule")}><Icon name="calendar" />Schedule</button>
        <button className="cq-navbutton" aria-current={view === "patients" ? "page" : undefined} onClick={() => setView("patients")}><Icon name="users" />Patients{!loading && !error && <span className="cq-count">{patients.length}</span>}</button>
      </nav>
      <div className="cq-account"><UserButton /><div><strong>{user?.firstName || "Your account"}</strong><span>Practice workspace</span></div></div>
    </aside>
    <div className="cq-workspace">
      <header className="cq-topbar"><div className="cq-breadcrumb"><Icon name="building" /><span>{practiceName || "Your practice"}</span><span aria-hidden="true">/</span><strong>{view === "schedule" ? "Schedule" : "Patients"}</strong></div></header>
      <main className="cq-main" data-cq-dialog-focus-fallback>
        {loading ? <div className="cq-empty" role="status"><Icon name="calendar" /><h1>Opening your front desk…</h1><p>Loading your practice, patients, and appointments.</p></div> : error ? <div className="cq-empty"><h1>We couldn’t open this practice.</h1><p className="cq-error" role="alert">{error}</p><button className="cq-button" onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>Try again</button></div> : <>
          {!capabilities.patients.create && !capabilities.appointments.create && <p className="cq-access-note" role="status">Your current role does not allow creating patients or appointments. Ask your practice owner to review your permissions and location assignments.</p>}
          <div className="cq-heading"><div><p className="cq-kicker">YOUR FRONT DESK, IN FOCUS</p><h1>{view === "schedule" ? "A little more room to care." : "Good care starts with people."}</h1><p>{view === "schedule" ? dayLabel(selectedDate) : "A familiar face. The right details. All in one place."}</p></div><div className="cq-actions"><button className="cq-button" disabled={!capabilities.patients.create} onClick={openPatient}><Icon name="user-plus" />New patient</button><button className="cq-button cq-primary" disabled={!canSchedule} onClick={() => openBooking()}><Icon name="plus" />Schedule visit</button></div></div>
          {view === "schedule" && <><div className="cq-calendar-tools"><div><button className="cq-iconbutton" aria-label="Previous week" onClick={() => setSelectedDate(shiftDate(selectedDate, -7))}><Icon name="chevron-left" /></button><button className="cq-iconbutton" aria-label="Next week" onClick={() => setSelectedDate(shiftDate(selectedDate, 7))}><Icon name="chevron-right" /></button><button className="cq-button cq-today" onClick={() => setSelectedDate(localDateKey(new Date()))}>Today</button></div><label className="cq-date-jump">Go to date<input className="cq-input" aria-label="Go to date" type="date" value={selectedDate} onChange={event => { if (event.target.value) setSelectedDate(event.target.value); }} /></label></div><div className="cq-days" role="group" aria-label="Choose a day">{days.map(day => <button key={day} className="cq-day" aria-label={dayLabel(day)} aria-pressed={day === selectedDate} onClick={() => setSelectedDate(day)}><span>{dateFromKey(day).toLocaleDateString(undefined, { weekday: "short" })}</span><strong>{dateFromKey(day).getDate()}</strong></button>)}</div></>}
          <div className="cq-contentgrid">
            <section className="cq-surface" aria-label={view === "schedule" ? "Appointments" : "Patient directory"}>
              <div className="cq-section-head"><h2>{view === "schedule" ? "Appointments" : "Your patients"}</h2><span className="cq-muted">{visibleCount} {view === "schedule" ? "appointments" : "patients"}</span></div>
              {view === "patients" && <div className="cq-patient-tools"><label className="cq-field">Find a patient<input type="search" className="cq-input" placeholder="Search name, email, or phone" value={search} onChange={event => setSearch(event.target.value)} /></label></div>}
              {!canReadView ? <div className="cq-empty"><h3>Access is not available.</h3><p>Your practice role does not have permission to view these records. Ask a practice administrator for access.</p></div> : !visibleCount ? <div className="cq-empty"><Icon name={view === "schedule" ? "calendar" : "users"} /><h3>{view === "schedule" ? "A little breathing room." : query ? "No matching patients." : "Welcome your first patient."}</h3><p>{view === "schedule" ? "No appointments on this day." : query ? "Try a different name, email, or phone number." : "Create a patient to start scheduling visits."}</p>{view === "schedule" ? <button className="cq-button cq-primary" disabled={!canSchedule} onClick={() => openBooking()}>Schedule a visit</button> : !query && <button className="cq-button cq-primary" disabled={!capabilities.patients.create} onClick={openPatient}>New patient</button>}</div> : view === "schedule" ? visits.map(item => { const person = patients.find(value => value.id === item.patientId); return <button key={item.id} className="cq-row" aria-pressed={visit?.id === item.id} onClick={() => setSelectedAppointment(item.id)}><span className="cq-time">{timeLabel(item.scheduledAt)}</span><span className="cq-avatar" aria-hidden="true">{initials(person)}</span><span><span className="cq-row-name">{fullName(person)}</span><span className="cq-row-reason">{item.reason || "Appointment"}</span></span><Icon name="chevron-right" /></button>; }) : filteredPatients.map(item => <button key={item.id} className="cq-row cq-patient-row" aria-pressed={patient?.id === item.id} onClick={() => setSelectedPatient(item.id)}><span className="cq-avatar" aria-hidden="true">{initials(item)}</span><span><span className="cq-row-name">{fullName(item)}</span><span className="cq-row-reason">{item.email || item.phone || "No contact details added"}</span></span><Icon name="chevron-right" /></button>)}
              <div className="cq-list-foot"><Icon name={view === "schedule" ? "clock" : "building"} />{view === "schedule" ? `Local time · ${timeZone}` : practiceName}</div>
            </section>
            <aside className="cq-surface cq-detail" aria-label={view === "schedule" ? "Selected appointment" : "Selected patient"}>
              {patient ? <><div className="cq-detail-top"><span className="cq-kicker">{view === "schedule" ? "VISIT DETAILS" : "PATIENT DETAILS"}</span>{view === "schedule" && visit && <span className="cq-status">{visit.status}</span>}</div><div className="cq-profile-avatar" aria-hidden="true">{initials(patient)}</div><h2 className="cq-profile-name">{fullName(patient)}</h2><p className="cq-muted cq-profile-subtitle">{view === "schedule" ? visit?.reason || "Appointment" : "Patient at " + practiceName}</p>
              {view === "schedule" && visit && <div className="cq-detail-line"><Icon name="calendar" /><div><strong>{dayLabel(selectedDate)}</strong><span>{timeLabel(visit.scheduledAt)} · {timeZone}</span></div></div>}
              <hr /><div className="cq-detail-line"><Icon name="mail" /><div><strong>Email</strong><span>{patient.email || "Not provided"}</span></div></div><div className="cq-detail-line"><Icon name="phone" /><div><strong>Phone</strong><span>{patient.phone || "Not provided"}</span></div></div><hr />
              {view === "schedule" ? <button className="cq-button cq-widebutton" onClick={() => { setSelectedPatient(patient.id); setSearch(""); setView("patients"); }}>View patient<Icon name="arrow" /></button> : <button className="cq-button cq-widebutton" disabled={!canSchedule} onClick={() => openBooking(patient.id)}><Icon name="plus" />Schedule a visit</button>}</> : <div className="cq-empty"><Icon name="users" /><h3>A fresh start.</h3><p>Select a patient or schedule a visit.</p></div>}
            </aside>
          </div>
        </>}
        <div className="cq-notification" role="status" aria-live="polite">{toast && <span><Icon name="check" />{toast}</span>}</div>
      </main>
    </div>
    {modal && <InterviewModal key={modal} title={modal === "patient" ? "A new face. A warm welcome." : "Make room for good care."} description={modal === "patient" ? "Add a patient to your practice." : "Schedule an appointment with the details below."} onClose={closeModal} busy={busy}>
      {modal === "patient" ? <PatientForm canCreate={capabilities.patients.create} practiceName={practiceName} onSubmit={savePatient} onBusyChange={setBusy} continueBooking={continueBooking} onCancel={() => { if (continueBooking) { setContinueBooking(false); setModal("booking"); } else closeModal(); }} /> : <BookingForm submissionAttempt={bookingAttempt} canCreate={canSchedule} canAddPatient={capabilities.patients.create} patients={patients} practiceName={practiceName} timeZone={timeZone} draft={draft} onChange={setDraft} onSubmit={saveAppointment} onBusyChange={setBusy} onCancel={closeModal} onAddPatient={() => { if (!capabilities.patients.create) return; setContinueBooking(true); setModal("patient"); }} />}
    </InterviewModal>}
  </div>;
}
