import { apiRequest } from "./client";
import { getAllPages } from "./pagination";
import { clinicalPath } from "./practice";

export type Appointment = {
    id: string;
    practiceId: string;
    patientId: string;
    scheduledAt: string;
    status: string;
    reason: string | null;
};

export type CreateAppointmentInput = {
    patientId: string;
    scheduledAt: string;
    reason?: string;
}

type AppointmentResponse = {
    data: Appointment;
};

export async function getAppointments(token: string, locationId?: string, signal?: AbortSignal) {
    return getAllPages<Appointment>(clinicalPath("appointments", locationId), token, signal);
}

export async function createAppointment(
    token: string,
    input: CreateAppointmentInput,
    idempotencyKey: string = crypto.randomUUID(),
    locationId?: string,
    signal?: AbortSignal,
) {
    const response = await apiRequest<AppointmentResponse>(
        clinicalPath("appointments", locationId),
        token,
        {
            method: "POST",
            signal,
            headers: { "Idempotency-Key": idempotencyKey },
            body: JSON.stringify(input),
        },
    );

    return response.data;
}
