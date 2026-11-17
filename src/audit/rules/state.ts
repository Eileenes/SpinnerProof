import type { Derived } from "../derive";
import { err, warn } from "../types";
import type { Finding } from "../types";

const OP_LABEL: Record<string, string> = {
  "missing-path": "the path does not exist in the replayed state",
  "missing-parent": "the parent container of the path does not exist",
  "invalid-op": "the op name is not part of RFC 6902",
  "missing-field": "a required field of the patch op is missing",
  "bad-pointer": "the JSON pointer is malformed",
};

export function stateRules(d: Derived): Finding[] {
  const out: Finding[] = [];

  // S101/S102 — real replay of the JSON Patch stream
  const byPath = new Map<string, number>();
  for (const f of d.patchFailures) {
    const key = `${f.op}:${f.path}:${f.problem}`;
    byPath.set(key, (byPath.get(key) ?? 0) + 1);
  }
  for (const [key, count] of byPath) {
    const [op, path, problem] = key.split(":");
    const first = d.patchFailures.find((f) => f.op === op && f.path === path && f.problem === problem);
    const severity = problem === "invalid-op" || problem === "missing-field" || problem === "bad-pointer" ? "error" : "error";
    out.push({
      rule: problem === "invalid-op" || problem === "missing-field" || problem === "bad-pointer" ? "S102" : "S101",
      severity,
      dim: "state",
      message: `StateDelta replay fails: op "${op}" on path "${path}" — ${OP_LABEL[problem as string] ?? problem}. The frontend hits this same failure at runtime; depending on the client it throws, skips silently, or requests a resync.`,
      evidence: `${count} failing op(s)${count > 1 ? `, first at event #${(first?.index ?? 0) + 1}` : ` at event #${(first?.index ?? 0) + 1}`}`,
      index: first?.index,
    });
  }

  // deltas without a grounding snapshot
  if (d.snapshotBeforeDelta && d.snapshotCount === 0) {
    out.push(warn({
      rule: "S100", dim: "state",
      message: "StateDelta events arrive but no StateSnapshot ever grounds the state document. The replay cannot be verified and the frontend may be patching an empty document.",
      evidence: "deltas seen with zero snapshots",
    }));
  }

  // S103 — snapshot rollback of delta-applied keys
  const rollback = [...new Set(d.rollbackKeys)];
  if (rollback.length > 0) {
    out.push(warn({
      rule: "S103", dim: "state",
      message: `A StateSnapshot reverts key(s) ${rollback.map((k) => `"${k}"`).join(", ")} that earlier StateDelta operations had changed. Replacing state with an older value silently rolls the UI back — the user sees data disappear.`,
      evidence: `keys rolled back by snapshot: ${rollback.join(", ")}`,
    }));
  }

  return out;
}
