import type { AGEvent } from "./types";

export interface ToolCallState {
  id: string;
  name: string;
  start: number;
  end?: number;
  result?: number;
  argsChars: number;
  argCount: number;
}

export interface MsgState {
  id: string;
  kind: "text" | "reasoning";
  start: number;
  end?: number;
  implicit: boolean;
  chars: number;
  deltaCount: number;
  role?: string;
}

export interface StepState {
  name: string;
  start: number;
  end?: number;
}

export interface PatchOp {
  op: string;
  path?: string;
  value?: unknown;
  from?: string;
}

export interface PatchFailure {
  index: number;
  op: string;
  path: string;
  problem: "missing-path" | "missing-parent" | "invalid-op" | "missing-field" | "bad-pointer";
}

export interface Derived {
  events: AGEvent[];

  runStarted: boolean;
  runStartIndex: number; // index of RunStarted, -1 if none
  duplicateRunStart: number[]; // indices of extra RunStarted events while run open
  terminated: boolean;
  terminateIndex: number;
  terminateKind: "" | "finished" | "error";
  runErrorMessageMissing: boolean;
  interruptWithoutInterrupts: boolean;

  firstEventNotRunStart: boolean;

  toolCalls: Map<string, ToolCallState>;
  msgs: Map<string, MsgState>;
  activityIds: Set<string>;
  activityTypes: Map<string, string>;
  steps: StepState[];
  subagents: Map<string, { start: number; closed: boolean }>;

  idCollisions: string[]; // messageIds used across kinds
  duplicateStarts: Array<{ index: number; id: string; kind: string }>;
  reuseClosed: Array<{ index: number; id: string; kind: string }>;

  patchFailures: PatchFailure[];
  snapshotCount: number;
  snapshotBeforeDelta: boolean;
  rollbackKeys: string[];
  deltaKeySet: Set<string>;
  argsAfterEnd: string[];

  snapshotWipedIds: string[];
  snapshotWipedIndex: number;

  eventsAfterTermination: number; // count
  firstAfterTermination: number; // index
  resultBeforeEnd: string[]; // toolCallIds

  emptyDeltas: number[];
  chunkWithoutId: number[];
  customMissingName: number[];
  thinkingDeprecated: number[];
  unknownTypes: string[];
  oversizedEvents: number[];
  missingFields: Array<{ index: number; type: string; field: string }>;
  consecutiveDuplicates: number[];
  namingDrift: boolean;
  malformedNote: string[];

  openToolCallIds: string[];
  openMessageIds: string[];
  endedWithoutResult: string[];
}

function jsonPtrEscape(p: string): string {
  return p.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** resolve a JSON pointer against a document; returns {ok, parent, key, leaf} */
function resolvePtr(doc: unknown, pointer: string): { ok: boolean; parent: unknown; key: string; exists: boolean } {
  if (pointer === "") return { ok: true, parent: null, key: "", exists: true };
  if (!pointer.startsWith("/")) return { ok: false, parent: null, key: pointer, exists: false };
  const parts = pointer.split("/").slice(1).map(jsonPtrEscape);
  let cur: unknown = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i] as string;
    if (cur === null || typeof cur !== "object") return { ok: false, parent: cur, key: k, exists: false };
    if (Array.isArray(cur)) {
      const nIdx = Number(k);
      if (!Number.isInteger(nIdx) || nIdx < 0 || nIdx >= cur.length) return { ok: false, parent: cur, key: k, exists: false };
    } else if (!(k in (cur as Record<string, unknown>))) {
      return { ok: false, parent: cur, key: k, exists: false };
    }
    cur = Array.isArray(cur) ? (cur as unknown[])[Number(k)] : (cur as Record<string, unknown>)[k as string];
  }
  const key = parts[parts.length - 1] ?? "";
  if (cur === null || typeof cur !== "object") return { ok: false, parent: cur, key, exists: false };
  if (Array.isArray(cur)) {
    const idx = Number(key);
    const exists = Number.isInteger(idx) && idx >= 0 && idx < cur.length;
    return { ok: true, parent: cur, key, exists };
  }
  const rec = cur as Record<string, unknown>;
  return { ok: true, parent: cur, key, exists: key in rec };
}

interface PatchTrack {
  pre: Map<string, unknown>;
  post: Map<string, unknown>;
}

