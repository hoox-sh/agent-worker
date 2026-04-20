# 🧠 agent-worker - Hoox Autonomous AI & Risk Manager

<div align="center">

[![Language](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/Platform-Cloudflare®%20Edge%20Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/)

</div>

> The `agent-worker` serves as the proactive intelligence layer of the Hoox trading ecosystem. Rather than waiting for webhooks, it runs continuously on a cron schedule to monitor portfolio health, enforce risk limits, and optimize position exits.

## ✨ Core Capabilities

| Feature | Description |
|---|---|
| ⏱️ **Cron-Driven Observation** | Automatically runs every 5 minutes (`*/5 * * * *`) to fetch live market data from Binance, Bybit, and MEXC. |
| 🛡️ **Global Kill Switch** | Calculates total account PnL and instantly locks out the `hoox` gateway from new entries if the `max_daily_drawdown_percent` is breached. |
| 🎯 **Dynamic Trailing Stops** | Stores watermark prices in `CONFIG_KV` and automatically triggers `CLOSE` payloads if the market reverses. |
| 💸 **Scale-Out Take Profits** | Detects when a position reaches a specific profit target and automatically sends partial close commands to secure gains. |
| 🤖 **AI System Summarization** | Periodically fetches `system_logs` from the `d1-worker`, analyzes them via LLaMA 3 8B, and sends natural language health reports to Telegram. |

## 🏗️ Architecture & Flow

1. **Trigger:** Cloudflare® Cron triggers the worker.
2. **State Sync:** Fetches active `OPEN` positions via the `d1-worker`.
3. **Market Pulse:** Pings public exchange APIs for the latest `markPrice`.
4. **Risk Evaluation:** Cross-references current price with KV-stored watermarks and global drawdown limits.
5. **Execution:** Dispatches actions to `trade-worker` (closing positions) and `telegram-worker` (alerts) via internal Service Bindings.

## 🚀 Endpoints & Interactions

While primarily a scheduled worker, it exposes REST endpoints for manual override:

### `POST /agent/risk-override`
Manually enforce or release risk locks.

```json
{
  "action": "engage_kill_switch",
  "reason": "Manual override from dashboard"
}
```

### `GET /agent/status`
Retrieve the real-time health of the agent and active trailing stops.

## 🔧 Configuration

All critical risk thresholds are stored in `CONFIG_KV` to allow real-time adjustments without code redeploys.

| KV Key | Default | Description |
|---|---|---|
| `trade:max_daily_drawdown_percent` | `-5` | The account-wide PnL percentage that triggers the Kill Switch. |
| `trade:kill_switch` | `false` | When `true`, halts all new trade entries. |
| `trade:watermark:{exchange}:{symbol}:{side}` | N/A | High/low watermark dynamically updated by the agent. |

## 🤝 Internal Service Bindings

The `agent-worker` requires the following bindings to operate:
- `D1_SERVICE`: To fetch open positions and system logs.
- `TRADE_SERVICE`: To execute trailing stops and profit-taking.
- `TELEGRAM_SERVICE`: To broadcast AI summaries and emergency alerts.


---

*Cloudflare® and the Cloudflare logo are trademarks and/or registered trademarks of Cloudflare, Inc. in the United States and other jurisdictions.*
