const API_URL = process.env.NEXT_PUBLIC_API_URL;

if(!API_URL) {
    throw new Error("NEXT_PUBLIC_API_URL is not configured");
}

type ApiErrorBody = {
    error?: {
        code?: string;
        message?: string;
    };
};

export async function apiRequest<T>(
    path: string,
    token: string,
    options: RequestInit = {},
): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...options.headers,
        },
    });

    const body = await response.json();

    if(!response.ok) {
        const errorBody = body as ApiErrorBody;

        throw new Error(
            errorBody.error?.message ?? "CareIQ API request failed.",
        );
    }

    return body as T;
}