function applyPatch(state: unknown, op: PatchOp, failures: PatchFailure[], index: number, deltaKeySet: Set<string>, track?: PatchTrack): { ok: boolean; state: unknown } {
  if (!op || typeof op !== "object") {
    failures.push({ index, op: "?", path: "", problem: "invalid-op" });
    return { ok: false, state };
  }
  const VALID = ["add", "replace", "remove", "test", "move", "copy"];
  if (!VALID.includes(String(op.op))) {
    failures.push({ index, op: String(op.op), path: String(op.path ?? ""), problem: "invalid-op" });
    return { ok: false, state };
  }
  if (op.op === "move" || op.op === "copy") {
    if (typeof op.from !== "string") {
      failures.push({ index, op: String(op.op), path: String(op.path ?? ""), problem: "missing-field" });
      return { ok: false, state };
    }
    if (typeof op.path !== "string") {
      failures.push({ index, op: String(op.op), path: "", problem: "missing-field" });
      return { ok: false, state };
    }
    const fromPtr: string = op.from;
    const destPtr: string = op.path;
    const src = resolvePtr(state, fromPtr);
    if (!src.ok || !src.exists) {
      failures.push({ index, op: String(op.op), path: fromPtr, problem: "missing-path" });
      return { ok: false, state };
    }
    const value = getAt(state, fromPtr);
    return applyPatch(state, { op: "add", path: destPtr, value }, failures, index, deltaKeySet, track);
  }
  if (typeof op.path !== "string") {
    failures.push({ index, op: String(op.op), path: "", problem: "missing-field" });
    return { ok: false, state };
  }
  if (op.op === "add" || op.op === "replace") {
    if (!("value" in op)) {
      failures.push({ index, op: String(op.op), path: op.path, problem: "missing-field" });
      return { ok: false, state };
    }
  }
  if (op.op === "test") {
    const at = resolvePtr(state, op.path);
    if (!at.ok || !at.exists) {
      failures.push({ index, op: op.op, path: op.path, problem: "missing-path" });
      return { ok: false, state };
    }
    const cur = getAt(state, op.path);
    return { ok: JSON.stringify(cur) === JSON.stringify(op.value), state };
  }
  if (pointerSyntaxBad(op.path)) {
    failures.push({ index, op: String(op.op), path: op.path, problem: "bad-pointer" });
    return { ok: false, state };
  }
  const at = resolvePtr(state, op.path);
  const targetPath: string = op.path;
  const recordTrack = (preValue: unknown, postValue: unknown) => {
    if (!track) return;
    const first = targetPath.split("/").filter(Boolean)[0];
    if (!first) return;
    const key = jsonPtrEscape(first);
    if (!track.pre.has(key)) track.pre.set(key, { value: preValue });
    track.post.set(key, { value: postValue });
  };
  if (op.op === "add") {
    // parent must exist (root add replaces the doc)
    if (op.path === "") return { ok: true, state: op.value };
    if (!at.ok) {
      failures.push({ index, op: op.op, path: op.path, problem: "missing-parent" });
      return { ok: false, state };
    }
    if (Array.isArray(at.parent)) {
      const arr = at.parent as unknown[];
      const idx = at.key === "-" ? arr.length : Number(at.key);
      if (!Number.isInteger(idx) || idx < 0 || idx > arr.length) {
        failures.push({ index, op: op.op, path: op.path, problem: "missing-parent" });
        return { ok: false, state };
      }
      arr.splice(idx, 0, op.value);
    } else if (at.parent !== null && typeof at.parent === "object") {
      recordTrack((at.parent as Record<string, unknown>)[at.key], op.value);
      (at.parent as Record<string, unknown>)[at.key] = op.value;
    } else {
      failures.push({ index, op: op.op, path: op.path, problem: "missing-parent" });
      return { ok: false, state };
    }
    rememberKeys(op.path, deltaKeySet);
    return { ok: true, state };
  }
  // replace / remove require the path to exist
  if (!at.ok || !at.exists) {
    failures.push({ index, op: String(op.op), path: op.path, problem: "missing-path" });
    return { ok: false, state };
  }
  if (op.op === "remove") {
    const pre = Array.isArray(at.parent) ? (at.parent as unknown[])[Number(at.key)] : (at.parent as Record<string, unknown>)[at.key];
    if (Array.isArray(at.parent)) {
      (at.parent as unknown[]).splice(Number(at.key), 1);
    } else if (at.parent !== null && typeof at.parent === "object") {
      delete (at.parent as Record<string, unknown>)[at.key];
    }
    recordTrack(pre, undefined);
    rememberKeys(op.path, deltaKeySet);
    return { ok: true, state };
  }
  // replace
  const preVal = Array.isArray(at.parent) ? (at.parent as unknown[])[Number(at.key)] : (at.parent as Record<string, unknown>)[at.key];
  if (Array.isArray(at.parent)) {
    (at.parent as unknown[])[Number(at.key)] = op.value;
  } else if (at.parent !== null && typeof at.parent === "object") {
    (at.parent as Record<string, unknown>)[at.key] = op.value;
  }
  recordTrack(preVal, op.value);
  rememberKeys(op.path, deltaKeySet);
  return { ok: true, state };
}

