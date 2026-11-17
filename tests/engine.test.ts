import { describe, it, expect } from "vitest";
import { parseStream, canonicalType } from "../src/audit/parse";
import { auditText, auditEvents } from "../src/audit/engine";
import { derive } from "../src/audit/derive";
import type { AGEvent } from "../src/audit/types";
import * as fs from "node:fs";
import * as path from "node:path";

const ex = (name: string) => fs.readFileSync(path.join(__dirname, "..", "examples", `${name}.jsonl`), "utf8");

describe("parse", () => {
  it("parses JSONL line by line", () => {
    const r = parseStream('{"type":"RunStarted","threadId":"t","runId":"r"}\n\n{"type":"RunFinished"}\n');
    expect(r.events).toHaveLength(2);
    expect(r.malformedLines).toBe(0);
    expect(r.events[0]!.type).toBe("runstarted");
  });

  it("parses a JSON array body", () => {
    const r = parseStream('[{"type":"RunStarted","threadId":"t","runId":"r"},{"type":"RunFinished"}]');
    expect(r.events).toHaveLength(2);
  });

  it("counts malformed lines instead of crashing", () => {
    const r = parseStream('{"type":"RunStarted","threadId":"t","runId":"r"}\nnot json\n{bad}\n');
    expect(r.events).toHaveLength(1);
    expect(r.malformedLines).toBe(2);
    expect(r.parseErrors.length).toBe(2);
  });

  it("unwraps {event:{...}} envelopes", () => {
    const r = parseStream('{"event":{"type":"RunStarted","threadId":"t","runId":"r"}}');
    expect(r.events[0]!.type).toBe("runstarted");
    expect(r.events[0]!.rawType).toBe("RunStarted");
  });

  it("canonicalises types across naming conventions", () => {
    expect(canonicalType("RUN_STARTED")).toBe("runstarted");
    expect(canonicalType("RunStarted")).toBe("runstarted");
    expect(canonicalType("run_started")).toBe("runstarted");
  });
});

describe("calibration fixtures", () => {
  it("clean-stream scores 100/A/pass with zero findings", () => {
    const r = auditText(ex("clean-stream"), { source: "test" });
    expect(r.score).toBe(100);
    expect(r.grade).toBe("A");
    expect(r.verdict).toBe("pass");
    expect(r.findings).toHaveLength(0);
    expect(r.hang.willHang).toBe(false);
    for (const d of r.dims) expect(d.score).toBe(100);
  });

  it("hang-stream is flagged as a forever-spinner with precise open ids", () => {
    const r = auditText(ex("hang-stream"), { source: "test" });
    expect(r.verdict).toBe("fail");
    expect(r.hang.willHang).toBe(true);
    expect(r.hang.openToolCallIds).toContain("t1");
    expect(r.hang.openMessageIds).toContain("m1");
    expect(r.hang.terminated).toBe(false);
    const rules = new Set(r.findings.map((f) => f.rule));
    expect(rules).toContain("H101");
    expect(rules).toContain("P101");
    expect(r.score).toBeLessThan(60);
  });

  it("chaos-stream trips at least 15 distinct rules and scores below 40", () => {
    const r = auditText(ex("chaos-stream"), { source: "test" });
    expect(r.verdict).toBe("fail");
    expect(r.score).toBeLessThan(40);
    expect(new Set(r.findings.map((f) => f.rule)).size).toBeGreaterThanOrEqual(15);
    const rules = new Set(r.findings.map((f) => f.rule));
    for (const rule of ["P108", "P106", "P102", "P103", "P105", "P111", "S101", "S102", "O106", "O101", "S103", "E102", "E104", "E103", "E106", "H105", "H102", "O105"]) {
      expect(rules).toContain(rule);
    }
  });

  it("calibration gaps stay above 15 points", () => {
    const clean = auditText(ex("clean-stream")).score;
    const hang = auditText(ex("hang-stream")).score;
    const chaos = auditText(ex("chaos-stream")).score;
    expect(clean - hang).toBeGreaterThan(15);
    expect(hang - chaos).toBeGreaterThan(15);
  });
});

