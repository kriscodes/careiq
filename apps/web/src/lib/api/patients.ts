import { apiRequest } from "./client";
import { getAllPages } from "./pagination";
import { clinicalPath } from "./practice";

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

export async function getPatients(token: string, locationId?: string, signal?: AbortSignal) {
  return getAllPages<Patient>(clinicalPath("patients", locationId), token, signal);
}

export async function createPatient(
  token: string,
  input: CreatePatientInput,
  idempotencyKey: string = crypto.randomUUID(),
  locationId?: string,
  signal?: AbortSignal,
) {
  const response = await apiRequest<PatientResponse>(
    clinicalPath("patients", locationId),
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
