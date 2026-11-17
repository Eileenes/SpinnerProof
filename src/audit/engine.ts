import { derive } from "./derive";
import { parseStream } from "./parse";
import { pairingRules } from "./rules/pairing";
import { orderRules } from "./rules/order";
import { stateRules } from "./rules/state";
import { hangRules } from "./rules/hang";
import { economyRules } from "./rules/economy";
import { computeScore, gradeOf, verdictOf } from "./score";
import type { AGEvent, Report } from "./types";

export const VERSION = "1.0.0";
export const TOOL_NAME = "SpinnerProof";

export interface AuditOptions {
  source?: string;
  malformedNote?: string[];
}

export function auditText(text: string, opts: AuditOptions = {}): Report {
  const parsed = parseStream(text);
  const source = opts.source ?? "inline";
  const report = auditEvents(parsed.events, { source, malformedNote: parsed.parseErrors });
  return report;
}

export function auditEvents(events: AGEvent[], opts: AuditOptions = {}): Report {
  const d = derive(events, opts.malformedNote ?? []);
  const findings = [
    ...pairingRules(d),
    ...orderRules(d),
    ...stateRules(d),
    ...hangRules(d),
    ...economyRules(d),
  ].sort((a, b) => {
    const order: Record<string, number> = { error: 0, warn: 1, info: 2 };
    if (order[a.severity] !== order[b.severity]) return order[a.severity]! - order[b.severity]!;
    return a.rule.localeCompare(b.rule);
  });

  const { dims, score } = computeScore(findings);
  const willHang = !d.terminated && events.length > 0;
  const errors = findings.filter((f) => f.severity === "error").length;

  const missingResults = d.endedWithoutResult.filter((id) => !d.openToolCallIds.includes(id));

  const hang = {
    willHang,
    reason: willHang
      ? `Stream ends without RunFinished/RunError${d.openToolCallIds.length > 0 ? `; ${d.openToolCallIds.length} tool call(s) still open` : ""}${d.openMessageIds.length > 0 ? `; ${d.openMessageIds.length} message(s) still open` : ""}`
      : d.terminated
        ? "Run terminated normally in the transcript"
        : "Empty stream",
    openToolCallIds: d.openToolCallIds,
    openMessageIds: d.openMessageIds,
    missingToolResults: missingResults,
    terminated: d.terminated,
  };

  const grade = gradeOf(score);
  const verdict = verdictOf(score, errors, willHang);

  const byRule = new Map<string, number>();
  for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  const topIssues = [...byRule.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rule, n]) => `${rule}×${n}`);

  const byteCount = events.reduce((acc, e) => acc + e.bytes, 0);

  return {
    tool: TOOL_NAME,
    version: VERSION,
    source: opts.source ?? "inline",
    eventCount: events.length,
    byteCount,
    score,
    grade,
    verdict,
    dims,
    findings,
    hang,
    topIssues,
  };
}
