"use client"

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
                throw new Error("Authentication token unavailable.");
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
                err instanceof Error
                ? err.message
                : "Unable to create appointment.",
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <section className="mt-10 space-y-8">
            <div>
                <h2 className="text-xl font-semibold">
                    Appointments
                </h2>

                <p className="text-sm text-gray-600">
                    Schedule appointments for patients in the active practice.
                </p>
            </div>

            <form
            onSubmit={handleSubmit}
            className="grid max-w-xl gap-4"
            >
                <select
                aria-label="Patient"
                value={patientId}
                onChange={(event) =>
                    setPatientId(event.target.value)
                }
                className="rounded border p-2"
                required
                >
                    <option value="">
                        Select patient
                    </option>
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
                aria-label="Appointment date and time"
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
                aria-label="Reason for visit"
                placeholder="Reason for visit"
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
                    ? "Scheduling..."
                    : "Schedule Appointment"
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
                                : "Unknown patient"}
                            </p>

                            <p className="text-sm text-gray-600">
                                {new Date(
                                appointment.scheduledAt,
                                ).toLocaleString()}
                            </p>

                            <p className="text-sm">
                                Status: {appointment.status}
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