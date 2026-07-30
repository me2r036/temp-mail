import { createHash, timingSafeEqual } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

const AUTH_CHALLENGE = 'Basic realm="Temp Mail", charset="UTF-8"';
const DEFAULT_USERNAME = "admin";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;

const MIME_TYPES: Record<string, string> = {
	".avif": "image/avif",
	".css": "text/css; charset=utf-8",
	".gif": "image/gif",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".webmanifest": "application/manifest+json",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

const SECURITY_HEADERS = {
	"Content-Security-Policy":
		"default-src 'self'; connect-src 'self' https:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
	"Cross-Origin-Opener-Policy": "same-origin",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
} as const;

export interface StaticHandlerOptions {
	distDir?: string;
	password: string;
	username?: string;
}

function digest(value: string): Buffer {
	return createHash("sha256").update(value, "utf8").digest();
}

function parseBasicCredentials(header: string | null): [string, string] | null {
	if (!header) return null;

	const match = /^Basic\s+([^\s]+)$/i.exec(header);
	if (!match) return null;

	const encoded = match[1];
	if (
		encoded.length % 4 !== 0 ||
		!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
		encoded.replace(/=+$/, "") !==
			Buffer.from(encoded, "base64").toString("base64").replace(/=+$/, "")
	) {
		return null;
	}

	try {
		const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
			Buffer.from(encoded, "base64"),
		);
		const separator = decoded.indexOf(":");
		return separator < 0 ? null : [decoded.slice(0, separator), decoded.slice(separator + 1)];
	} catch {
		return null;
	}
}

function response(body: BodyInit | null, status: number, headers?: HeadersInit): Response {
	return new Response(body, {
		status,
		headers: { ...SECURITY_HEADERS, ...headers },
	});
}

function unauthorized(headOnly: boolean): Response {
	return response(headOnly ? null : "Authentication required.\n", 401, {
		"Cache-Control": "no-store, max-age=0",
		Expires: "0",
		Pragma: "no-cache",
		"WWW-Authenticate": AUTH_CHALLENGE,
		"Content-Type": "text/plain; charset=utf-8",
	});
}

function isInside(root: string, candidate: string): boolean {
	const pathFromRoot = relative(root, candidate);
	return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..");
}

async function findFile(root: string, pathname: string): Promise<string | null> {
	let decodedPath: string;
	try {
		decodedPath = decodeURIComponent(pathname);
	} catch {
		return null;
	}

	if (decodedPath.includes("\0") || decodedPath.includes("\\")) return null;
	const candidate = resolve(root, `.${decodedPath === "/" ? "/index.html" : decodedPath}`);
	if (!isInside(root, candidate)) return null;

	try {
		const resolvedFile = await realpath(candidate);
		if (!isInside(root, resolvedFile) || !(await stat(resolvedFile)).isFile()) return null;
		return resolvedFile;
	} catch {
		return null;
	}
}

function cacheControl(path: string): string {
	if (extname(path) === ".html") return "no-cache";
	if (/[/\\]assets[/\\].+-[A-Za-z0-9_-]{8,}\.[^/\\]+$/.test(path)) {
		return "public, max-age=31536000, immutable";
	}
	return "public, max-age=3600";
}

function textResponse(
	request: Request,
	body: string,
	status: number,
	headers?: HeadersInit,
): Response {
	return response(request.method === "HEAD" ? null : body, status, headers);
}

async function serveStatic(request: Request, distRoot: string): Promise<Response> {
	const pathname = new URL(request.url).pathname;
	let decodedPathname: string;
	try {
		decodedPathname = decodeURIComponent(pathname);
	} catch {
		return textResponse(request, "Not found.\n", 404, {
			"Cache-Control": "no-store",
			"Content-Type": "text/plain; charset=utf-8",
		});
	}
	if (decodedPathname.split("/").includes("..") || decodedPathname.includes("\\")) {
		return textResponse(request, "Not found.\n", 404, {
			"Cache-Control": "no-store",
			"Content-Type": "text/plain; charset=utf-8",
		});
	}

	let filePath = await findFile(distRoot, pathname);
	if (!filePath && !pathname.startsWith("/assets/")) {
		filePath = await findFile(distRoot, "/index.html");
	}
	if (!filePath) {
		return textResponse(request, "Not found.\n", 404, {
			"Cache-Control": "no-store",
			"Content-Type": "text/plain; charset=utf-8",
		});
	}

	const headers = {
		"Cache-Control": cacheControl(filePath),
		"Content-Type": MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
	};
	return response(request.method === "HEAD" ? null : Bun.file(filePath), 200, headers);
}

export function createStaticHandler(
	options: StaticHandlerOptions,
): (request: Request) => Promise<Response> {
	if (!options.password.trim())
		throw new Error("FRONTEND_PASSWORD must be set to a non-blank value");

	const username = options.username?.trim() || DEFAULT_USERNAME;
	const expectedUsername = digest(username);
	const expectedPassword = digest(options.password);
	const configuredDistDir = resolve(options.distDir ?? resolve(import.meta.dir, "dist"));
	let distRootPromise: Promise<string> | undefined;

	return async (request: Request): Promise<Response> => {
		const credentials = parseBasicCredentials(request.headers.get("Authorization"));
		const usernameMatches = credentials
			? timingSafeEqual(digest(credentials[0]), expectedUsername)
			: false;
		const passwordMatches = credentials
			? timingSafeEqual(digest(credentials[1]), expectedPassword)
			: false;
		if (!usernameMatches || !passwordMatches) return unauthorized(request.method === "HEAD");

		if (request.method !== "GET" && request.method !== "HEAD") {
			return textResponse(request, "Method not allowed.\n", 405, {
				Allow: "GET, HEAD",
				"Cache-Control": "no-store",
				"Content-Type": "text/plain; charset=utf-8",
			});
		}

		let distRoot: string;
		try {
			distRootPromise ??= realpath(configuredDistDir);
			distRoot = await distRootPromise;
		} catch {
			return textResponse(request, "Static build not found.\n", 503, {
				"Cache-Control": "no-store",
				"Content-Type": "text/plain; charset=utf-8",
			});
		}
		return serveStatic(request, distRoot);
	};
}

export function readServerConfig(env: Record<string, string | undefined> = Bun.env) {
	const password = env.FRONTEND_PASSWORD;
	if (!password?.trim()) throw new Error("FRONTEND_PASSWORD must be set to a non-blank value");

	const portText = env.PORT?.trim() || String(DEFAULT_PORT);
	const port = Number(portText);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(
			`PORT must be an integer between 1 and 65535; received ${JSON.stringify(portText)}`,
		);
	}

	return {
		hostname: env.HOST?.trim() || DEFAULT_HOST,
		password,
		port,
		username: env.FRONTEND_USERNAME?.trim() || DEFAULT_USERNAME,
	};
}

if (import.meta.main) {
	try {
		const config = readServerConfig();
		const server = Bun.serve({
			fetch: createStaticHandler(config),
			hostname: config.hostname,
			port: config.port,
		});
		console.log(`Temp Mail web server listening on ${server.url}`);
	} catch (error) {
		console.error(
			`Failed to start Temp Mail web server: ${error instanceof Error ? error.message : error}`,
		);
		process.exit(1);
	}
}
