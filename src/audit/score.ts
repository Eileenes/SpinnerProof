import type { Dimension, DimScore, Finding, Report } from "./types";

const DIM_META: Array<{ key: Dimension; label: string; weight: number; k: number }> = [
  { key: "pairing", label: "Pairing integrity", weight: 0.26, k: 30 },
  { key: "order", label: "Event ordering", weight: 0.22, k: 35 },
  { key: "state", label: "State integrity", weight: 0.20, k: 35 },
  { key: "hang", label: "Hang risk", weight: 0.20, k: 30 },
  { key: "economy", label: "Payload economy", weight: 0.12, k: 45 },
];

const SEV_PT: Record<string, number> = { error: 8, warn: 4, info: 1 };

/** per-rule score caps: one instance of this rule bounds the total score */
const RULE_CAPS: Record<string, number> = {
  H101: 55,
  P101: 62,
  H102: 60,
  O106: 58,
  P111: 58,
  S101: 62,
  S102: 65,
};

function capForErrorCount(errors: number): number | null {
  if (errors >= 12) return 40;
  if (errors >= 8) return 52;
  if (errors >= 4) return 65;
  return null;
}

export function computeScore(findings: Finding[]): { dims: DimScore[]; score: number } {
  const dims: DimScore[] = [];
  const errors = findings.filter((f) => f.severity === "error").length;
  const warns = findings.filter((f) => f.severity === "warn").length;

  let weighted = 0;
  for (const meta of DIM_META) {
    const dimFindings = findings.filter((f) => f.dim === meta.key);
    // repeated occurrences of the same rule contribute only 35% from the second one on
    const perRule = new Map<string, number>();
    let raw = 0;
    for (const f of dimFindings) {
      const n = perRule.get(f.rule) ?? 0;
      const pt = SEV_PT[f.severity] ?? 1;
      raw += n === 0 ? pt : pt * 0.35;
      perRule.set(f.rule, n + 1);
    }
    const score = raw === 0 ? 100 : 100 / (1 + raw / meta.k);
    dims.push({
      key: meta.key,
      label: meta.label,
      weight: meta.weight,
      score: Math.round(score * 10) / 10,
      findings: dimFindings.length,
      errors: dimFindings.filter((f) => f.severity === "error").length,
      warns: dimFindings.filter((f) => f.severity === "warn").length,
      infos: dimFindings.filter((f) => f.severity === "info").length,
    });
    weighted += (score * meta.weight);
  }

  let score = weighted;

  // per-rule hard caps
  for (const f of findings) {
    const cap = RULE_CAPS[f.rule];
    if (cap !== undefined && score > cap) score = cap;
  }
  // error-count cap
  const errCap = capForErrorCount(errors);
  if (errCap !== null && score > errCap) score = errCap;
  // aggregate penalty, bounded
  const penalty = Math.min(20, 2 * errors + 0.8 * warns);
  score -= penalty;

  score = Math.max(0, Math.round(score * 10) / 10);
  return { dims, score };
}

export function gradeOf(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function verdictOf(score: number, errors: number, willHang: boolean): "pass" | "fail" {
  if (willHang) return "fail";
  if (errors > 0 && score < 80) return "fail";
  if (score < 60) return "fail";
  return "pass";
}
