# HOOX · Agent Worker

**Autonomous risk management agent — runs every 5 minutes, assesses portfolio entropy, pulls the kill switch when variance exceeds thresholds.**

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![Runtime](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)](https://bun.sh) [![Platform](https://img.shields.io/badge/Platform-Cloudflare%C2%AE%20Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/) [![License](https://img.shields.io/badge/License-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)

**Part of the [HOOX](https://github.com/jango-blockchained/hoox) edge-trading mesh — a production-grade algorithmic trading framework on Cloudflare Workers.**  
**Site:** [hoox.sh](https://hoox.sh) · **Docs:** [docs.hoox.sh](https://docs.hoox.sh) · **Paper:** [`hoox-arxiv-paper-core.pdf`](https://github.com/jango-blockchained/hoox/blob/main/papers/hoox-arxiv-paper-core.pdf)

---

The agent-worker is a cron-driven autonomous agent (schedule: `*/5 * * * *`) that applies AI-driven risk management across the entire portfolio. On each tick it fetches all open positions from the [`d1-worker`](../d1-worker), evaluates trailing-stop watermarks stored in KV, computes unrealized PnL, and determines whether to close positions, adjust stops, or engage the global kill switch.

Risk assessment is routed through a multi-provider AI backend with automatic fallback: **Workers AI → OpenAI → Anthropic → Google Gemini**. Each provider is abstracted behind a `ProviderManager` that handles model selection, prompt templating, and response parsing. If daily drawdown breaches the configured threshold (`trade:max_daily_drawdown_percent` in KV), the kill switch flips — all subsequent signals through the gateway are dropped until manually reset.

The worker also exposes a full REST API for dashboard integration: manual housekeeping triggers, risk-override configuration, model testing, embedding generation, and chat completion.

### Role in the Mesh

```
        ┌──────────────────────┐
        │  agent-worker        │  ← private, cron: */5 * * * *
        │  (AI risk assessor)  │
        └──┬───────┬───────┬───┘
           │       │       │
      positions  kill     alerts
           │     switch    │
           ▼       │       ▼
    ┌──────────┐   │  ┌──────────────────┐
    │ d1-worker│   │  │ telegram-worker  │
    └──────────┘   │  └──────────────────┘
                   │
                   ▼
            ┌─────────────┐
            │ trade-worker│  ← close positions, adjust stops
            └─────────────┘
```

### Service Bindings

| Target Worker                           | Binding            | Protocol                                     |
| --------------------------------------- | ------------------ | -------------------------------------------- |
| [`trade-worker`](../trade-worker)       | `TRADE_SERVICE`    | Position adjustment / stop-loss orders       |
| [`telegram-worker`](../telegram-worker) | `TELEGRAM_SERVICE` | Risk alerts & kill-switch notifications      |
| [`d1-worker`](../d1-worker)             | `D1_SERVICE`       | Position data (direct D1 legacy — migrating) |

### AI Provider Chain

| Priority | Provider                | Models                              | Fallback  |
| -------- | ----------------------- | ----------------------------------- | --------- |
| 1        | Workers AI (Cloudflare) | `@cf/meta/llama-3.1-8b`             | → 2       |
| 2        | OpenAI                  | `gpt-4o`, `gpt-4o-mini`             | → 3       |
| 3        | Anthropic               | `claude-3-haiku`, `claude-3-sonnet` | → 4       |
| 4        | Google Gemini           | `gemini-1.5-flash`                  | Hard fail |

### Entry Points

| Trigger     | Path / Event           | Description                          |
| ----------- | ---------------------- | ------------------------------------ |
| `scheduled` | `*/5 * * * *`          | `runHousekeeping` + `processRoutine` |
| `POST`      | `/agent/housekeeping`  | Manual cron trigger (from dashboard) |
| `POST`      | `/agent/risk-override` | Set `trailingStopPercent` in KV      |
| `GET/POST`  | `/agent/config`        | Read/update `AgentConfig`            |
| `POST`      | `/agent/chat`          | Generic AI chat completion           |
| `POST`      | `/agent/embedding`     | Generate text embeddings             |
| `GET`       | `/agent/health`        | Provider health status               |

### Development

```bash
bun test workers/agent-worker
```

### License

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — part of the HOOX open-core mesh.
