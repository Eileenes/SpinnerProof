import type { AGEvent } from "./types";

const KNOWN_TYPES = new Set([
  "runstarted",
  "runfinished",
  "runerror",
  "stepstarted",
  "stepfinished",
  "textmessagestart",
  "textmessagecontent",
  "textmessageend",
  "textmessagechunk",
  "toolcallstart",
  "toolcallargs",
  "toolcallend",
  "toolcallresult",
  "toolcallchunk",
  "statesnapshot",
  "statedelta",
  "messagessnapshot",
  "activitysnapshot",
  "activitydelta",
  "reasoningstart",
  "reasoningend",
  "reasoningmessagestart",
  "reasoningmessagecontent",
  "reasoningmessageend",
  "reasoningmessagechunk",
  "reasoningencryptedvalue",
  "subagentstarted",
  "subagentfinished",
  "subagenterror",
  "custom",
  "raw",
  "metaevent",
]);

export function canonicalType(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function isKnownType(c: string): boolean {
  return KNOWN_TYPES.has(c);
}

/** true when the raw type uses SCREAMING_SNAKE_CASE */
export function isScreaming(raw: string): boolean {
  return /_[A-Z]/.test(raw) || /^[A-Z]+(_[A-Z0-9]+)+$/.test(raw);
}

export interface ParseResult {
  events: AGEvent[];
  malformedLines: number;
  parseErrors: string[];
}

/**
 * Accepts either JSONL (one event per line, blank lines ignored) or a single
 * JSON array of events. Lines that fail to parse are skipped and counted so
 * the auditor can flag lossy transport instead of crashing.
 */
export function parseStream(text: string): ParseResult {
  const trimmed = text.trim();
  const parseErrors: string[] = [];
  if (trimmed.startsWith("[")) {
    let arr: unknown;
    try {
      arr = JSON.parse(trimmed);
    } catch (e) {
      return { events: [], malformedLines: 1, parseErrors: [`array body: ${(e as Error).message}`] };
    }
    if (!Array.isArray(arr)) {
      return { events: [], malformedLines: 1, parseErrors: ["top-level JSON is not an array"] };
    }
    const events: AGEvent[] = [];
    for (const item of arr as unknown[]) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        events.push(wrapEvent(item as Record<string, unknown>, events.length));
      } else {
        parseErrors.push("non-object entry in array");
      }
    }
    return { events, malformedLines: 0, parseErrors };
  }
  const events: AGEvent[] = [];
  let malformed = 0;
  for (const line of trimmed.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(s);
    } catch (e) {
      malformed += 1;
      parseErrors.push(`line ${events.length + malformed}: ${(e as Error).message}`);
      continue;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      malformed += 1;
      parseErrors.push(`line ${events.length + malformed}: not an object`);
      continue;
    }
    events.push(wrapEvent(obj as Record<string, unknown>, events.length));
  }
  return { events, malformedLines: malformed, parseErrors };
}

function wrapEvent(obj: Record<string, unknown>, index: number): AGEvent {
  // tolerate envelope styles: {type,...} or {event:{type,...}}
  const inner = obj.event && typeof obj.event === "object" && !Array.isArray(obj.event)
    ? (obj.event as Record<string, unknown>)
    : obj;
  const rawType = typeof inner.type === "string" ? inner.type : "";
  const bytes = Buffer.byteLength(JSON.stringify(obj), "utf8");
  return { index, rawType, type: canonicalType(rawType), event: inner, bytes };
}
