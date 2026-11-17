import type { Derived } from "../derive";
import { info, warn } from "../types";
import type { Finding } from "../types";

export function economyRules(d: Derived): Finding[] {
  const out: Finding[] = [];

  // E101 — chunk fragmentation
  const frag: string[] = [];
  for (const [id, msg] of d.msgs) {
    if (msg.deltaCount >= 20 && msg.deltaCount > 0 && msg.chars / msg.deltaCount < 12) {
      frag.push(`message "${id}": ${msg.deltaCount} chunks × ${msg.chars / msg.deltaCount === Math.floor(msg.chars / msg.deltaCount) ? msg.chars / msg.deltaCount : (msg.chars / msg.deltaCount).toFixed(1)} avg chars`);
    }
  }
  if (frag.length > 0) {
    out.push(warn({
      rule: "E101", dim: "economy",
      message: `Pathological chunk fragmentation. ${frag.slice(0, 2).join("; ")}. Every chunk is a separate reconciliation pass in the frontend; per-character event overhead dominates the payload.`,
      evidence: `${frag.length} fragmented message(s)`,
    }));
  }

  // E102 — consecutive duplicates (reconnect replay)
  if (d.consecutiveDuplicates.length > 0) {
    out.push(warn({
      rule: "E102", dim: "economy",
      message: `${d.consecutiveDuplicates.length} event(s) are byte-identical to the immediately preceding event (timestamp excluded). This is the reconnect-replay signature: the frontend re-appends the same content chunk and duplicates text in the bubble.`,
      evidence: `duplicates at event(s) ${d.consecutiveDuplicates.slice(0, 4).map((i) => `#${i + 1}`).join(", ")}${d.consecutiveDuplicates.length > 4 ? " …" : ""}`,
      index: d.consecutiveDuplicates[0],
    }));
  }

  // E103 — deprecated THINKING_* events
  if (d.thinkingDeprecated.length > 0) {
    out.push(info({
      rule: "E103", dim: "economy",
      message: `${d.thinkingDeprecated.length} deprecated THINKING_* event(s). These are scheduled for removal in AG-UI 1.0.0; migrate to ReasoningStart/ReasoningMessage*/ReasoningEnd now to avoid a breaking upgrade.`,
      evidence: `first deprecated event at #${(d.thinkingDeprecated[0] ?? 0) + 1}`,
      index: d.thinkingDeprecated[0],
    }));
  }

  // E104 — naming convention drift
  if (d.namingDrift) {
    out.push(warn({
      rule: "E104", dim: "economy",
      message: "Mixed event-name conventions in one stream (SCREAMING_SNAKE_CASE alongside camelCase). Two producers are interleaving into this stream, or one producer drifts between SDK generations; consumers that match on exact strings will miss half the events.",
      evidence: "both naming styles observed in the same transcript",
    }));
  }

  // E105 — oversized events
  if (d.oversizedEvents.length > 0) {
    out.push(info({
      rule: "E105", dim: "economy",
      message: `${d.oversizedEvents.length} event(s) exceed 64 KB serialized. Oversized SSE frames stall the parser on slow clients and can be dropped by proxies with small buffer limits.`,
      evidence: `oversized at event(s) ${d.oversizedEvents.slice(0, 3).map((i) => `#${i + 1}`).join(", ")}`,
      index: d.oversizedEvents[0],
    }));
  }

  // E106 — Custom without name
  if (d.customMissingName.length > 0) {
    out.push(warn({
      rule: "E106", dim: "economy",
      message: `${d.customMissingName.length} Custom event(s) without a name. The protocol requires name+value; unnamed custom events are unaddressable for the application.`,
      evidence: `first unnamed Custom at #${(d.customMissingName[0] ?? 0) + 1}`,
      index: d.customMissingName[0],
    }));
  }

  // E107 — empty deltas
  if (d.emptyDeltas.length > 0) {
    out.push(warn({
      rule: "E107", dim: "economy",
      message: `${d.emptyDeltas.length} delta event(s) carry an empty string. Protocol requires a non-empty delta for TextMessageContent/ToolCallArgs; empty chunks cost a reconciliation pass each and add nothing.`,
      evidence: `first empty delta at #${(d.emptyDeltas[0] ?? 0) + 1}`,
      index: d.emptyDeltas[0],
    }));
  }

  // E109 — unregistered event types
  for (const t of d.unknownTypes) {
    out.push(info({
      rule: "E109", dim: "economy",
      message: `Unknown event type "${t}" is not part of the AG-UI protocol registry (including draft events). Strict consumers reject or ignore it; if this is a Custom extension it should travel as a Custom event with a name.`,
      evidence: `unknown type "${t}"`,
    }));
  }

  // E110 — chunk without messageId
  if (d.chunkWithoutId.length > 0) {
    out.push(warn({
      rule: "E110", dim: "economy",
      message: `${d.chunkWithoutId.length} chunk event(s) carry no messageId/toolCallId and cannot be associated with any stream. The protocol requires the first chunk of a stream to carry the id.`,
      evidence: `first unanchored chunk at #${(d.chunkWithoutId[0] ?? 0) + 1}`,
      index: d.chunkWithoutId[0],
    }));
  }

  return out;
}
