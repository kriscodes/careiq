import { apiRequest } from "./client";
import { getAllPages } from "./pagination";

export type Patient = {
  id: string;
  practiceId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
};

export type CreatePatientInput = {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
};

type PatientResponse = {
  data: Patient;
};

export async function getPatients(token: string) {
  return getAllPages<Patient>("/api/v1/patients", token);
}

export async function createPatient(
  token: string,
  input: CreatePatientInput,
  idempotencyKey: string = crypto.randomUUID(),
) {
  const response = await apiRequest<PatientResponse>(
    "/api/v1/patients",
    token,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    },
  );

  return response.data;
}
