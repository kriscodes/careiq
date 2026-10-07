"use client";

import { type SubmitEvent, useId, useRef, useState } from "react";

import type { CreateAppointmentInput } from "@/lib/api/appointments";
import type { CreatePatientInput, Patient } from "@/lib/api/patients";
import { ApiError } from "@/lib/api/client";
import { createSubmissionAttempt, type SubmissionAttempt } from "@/lib/submission-attempt";

function saveError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError && cause.code === "IDEMPOTENCY_KEY_REUSED") {
    return "This save conflicts with an earlier attempt. Refresh the practice to check existing records before starting a new entry.";
  }
  return cause instanceof Error ? cause.message : fallback;
}

export type BookingDraft = {
  patientId: string;
  date: string;
  time: string;
  reason: string;
};

type PatientFormProps = {
  practiceName: string;
  onSubmit: (input: CreatePatientInput, idempotencyKey: string) => Promise<void>;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
  continueBooking?: boolean;
  canCreate: boolean;
};

export function PatientForm({
  practiceName,
  onSubmit,
  onCancel,
  onBusyChange,
  continueBooking = false,
  canCreate,
}: PatientFormProps) {
  const id = useId();
  const submitting = useRef(false);
  const attempt = useRef(createSubmissionAttempt());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (!canCreate) { setError("Your practice role can view patients but cannot create them. Ask a practice administrator for access."); return; }

    if (!firstName.trim() || !lastName.trim()) {
      setError("Enter the patient's first and last name.");
      return;
    }

    const emailInput = event.currentTarget.elements.namedItem("email");
    if (emailInput instanceof HTMLInputElement && !emailInput.validity.valid) {
      setError("Enter a valid email address, or leave it blank.");
      return;
    }

    submitting.current = true;
    setPending(true);
    setError(null);
    onBusyChange(true);
    try {
      const input = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      };
      await attempt.current.submit(input, key => onSubmit(input, key));
    } catch (cause) {
      setError(saveError(cause, "Unable to create patient. Please try again."));
    } finally {
      submitting.current = false;
      setPending(false);
      onBusyChange(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={pending}>
      <fieldset className="cq-form-body" disabled={pending || !canCreate}>
        <div className="cq-two-fields">
          <label className="cq-field" htmlFor={`${id}-first`}>
            First name
            <input id={`${id}-first`} className="cq-input" name="firstName" maxLength={120} autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
          </label>
          <label className="cq-field" htmlFor={`${id}-last`}>
            Last name
            <input id={`${id}-last`} className="cq-input" name="lastName" maxLength={120} autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} required />
          </label>
        </div>
        <label className="cq-field" htmlFor={`${id}-email`}>
          <span>Email <small>(optional)</small></span>
          <input id={`${id}-email`} className="cq-input" name="email" maxLength={254} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="cq-field" htmlFor={`${id}-phone`}>
          <span>Phone <small>(optional)</small></span>
          <input id={`${id}-phone`} className="cq-input" name="phone" maxLength={40} type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </label>
        <p className="cq-form-note">This patient will be added to {practiceName}.</p>
        {error && <p className="cq-error" role="alert">{error}</p>}
        <div className="cq-form-foot">
          <button type="button" className="cq-button" onClick={onCancel}>{continueBooking ? "Back to appointment" : "Cancel"}</button>
          <button type="submit" className="cq-button cq-primary">{pending ? "Creating patient…" : continueBooking ? "Create & continue" : "Create patient"}</button>
        </div>
      </fieldset>
    </form>
  );
}

type BookingFormProps = {
  patients: Patient[];
  practiceName: string;
  timeZone: string;
  draft: BookingDraft;
  onChange: (draft: BookingDraft) => void;
  onSubmit: (input: CreateAppointmentInput, idempotencyKey: string) => Promise<void>;
  onAddPatient: () => void;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
  canCreate: boolean;
  canAddPatient: boolean;
  submissionAttempt: SubmissionAttempt;
};

function readLocalAppointmentTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const value = new Date(`${date}T${time}:00`);

  // Date can silently roll an impossible calendar date or a daylight-saving gap forward.
  if (
    year < 1 ||
    Number.isNaN(value.getTime()) ||
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== day ||
    value.getHours() !== hour ||
    value.getMinutes() !== minute
  ) return null;

  return value;
}

export function BookingForm({ patients, practiceName, timeZone, draft, onChange, onSubmit, onAddPatient, onCancel, onBusyChange, canCreate, canAddPatient, submissionAttempt }: BookingFormProps) {
  const id = useId();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (!canCreate) { setError("Your practice role can view appointments but cannot schedule them. Ask a practice administrator for access."); return; }
    if (!patients.some((patient) => patient.id === draft.patientId)) {
      setError("Choose a patient from the active practice.");
      return;
    }
    const scheduledAt = readLocalAppointmentTime(draft.date, draft.time);
    if (!scheduledAt) {
      setError("Choose a valid date and time. Times skipped by a daylight-saving change are unavailable.");
      return;
    }

    submitting.current = true;
    setPending(true);
    setError(null);
    onBusyChange(true);
    try {
      const input = { patientId: draft.patientId, scheduledAt: scheduledAt.toISOString(), reason: draft.reason.trim() || undefined };
      await submissionAttempt.submit(input, key => onSubmit(input, key));
    } catch (cause) {
      setError(saveError(cause, "Unable to schedule appointment. Please try again."));
    } finally {
      submitting.current = false;
      setPending(false);
      onBusyChange(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={pending}>
      <fieldset className="cq-form-body" disabled={pending || !canCreate}>
        <label className="cq-field" htmlFor={`${id}-patient`}>
          Patient
          <span className="cq-select-wrap">
            <select id={`${id}-patient`} name="patientId" className="cq-input" value={draft.patientId} onChange={(event) => onChange({ ...draft, patientId: event.target.value })} required>
              <option value="">{patients.length ? "Select a patient" : "Add a patient to get started"}</option>
              {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.firstName} {patient.lastName}</option>)}
            </select>
          </span>
        </label>
        <button type="button" className="cq-inline-action" disabled={!canAddPatient} onClick={onAddPatient}>+ Add a new patient</button>
        <div className="cq-two-fields">
          <label className="cq-field" htmlFor={`${id}-date`}>
            Date
            <input id={`${id}-date`} className="cq-input" name="date" type="date" value={draft.date} onChange={(event) => onChange({ ...draft, date: event.target.value })} required />
          </label>
          <label className="cq-field" htmlFor={`${id}-time`}>
            Time
            <input id={`${id}-time`} className="cq-input" name="time" type="time" step="60" value={draft.time} onChange={(event) => onChange({ ...draft, time: event.target.value })} required aria-describedby={`${id}-zone`} />
          </label>
        </div>
        <p id={`${id}-zone`} className="cq-form-note">Time zone: {timeZone}. Scheduling for {practiceName}.</p>
        <label className="cq-field" htmlFor={`${id}-reason`}>
          <span>Reason for visit <small>(optional)</small></span>
          <textarea id={`${id}-reason`} className="cq-input" name="reason" maxLength={1000} rows={3} placeholder="e.g. Routine checkup" value={draft.reason} onChange={(event) => onChange({ ...draft, reason: event.target.value })} />
        </label>
        {error && <p className="cq-error" role="alert">{error}</p>}
        <div className="cq-form-foot">
          <button type="button" className="cq-button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="cq-button cq-primary" disabled={!patients.length}>{pending ? "Scheduling…" : "Schedule appointment"}</button>
        </div>
      </fieldset>
    </form>
  );
}
