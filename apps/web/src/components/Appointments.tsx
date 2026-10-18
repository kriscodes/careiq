"use client"

import { useI18n } from "@/i18n/provider";
import { accessStatusLabel } from "@/components/access/display";
import { useAuth } from "@clerk/nextjs";
import {
    type SubmitEvent,
    useState,
} from "react";

import {
    createAppointment,
    type Appointment,
} from "@/lib/api/appointments";

import {
      type Patient,
} from "@/lib/api/patients";

export function Appointments({ patients, appointments, onCreated }: { patients: Patient[]; appointments: Appointment[]; onCreated: (appointment: Appointment) => void; }) {
  const { t, uiError, formatDate } = useI18n();
    const { getToken } = useAuth();


    const [patientId, setPatientId] = useState("");
    const [scheduledAt, setScheduledAt] = useState("");
    const [reason, setReason] = useState("");

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(
        event: SubmitEvent<HTMLFormElement>,
    ) {
        event.preventDefault();

        try {
            setLoading(true);
            setError(null);

            const token = await getToken();

            if(!token) {
                throw new Error(t("access.copy.authentication_token_unavailable"));
            }

            const appointment = await createAppointment(token, {
                patientId,
                scheduledAt: new Date(scheduledAt).toISOString(),
                reason: reason.trim() || undefined,
            });

            setScheduledAt("");
            setReason("");

            onCreated(appointment);
        } catch (err) {
            setError(
                uiError(err, "access.copy.unable_to_create_appointment"),
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <section className="mt-10 space-y-8">
            <div>
                <h2 className="text-xl font-semibold">
                    {t("access.copy.appointments")} </h2>

                <p className="text-sm text-gray-600">
                    {t("access.copy.schedule_appointments_for_patients_in_the_active_practice")} </p>
            </div>

            <form
            onSubmit={handleSubmit}
            className="grid max-w-xl gap-4"
            >
                <select
                aria-label={t("access.copy.patient")}
                value={patientId}
                onChange={(event) =>
                    setPatientId(event.target.value)
                }
                className="rounded border p-2"
                required
                >
                    <option value="">
                        {t("access.copy.select_patient")} </option>
                    {patients.map((patient) => (
                        <option
                        key={patient.id}
                        value={patient.id}
                        >
                            {patient.firstName} {patient.lastName}
                        </option>
                    ))}
                </select>

                <input
                aria-label={t("access.copy.appointment_date_and_time")}
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) =>
                    setScheduledAt(event.target.value)
                }
                className="rounded border p-2"
                required
                />

                <input
                value={reason}
                onChange={(event) =>
                    setReason(event.target.value)
                }
                aria-label={t("access.copy.reason_for_visit")}
                placeholder={t("access.copy.reason_for_visit")}
                className="rounded border p-2"
                />

                <button
                type="submit"
                disabled={
                    loading ||
                    !patientId ||
                    !scheduledAt
                }
                className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
                >
                    {loading
                    ? t("access.copy.scheduling")
                    : t("access.copy.schedule_appointment")
                    }
                </button>
            </form>

            {error && (
                <p role="alert" className="text-sm text-red-600">
                    {error}
                </p>
            )}

            <div className="space-y-3">
                {appointments.map((appointment) => {
                    const patient = patients.find(
                        (item) => item.id === appointment.patientId,
                    );

                    return (
                        <div
                        key={appointment.id}
                        className="rounded border p-4"
                        >
                            <p className="font-medium">
                                {patient
                                ? `${patient.firstName} ${patient.lastName}`
                                : t("access.copy.unknown_patient")}
                            </p>

                            <p className="text-sm text-gray-600">
                                {formatDate(appointment.scheduledAt, { dateStyle: "medium", timeStyle: "short" })}
                            </p>

                            <p className="text-sm">
                                {t("access.member.status", { status: accessStatusLabel(t, appointment.status) })}
                            </p>

                            {appointment.reason && (
                                <p className="text-sm text-gray-600">
                                {appointment.reason}
                                </p>
                            )}
                        </div>

                    )
                })}
            </div>
        </section>
    )
}