function rememberKeys(path: string, set: Set<string>): void {
  const first = path.split("/").filter(Boolean)[0];
  if (first) set.add(jsonPtrEscape(first));
}

function pointerSyntaxBad(p: string): boolean {
  return p !== "" && !p.startsWith("/");
}

function getAt(doc: unknown, pointer: string): unknown {
  const parts = pointer.split("/").slice(1).map(jsonPtrEscape);
  let cur: unknown = doc;
  for (const k of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = Array.isArray(cur) ? (cur as unknown[])[Number(k)] : (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export function derive(events: AGEvent[], malformedNote: string[]): Derived {
  const d: Derived = {
    events,
    runStarted: false,
    runStartIndex: -1,
    duplicateRunStart: [],
    terminated: false,
    terminateIndex: -1,
    terminateKind: "",
    runErrorMessageMissing: false,
    interruptWithoutInterrupts: false,
    firstEventNotRunStart: false,
    toolCalls: new Map(),
    msgs: new Map(),
    activityIds: new Set(),
    activityTypes: new Map(),
    steps: [],
    subagents: new Map(),
    idCollisions: [],
    duplicateStarts: [],
    reuseClosed: [],
    patchFailures: [],
    snapshotCount: 0,
    snapshotBeforeDelta: false,
    rollbackKeys: [],
    deltaKeySet: new Set(),
    argsAfterEnd: [],
    snapshotWipedIds: [],
    snapshotWipedIndex: -1,
    eventsAfterTermination: 0,
    firstAfterTermination: -1,
    resultBeforeEnd: [],
    emptyDeltas: [],
    chunkWithoutId: [],
    customMissingName: [],
    thinkingDeprecated: [],
    unknownTypes: [],
    oversizedEvents: [],
    missingFields: [],
    consecutiveDuplicates: [],
    namingDrift: false,
    malformedNote,
    openToolCallIds: [],
    openMessageIds: [],
    endedWithoutResult: [],
  };

  const seenKinds = new Map<string, Set<string>>(); // messageId -> kinds
  let sawCamel = false;
  let sawScreaming = false;
  let lastSerialized = "";
  let state: unknown = undefined;
  let lastChunkMsgId = "";
  let lastSnapshot: unknown = undefined;
  const preDelta = new Map<string, { value: unknown }>();
  const postDelta = new Map<string, { value: unknown }>();

  const noteKind = (id: string, kind: string, index: number) => {
    let set = seenKinds.get(id);
    if (!set) {
      set = new Set();
      seenKinds.set(id, set);
    }
    if (!set.has(kind) && set.size > 0) {
      d.idCollisions.push(id);
    }
    set.add(kind);
    void index;
  };

  for (const ev of events) {
    const idx = ev.index;
    const e = ev.event;
    const t = ev.type;
    const raw = ev.rawType;
    if (ev.bytes > 65536) d.oversizedEvents.push(idx);
    if (raw && !raw.includes("_")) sawCamel = true;
    if (raw && (raw.includes("_") || /^[A-Z0-9_]+$/.test(raw))) sawScreaming = true;

    if (t === "runstarted") {
      if (d.runStarted && !d.terminated) {
        d.duplicateRunStart.push(idx);
      } else if (d.runStartIndex === -1) {
        d.runStarted = true;
        d.runStartIndex = idx;
        if (idx !== 0) d.firstEventNotRunStart = true;
        if (typeof e.threadId !== "string") d.missingFields.push({ index: idx, type: raw || "RunStarted", field: "threadId" });
        if (typeof e.runId !== "string") d.missingFields.push({ index: idx, type: raw || "RunStarted", field: "runId" });
      }
      continue;
    }
    if (t === "runfinished" || t === "runerror") {
      if (d.terminated) {
        if (d.firstAfterTermination === -1) d.firstAfterTermination = idx;
        d.eventsAfterTermination += 1;
        continue;
      }
      d.terminated = true;
      d.terminateIndex = idx;
      d.terminateKind = t === "runfinished" ? "finished" : "error";
      if (t === "runerror") {
        const msg = e.message;
        if (typeof msg !== "string" || msg.length === 0) d.runErrorMessageMissing = true;
      }
      if (t === "runfinished") {
        const outcome = e.outcome;
        if (outcome && typeof outcome === "object" && !Array.isArray(outcome)) {
          const oc = outcome as Record<string, unknown>;
          if (oc.type === "interrupt") {
            const interrupts = oc.interrupts;
            if (!Array.isArray(interrupts) || interrupts.length === 0) d.interruptWithoutInterrupts = true;
          }
        }
      }
      continue;
    }
    if (d.terminated) {
      d.eventsAfterTermination += 1;
      if (d.firstAfterTermination === -1) d.firstAfterTermination = idx;
      // deprecated thinking events still count for economy
      if (t.startsWith("thinking")) d.thinkingDeprecated.push(idx);
      if (!ev.rawType) void 0;
      continue;
    }

    switch (t) {
      case "stepstarted": {
        const name = typeof e.stepName === "string" ? e.stepName : "";
        d.steps.push({ name, start: idx });
        if (typeof e.stepName !== "string") d.missingFields.push({ index: idx, type: raw || "StepStarted", field: "stepName" });
        break;
      }
      case "stepfinished": {
        const name = typeof e.stepName === "string" ? e.stepName : "";
        const open = [...d.steps].reverse().find((s) => s.end === undefined);
        const match = [...d.steps].reverse().find((s) => s.end === undefined && s.name === name);
        if (match) {
          match.end = idx;
        } else if (open) {
          // mismatched close: close the oldest open to keep bookkeeping sane, flag later
          open.end = idx;
          d.duplicateStarts.push({ index: idx, id: name || "(empty)", kind: "step-mismatch" });
        } else {
          d.reuseClosed.push({ index: idx, id: name || "(empty)", kind: "step-orphan" });
        }
        break;
      }
      case "textmessagestart":
      case "reasoningmessagestart": {
        const id = typeof e.messageId === "string" ? e.messageId : "";
        const kind = t === "textmessagestart" ? "text" : "reasoning";
        if (typeof e.messageId !== "string") d.missingFields.push({ index: idx, type: raw || "TextMessageStart", field: "messageId" });
        if (t === "textmessagestart" && typeof e.role !== "string") d.missingFields.push({ index: idx, type: raw || "TextMessageStart", field: "role" });
        noteKind(id, kind, idx);
        const existing = d.msgs.get(id);
        if (existing && existing.end === undefined) {
          d.duplicateStarts.push({ index: idx, id, kind });
          break;
        }
        if (existing && existing.end !== undefined) {
          d.reuseClosed.push({ index: idx, id, kind });
        }
        d.msgs.set(id, { id, kind, start: idx, implicit: false, chars: 0, deltaCount: 0, role: typeof e.role === "string" ? e.role : undefined });
        break;
      }
      case "textmessagecontent":
      case "reasoningmessagecontent": {
        const id = typeof e.messageId === "string" ? e.messageId : "";
        const delta = e.delta;
        const msg = d.msgs.get(id);
        if (!msg) {
          // content without start: synthesise a record so later events still pair, and flag it
          const kind = t === "textmessagecontent" ? "text" : "reasoning";
          noteKind(id, kind, idx);
          d.msgs.set(id, { id, kind, start: idx, implicit: true, chars: 0, deltaCount: 0 });
          d.reuseClosed.push({ index: idx, id, kind });
          break;
        }
        if (typeof delta !== "string") {
          d.missingFields.push({ index: idx, type: raw || "Content", field: "delta" });
        } else if (delta.length === 0) {
          d.emptyDeltas.push(idx);
        } else {
          msg.chars += delta.length;
          msg.deltaCount += 1;
        }
        break;
      }
      case "textmessageend":
      case "reasoningmessageend": {
        const id = typeof e.messageId === "string" ? e.messageId : "";
        const msg = d.msgs.get(id);
        if (!msg) {
          d.reuseClosed.push({ index: idx, id, kind: t === "textmessageend" ? "text" : "reasoning" });
          break;
        }
        if (msg.end !== undefined) {
          d.duplicateStarts.push({ index: idx, id, kind: "end" });
          break;
        }
        msg.end = idx;
        break;
      }
      case "textmessagechunk": {
        const id = typeof e.messageId === "string" ? e.messageId : lastChunkMsgId;
        if (typeof e.messageId !== "string") {
          if (!lastChunkMsgId) d.chunkWithoutId.push(idx);
        } else {
          lastChunkMsgId = id;
        }
        const delta = typeof e.delta === "string" ? e.delta : "";
        let msg = d.msgs.get(id);
        if (!msg || msg.kind !== "text") {
          noteKind(id, "text", idx);
          msg = { id, kind: "text", start: idx, implicit: true, chars: 0, deltaCount: 0 };
          d.msgs.set(id, msg);
        }
        if (delta.length === 0) d.emptyDeltas.push(idx);
        else {
          msg.chars += delta.length;
          msg.deltaCount += 1;
        }
        break;
      }
      case "reasoningmessagechunk": {
        const id = typeof e.messageId === "string" ? e.messageId : "";
        if (!id) d.chunkWithoutId.push(idx);
        const delta = typeof e.delta === "string" ? e.delta : "";
        if (id) {
          let msg = d.msgs.get(id);
          if (!msg || msg.kind !== "reasoning") {
            noteKind(id, "reasoning", idx);
            msg = { id, kind: "reasoning", start: idx, implicit: true, chars: 0, deltaCount: 0 };
            d.msgs.set(id, msg);
          }
          if (delta.length === 0) {
            // empty delta closes a reasoning chunk message per protocol
            if (msg.end === undefined) msg.end = idx;
          } else {
            msg.chars += delta.length;
            msg.deltaCount += 1;
          }
        }
        break;
      }
      case "reasoningstart":
      case "reasoningend": {
        const id = typeof e.messageId === "string" ? e.messageId : "";
        if (t === "reasoningstart" && !id) d.missingFields.push({ index: idx, type: raw || "ReasoningStart", field: "messageId" });
        break;
      }
      case "toolcallstart": {
        const id = typeof e.toolCallId === "string" ? e.toolCallId : "";
        const name = typeof e.toolCallName === "string" ? e.toolCallName : "";
        if (!id) d.missingFields.push({ index: idx, type: raw || "ToolCallStart", field: "toolCallId" });
        if (!name) d.missingFields.push({ index: idx, type: raw || "ToolCallStart", field: "toolCallName" });
        const existing = d.toolCalls.get(id);
        if (existing && existing.end === undefined) {
          d.duplicateStarts.push({ index: idx, id, kind: "tool" });
          break;
        }
        if (existing && existing.end !== undefined) {
          d.reuseClosed.push({ index: idx, id, kind: "tool" });
        }
        d.toolCalls.set(id, { id, name, start: idx, argsChars: 0, argCount: 0 });
        break;
      }
      case "toolcallargs": {
        const id = typeof e.toolCallId === "string" ? e.toolCallId : "";
        const tc = d.toolCalls.get(id);
        if (!tc) break; // flagged in post-pass as orphan args
        if (tc.end !== undefined) {
          if (!d.argsAfterEnd.includes(id)) d.argsAfterEnd.push(id);
          break;
        }
        const delta = e.delta;
        if (typeof delta !== "string") {
          d.missingFields.push({ index: idx, type: raw || "ToolCallArgs", field: "delta" });
        } else if (delta.length === 0) {
          d.emptyDeltas.push(idx);
        } else {
          tc.argsChars += delta.length;
          tc.argCount += 1;
        }
        break;
      }
      case "toolcallend": {
        const id = typeof e.toolCallId === "string" ? e.toolCallId : "";
        const tc = d.toolCalls.get(id);
        if (!tc) {
          d.reuseClosed.push({ index: idx, id, kind: "tool-end" });
          break;
        }
        if (tc.end !== undefined) {
          d.duplicateStarts.push({ index: idx, id, kind: "tool-end" });
          break;
        }
        tc.end = idx;
        break;
      }
      case "toolcallresult": {
        const id = typeof e.toolCallId === "string" ? e.toolCallId : "";
        if (!("content" in e)) d.missingFields.push({ index: idx, type: raw || "ToolCallResult", field: "content" });
        const tc = d.toolCalls.get(id);
        if (!tc) break; // flagged in post-pass as unknown result
        if (tc.end === undefined) d.resultBeforeEnd.push(id);
        if (tc.result === undefined) tc.result = idx;
        break;
      }
      case "toolcallchunk": {
        const id = typeof e.toolCallId === "string" ? e.toolCallId : "";
        if (!id) d.chunkWithoutId.push(idx);
        const delta = typeof e.delta === "string" ? e.delta : "";
        let tc = d.toolCalls.get(id);
        if (!tc) {
          tc = { id, name: typeof e.toolCallName === "string" ? e.toolCallName : "", start: idx, argsChars: 0, argCount: 0 };
          d.toolCalls.set(id, tc);
        }
        if (delta.length === 0) d.emptyDeltas.push(idx);
        else {
          tc.argsChars += delta.length;
          tc.argCount += 1;
        }
        break;
      }
      case "statesnapshot": {
        d.snapshotCount += 1;
        if (!e.snapshot || typeof e.snapshot !== "object" || Array.isArray(e.snapshot)) {
          d.missingFields.push({ index: idx, type: raw || "StateSnapshot", field: "snapshot" });
        } else {
          // rollback detection: a snapshot that sets a delta-mutated key back to
          // its pre-delta value silently rolls the UI back
          const snap = e.snapshot as Record<string, unknown>;
          if (preDelta.size > 0) {
            for (const key of d.deltaKeySet) {
              const pre = preDelta.get(key);
              const post = postDelta.get(key);
              const now = snap[key];
              if (
                pre !== undefined &&
                post !== undefined &&
                JSON.stringify(now) === JSON.stringify(pre.value) &&
                JSON.stringify(post.value) !== JSON.stringify(pre.value)
              ) {
                d.rollbackKeys.push(key);
              }
            }
          }
          lastSnapshot = e.snapshot;
          state = e.snapshot;
          preDelta.clear();
          postDelta.clear();
          d.deltaKeySet.clear();
        }
        break;
      }
      case "statedelta": {
        if (lastSnapshot === undefined) {
          // deltas against a state the auditor never saw: replay cannot be grounded
          d.snapshotBeforeDelta = true;
        }
        const ops = e.delta;
        if (!Array.isArray(ops)) {
          d.patchFailures.push({ index: idx, op: "?", path: "", problem: "missing-field" });
          break;
        }
        if (ops.length === 0) {
          d.emptyDeltas.push(idx);
          break;
        }
        for (const rawOp of ops as unknown[]) {
          const res = applyPatch(state, rawOp as PatchOp, d.patchFailures, idx, d.deltaKeySet, { pre: preDelta, post: postDelta });
          if (res.ok) state = res.state;
        }
        break;
      }
      case "messagessnapshot": {
        const msgs = e.messages;
        if (!Array.isArray(msgs)) {
          d.missingFields.push({ index: idx, type: raw || "MessagesSnapshot", field: "messages" });
          break;
        }
        const ids = new Set<string>();
        for (const m of msgs as unknown[]) {
          if (m && typeof m === "object" && typeof (m as Record<string, unknown>).id === "string") {
            ids.add((m as Record<string, unknown>).id as string);
          }
        }
        // streamed text messages must survive the snapshot (reasoning/activity are all-or-nothing and excluded)
        const missing: string[] = [];
        for (const [id, msg] of d.msgs) {
          if (msg.kind === "text" && !msg.implicit && !ids.has(id)) missing.push(id);
        }
        if (missing.length > 0) {
          d.snapshotWipedIds = missing;
          d.snapshotWipedIndex = idx;
        }
        break;
      }
      case "activitysnapshot": {
        const id = typeof e.messageId === "string" ? e.messageId : "";
        if (!id) d.missingFields.push({ index: idx, type: raw || "ActivitySnapshot", field: "messageId" });
        if (!("activityType" in e)) d.missingFields.push({ index: idx, type: raw || "ActivitySnapshot", field: "activityType" });
        if (!("content" in e)) d.missingFields.push({ index: idx, type: raw || "ActivitySnapshot", field: "content" });
        if (id) {
          noteKind(id, "activity", idx);
          d.activityIds.add(id);
          if (typeof e.activityType === "string") d.activityTypes.set(id, e.activityType);
        }
        break;
      }
      case "activitydelta": {
        const id = typeof e.messageId === "string" ? e.messageId : "";
        if (!d.activityIds.has(id)) {
          d.reuseClosed.push({ index: idx, id, kind: "activity" });
        }
        if (!Array.isArray(e.patch)) {
          d.missingFields.push({ index: idx, type: raw || "ActivityDelta", field: "patch" });
        }
        break;
      }
      case "custom": {
        if (typeof e.name !== "string" || e.name.length === 0) d.customMissingName.push(idx);
        break;
      }
      case "raw": {
        if (!("event" in e)) d.missingFields.push({ index: idx, type: raw || "Raw", field: "event" });
        break;
      }
      case "subagentstarted": {
        const id = typeof e.subagentRunId === "string" ? e.subagentRunId : "";
        if (!id) d.missingFields.push({ index: idx, type: raw || "SubagentStarted", field: "subagentRunId" });
        if (id) d.subagents.set(id, { start: idx, closed: false });
        break;
      }
      case "subagentfinished":
      case "subagenterror": {
        const id = typeof e.subagentRunId === "string" ? e.subagentRunId : "";
        const sa = d.subagents.get(id);
        if (!sa) {
          d.reuseClosed.push({ index: idx, id, kind: "subagent" });
        } else if (sa.closed) {
          d.duplicateStarts.push({ index: idx, id, kind: "subagent" });
        } else {
          sa.closed = true;
        }
        break;
      }
      case "runerror2": // unreachable; keeps switch exhaustive shape
        break;
      default: {
        if (t.startsWith("thinking")) {
          d.thinkingDeprecated.push(idx);
          break;
        }
        if (t === "" ) {
          d.missingFields.push({ index: idx, type: raw === "" ? "(no type)" : raw, field: "type" });
          break;
        }
        if (!d.unknownTypes.includes(t)) d.unknownTypes.push(raw || t);
        break;
      }
    }

    if (t === "toolcallstart" || t === "toolcallargs" || t === "toolcallend") {
      // no-op, bookkeeping above
    }
  }

  // consecutive duplicate detection
  for (let i = 1; i < events.length; i++) {
    const a = stripVolatile(events[i - 1] as AGEvent);
    const b = stripVolatile(events[i] as AGEvent);
    if (JSON.stringify(a) === JSON.stringify(b)) d.consecutiveDuplicates.push(events[i]!.index);
  }

  d.namingDrift = sawCamel && sawScreaming;

  // post-pass: open items
  for (const [, tc] of d.toolCalls) {
    if (tc.end === undefined) d.openToolCallIds.push(tc.id);
    else if (tc.result === undefined) d.endedWithoutResult.push(tc.id);
  }
  for (const [, msg] of d.msgs) {
    if (msg.end === undefined && !msg.implicit) d.openMessageIds.push(msg.id);
  }
  // orphan args / unknown results
  for (const ev of events) {
    const t = ev.type;
    const e = ev.event;
    if (t === "toolcallargs") {
      const id = typeof e.toolCallId === "string" ? e.toolCallId : "";
      if (!d.toolCalls.has(id)) d.reuseClosed.push({ index: ev.index, id, kind: "tool-args-orphan" });
    }
    if (t === "toolcallresult") {
      const id = typeof e.toolCallId === "string" ? e.toolCallId : "";
      if (!d.toolCalls.has(id)) d.reuseClosed.push({ index: ev.index, id, kind: "tool-result-unknown" });
    }
  }

  return d;
}

function stripVolatile(ev: AGEvent): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...ev.event };
  delete copy.timestamp;
  delete copy.rawEvent;
  // index/bytes are positional metadata, not payload — exclude them so genuinely
  // identical events compare equal
  return { type: ev.type, rawType: ev.rawType, event: copy };
}
