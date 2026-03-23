---
name: kg-storing
description: "Store domain knowledge correctly via knowledge_store. Use when capturing business rules, domain facts, workflow rationale, or cross-feature relationships. Triggers: 'store this rule', 'remember this fact', 'save this business logic', user confirms a domain insight, interview protocol needed."
---

# Storing Domain Knowledge

## Workflow

1. `knowledge_list` — scan existing domains (hook enforces this)
2. Reuse existing domain if one matches — never create synonyms
3. If inferring from code → store as `insight` with `source: observed:*`
4. Interview user to confirm → `knowledge_evolve` to `fact`/`rule`

## Category Decision

| Situation | Category | Source |
|-----------|----------|--------|
| User states directly | `fact` or `rule` | `user-confirmed:*` or none |
| Inferred from code | `insight` | `observed:*` or `code-review:*` |
| Open question | `question` | `discussion-with-user:*` |
| Multi-step process | `workflow` | `user-confirmed:*` or none |

## Source Rules (hook-enforced)

- `insight`/`question`: MUST have source with allowed prefix
- `fact`/`rule`/`workflow`: CANNOT use `observed:*` or `code-review:*`

## Content Targets

| Category | Size | Style |
|----------|------|-------|
| `fact` | 500 chars | Single verified statement |
| `rule` | 800 chars | Constraint + rationale |
| `insight` | 600 chars | Observation + hypothesis |
| `question` | 400 chars | Clear question + context |
| `workflow` | 800 chars | Steps with rationale |

## Checklist

- [ ] Called `knowledge_list` first
- [ ] Reused existing domain
- [ ] Correct category + source
- [ ] Content is natural language, no code snippets
- [ ] Keywords 1-15, domain max 50 chars, summary max 200 chars