function ev(type: string, extra: Record<string, unknown> = {}): AGEvent {
  return { index: 0, rawType: type, type: canonicalType(type), event: { type, ...extra }, bytes: 100 };
}

function run(list: AGEvent[]): ReturnType<typeof auditEvents> {
  const withIndex = list.map((e, i) => ({ ...e, index: i }));
  return auditEvents(withIndex, { source: "unit" });
}

describe("pairing rules", () => {
  it("P101 flags a tool call left open", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("ToolCallStart", { toolCallId: "x", toolCallName: "search" }),
      ev("ToolCallEnd", { toolCallId: "x" }),
      ev("ToolCallStart", { toolCallId: "y", toolCallName: "deploy" }),
      ev("RunFinished", {}),
    ]);
    const p101 = r.findings.filter((f) => f.rule === "P101");
    expect(p101).toHaveLength(1);
    expect(p101[0]!.evidence).toContain('"y"');
    expect(r.hang.missingToolResults).toContain("x");
  });

  it("P103 flags a result for a never-started call", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("ToolCallResult", { messageId: "m", toolCallId: "ghost", content: "x" }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "P103" && f.severity === "error")).toBe(true);
  });

  it("P111 flags messageId reuse across text and reasoning", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("TextMessageStart", { messageId: "dup", role: "assistant" }),
      ev("ReasoningMessageStart", { messageId: "dup", role: "reasoning" }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "P111")).toBe(true);
  });

  it("P112 flags id reuse after the call closed", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("ToolCallStart", { toolCallId: "t9", toolCallName: "a" }),
      ev("ToolCallEnd", { toolCallId: "t9" }),
      ev("ToolCallStart", { toolCallId: "t9", toolCallName: "a" }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "P112")).toBe(true);
  });

  it("P110 flags a subagent finished without started", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("SubagentFinished", { subagentRunId: "sa1" }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "P110")).toBe(true);
  });

  it("P113 flags interrupt outcome without interrupts array", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("RunFinished", { outcome: { type: "interrupt" } }),
    ]);
    expect(r.findings.some((f) => f.rule === "P113")).toBe(true);
  });
});

describe("order rules", () => {
  it("O101 aggregates events after termination", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("RunFinished", {}),
      ev("TextMessageStart", { messageId: "m", role: "assistant" }),
      ev("TextMessageEnd", { messageId: "m" }),
    ]);
    const o101 = r.findings.filter((f) => f.rule === "O101");
    expect(o101).toHaveLength(1);
    expect(o101[0]!.message).toContain("2 event(s)");
  });

  it("O105 flags a result that arrives before End", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("ToolCallStart", { toolCallId: "c", toolCallName: "a" }),
      ev("ToolCallResult", { messageId: "m", toolCallId: "c", content: "r" }),
      ev("ToolCallEnd", { toolCallId: "c" }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "O105")).toBe(true);
  });
});

describe("state rules", () => {
  it("S101 catches a replace on a missing path via real replay", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("StateSnapshot", { snapshot: { a: 1 } }),
      ev("StateDelta", { delta: [{ op: "replace", path: "/nope", value: 2 }] }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "S101" && f.severity === "error")).toBe(true);
  });

  it("S102 catches a non-RFC6902 op", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("StateSnapshot", { snapshot: { a: 1 } }),
      ev("StateDelta", { delta: [{ op: "upsert", path: "/a", value: 2 }] }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "S102")).toBe(true);
  });

  it("S103 catches a snapshot that rolls a delta-mutated key back", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("StateSnapshot", { snapshot: { status: "draft" } }),
      ev("StateDelta", { delta: [{ op: "replace", path: "/status", value: "final" }] }),
      ev("StateSnapshot", { snapshot: { status: "draft" } }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "S103")).toBe(true);
  });

  it("legitimate snapshot evolution is not flagged as rollback", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("StateSnapshot", { snapshot: { n: 0 } }),
      ev("StateDelta", { delta: [{ op: "replace", path: "/n", value: 1 }] }),
      ev("StateSnapshot", { snapshot: { n: 1, extra: true } }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "S103")).toBe(false);
    expect(r.findings.filter((f) => f.severity === "error" && f.dim === "state")).toHaveLength(0);
  });

  it("S100 warns when deltas arrive with no grounding snapshot", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("StateDelta", { delta: [{ op: "add", path: "/a", value: 1 }] }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "S100")).toBe(true);
  });
});

