import { describe, it, expect, afterAll, beforeAll } from "vitest";
import * as http from "node:http";
import { startServer } from "../src/server";

let base = "";
const server = startServer({ port: 0, host: "127.0.0.1" });

beforeAll(async () => {
  if (!server.listening) {
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  }
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

function get(url: string): Promise<{ code: number; body: string; type: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(`${base}${url}`, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ code: res.statusCode ?? 0, body: data, type: String(res.headers["content-type"] ?? "") }));
      })
      .on("error", reject);
  });
}

function post(url: string, body: string): Promise<{ code: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${base}${url}`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ code: res.statusCode ?? 0, body: data }));
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("server", () => {
  it("health check returns ok", async () => {
    const r = await get("/healthz");
    expect(r.code).toBe(200);
    const j = JSON.parse(r.body);
    expect(j.ok).toBe(true);
    expect(j.tool).toBe("SpinnerProof");
  });

  it("serves the demo list", async () => {
    const r = await get("/api/demos");
    expect(r.code).toBe(200);
    const j = JSON.parse(r.body);
    expect(j.demos).toContain("clean-stream");
    expect(j.demos).toContain("hang-stream");
    expect(j.demos).toContain("chaos-stream");
  });

  it("serves a demo report", async () => {
    const r = await get("/api/demo/clean-stream");
    expect(r.code).toBe(200);
    const j = JSON.parse(r.body);
    expect(j.score).toBe(100);
    expect(j.verdict).toBe("pass");
  });

  it("404s an unknown demo", async () => {
    const r = await get("/api/demo/nope");
    expect(r.code).toBe(404);
  });

  it("audits a posted JSONL stream", async () => {
    const body = [
      '{"type":"RunStarted","threadId":"t","runId":"r"}',
      '{"type":"TextMessageStart","messageId":"m","role":"assistant"}',
      '{"type":"RunFinished"}',
    ].join("\n");
    const r = await post("/api/audit", body);
    expect(r.code).toBe(200);
    const j = JSON.parse(r.body);
    expect(j.verdict).toBe("fail"); // H102: open message at termination
    expect(j.findings.some((f: { rule: string }) => f.rule === "H102")).toBe(true);
  });

  it("405s a GET on /api/audit", async () => {
    const r = await get("/api/audit");
    expect(r.code).toBe(405);
  });

  it("404s unknown api endpoints", async () => {
    const r = await get("/api/unknown");
    expect(r.code).toBe(404);
  });

  it("405s wrong method on demo endpoint", async () => {
    const r = await post("/api/demo/clean-stream", "");
    expect(r.code).toBe(405);
  });

  it("serves the console and falls back for SPA routes", async () => {
    const index = await get("/");
    expect(index.code).toBe(200);
    expect(index.type).toContain("text/html");
    const deep = await get("/some/client/route");
    expect(deep.code).toBe(200);
    expect(deep.type).toContain("text/html");
  });

  it("blocks path traversal", async () => {
    const r = await get("/..%2f..%2fpackage.json");
    expect(r.code).toBe(404);
    expect(r.body).not.toContain('"name": "spinnerproof"');
  });

  it("serves built assets", async () => {
    const index = await get("/");
    const m = /assets\/[a-zA-Z0-9_.-]+\.js/.exec(index.body);
    if (m && m[0]) {
      const asset = await get(`/${m[0]}`);
      expect(asset.code).toBe(200);
      expect(asset.type).toContain("javascript");
    }
  });
});
