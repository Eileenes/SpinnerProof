export type Severity = "error" | "warn" | "info";

export type Dimension = "pairing" | "order" | "state" | "hang" | "economy";

export interface AGEvent {
  /** zero-based position in the stream */
  index: number;
  /** raw type string exactly as it appeared on the wire */
  rawType: string;
  /** normalised type key: alphanumeric lowercase, e.g. "runstarted" */
  type: string;
  /** the event object itself */
  event: Record<string, unknown>;
  /** serialised size of this event in bytes */
  bytes: number;
}

export interface Finding {
  rule: string;
  severity: Severity;
  dim: Dimension;
  message: string;
  evidence: string;
  /** event index the finding is anchored to (optional) */
  index?: number;
}

export interface DimScore {
  key: Dimension;
  label: string;
  weight: number;
  score: number;
  findings: number;
  errors: number;
  warns: number;
  infos: number;
}

export interface HangVerdict {
  willHang: boolean;
  reason: string;
  openToolCallIds: string[];
  openMessageIds: string[];
  missingToolResults: string[];
  terminated: boolean;
}

export interface Report {
  tool: string;
  version: string;
  source: string;
  eventCount: number;
  byteCount: number;
  score: number;
  grade: string;
  verdict: "pass" | "fail";
  dims: DimScore[];
  findings: Finding[];
  hang: HangVerdict;
  topIssues: string[];
}

export function err(f: Omit<Finding, "severity">): Finding {
  return { ...f, severity: "error" };
}
export function warn(f: Omit<Finding, "severity">): Finding {
  return { ...f, severity: "warn" };
}
export function info(f: Omit<Finding, "severity">): Finding {
  return { ...f, severity: "info" };
}
