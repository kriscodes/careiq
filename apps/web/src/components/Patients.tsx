"use client";

import { useAuth } from "@clerk/nextjs";
import {
  type SubmitEvent,
  useEffect,
  useState,
} from "react";

import {
  createPatient,
  getPatients,
  type Patient,
} from "@/lib/api/patients";

export function Patients() {
    const { getToken, isLoaded, isSignedIn } = useAuth();

    const [patients, setPatients] = useState<Patient[]>([]);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");

    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function loadPatients() {
        try {
            setError(null);

            const token = await getToken();

            if (!token) {
                throw new Error("Authentication token unavailable.");
            }

            const data = await getPatients(token);

            setPatients(data);
        } catch (err) {
            setError(
            err instanceof Error
                ? err.message
                : "Unable to load patients.",
            );
        }
    }

    async function handleSubmit(
        event: SubmitEvent<HTMLFormElement>,
    ) {
        event.preventDefault();

        try {
            setLoading(true);
            setError(null);

            const token = await getToken();

            if (!token) {
                throw new Error("Authentication token unavailable.");
            }

            await createPatient(token, {
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                email: email.trim() || undefined,
                phone: phone.trim() || undefined,
            });

            setFirstName("");
            setLastName("");
            setEmail("");
            setPhone("");

            await loadPatients();
        } catch (err) {
            setError(
            err instanceof Error
                ? err.message
                : "Unable to create patient.",
            );
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if(isLoaded && isSignedIn) {
            void loadPatients();
        }
    }, [isLoaded, isSignedIn]);

    if(!isLoaded) {
        return <p>Loading...</p>;
    }

    if(!isSignedIn) {
        return null;
    }

    return (
        <section className="mt-10 space-y-8">
            <div>
                <h2 className="text-xl font-semibold">Patients</h2>
                <p className="text-sm text-gray-600">
                    Create and view patients for the actice practice.
                </p>
            </div>

            <form
            onSubmit={handleSubmit}
            className="grid max-w-xl gap-4"
            >
                <input 
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                placeholder="First name"
                className="rounded border p-2"
                required
                />

                <input 
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                placeholder="Last name"
                className="rounded border p-2"
                required
                />
                
                <input 
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email"
                type="email"
                className="rounded border p-2"
                />

                <input 
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Phone"
                className="rounded border p-2"
                />

                <button 
                type="submit"
                disabled={loading}
                className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
                >
                    {loading ? "Creating..." : "Create Patient"}
                </button>
            </form>

            {error && (
                <p className="text-sm text-red-600">
                    {error}
                </p>
            )}

            <div className="space-y-3">
                {patients.map((patient) => (
                    <div
                    key={patient.id}
                    className="rounded border p-4"
                    >
                        <p className="font-medium">
                            {patient.firstName} {patient.lastName}
                        </p>

                        {patient.email && (
                            <p className="text-sm text-gray-600">
                                {patient.email}
                            </p>
                        )}

                        {patient.phone && (
                            <p className="text-sm text-gray-600">
                                {patient.phone}
                            </p>
                        )}
                    </div>
                ))}

                {patients.length === 0 && (
                    <p className="text-sm text-gray-600">
                        No patients yet.
                    </p>
                )}
            </div>
        </section>
    );
}