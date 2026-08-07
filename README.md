# HOOX · Agent Worker

**Autonomous risk management agent — configurable cron (1–1440 minutes), assesses portfolio entropy, pulls the kill switch when variance exceeds thresholds.**

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![Runtime](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)](https://bun.sh) [![Platform](https://img.shields.io/badge/Platform-Cloudflare%C2%AE%20Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/) [![License](https://img.shields.io/badge/License-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)

**Part of the [HOOX](https://github.com/hoox-sh/hoox) edge-trading mesh — a production-grade algorithmic trading framework on Cloudflare Workers.**  
**Site:** [hoox.sh](https://hoox.sh) · **Docs:** [docs.hoox.sh](https://docs.hoox.sh) · **Paper:** [`hoox-arxiv-paper-core.pdf`](https://github.com/hoox-sh/hoox/blob/main/papers/hoox-arxiv-paper-core.pdf)

---

The agent-worker is a cron-driven autonomous agent that applies AI-driven risk management across the entire portfolio. On each tick it fetches all open positions from the [`d1-worker`](https://github.com/hoox-sh/d1-worker), evaluates trailing-stop watermarks stored in KV, computes unrealized PnL, and determines whether to close positions, adjust stops, or engage the global kill switch.

The schedule is **not** fixed at 5 minutes. You pick any interval from **1 to 1440 minutes** and set the matching Cloudflare cron expression in `wrangler.jsonc` (default in this repo: **every 15 minutes**).

Risk assessment is routed through a multi-provider AI backend with automatic fallback: **Workers AI → OpenAI → Anthropic → Google Gemini**. Each provider is abstracted behind a `ProviderManager` that handles model selection, prompt templating, and response parsing. If daily drawdown breaches the configured threshold (`trade:max_daily_drawdown_percent` in KV), the kill switch flips — all subsequent signals through the gateway are dropped until manually reset.

The worker also exposes a full REST API for dashboard integration: manual housekeeping triggers, risk-override configuration, model testing, embedding generation, and chat completion.

### Cron setup (1–1440 minutes)

Cloudflare Workers use standard 5-field cron expressions under `triggers.crons`. Choose an interval in **minutes** (1–1440) and map it as follows:

| Interval (minutes) | Cron expression     | Notes                          |
| ------------------ | ------------------- | ------------------------------ |
| 1                  | `* * * * *`         | Every minute                   |
| 5                  | `*/5 * * * *`       | Every 5 minutes                |
| 10                 | `*/10 * * * *`      |                                |
| 15                 | `*/15 * * * *`      | **Default** in this repo       |
| 30                 | `*/30 * * * *`      |                                |
| 60                 | `0 * * * *`         | Every hour on the hour         |
| 120                | `0 */2 * * *`       | Every 2 hours                  |
| 360                | `0 */6 * * *`       | Every 6 hours                  |
| 720                | `0 */12 * * *`      | Every 12 hours                 |
| 1440               | `0 0 * * *`         | Once daily (midnight UTC)      |

**Rules of thumb:**

- **1–59 minutes:** use `*/N * * * *` (or `* * * * *` for 1).
- **Multiples of 60:** use `0 */H * * *` where `H = minutes / 60` (cap at 23 for hours-of-day; use `0 0 * * *` for 1440).
- **Disable schedule:** set `"crons": []` — manual `POST /agent/housekeeping` still works.
- Keep `dashboard.jsonc` → `cron.interval_minutes` (1–1440, free number input) aligned with your wrangler expression for operator documentation.

Example:

```jsonc
"triggers": {
  "crons": ["*/15 * * * *"]
}
```

Redeploy after changing the schedule: `hoox deploy worker agent-worker` (or `wrangler deploy` from this package).

### Role in the Mesh

```
        ┌──────────────────────┐
        │  agent-worker        │  ← private, cron: 1–1440 min (default */15)
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
| [`trade-worker`](https://github.com/hoox-sh/trade-worker)       | `TRADE_SERVICE`    | Position adjustment / stop-loss orders       |
| [`telegram-worker`](https://github.com/hoox-sh/telegram-worker) | `TELEGRAM_SERVICE` | Risk alerts & kill-switch notifications      |
| [`d1-worker`](https://github.com/hoox-sh/d1-worker)             | `D1_SERVICE`       | Position data (direct D1 legacy — migrating) |

### AI Provider Chain

| Priority | Provider                | Models                              | Fallback  |
| -------- | ----------------------- | ----------------------------------- | --------- |
| 1        | Workers AI (Cloudflare) | `@cf/meta/llama-3.1-8b`             | → 2       |
| 2        | OpenAI                  | `gpt-4o`, `gpt-4o-mini`             | → 3       |
| 3        | Anthropic               | `claude-3-haiku`, `claude-3-sonnet` | → 4       |
| 4        | Google Gemini           | `gemini-1.5-flash`                  | → 5       |
| 5        | Azure OpenAI            | deployment name (e.g. `gpt-4o-mini`) | Hard fail |

Azure requires KV keys `agent:azure_api_key` and `agent:azure_endpoint` (`https://*.openai.azure.com` only).

### Entry Points

| Trigger     | Path / Event                    | Auth | Description |
| ----------- | ------------------------------- | ---- | ----------- |
| `scheduled` | wrangler `triggers.crons`       | n/a  | `runHousekeeping` + `processRoutine` |
| `POST`      | `/agent/housekeeping`           | Internal | Manual cron trigger (from dashboard) |
| `POST`      | `/agent/risk-override`          | Internal | Kill switch + trailing stop override |
| `GET`       | `/agent/status`                 | Internal | Health + active trailing watermarks |
| `GET/POST`  | `/agent/config`                 | Internal | Read/update `AgentConfig` |
| `GET`       | `/agent/models`                 | Internal | Available model catalog |
| `POST`      | `/agent/test-model`             | Internal | Smoke-test a provider/model |
| `POST`      | `/agent/chat`                   | Internal | AI chat completion (user text sanitized) |
| `POST`      | `/agent/vision`                 | Internal | Vision analysis (base64 or public https URL) |
| `POST`      | `/agent/embedding`              | Internal | Generate text embeddings |
| `GET`       | `/agent/health`                 | Internal | Provider health status (parallel probes) |
| `GET`       | `/health`                       | None | Liveness probe |
| `GET`       | `/`                             | None | Banner |

### Development

```bash
bun test workers/agent-worker
```

### Mesh interconnect

| Direction | Peers |
| --------- | ----- |
| **Called by** | Cloudflare Cron (`triggers.crons`, default `*/15 * * * *`) and [dashboard](https://github.com/hoox-sh/hoox/tree/main/workers/dashboard) REST (housekeeping, chat, config). |
| **This worker calls** | See list below |

- **[d1-worker](https://github.com/hoox-sh/d1-worker)** — D1_SERVICE — open positions / history
- **[trade-worker](https://github.com/hoox-sh/trade-worker)** — TRADE_SERVICE — close positions, adjust stops
- **[telegram-worker](https://github.com/hoox-sh/telegram-worker)** — TELEGRAM_SERVICE — risk / kill-switch alerts
- **[analytics-worker](https://github.com/hoox-sh/analytics-worker)** — ANALYTICS_SERVICE — agent heartbeats / decisions

Full mesh (all isolates live as git submodules under [`hoox-sh/hoox`](https://github.com/hoox-sh/hoox) `workers/`):

| Isolate | Role | Repository |
| ------- | ---- | ---------- |
| [hoox-worker](https://github.com/hoox-sh/hoox-worker) | Public webhook gateway (WAF, idempotency, dispatch) | monorepo `workers/hoox-worker` |
| [trade-worker](https://github.com/hoox-sh/trade-worker) | Multi-exchange order execution (Binance / Bybit / MEXC) | monorepo `workers/trade-worker` |
| [agent-worker](https://github.com/hoox-sh/agent-worker) | AI risk manager (configurable cron 1–1440 min, kill switch) | monorepo `workers/agent-worker` |
| [d1-worker](https://github.com/hoox-sh/d1-worker) | D1 SQL proxy + settings / balances / positions | monorepo `workers/d1-worker` |
| [telegram-worker](https://github.com/hoox-sh/telegram-worker) | Alerts, bot commands, RAG copilot | monorepo `workers/telegram-worker` |
| [email-worker](https://github.com/hoox-sh/email-worker) | Mailgun / email signal parsing → trade | monorepo `workers/email-worker` |
| [analytics-worker](https://github.com/hoox-sh/analytics-worker) | Analytics Engine write + query path | monorepo `workers/analytics-worker` |
| [report-worker](https://github.com/hoox-sh/report-worker) | PDF reports via Browser Rendering → R2 | monorepo `workers/report-worker` |
| [web3-wallet-worker](https://github.com/hoox-sh/web3-wallet-worker) | On-chain wallet identity (ethers.js) | monorepo `workers/web3-wallet-worker` |
| [dashboard](https://github.com/hoox-sh/hoox/tree/main/workers/dashboard) | Next.js ops console (OpenNext, public) | monorepo `workers/dashboard` |

### Docs & monorepo

| Resource | Link |
| -------- | ---- |
| Isolate profile (operators) | [https://docs.hoox.sh/docs/devops/workers/agent-worker](https://docs.hoox.sh/docs/devops/workers/agent-worker) |
| Parent monorepo | [github.com/hoox-sh/hoox](https://github.com/hoox-sh/hoox) |
| This repository | [github.com/hoox-sh/agent-worker](https://github.com/hoox-sh/agent-worker) |
| Workers index | [docs.hoox.sh → Workers](https://docs.hoox.sh/docs/devops/workers) |
| CLI | `@hoox-sh/hoox-cli` · `hoox deploy worker agent-worker` |

### License

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — part of the HOOX open-core mesh.
