"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";

export function ApiTest() {
    const { getToken, isLoaded, isSignedIn } = useAuth();

    const [response, setResponse] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function testApi() {
        try {
            setError(null);

            const token = await getToken();

            const res = await fetch("http://localhost:3000/api/v1/me", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const data = await res.json();

            setResponse(JSON.stringify(data, null, 2));
        } catch(err) {
            console.error(err);
            setError("Failed to call CareIQ API.")
        }
    }

    if(!isLoaded) {
        return <p>Loading Authentication...</p>;
    }

    if(!isSignedIn) {
        return null;
    }

    return (
        <div className="mt-8 space-y-4">
            <button
                onClick={testApi}
                className="rounded bg-black px-4 py-2 text-white"
            >
                Test CareIQ API
            </button>

            {error && <p>{error}</p>}

            {response && (
                <pre className="rounded bg-black-100 p-4">
                    {response}
                </pre>
            )}
        </div>
    )
}