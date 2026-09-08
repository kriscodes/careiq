import { apiRequest } from "./client";

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

type AppointmentListResponse = {
    data: Appointment[];
}

type AppointmentResponse = {
    data: Appointment;
};

export async function getAppointments(token: string) {
    const response = await apiRequest<AppointmentListResponse>(
        "/api/v1/appointments",
        token,
    );

    return response.data;
}

export async function createAppointment(
    token: string,
    input: CreateAppointmentInput,
) {
    const response = await apiRequest<AppointmentResponse>(
        "/api/v1/appointments",
        token,
        {
            method: "POST",
            body: JSON.stringify(input),
        },
    );

    return response.data;
}