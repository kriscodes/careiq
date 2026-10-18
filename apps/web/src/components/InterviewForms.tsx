"use client";

import { useI18n } from "@/i18n/provider";
import { localizeAccessText, accessZoneLabel } from "@/components/access/display";
import { type SubmitEvent, useId, useRef, useState } from "react";

import type { CreateAppointmentInput } from "@/lib/api/appointments";
import type { CreatePatientInput, Patient } from "@/lib/api/patients";
import { createSubmissionAttempt, type SubmissionAttempt } from "@/lib/submission-attempt";


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
  const { t, uiError } = useI18n();
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
    if (!canCreate) { setError(t("access.copy.your_practice_role_can_view_patients_but_cannot_create_them_ask_a_practice")); return; }

    if (!firstName.trim() || !lastName.trim()) {
      setError(t("access.copy.enter_the_patient_s_first_and_last_name"));
      return;
    }

    const emailInput = event.currentTarget.elements.namedItem("email");
    if (emailInput instanceof HTMLInputElement && !emailInput.validity.valid) {
      setError(t("access.copy.enter_a_valid_email_address_or_leave_it_blank"));
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
      setError(uiError(cause, "access.copy.unable_to_create_patient_please_try_again"));
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
            {t("access.copy.first_name")} <input id={`${id}-first`} className="cq-input" name="firstName" maxLength={120} autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
          </label>
          <label className="cq-field" htmlFor={`${id}-last`}>
            {t("access.copy.last_name")} <input id={`${id}-last`} className="cq-input" name="lastName" maxLength={120} autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} required />
          </label>
        </div>
        <label className="cq-field" htmlFor={`${id}-email`}>
          <span>{t("access.copy.email")} <small>{t("access.copy.optional")}</small></span>
          <input id={`${id}-email`} className="cq-input" name="email" maxLength={254} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="cq-field" htmlFor={`${id}-phone`}>
          <span>{t("access.copy.phone")} <small>{t("access.copy.optional")}</small></span>
          <input id={`${id}-phone`} className="cq-input" name="phone" maxLength={40} type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </label>
        <p className="cq-form-note">{t("access.patient.addedTo", { practice: practiceName })}</p>
        {error && <p className="cq-error" role="alert">{localizeAccessText(t, error)}</p>}
        <div className="cq-form-foot">
          <button type="button" className="cq-button" onClick={onCancel}>{continueBooking ? t("access.copy.back_to_appointment") : t("access.copy.cancel")}</button>
          <button type="submit" className="cq-button cq-primary">{pending ? t("access.copy.creating_patient") : continueBooking ? t("access.copy.create_continue") : t("access.copy.create_patient_84e7b1")}</button>
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
  const { t, uiError, locale } = useI18n();
  const id = useId();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (!canCreate) { setError(t("access.copy.your_practice_role_can_view_appointments_but_cannot_schedule_them_ask_a_pr")); return; }
    if (!patients.some((patient) => patient.id === draft.patientId)) {
      setError(t("access.copy.choose_a_patient_from_the_active_practice"));
      return;
    }
    const scheduledAt = readLocalAppointmentTime(draft.date, draft.time);
    if (!scheduledAt) {
      setError(t("access.copy.choose_a_valid_date_and_time_times_skipped_by_a_daylight_saving_change_are"));
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
      setError(uiError(cause, "access.copy.unable_to_schedule_appointment_please_try_again"));
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
          {t("access.copy.patient")} <span className="cq-select-wrap">
            <select id={`${id}-patient`} name="patientId" className="cq-input" value={draft.patientId} onChange={(event) => onChange({ ...draft, patientId: event.target.value })} required>
              <option value="">{patients.length ? t("access.copy.select_a_patient") : t("access.copy.add_a_patient_to_get_started")}</option>
              {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.firstName} {patient.lastName}</option>)}
            </select>
          </span>
        </label>
        <button type="button" className="cq-inline-action" disabled={!canAddPatient} onClick={onAddPatient}>{t("access.copy.add_a_new_patient")}</button>
        <div className="cq-two-fields">
          <label className="cq-field" htmlFor={`${id}-date`}>
            {t("access.copy.date")} <input id={`${id}-date`} className="cq-input" name="date" type="date" value={draft.date} onChange={(event) => onChange({ ...draft, date: event.target.value })} required />
          </label>
          <label className="cq-field" htmlFor={`${id}-time`}>
            {t("access.copy.time")} <input id={`${id}-time`} className="cq-input" name="time" type="time" step="60" value={draft.time} onChange={(event) => onChange({ ...draft, time: event.target.value })} required aria-describedby={`${id}-zone`} />
          </label>
        </div>
        <p id={`${id}-zone`} className="cq-form-note">{t("access.booking.zone", { timeZone: accessZoneLabel(locale, timeZone), practice: practiceName })}</p>
        <label className="cq-field" htmlFor={`${id}-reason`}>
          <span>{t("access.copy.reason_for_visit")} <small>{t("access.copy.optional")}</small></span>
          <textarea id={`${id}-reason`} className="cq-input" name="reason" maxLength={1000} rows={3} placeholder={t("access.copy.e_g_routine_checkup")} value={draft.reason} onChange={(event) => onChange({ ...draft, reason: event.target.value })} />
        </label>
        {error && <p className="cq-error" role="alert">{localizeAccessText(t, error)}</p>}
        <div className="cq-form-foot">
          <button type="button" className="cq-button" onClick={onCancel}>{t("access.copy.cancel")}</button>
          <button type="submit" className="cq-button cq-primary" disabled={!patients.length}>{pending ? t("access.copy.scheduling_0e44db") : t("access.copy.schedule_appointment_d5c7f2")}</button>
        </div>
      </fieldset>
    </form>
  );
}
