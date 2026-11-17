import React, { useEffect, useState } from "react";

interface Dim {
  key: string;
  label: string;
  weight: number;
  score: number;
  findings: number;
  errors: number;
  warns: number;
  infos: number;
}

interface Finding {
  rule: string;
  severity: "error" | "warn" | "info";
  dim: string;
  message: string;
  evidence: string;
  index?: number;
}

interface Hang {
  willHang: boolean;
  reason: string;
  openToolCallIds: string[];
  openMessageIds: string[];
  missingToolResults: string[];
  terminated: boolean;
}

interface Report {
  tool: string;
  version: string;
  source: string;
  eventCount: number;
  byteCount: number;
  score: number;
  grade: string;
  verdict: "pass" | "fail";
  dims: Dim[];
  findings: Finding[];
  hang: Hang;
  topIssues: string[];
}

const DEMOS: Array<{ id: string; label: string; blurb: string }> = [
  { id: "clean-stream", label: "Clean stream", blurb: "a well-formed AG-UI run: reasoning, streaming text, one tool call, state sync" },
  { id: "hang-stream", label: "Spinner forever", blurb: "the transcript just stops: open tool call, no RunFinished — the UI spins forever" },
  { id: "chaos-stream", label: "Chaos stream", blurb: "12 protocol violations at once: orphan args, wiped messages, patch failures, collisions" },
];

const DEMO_URLS: Record<string, string> = {
  "clean-stream": "?demo=clean-stream",
  "hang-stream": "?demo=hang-stream",
  "chaos-stream": "?demo=chaos-stream",
};

function ScoreRing({ score, grade, verdict }: { score: number; grade: string; verdict: string }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const filled = (score / 100) * C;
  const color = score >= 90 ? "#16a34a" : score >= 70 ? "#d97706" : "#dc2626";
  return (
    <div className="ring-wrap">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#e5e7eb" strokeWidth="12" />
        <circle
          cx="70" cy="70" r={R} fill="none" stroke={color} strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${C - filled}`}
          transform="rotate(-90 70 70)"
        />
        <text x="70" y="66" textAnchor="middle" fontSize="30" fontWeight="700" fill="#111827">{score.toFixed(0)}</text>
        <text x="70" y="92" textAnchor="middle" fontSize="14" fill="#6b7280">/ 100 · grade {grade}</text>
      </svg>
      <span className={`verdict ${verdict}`}>{verdict === "pass" ? "PASS" : "FAIL"}</span>
    </div>
  );
}

export default function App() {
  const [selected, setSelected] = useState<string>("hang-stream");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const demo = params.get("demo");
    const initial = demo && DEMOS.some((d) => d.id === demo) ? demo : "hang-stream";
    setSelected(initial);
  }, []);

  useEffect(() => {
    let alive = true;
    setError("");
    fetch(`/api/demo/${selected}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: Report) => {
        if (alive) setReport(data);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [selected]);

  const pick = (id: string) => {
    setSelected(id);
    window.history.replaceState(null, "", DEMO_URLS[id] ?? "?");
  };

  const errCount = report?.findings.filter((f) => f.severity === "error").length ?? 0;
  const warnCount = report?.findings.filter((f) => f.severity === "warn").length ?? 0;
  const infoCount = report?.findings.filter((f) => f.severity === "info").length ?? 0;

  return (
    <div className="shell">
      <header>
        <div className="brand">
          <span className="logo">◎</span>
          <div>
            <h1>SpinnerProof</h1>
            <p className="tag">deterministic conformance audit for AG-UI agent → UI event streams</p>
          </div>
        </div>
        <nav className="demos">
          {DEMOS.map((d) => (
            <button key={d.id} className={selected === d.id ? "demo active" : "demo"} onClick={() => pick(d.id)} title={d.blurb}>
              {d.label}
            </button>
          ))}
        </nav>
      </header>

      {error && <div className="banner error">failed to load report: {error}</div>}

      {report && (
        <main>
          {report.hang.willHang && (
            <div className="banner hang">
              <strong>This stream will hang the UI.</strong> The transcript ends without RunFinished / RunError — the frontend
              shows the run as in-progress forever. Open items:{" "}
              {[
                ...report.hang.openToolCallIds.map((i) => `tool call "${i}"`),
                ...report.hang.openMessageIds.map((i) => `message "${i}"`),
              ].join(", ") || "run lifecycle itself"}
              .
            </div>
          )}

          <section className="top">
            <ScoreRing score={report.score} grade={report.grade} verdict={report.verdict} />
            <div className="meta">
              <table>
                <tbody>
                  <tr><th>source</th><td>{report.source}</td></tr>
                  <tr><th>events</th><td>{report.eventCount} ({(report.byteCount / 1024).toFixed(1)} KB)</td></tr>
                  <tr><th>findings</th><td><span className="chip error">{errCount} error</span> <span className="chip warn">{warnCount} warn</span> <span className="chip info">{infoCount} info</span></td></tr>
                  <tr><th>top rules</th><td>{report.topIssues.join("  ·  ") || "—"}</td></tr>
                  <tr><th>terminated</th><td>{report.hang.terminated ? "yes" : "no"}</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="dims">
            {report.dims.map((d) => (
              <div key={d.key} className="dim">
                <div className="dim-head">
                  <span>{d.label}</span>
                  <span className="dim-score">{d.score}</span>
                </div>
                <div className="bar">
                  <div className="fill" style={{ width: `${d.score}%`, background: d.score >= 90 ? "#16a34a" : d.score >= 70 ? "#d97706" : "#dc2626" }} />
                </div>
                <div className="dim-sub">weight {d.weight} · {d.errors}E / {d.warns}W / {d.infos}I</div>
              </div>
            ))}
          </section>

          <section className="findings">
            <h2>Findings</h2>
            {report.findings.length === 0 && <p className="clean">No findings — this stream is protocol-clean.</p>}
            {report.findings.map((f, i) => (
              <div key={i} className={`finding ${f.severity}`}>
                <div className="finding-head">
                  <span className={`chip ${f.severity}`}>{f.severity}</span>
                  <span className="rule">{f.rule}</span>
                  <span className="dim-tag">{f.dim}</span>
                  {f.index !== undefined && <span className="idx">event #{f.index + 1}</span>}
                </div>
                <p className="msg">{f.message}</p>
                <p className="evidence">{f.evidence}</p>
              </div>
            ))}
          </section>
        </main>
      )}

      <footer>
        <span>SpinnerProof — pick a demo, or POST your own JSONL to <code>/api/audit</code>.</span>
      </footer>
    </div>
  );
}
