import type { ApiErrorBody, EmailDetail, EmailSummary } from "./types";

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
export const API_URL = (configuredApiUrl || "http://api.example.com").replace(
	/\/+$/,
	"",
);

export class ApiError extends Error {
	status: number;
	supportedDomains?: string[];

	constructor(message: string, status: number, supportedDomains?: string[]) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.supportedDomains = supportedDomains;
	}
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
	let response: Response;
	try {
		response = await fetch(`${API_URL}${path}`, {
			signal,
			headers: { Accept: "application/json" },
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") throw error;
		throw new ApiError("Could not reach the mail service. Check your connection and try again.", 0);
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new ApiError("The mail service returned an unreadable response.", response.status);
	}

	if (!response.ok || !isSuccess(body)) {
		const errorBody = body as ApiErrorBody;
		throw new ApiError(
			typeof errorBody.error === "string"
				? errorBody.error
				: errorBody.error?.message || `The mail service returned an error (${response.status}).`,
			response.status,
			errorBody.note?.supported_domains,
		);
	}

	return body.result as T;
}

function isSuccess(body: unknown): body is { success: true; result: unknown } {
	return Boolean(body && typeof body === "object" && "success" in body && body.success === true);
}

export function getDomains(signal?: AbortSignal) {
	return request<string[] | { public?: string[]; temp?: string[] }>("/domains", signal).then(
		(result) =>
			Array.isArray(result)
				? result
				: Array.from(new Set([...(result.public ?? []), ...(result.temp ?? [])])),
	);
}

export function getEmails(address: string, signal?: AbortSignal) {
	return request<EmailSummary[] | { items?: EmailSummary[] }>(
		`/emails/${encodeURIComponent(address)}?limit=100`,
		signal,
	).then((result) => (Array.isArray(result) ? result : (result.items ?? [])));
}

export function getEmail(id: string, signal?: AbortSignal) {
	return request<EmailDetail>(`/inbox/${encodeURIComponent(id)}`, signal);
}
