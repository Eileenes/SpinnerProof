#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { auditText, auditEvents, VERSION, TOOL_NAME } from "./audit/engine";
import { renderText } from "./audit/render";
import { parseStream } from "./audit/parse";
import { examplesDir } from "./util/here";
import { serveCommand } from "./server";

const USAGE = `
${TOOL_NAME} v${VERSION} — deterministic conformance auditor for AG-UI agent→UI event streams

Usage:
  spinnerproof audit <file.jsonl|file.json> [--format text|json] [--out <path>]
  spinnerproof demo <name>   [--format text|json]      audit a bundled example stream
  spinnerproof demos                                   list bundled examples
  spinnerproof serve        [--port N] [--host H]      start the web console
  spinnerproof version

Pipe input instead of a file:
  cat events.jsonl | spinnerproof audit -

Exit codes: 0 = pass, 1 = fail, 2 = usage error.
`.trim();

function fail(msg: string, code = 2): number {
  process.stderr.write(`${msg}\n\n${USAGE}\n`);
  return code;
}

function readInput(fileArg: string): string | null {
  if (fileArg === "-") {
    try {
      return fs.readFileSync(0, "utf8");
    } catch {
      return null;
    }
  }
  const file = path.resolve(fileArg);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8");
}

function listDemos(): string[] {
  const dir = examplesDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(/\.jsonl$/, ""));
}

export function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    if (a === "--format" || a === "--out" || a === "--port" || a === "--host") {
      flags[a.slice(2)] = (rest[i + 1] as string) ?? "";
      consumed.add(i);
      consumed.add(i + 1);
      i++;
    } else if (!consumed.has(i)) {
      positional.push(a);
    }
  }

  switch (cmd) {
    case "audit": {
      const target = positional[0];
      if (!target) return fail("audit requires a file path or '-' for stdin");
      const text = readInput(target);
      if (text === null) return fail(`cannot read input: ${target}`);
      const report = auditText(text, { source: target });
      const format = flags.format ?? "text";
      if (format === "json") {
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      } else {
        process.stdout.write(renderText(report) + "\n");
      }
      if (flags.out) {
        const outPath = path.resolve(flags.out);
        const body = format === "json" ? JSON.stringify(report, null, 2) : renderText(report);
        fs.writeFileSync(outPath, body + "\n");
        process.stderr.write(`report written to ${outPath}\n`);
      }
      process.exitCode = report.verdict === "pass" ? 0 : 1;
      return process.exitCode;
    }
    case "demo": {
      const name = positional[0];
      if (!name) return fail("demo requires an example name (see `demos`)");
      if (!listDemos().includes(name)) return fail(`unknown demo "${name}". Available: ${listDemos().join(", ")}`);
      const file = path.join(examplesDir(), `${name}.jsonl`);
      const report = auditText(fs.readFileSync(file, "utf8"), { source: `demo:${name}` });
      if ((flags.format ?? "text") === "json") {
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      } else {
        process.stdout.write(renderText(report) + "\n");
      }
      process.exitCode = report.verdict === "pass" ? 0 : 1;
      return process.exitCode;
    }
    case "demos": {
      process.stdout.write(listDemos().join("\n") + "\n");
      return 0;
    }
    case "serve": {
      return serveCommand(rest);
    }
    case "version":
    case "--version":
    case "-v": {
      process.stdout.write(`${TOOL_NAME} ${VERSION}\n`);
      return 0;
    }
    case "help":
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(USAGE + "\n");
      return 0;
    default:
      return fail(`unknown command "${cmd}"`);
  }
}

export { auditText, auditEvents, parseStream, renderText, VERSION, TOOL_NAME };

if (require.main === module) {
  const code = main(process.argv.slice(2));
  if (code !== 0) process.exitCode = code;
}
