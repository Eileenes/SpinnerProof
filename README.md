[English](#english) | [中文](#中文)

---

<a id="english"></a>

# SpinnerProof

**Deterministic conformance auditor for AG-UI agent → UI event streams.**

Your agent backend streams events to your frontend over the [AG-UI protocol](https://github.com/ag-ui-protocol/ag-ui): `RunStarted → TextMessageStart → Content → End → ToolCallStart → Args → End → Result → RunFinished`. Every streaming contract in that protocol has one failure mode users see directly:

- **The spinner that never stops** — the transcript ends without `RunFinished`, with a tool call left open. The UI shows "working…" forever. This is the single most common AG-UI integration bug, and it is 100% deterministic: the stream simply ends.
- **Messages that vanish** — a `MessagesSnapshot` that omits messages streamed earlier wipes them from the transcript.
- **State that rolls back** — a `StateSnapshot` that resets a key your `StateDelta` operations already changed.
- **Patches that throw** — `StateDelta` operations that fail RFC 6902 replay against the last snapshot.

The protocol SDK helps you *emit* events. Nothing helps you *verify* what you actually emitted. SpinnerProof replays your event transcript with 34 deterministic rules across 5 weighted dimensions and answers the question every agent-frontend developer asks at 2 a.m.: **"why is my UI spinning forever?"**

## Features

- **Hang detection (the headline)** — a stream truncated without `RunFinished`/`RunError` is flagged `willHang: true`, with the exact `toolCallId` / `messageId` left open. No LLM, no guessing: the transcript is the evidence.
- **Real JSON Patch replay** — every `StateDelta` is applied op-by-op against the last `StateSnapshot`. Missing paths, invalid op names, missing fields, malformed pointers are caught before your frontend hits them.
- **Snapshot rollback detection** — a snapshot that reverts a delta-mutated key back to its pre-delta value is flagged (legitimate forward evolution is not).
- **MessagesSnapshot loss detection** — streamed messages missing from a snapshot are listed by id.
- **Id-space collision audit** — `messageId` reused across text / reasoning / activity kinds, per-protocol violation.
- **Lifecycle pairing** — orphan tool calls, args after `End`, results for unknown calls, unclosed steps, duplicate starts, id reuse after close.
- **Payload economy** — chunk fragmentation (events per rendered character), reconnect-replay duplicates, deprecated `THINKING_*` events, mixed naming conventions, oversized frames, empty deltas.
- **Calibrated 0–100 score** — 5 dimensions (pairing 0.26 / ordering 0.22 / state 0.20 / hang 0.20 / economy 0.12), per-rule hard caps, error-count caps. Three bundled fixtures pin the calibration: clean stream = 100/A, forever-spinner = 49.4/F, chaos stream = 32/F.
- **Web console** — scores, dimension bars, and every finding with its evidence, deep-linkable via `?demo=hang-stream`.
- **Zero runtime dependencies** — TypeScript strict, Node `node:*` builtins only.

## Quick start

### CLI

```bash
# audit a transcript file (JSONL or a JSON array)
npx spinnerproof audit events.jsonl

# or pipe a stream
curl -sN https://your-agent.example.com/run/123 | npx spinnerproof audit -

# JSON output for CI
npx spinnerproof audit events.jsonl --format json
```

Exit codes: `0` = pass, `1` = fail, `2` = usage error — usable directly as a CI gate.

### Web console

```bash
git clone https://github.com/Eileenes/SpinnerProof.git
cd SpinnerProof
npm install && npm run build
npm start          # console on http://127.0.0.1:8800
```

Open the three bundled demos: `Clean stream` (100/A), `Spinner forever` (49.4/F), `Chaos stream` (32/F).

### Docker

```bash
docker compose up --build
# console on http://localhost:8800
```

### HTTP API

```bash
# health
curl http://localhost:8800/healthz

# audit a posted transcript
curl -X POST http://localhost:8800/api/audit \
  -H "Content-Type: application/json" \
  --data-binary @events.jsonl

# bundled demos
curl http://localhost:8800/api/demos
curl http://localhost:8800/api/demo/clean-stream
```

## API documentation

### CLI

| Command | Description |
|---|---|
| `spinnerproof audit <file\|->` | Audit a JSONL / JSON-array transcript. `--format text\|json`, `--out <path>` |
| `spinnerproof demo <name>` | Audit a bundled example (`clean-stream`, `hang-stream`, `chaos-stream`) |
| `spinnerproof demos` | List bundled examples |
| `spinnerproof serve` | Start the web console. `--port N` (default `PORT` or 8800), `--host H` (default `HOST` or 0.0.0.0) |
| `spinnerproof version` | Print version |

### HTTP endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/healthz` | Health check |
| GET | `/api/demos` | List bundled demos |
| GET | `/api/demo/:name` | Audit report for a bundled demo |
| POST | `/api/audit` | Audit a transcript posted as JSONL or JSON array body (max 8 MB) |
| GET | `/*` | Web console (SPA fallback) |

### Report shape

```json
{
  "score": 49.4,
  "grade": "F",
  "verdict": "fail",
  "eventCount": 8,
  "dims": [{ "key": "hang", "score": 71.4, "weight": 0.2 }],
  "hang": {
    "willHang": true,
    "reason": "Stream ends without RunFinished/RunError; 1 tool call(s) still open",
    "openToolCallIds": ["t1"],
    "openMessageIds": ["m1"],
    "missingToolResults": []
  },
  "findings": [
    {
      "rule": "H101",
      "severity": "error",
      "dim": "hang",
      "message": "The stream is truncated: no RunFinished and no RunError…",
      "evidence": "last event is #8, type TextMessageContent, run opened at #1"
    }
  ]
}
```

### Rule catalogue

| Dim | Rules |
|---|---|
| pairing (0.26) | P101 open tool call · P102 args after End / orphan args / orphan End · P103 result for unknown call · P104 open message · P105 content without Start · P106 step name mismatch · P107 orphan / open steps · P108 missing RunStarted · P110 orphan subagent events · P111 messageId kind collision · P112 id reuse after close · P113 interrupt without interrupts · P114 duplicate lifecycle events |
| ordering (0.22) | O101 events after termination · O103 empty message · O104 second RunStarted while open · O105 result before End · O106 snapshot wipes streamed messages |
| state (0.20) | S100 deltas without grounding snapshot · S101 patch replay missing path/parent · S102 invalid op / missing field / bad pointer · S103 snapshot rollback |
| hang (0.20) | H101 stream truncated (willHang) · H102 closed run with open messages · H103 ended calls without results · H104 empty run · H105 RunError without message |
| economy (0.12) | E101 chunk fragmentation · E102 reconnect-replay duplicates · E103 deprecated THINKING_* · E104 naming drift · E105 oversized frames · E106 Custom without name · E107 empty deltas · E109 unregistered event types · E110 chunk without id · E112 missing required fields |

Scoring: each finding costs 8 (error) / 4 (warn) / 1 (info) points in its dimension; repeats of the same rule count 35%. `score = Σ dim·weight`, then hard caps (`H101→55`, `P101→62`, `H102→60`, `O106→58`, `P111→58`, `S101→62`, `S102→65`, errors ≥4→65 / ≥8→52 / ≥12→40), then a bounded aggregate penalty (`min(20, 2E + 0.8W)`).

## Tech stack

- **TypeScript 5.7 (strict)** — zero runtime dependencies, Node ≥ 20
- **React 18 + Vite 5** console (built artifacts committed to `static/`)
- **Vitest** — 46 tests
- **Docker** multi-stage build (node:22-alpine), non-root user, read-only rootfs, `cap_drop ALL`

## Project layout

```
SpinnerProof/
├── src/
│   ├── audit/
│   │   ├── parse.ts        # JSONL / JSON-array ingestion, type canonicalisation
│   │   ├── derive.ts       # single-pass stream analysis + RFC 6902 replay
│   │   ├── engine.ts       # rule orchestration → report
│   │   ├── score.ts        # calibrated scoring model
│   │   ├── render.ts       # terminal report
│   │   └── rules/          # pairing / order / state / hang / economy
│   ├── server.ts           # HTTP API + console host
│   ├── cli.ts              # CLI entry
│   └── util/
├── web/                    # React console source
├── static/                 # built console (committed)
├── examples/               # calibration fixtures
└── tests/                  # Vitest
```

## License

MIT

---

<a id="中文"></a>

# SpinnerProof

**AG-UI agent → 前端事件流的确定性合规审计器。**

你的 agent 后端正在通过 [AG-UI 协议](https://github.com/ag-ui-protocol/ag-ui)向前端流式输出事件：`RunStarted → TextMessageStart → Content → End → ToolCallStart → Args → End → Result → RunFinished`。这套协议里的每一个流式契约，都对应一种用户直接看得见的故障：

- **永远不停的转圈** —— 流在没有 `RunFinished` 的情况下戛然而止，还有一个工具调用悬空。前端永远显示"工作中…"。这是 AG-UI 集成最常见的 bug，而且 100% 确定：流就是断了。
- **凭空消失的消息** —— 一条 `MessagesSnapshot` 漏掉了之前流式送达的消息，前端整段抹掉。
- **回滚的状态** —— 一条 `StateSnapshot` 把 `StateDelta` 已经改过的键改回了旧值。
- **直接抛错的补丁** —— `StateDelta` 操作对上一张快照做 RFC 6902 回放时路径不存在。

协议 SDK 帮你**发**事件，没有任何工具帮你**验证**你实际发出去了什么。SpinnerProof 用 5 个加权维度、34 条确定性规则回放你的事件流，回答每个 agent 前端开发者凌晨两点都在问的问题：**"我的 UI 为什么永远在转圈？"**

## 功能列表

- **永转圈检测（头号功能）** —— 流被截断且无 `RunFinished`/`RunError` 时判定 `willHang: true`，并精确定位悬空的 `toolCallId` / `messageId`。不靠 LLM、不靠猜：流本身就是证据。
- **JSON Patch 真实回放** —— 每条 `StateDelta` 对最近一张 `StateSnapshot` 逐操作回放；路径缺失、非法 op、缺字段、指针格式错误，在前端炸掉之前先被抓住。
- **快照回滚检测** —— 快照把 delta 已修改的键改回 delta 之前的值会被标记（合法的正向演进不误报）。
- **消息快照丢流检测** —— 被快照抹掉的已流式消息按 id 列出。
- **id 空间冲突审计** —— `messageId` 跨 text / reasoning / activity 复用，违反协议共享 id 空间的规定。
- **生命周期配对** —— 悬空工具调用、`End` 之后还来 args、未知调用的 result、不闭合的 step、重复 Start、关闭后复用 id。
- **载荷经济学** —— chunk 碎片化（每渲染字符的事件数）、重连重放式重复、已弃用的 `THINKING_*` 事件、命名规范混用、超大帧、空 delta。
- **标定过的 0–100 评分** —— 5 维（pairing 0.26 / ordering 0.22 / state 0.20 / hang 0.20 / economy 0.12），单规则硬封顶 + 错误数封顶。三个内置 fixture 钉死标定：干净流 = 100/A，永转圈 = 49.4/F，混乱流 = 32/F。
- **Web 控制台** —— 评分环、维度条、逐条 finding 带证据，`?demo=hang-stream` 可深链分享。
- **零运行时依赖** —— TypeScript strict，只用 Node `node:*` 内置模块。

## 快速开始

### CLI

```bash
# 审计一份 transcript（JSONL 或 JSON 数组）
npx spinnerproof audit events.jsonl

# 或者直接接管一条流
curl -sN https://your-agent.example.com/run/123 | npx spinnerproof audit -

# CI 用 JSON 输出
npx spinnerproof audit events.jsonl --format json
```

退出码：`0` = 通过，`1` = 不通过，`2` = 用法错误 —— 可直接当 CI 闸门。

### Web 控制台

```bash
git clone https://github.com/Eileenes/SpinnerProof.git
cd SpinnerProof
npm install && npm run build
npm start          # 控制台 http://127.0.0.1:8800
```

打开三个内置 demo：`Clean stream`（100/A）、`Spinner forever`（49.4/F）、`Chaos stream`（32/F）。

### Docker

```bash
docker compose up --build
# 控制台 http://localhost:8800
```

### HTTP API

```bash
# 健康检查
curl http://localhost:8800/healthz

# 审计 POST 上来的 transcript
curl -X POST http://localhost:8800/api/audit \
  -H "Content-Type: application/json" \
  --data-binary @events.jsonl

# 内置 demo
curl http://localhost:8800/api/demos
curl http://localhost:8800/api/demo/clean-stream
```

## API 文档

### CLI 命令

| 命令 | 说明 |
|---|---|
| `spinnerproof audit <file\|->` | 审计 JSONL / JSON 数组 transcript，`--format text\|json`，`--out <path>` |
| `spinnerproof demo <name>` | 审计内置示例（`clean-stream` / `hang-stream` / `chaos-stream`） |
| `spinnerproof demos` | 列出内置示例 |
| `spinnerproof serve` | 启动 Web 控制台，`--port N`（默认 `PORT` 或 8800），`--host H`（默认 `HOST` 或 0.0.0.0） |
| `spinnerproof version` | 打印版本 |

### HTTP 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/healthz` | 健康检查 |
| GET | `/api/demos` | 列出内置 demo |
| GET | `/api/demo/:name` | 某个内置 demo 的审计报告 |
| POST | `/api/audit` | 审计 POST 上来的 transcript（JSONL / JSON 数组，上限 8 MB） |
| GET | `/*` | Web 控制台（SPA 回退） |

### 报告结构

```json
{
  "score": 49.4,
  "grade": "F",
  "verdict": "fail",
  "eventCount": 8,
  "hang": {
    "willHang": true,
    "reason": "Stream ends without RunFinished/RunError; 1 tool call(s) still open",
    "openToolCallIds": ["t1"],
    "openMessageIds": ["m1"]
  },
  "findings": [
    { "rule": "H101", "severity": "error", "dim": "hang", "message": "…", "evidence": "…" }
  ]
}
```

### 规则目录

| 维度 | 规则 |
|---|---|
| pairing（0.26） | P101 工具调用未闭合 · P102 End 后仍有 args / 孤儿 args / 孤儿 End · P103 未知调用的 result · P104 消息未闭合 · P105 无 Start 的 content · P106 step 名不匹配 · P107 孤儿/未闭合 step · P108 缺 RunStarted · P110 孤儿子代理事件 · P111 messageId 跨类冲突 · P112 关闭后复用 id · P113 interrupt 缺 interrupts · P114 重复生命周期事件 |
| ordering（0.22） | O101 终止后仍有事件 · O103 空消息 · O104 运行未结束时再次 RunStarted · O105 result 先于 End · O106 快照抹掉已流式消息 |
| state（0.20） | S100 delta 无快照奠基 · S101 回放路径缺失/父容器缺失 · S102 非法 op / 缺字段 / 指针格式错 · S103 快照回滚 |
| hang（0.20） | H101 流截断（willHang）· H102 运行已结束但消息未闭合 · H103 调用结束但无 result · H104 空运行 · H105 RunError 无 message |
| economy（0.12） | E101 chunk 碎片化 · E102 重连重放重复 · E103 已弃用 THINKING_* · E104 命名混用 · E105 超大帧 · E106 Custom 无 name · E107 空 delta · E109 未注册事件类型 · E110 无 id 的 chunk · E112 缺必填字段 |

评分模型：每条 finding 在所属维度记 8（error）/ 4（warn）/ 1（info）分，同规则重复从第二条起只计 35%。`score = Σ 维度·权重`，再套硬封顶（`H101→55`、`P101→62`、`H102→60`、`O106→58`、`P111→58`、`S101→62`、`S102→65`、错误数 ≥4→65 / ≥8→52 / ≥12→40），最后减去有上限的聚合惩罚（`min(20, 2E + 0.8W)`）。

## 技术栈

- **TypeScript 5.7（strict）** —— 零运行时依赖，Node ≥ 20
- **React 18 + Vite 5** 控制台（构建产物提交在 `static/`）
- **Vitest** —— 46 个测试
- **Docker** 多阶段构建（node:22-alpine），非 root 用户、只读根文件系统、`cap_drop ALL`

## 项目结构

```
SpinnerProof/
├── src/
│   ├── audit/
│   │   ├── parse.ts        # JSONL / JSON 数组接入，事件类型归一化
│   │   ├── derive.ts       # 单遍流分析 + RFC 6902 真实回放
│   │   ├── engine.ts       # 规则编排 → 报告
│   │   ├── score.ts        # 标定评分模型
│   │   ├── render.ts       # 终端报告
│   │   └── rules/          # pairing / order / state / hang / economy
│   ├── server.ts           # HTTP API + 控制台托管
│   ├── cli.ts              # CLI 入口
│   └── util/
├── web/                    # React 控制台源码
├── static/                 # 控制台构建产物（已提交）
├── examples/               # 标定 fixture
└── tests/                  # Vitest
```

## License

MIT
