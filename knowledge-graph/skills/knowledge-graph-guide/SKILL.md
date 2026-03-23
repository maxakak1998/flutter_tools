---
name: knowledge-graph-guide
description: "Hub skill for Knowledge Graph MCP tools. Use when starting KG work, unsure which tool to use, or need a quick reference. Triggers: 'which KG tool?', 'how to store knowledge', 'how to query KG', 'what tools are available', starting a session involving domain knowledge or operational learnings."
---

# Knowledge Graph Guide

## Start Here

1. Call `knowledge_list` to see existing domains
2. Match task to a skill below — read that skill
3. Follow the workflow + checklist in the skill

## Routing Table

| Task | Skill |
|------|-------|
| Store domain knowledge (business rules, facts) | `kg-storing` |
| Search/browse existing knowledge | `kg-exploring` |
| Validate or promote knowledge lifecycle | `kg-lifecycle` |
| Store coding mistake/gotcha/workaround | `kg-life-knowledge` |
| Debug KG tool errors | `kg-troubleshooting` |

## Tool Quick Reference

### Domain Knowledge Tools
| Tool | Purpose |
|------|---------|
| `knowledge_store` | Store business rule, domain fact, workflow rationale |
| `knowledge_query` | Semantic search across knowledge graph |
| `knowledge_list` | Browse by filters, check domains before storing |
| `knowledge_validate` | Confirm/refute with evidence |
| `knowledge_promote` | Graduate lifecycle (requires golden evidence) |
| `knowledge_evolve` | Update content, preserve confidence |
| `knowledge_link` | Create relationship between chunks |
| `knowledge_delete` | Remove chunk (reason required for validated+) |

### Operational Learning Tools
| Tool | Purpose |
|------|---------|
| `life_store` | Store coding gotcha, pattern, workaround |
| `life_feedback` | Report success/failure after applying a learning |
| `life_draft_skill` | Generate skill draft from high-score learnings |

## Domain vs Life Knowledge — Decision Guide

**Litmus test**: Ask "Does this explain a BUSINESS reason, or a CODING technique?"

### `knowledge_store` — Domain Knowledge (the WHY)
Business rules, domain constraints, workflow rationale. Written in natural language, NO code.

Examples:
- "Withdrawals require 3-step verification because the payment gateway rejects single-step flows over $500"
- "Betslip odds must be re-validated within 3 seconds of submission because WebSocket odds can drift"
- "Geo-blocked users can see the app but cannot place bets — legal requirement in AU"
- "User onboarding: signup → email verify → ID upload → manual review (24h SLA) → activated"

### `life_store` — Operational Learnings (the HOW)
Coding gotchas, patterns, workarounds, framework quirks. CAN include code snippets and file paths.

Examples:
- "pumpAndSettle never returns when WebSocket streams are active — use pumpAndSettle with timeout"
- "registerFallbackValue required for custom types in mocktail — add in setUpAll"
- "BaseCubitState IDs must use microsecondsSinceEpoch, not millisecondsSinceEpoch — mixing causes dropped states"
- "Patrol $.tap() fails hit-test on overlapping widgets — use $.tester.tap() instead"

### Common Mistakes

| You discovered... | WRONG tool | RIGHT tool | Why |
|---|---|---|---|
| "The cubit deduplicates by state ID" | `knowledge_store` | `life_store` | Code behavior, not business rule |
| "External writes to betslip store bypass the cubit" | `knowledge_store` | `life_store` | Architecture pattern, not business constraint |
| "Soft-delete is required for products with sales history" | `life_store` | `knowledge_store` | Business rule (data integrity) |
| "Withdrawal limits are tiered by verification level" | `life_store` | `knowledge_store` | Business domain rule |
| "Use registerFactory not registerLazySingleton for repos" | `knowledge_store` | `life_store` | Coding pattern/DI technique |

### Quick Decision Flow

```
Is it about WHY the business works this way?
  YES → knowledge_store (natural language, no code)
  NO → Is it about HOW to code something correctly?
    YES → life_store (can include code, file paths)
    NO → Probably not worth storing
```
