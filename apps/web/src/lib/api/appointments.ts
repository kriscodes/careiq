import { apiRequest } from "./client";
import { getAllPages } from "./pagination";

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

export async function getAppointments(token: string) {
    return getAllPages<Appointment>("/api/v1/appointments", token);
}

export async function createAppointment(
    token: string,
    input: CreateAppointmentInput,
    idempotencyKey: string = crypto.randomUUID(),
) {
    const response = await apiRequest<AppointmentResponse>(
        "/api/v1/appointments",
        token,
        {
            method: "POST",
            headers: { "Idempotency-Key": idempotencyKey },
            body: JSON.stringify(input),
        },
    );

    return response.data;
}