describe("hang rules", () => {
  it("H102 flags a closed run with an open message", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("TextMessageStart", { messageId: "m", role: "assistant" }),
      ev("TextMessageContent", { messageId: "m", delta: "hello world" }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "H102" && f.severity === "error")).toBe(true);
    expect(r.hang.willHang).toBe(false);
  });

  it("H103 flags ended calls without results on a successful run", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("ToolCallStart", { toolCallId: "c1", toolCallName: "a" }),
      ev("ToolCallEnd", { toolCallId: "c1" }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "H103")).toBe(true);
  });

  it("H104 flags an empty run", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "H104")).toBe(true);
  });

  it("H105 flags RunError without a message", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("RunError", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "H105")).toBe(true);
  });
});

describe("economy rules", () => {
  it("E101 flags pathological fragmentation", () => {
    const list: AGEvent[] = [
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("TextMessageStart", { messageId: "m", role: "assistant" }),
    ];
    for (let i = 0; i < 25; i++) list.push(ev("TextMessageContent", { messageId: "m", delta: "ab" }));
    list.push(ev("TextMessageEnd", { messageId: "m" }), ev("RunFinished", {}));
    const r = run(list);
    expect(r.findings.some((f) => f.rule === "E101")).toBe(true);
  });

  it("E102 flags byte-identical consecutive events", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("TextMessageContent", { messageId: "m", delta: "same" }),
      ev("TextMessageContent", { messageId: "m", delta: "same" }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "E102")).toBe(true);
  });

  it("E103 flags deprecated THINKING_* events", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("THINKING_START", { messageId: "m" }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "E103")).toBe(true);
  });

  it("E104 flags naming-convention drift", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("STEP_STARTED", { stepName: "x" }),
      ev("STEP_FINISHED", { stepName: "x" }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "E104")).toBe(true);
  });

  it("E106 flags unnamed Custom events", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("Custom", { value: {} }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "E106")).toBe(true);
  });

  it("E107 flags empty deltas", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("TextMessageStart", { messageId: "m", role: "assistant" }),
      ev("TextMessageContent", { messageId: "m", delta: "" }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "E107")).toBe(true);
  });

  it("E109 flags unregistered event types", () => {
    const r = run([
      ev("RunStarted", { threadId: "t", runId: "r" }),
      ev("WarpCoreEngaged", { level: 9 }),
      ev("RunFinished", {}),
    ]);
    expect(r.findings.some((f) => f.rule === "E109" && f.evidence.includes("WarpCoreEngaged"))).toBe(true);
  });
});

describe("derive internals", () => {
  it("derive computes open items and missing results", () => {
    const parsed = parseStream(ex("hang-stream"));
    const d = derive(parsed.events, []);
    expect(d.openToolCallIds).toEqual(["t1"]);
    expect(d.terminated).toBe(false);
    expect(d.firstEventNotRunStart).toBe(false);
  });

  it("flags P108 when RunStarted never appears", () => {
    const parsed = parseStream('{"type":"TextMessageStart","messageId":"m","role":"assistant"}');
    const d = derive(parsed.events, []);
    expect(d.firstEventNotRunStart).toBe(false);
    const withIndex = parsed.events.map((e, i) => ({ ...e, index: i }));
    const report = auditEvents(withIndex, { source: "unit" });
    const p108 = report.findings.find((f) => f.rule === "P108");
    expect(p108).toBeDefined();
    expect(p108!.message).toContain("No RunStarted anywhere");
  });
});
