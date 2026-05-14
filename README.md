# @hoox/agent-worker

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![Runtime](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)](https://bun.sh) [![Platform](https://img.shields.io/badge/Platform-Cloudflare%C2%AE%20Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/) [![License](https://img.shields.io/badge/License-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)

AI risk manager — runs every 5 minutes to monitor positions, move trailing stops, and flip the kill switch.

## For CLI Users

Use this worker indirectly when you run `hoox` commands:

- `hoox config kv set trade:max_daily_drawdown_percent 10` — adjust risk limit
- `hoox monitor kill-switch show` — check kill switch status

→ [AI Risk Manager Guide](../../docs/concepts/ai-risk-manager.md) · [CLI Reference](../../docs/reference/cli-commands.md)

## For Operators

This worker provides automated portfolio risk management. It runs on a 5-minute cron trigger, fetches open positions from the D1 worker, evaluates market conditions, enforces trailing stops and take-profit levels, and engages a global kill switch when daily drawdown limits are breached. Supports multi-provider AI (Workers AI, OpenAI, Anthropic, Google) with automatic fallback.

→ [Operator Docs](../../docs/devops/workers/agent-worker.md)

## Development

```bash
bun test workers/agent-worker
```
