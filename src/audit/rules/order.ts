import type { Derived } from "../derive";
import { err, warn } from "../types";
import type { Finding } from "../types";

export function orderRules(d: Derived): Finding[] {
  const out: Finding[] = [];

  if (d.eventsAfterTermination > 0) {
    out.push(err({
      rule: "O101", dim: "order",
      message: `${d.eventsAfterTermination} event(s) arrive after the run was terminated by ${d.terminateKind === "error" ? "RunError" : "RunFinished"}. Per protocol nothing is processed after termination; a frontend either drops them or double-renders.`,
      evidence: `first stray event at #${d.firstAfterTermination + 1}`,
      index: d.firstAfterTermination,
    }));
  }

  // O105 — result before End
  for (const id of [...new Set(d.resultBeforeEnd)]) {
    const tc = d.toolCalls.get(id);
    out.push(warn({
      rule: "O105", dim: "order",
      message: `ToolCallResult for "${id}" arrives before ToolCallEnd. The result is not part of the Start→Args→End triple; frontends that close on End will discard the result that arrived early.`,
      evidence: `result at #${(tc?.result ?? 0) + 1}, End at ${tc?.end === undefined ? "(never)" : `#${tc.end + 1}`}`,
      index: tc?.result,
    }));
  }

  // O106 — MessagesSnapshot wipes streamed messages
  if (d.snapshotWipedIds.length > 0) {
    out.push(err({
      rule: "O106", dim: "order",
      message: `MessagesSnapshot at #${d.snapshotWipedIndex + 1} omits ${d.snapshotWipedIds.length} message(s) that were streamed earlier in this run. The snapshot instructs the frontend to replace the transcript, so those messages vanish from the UI.`,
      evidence: `missing from snapshot: ${d.snapshotWipedIds.slice(0, 5).map((i) => `"${i}"`).join(", ")}${d.snapshotWipedIds.length > 5 ? ` (+${d.snapshotWipedIds.length - 5} more)` : ""}`,
      index: d.snapshotWipedIndex,
    }));
  }

  // O107 — content events for implicit messages with no start (covered by P105) — reasoning-after-end handled via msg closed check
  for (const [id, msg] of d.msgs) {
    if (msg.kind === "reasoning" && msg.end !== undefined && msg.deltaCount === 0) {
      out.push(warn({
        rule: "O103", dim: "order",
        message: `Reasoning message "${id}" closed with zero content chunks. The reasoning panel flickers open and immediately collapses.`,
        evidence: `started #${msg.start + 1}, ended #${msg.end + 1}, 0 chunks`,
        index: msg.end,
      }));
    }
    if (msg.end !== undefined && msg.chars === 0 && msg.kind === "text" && !msg.implicit) {
      out.push(warn({
        rule: "O103", dim: "order",
        message: `Text message "${id}" closed with zero content. The frontend renders an empty assistant bubble.`,
        evidence: `started #${msg.start + 1}, ended #${msg.end + 1}, 0 characters`,
        index: msg.end,
      }));
    }
    void id;
  }

  return out;
}
