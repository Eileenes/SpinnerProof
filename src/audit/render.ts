import type { Report } from "./types";

const SEV_LABEL: Record<string, string> = { error: "ERROR", warn: "WARN ", info: "INFO " };

export function renderText(r: Report): string {
  const L: string[] = [];
  const bar = "─".repeat(62);
  L.push(bar);
  L.push(`  ${r.tool} v${r.version} — AG-UI event stream conformance audit`);
  L.push(bar);
  L.push(`  source      : ${r.source}`);
  L.push(`  events      : ${r.eventCount}  (${(r.byteCount / 1024).toFixed(1)} KB)`);
  L.push(`  score       : ${r.score.toFixed(1)}/100  grade ${r.grade}  verdict ${r.verdict.toUpperCase()}`);
  L.push(`  hang        : ${r.hang.willHang ? "YES — this stream will spin forever" : "no"}`);
  if (r.hang.openToolCallIds.length > 0) L.push(`  open calls  : ${r.hang.openToolCallIds.join(", ")}`);
  if (r.hang.openMessageIds.length > 0) L.push(`  open msgs   : ${r.hang.openMessageIds.join(", ")}`);
  L.push("");
  for (const d of r.dims) {
    const filled = Math.round(d.score / 10);
    const g = "█".repeat(filled) + "░".repeat(10 - filled);
    L.push(`  ${g}  ${String(d.score).padStart(5)}  ${d.label} (w=${d.weight})  ${d.errors}E/${d.warns}W/${d.infos}I`);
  }
  L.push("");
  L.push(`  findings    : ${r.findings.length} (${r.findings.filter((f) => f.severity === "error").length} error / ${r.findings.filter((f) => f.severity === "warn").length} warn / ${r.findings.filter((f) => f.severity === "info").length} info)`);
  if (r.topIssues.length > 0) L.push(`  top rules   : ${r.topIssues.join("  ")}`);
  L.push("");
  for (const f of r.findings) {
    L.push(`  [${SEV_LABEL[f.severity]}] ${f.rule} (${f.dim})`);
    L.push(`        ${f.message}`);
    L.push(`        evidence: ${f.evidence}`);
  }
  if (r.findings.length === 0) L.push("  no findings — the stream is clean");
  L.push(bar);
  return L.join("\n");
}
