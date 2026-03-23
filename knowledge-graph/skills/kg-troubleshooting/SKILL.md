---
name: kg-troubleshooting
description: "Diagnose and fix KG tool errors. Use when a knowledge-graph MCP tool returns an error, hook blocks a tool call, daemon is unreachable, or KG behaves unexpectedly. Triggers: ECONNREFUSED, 'BLOCKED:', tool failure, daemon down, Ollama offline, 'Cannot delete', 'not initialized'."
---

# KG Troubleshooting

## Symptom → Fix

| Error | Cause | Fix |
|-------|-------|-----|
| `ECONNREFUSED` / `fetch failed` | Daemon down | `kg doctor` → `kg serve` |
| `no .knowledge-graph` | Not initialized | `kg init` |
| `ollama` / `bge-m3` | Ollama offline | `ollama serve` → `ollama pull bge-m3` |
| `lock` / `busy` | DB locked | `kg stop` → `kg serve` |
| `Cannot delete without reason` | Lifecycle guard | Add `reason` field |
| `BLOCKED: source/category` | Hook enforcement | Fix per kg-storing skill |
| `BLOCKED: evidence required` | Validate hook | Add `evidence` field |
| `BLOCKED: Golden evidence` | Promote hook | Cite all 4 sources |
| `Cannot link across layers` | Cross-layer guard | Both chunks same layer |
| `Not an operational chunk` | Layer mismatch | `life_feedback` only for operational |

## Health Check

Run `kg doctor` — checks Node, config, Ollama, model, DB, hooks, life tools, skills.

## Common Scenarios

**Empty results**: Check chunks exist (`knowledge_list`), check domain matches, check lifecycle filters.

**Daemon dies**: Check idle timeout (300s default), port conflicts (`kg serve:PORT`), logs (`.knowledge-graph/logs/`).

**Hooks blocking**: Read the error message — it explains exactly what to fix.
