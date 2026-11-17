import type { Derived } from "../derive";
import { err, info, warn } from "../types";
import type { Finding } from "../types";

export function pairingRules(d: Derived): Finding[] {
  const out: Finding[] = [];

  // P108 — run lifecycle head
  if (d.firstEventNotRunStart) {
    out.push(err({
      rule: "P108", dim: "pairing",
      message: "First event is not RunStarted. Every AG-UI run transcript must open with RunStarted(threadId, runId); a frontend that joins mid-stream cannot bind run identity.",
      evidence: `stream opens with event #${(d.events[0]?.index ?? 0) + 1} (${d.events[0]?.rawType || "no type"})`,
      index: d.events[0]?.index,
    }));
  } else if (!d.runStarted && d.events.length > 0) {
    out.push(err({
      rule: "P108", dim: "pairing",
      message: "No RunStarted anywhere in the stream. The frontend never receives threadId/runId, so state and messages cannot be attributed to a run.",
      evidence: `${d.events.length} events without a run header`,
    }));
  }

  for (const idx of d.duplicateRunStart) {
    out.push(err({
      rule: "O104", dim: "order",
      message: "Second RunStarted while the previous run is still open. A frontend treats this as a new run and orphans everything streamed before it.",
      evidence: `RunStarted at event #${idx + 1} while run from event #${d.runStartIndex + 1} is still open`,
      index: idx,
    }));
  }

  // P101 — tool calls never closed
  for (const id of d.openToolCallIds) {
    const tc = d.toolCalls.get(id);
    out.push(err({
      rule: "P101", dim: "pairing",
      message: `ToolCallStart for "${id}" is never followed by ToolCallEnd. The frontend keeps the tool chip in its streaming state forever.`,
      evidence: `call "${id}" started at event #${(tc?.start ?? 0) + 1}, tool "${tc?.name ?? "?"}", ${tc?.argCount ?? 0} args chunk(s), no End`,
      index: tc?.start,
    }));
  }

  // P102 — args after End (the triple was already closed)
  for (const id of [...new Set(d.argsAfterEnd)]) {
    const tc = d.toolCalls.get(id);
    out.push(err({
      rule: "P102", dim: "pairing",
      message: `ToolCallArgs for "${id}" arrive after ToolCallEnd. The argument stream was already closed; these fragments either corrupt the assembled arguments or are dropped by the consumer.`,
      evidence: `args after End (call started #${(tc?.start ?? 0) + 1}, ended ${tc?.end === undefined ? "?" : `#${tc.end + 1}`})`,
      index: tc?.end,
    }));
  }

  // orphan ToolCallArgs
  for (const o of d.reuseClosed.filter((x) => x.kind === "tool-args-orphan")) {
    out.push(err({
      rule: "P102", dim: "pairing",
      message: `ToolCallArgs for unknown toolCallId "${o.id}". Args without a matching Start cannot be attached to any tool chip; the payload is silently dropped.`,
      evidence: `orphan args at event #${o.index + 1}`,
      index: o.index,
    }));
  }
  for (const o of d.reuseClosed.filter((x) => x.kind === "tool-result-unknown")) {
    out.push(err({
      rule: "P103", dim: "pairing",
      message: `ToolCallResult for unknown toolCallId "${o.id}". The result references a call that was never started on this stream.`,
      evidence: `orphan result at event #${o.index + 1}`,
      index: o.index,
    }));
  }
  for (const o of d.reuseClosed.filter((x) => x.kind === "tool-end")) {
    out.push(warn({
      rule: "P102", dim: "pairing",
      message: `ToolCallEnd for unknown toolCallId "${o.id}".`,
      evidence: `orphan End at event #${o.index + 1}`,
      index: o.index,
    }));
  }

  // P104 / P105 — text message pairing
  for (const id of d.openMessageIds) {
    const msg = d.msgs.get(id);
    out.push(warn({
      rule: "P104", dim: "pairing",
      message: `${msg?.kind === "reasoning" ? "Reasoning" : "Text"}MessageStart for "${id}" is never closed with an End event. The frontend renders an unterminated typing cursor.`,
      evidence: `started at event #${(msg?.start ?? 0) + 1}, ${msg?.deltaCount ?? 0} content chunk(s), no End`,
      index: msg?.start,
    }));
  }
  for (const o of d.reuseClosed.filter((x) => x.kind === "text" || x.kind === "reasoning")) {
    out.push(err({
      rule: "P105", dim: "pairing",
      message: `Message event for messageId "${o.id}" without a matching Start on this stream.`,
      evidence: `unanchored event at #${o.index + 1}`,
      index: o.index,
    }));
  }
  for (const o of d.duplicateStarts.filter((x) => (x.kind === "text" || x.kind === "reasoning" || x.kind === "tool" || x.kind === "end" || x.kind === "tool-end" || x.kind === "subagent") && !d.idCollisions.includes(x.id))) {
    out.push(err({
      rule: "P114", dim: "pairing",
      message: `Duplicate lifecycle event for id "${o.id}" (kind: ${o.kind}). Double Starts render duplicated UI elements or reset in-flight state.`,
      evidence: `duplicate at event #${o.index + 1}`,
      index: o.index,
    }));
  }

  // P112 — id reuse after close
  for (const o of d.reuseClosed.filter((x) => x.kind === "tool")) {
    out.push(warn({
      rule: "P112", dim: "pairing",
      message: `toolCallId "${o.id}" reused after its call already closed. Some frontends merge the old and new call, showing a stale result.`,
      evidence: `reuse at event #${o.index + 1}`,
      index: o.index,
    }));
  }

  // P106/P107 — steps
  for (const o of d.duplicateStarts.filter((x) => x.kind === "step-mismatch")) {
    out.push(err({
      rule: "P106", dim: "pairing",
      message: `StepFinished(stepName="${o.id}") does not match the open StepStarted. Progress UI highlights the wrong step and one step stays pinned as "running".`,
      evidence: `mismatched close at event #${o.index + 1}`,
      index: o.index,
    }));
  }
  for (const o of d.reuseClosed.filter((x) => x.kind === "step-orphan")) {
    out.push(warn({
      rule: "P107", dim: "pairing",
      message: `StepFinished(stepName="${o.id}") without a matching open StepStarted.`,
      evidence: `orphan step close at event #${o.index + 1}`,
      index: o.index,
    }));
  }
  const openSteps = d.steps.filter((s) => s.end === undefined);
  if (openSteps.length > 0) {
    out.push(warn({
      rule: "P107", dim: "pairing",
      message: `${openSteps.length} StepStarted event(s) never closed: ${openSteps.map((s) => `"${s.name || "(empty)"}"`).join(", ")}. The step indicator spins after the run is over.`,
      evidence: `open step(s) opened at event #${openSteps.map((s) => s.start + 1).join(", #")}`,
      index: openSteps[0]?.start,
    }));
  }

  // P111 — messageId space collisions
  const collisions = [...new Set(d.idCollisions)];
  for (const id of collisions) {
    out.push(err({
      rule: "P111", dim: "pairing",
      message: `messageId "${id}" is used across different message kinds (text/reasoning/activity). The protocol forbids reusing the shared id space; the frontend overwrites one message with another.`,
      evidence: `collision on "${id}"`,
    }));
  }

  // P109 — reasoning lifecycle (open implicit reasoning already covered by P104; explicit orphan content covered by P105)
  // P110 — subagents
  for (const o of d.reuseClosed.filter((x) => x.kind === "subagent")) {
    out.push(warn({
      rule: "P110", dim: "pairing",
      message: `Subagent event for subagentRunId "${o.id}" without a matching SubagentStarted.`,
      evidence: `orphan subagent event at #${o.index + 1}`,
      index: o.index,
    }));
  }
  for (const o of d.duplicateStarts.filter((x) => x.kind === "subagent")) {
    out.push(warn({
      rule: "P110", dim: "pairing",
      message: `Subagent "${o.id}" closed more than once.`,
      evidence: `duplicate close at #${o.index + 1}`,
      index: o.index,
    }));
  }

  // P113 — interrupt outcome shape
  if (d.interruptWithoutInterrupts) {
    out.push(warn({
      rule: "P113", dim: "pairing",
      message: "RunFinished with outcome=interrupt but no interrupts array. The frontend cannot build the resume payload, so the human-in-the-loop prompt is lost.",
      evidence: "outcome.type == 'interrupt' without interrupts[]",
    }));
  }

  // missing required fields (paired with E112 at render level, but count here for pairing hygiene)
  for (const m of d.missingFields) {
    out.push(info({
      rule: "E112", dim: "economy",
      message: `Event ${m.type} is missing required field "${m.field}". Consumers that read this field get undefined and fall back silently.`,
      evidence: `${m.type} at event #${m.index + 1} lacks ${m.field}`,
      index: m.index,
    }));
  }

  return out;
}
