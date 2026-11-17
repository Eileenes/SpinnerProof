import type { Derived } from "../derive";
import { err, warn } from "../types";
import type { Finding } from "../types";

export function hangRules(d: Derived): Finding[] {
  const out: Finding[] = [];

  // H101 — the headline: the stream never terminates
  if (!d.terminated && d.events.length > 0) {
    const bits: string[] = [];
    if (d.openToolCallIds.length > 0) bits.push(`${d.openToolCallIds.length} tool call(s) never received ToolCallEnd (${d.openToolCallIds.map((i) => `"${i}"`).join(", ")})`);
    if (d.openMessageIds.length > 0) bits.push(`${d.openMessageIds.length} message(s) never received End (${d.openMessageIds.map((i) => `"${i}"`).join(", ")})`);
    out.push(err({
      rule: "H101", dim: "hang",
      message: `The stream is truncated: no RunFinished and no RunError. ${bits.length > 0 ? bits.join("; ") + ". " : ""}The frontend will show the run as still in progress — the spinner never stops. This is deterministic: the transcript simply ends.`,
      evidence: `last event is #${d.events[d.events.length - 1]?.index ?? 0}, type ${d.events[d.events.length - 1]?.rawType || "(none)"}, run opened at #${d.runStartIndex + 1}`,
      index: Math.max(0, d.events.length - 1),
    }));
  }

  // H102 — terminated but a message is still open: cursor blinks forever
  if (d.terminated && d.openMessageIds.length > 0) {
    out.push(err({
      rule: "H102", dim: "hang",
      message: `The run is closed (${d.terminateKind === "error" ? "RunError" : "RunFinished"}) but ${d.openMessageIds.length} message(s) were never closed with End (${d.openMessageIds.map((i) => `"${i}"`).join(", ")}). The typing cursor on those bubbles blinks forever next to a finished run.`,
      evidence: `terminated at #${d.terminateIndex + 1}, open message(s) started at ${d.openMessageIds.map((i) => { const m = d.msgs.get(i); return `#${(m?.start ?? 0) + 1}`; }).join(", ")}`,
      index: d.terminateIndex,
    }));
  }

  // H103 — clean finish, ended calls without results
  if (d.terminated && d.terminateKind === "finished") {
    const missing = [...new Set(d.endedWithoutResult.filter((id) => d.openToolCallIds.includes(id) === false))];
    if (missing.length > 0) {
      out.push(warn({
        rule: "H103", dim: "hang",
        message: `${missing.length} tool call(s) ended but never received a ToolCallResult before RunFinished (${missing.map((i) => `"${i}"`).join(", ")}). Tool chips stay in "running" state after the run claims success.`,
        evidence: `calls ended without result: ${missing.join(", ")}`,
      }));
    }
  }

  // H104 — empty run
  const visible = d.events.filter((e) => e.type !== "runstarted" && e.type !== "runfinished").length;
  if (d.terminated && d.terminateKind === "finished" && visible === 0) {
    out.push(warn({
      rule: "H104", dim: "hang",
      message: "Empty run: RunStarted is immediately followed by RunFinished with zero content events. The UI flashes a spinner for nothing.",
      evidence: `${d.events.length} events, no user-visible content`,
    }));
  }

  // H105 — error without message
  if (d.runErrorMessageMissing) {
    out.push(warn({
      rule: "H105", dim: "hang",
      message: "RunError without a message field. The frontend has nothing to show except a generic failure — the user cannot tell what went wrong.",
      evidence: `RunError at #${d.terminateIndex + 1} lacks message`,
      index: d.terminateIndex,
    }));
  }

  return out;
}
