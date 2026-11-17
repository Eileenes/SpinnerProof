import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { auditText } from "./audit/engine";
import { renderText } from "./audit/render";
import { VERSION, TOOL_NAME } from "./audit/engine";
import { examplesDir, staticDir } from "./util/here";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

interface StartOptions {
  port?: number;
  host?: string;
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function sendFile(res: http.ServerResponse, file: string): void {
  const ext = path.extname(file).toLowerCase();
  const data = fs.readFileSync(file);
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Content-Length": data.length,
    "Cache-Control": "no-cache",
  });
  res.end(data);
}

export function startServer(opts: StartOptions = {}): http.Server {
  const port = opts.port ?? Number(process.env.PORT ?? 8800);
  const host = opts.host ?? process.env.HOST ?? "127.0.0.1";

  const server = http.createServer((req, res) => {
    try {
      handle(req, res);
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
  });

  const handle = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    const method = (req.method ?? "GET").toUpperCase();

    if (pathname === "/healthz") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      return json(res, 200, { ok: true, tool: TOOL_NAME, version: VERSION });
    }

    if (pathname.startsWith("/api/")) {
      if (pathname === "/api/demos") {
        if (method !== "GET") return json(res, 405, { error: "method not allowed" });
        const names = fs.existsSync(examplesDir())
          ? fs.readdirSync(examplesDir()).filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(/\.jsonl$/, ""))
          : [];
        return json(res, 200, { demos: names });
      }
      const demoMatch = /^\/api\/demo\/([a-zA-Z0-9_-]+)$/.exec(pathname);
      if (demoMatch) {
        if (method !== "GET") return json(res, 405, { error: "method not allowed" });
        const name = demoMatch[1] as string;
        const file = path.join(examplesDir(), `${name}.jsonl`);
        if (!file.startsWith(examplesDir()) || !fs.existsSync(file)) {
          return json(res, 404, { error: `demo "${name}" not found` });
        }
        const report = auditText(fs.readFileSync(file, "utf8"), { source: `demo:${name}` });
        return json(res, 200, report);
      }
      if (pathname === "/api/audit") {
        if (method !== "POST") return json(res, 405, { error: "method not allowed; POST a JSONL event stream" });
        let body = "";
        let tooBig = false;
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
          if (body.length > 8 * 1024 * 1024) {
            tooBig = true;
            req.destroy();
          }
        });
        req.on("end", () => {
          if (tooBig) return;
          try {
            const report = auditText(body, { source: "api" });
            json(res, 200, report);
          } catch (e) {
            json(res, 400, { error: (e as Error).message });
          }
        });
        return;
      }
      return json(res, 404, { error: `no such api endpoint: ${pathname}` });
    }

    // static files with SPA fallback
    const root = staticDir();
    let rel = pathname === "/" ? "/index.html" : pathname;
    if (rel.includes("..")) {
      return json(res, 404, { error: "not found" });
    }
    const file = path.join(root, rel);
    if (!file.startsWith(root)) {
      return json(res, 404, { error: "not found" });
    }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return sendFile(res, file);
    }
    // SPA fallback
    const index = path.join(root, "index.html");
    if (fs.existsSync(index)) {
      return sendFile(res, index);
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("console not built; run npm run build in web/");
  };

  return server.listen(port, host);
}

/** CLI entry for `serve` */
export function serveCommand(args: string[]): number {
  let port = Number(process.env.PORT ?? 8800);
  let host = process.env.HOST ?? "0.0.0.0";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--port" || a === "-p") {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v) && v > 0) port = v;
      i++;
    } else if (a === "--host") {
      host = args[i + 1] ?? host;
      i++;
    }
  }
  const server = startServer({ port, host });
  const addr = server.address();
  const realPort = typeof addr === "object" && addr !== null ? addr.port : port;
  process.stderr.write(`${TOOL_NAME} console listening on http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${realPort}\n`);
  return 0; // server keeps running
}

export { renderText };
