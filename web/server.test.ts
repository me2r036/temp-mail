import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaticHandler, readServerConfig } from "./server";

let distDir: string;
let handler: ReturnType<typeof createStaticHandler>;
const authorization = `Basic ${Buffer.from("admin:correct horse battery staple").toString("base64")}`;

function request(path: string, init: RequestInit = {}) {
	return handler(new Request(`http://localhost${path}`, init));
}

beforeAll(async () => {
	distDir = await mkdtemp(join(tmpdir(), "temp-mail-web-"));
	await mkdir(join(distDir, "assets"));
	await writeFile(join(distDir, "index.html"), "<!doctype html><title>Temp Mail</title>");
	await writeFile(join(distDir, "assets", "app-AbCd1234.js"), "console.log('loaded')");
	handler = createStaticHandler({ distDir, password: "correct horse battery staple" });
});

afterAll(async () => {
	await rm(distDir, { recursive: true, force: true });
});

describe("static server authentication", () => {
	test("rejects missing, malformed, and wrong credentials without serving content", async () => {
		for (const value of [
			undefined,
			"Basic !!!=",
			`Basic ${Buffer.from("admin:wrong").toString("base64")}`,
		]) {
			const response = await request("/", value ? { headers: { Authorization: value } } : {});
			expect(response.status).toBe(401);
			expect(response.headers.get("WWW-Authenticate")).toBe(
				'Basic realm="Temp Mail", charset="UTF-8"',
			);
			expect(response.headers.get("Cache-Control")).toContain("no-store");
			expect(await response.text()).toBe("Authentication required.\n");
		}
	});

	test("serves the index and immutable hashed assets with correct credentials", async () => {
		const index = await request("/", { headers: { Authorization: authorization } });
		expect(index.status).toBe(200);
		expect(index.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
		expect(index.headers.get("Cache-Control")).toBe("no-cache");
		expect(await index.text()).toContain("Temp Mail");

		const asset = await request("/assets/app-AbCd1234.js", {
			headers: { Authorization: authorization },
		});
		expect(asset.status).toBe(200);
		expect(asset.headers.get("Cache-Control")).toContain("immutable");
		expect(await asset.text()).toContain("loaded");
	});
});

describe("static routing", () => {
	test("falls back to the SPA for direct inbox routes", async () => {
		const response = await request("/inbox/test%40example.com", {
			headers: { Authorization: authorization },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
		expect(await response.text()).toContain("Temp Mail");
	});

	test("returns 404 for missing assets", async () => {
		const response = await request("/assets/missing.js", {
			headers: { Authorization: authorization },
		});
		expect(response.status).toBe(404);
	});

	test("does not expose files through traversal paths", async () => {
		const response = await request("/assets/%2e%2e%2f%2e%2e%2fetc/passwd", {
			headers: { Authorization: authorization },
		});
		expect(response.status).toBe(404);
		expect(await response.text()).toBe("Not found.\n");
	});

	test("rejects authenticated non-GET methods", async () => {
		const response = await request("/", {
			headers: { Authorization: authorization },
			method: "POST",
		});
		expect(response.status).toBe(405);
		expect(response.headers.get("Allow")).toBe("GET, HEAD");
	});

	test("returns headers but no body for HEAD", async () => {
		const response = await request("/", {
			headers: { Authorization: authorization },
			method: "HEAD",
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");

		const unauthorized = await request("/", { method: "HEAD" });
		expect(unauthorized.status).toBe(401);
		expect(await unauthorized.text()).toBe("");
	});
});

describe("startup configuration", () => {
	test("requires a non-blank password", () => {
		expect(() => readServerConfig({})).toThrow("FRONTEND_PASSWORD");
		expect(() => readServerConfig({ FRONTEND_PASSWORD: "   " })).toThrow("FRONTEND_PASSWORD");
	});

	test("uses safe defaults and validates the port", () => {
		expect(readServerConfig({ FRONTEND_PASSWORD: "secret" })).toEqual({
			hostname: "127.0.0.1",
			password: "secret",
			port: 4173,
			username: "admin",
		});
		expect(() => readServerConfig({ FRONTEND_PASSWORD: "secret", PORT: "invalid" })).toThrow(
			"PORT",
		);
	});
});
