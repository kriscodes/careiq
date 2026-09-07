import { apiRequest } from "./client";

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

type PatientListResponse = {
  data: Patient[];
};

type PatientResponse = {
  data: Patient;
};

export async function getPatients(token: string) {
  const response = await apiRequest<PatientListResponse>(
    "/api/v1/patients",
    token,
  );

  return response.data;
}

export async function createPatient(
  token: string,
  input: CreatePatientInput,
) {
  const response = await apiRequest<PatientResponse>(
    "/api/v1/patients",
    token,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );

  return response.data;
}