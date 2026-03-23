---
name: kg-life-knowledge
description: "Store and manage operational learnings (coding gotchas, patterns, workarounds) via life_store, life_feedback, life_draft_skill. Use when Claude made a mistake and found the fix, discovered surprising framework behavior, found a workaround, or took 3+ attempts to solve something. Triggers: 'remember this fix', 'store this gotcha', 'log this workaround', coding mistake resolved, root cause differed from hypothesis."
---

# Life Knowledge — Operational Learnings

## Workflow

1. `life_store` — store with at least 1 `life:*` tag
2. Next similar situation → apply the stored fix
3. `life_feedback(id, "success")` if it works
4. `life_feedback(id, "failure")` if it doesn't

## Score Lifecycle

```
Score 5 (new) ──[+1 per success]──> Score 10 (skill-eligible)
Score 5 (new) ──[-1 per failure]──> Score 0 (hidden, purge after 14d)
Score 0 (hidden) ──[+1 success]──> Score 1 (revived)
```

## Skill Promotion

When a domain has 10+ entries at score 10:
```
life_draft_skill({ domain: "flutter-testing" })
→ generates draft SKILL.md for review
```

## Tag Selection

| Situation | Tag |
|-----------|-----|
| Surprising behavior | `life:gotcha` |
| Useful pattern | `life:pattern` |
| Common mistake | `life:anti-pattern` |
| Framework bypass | `life:workaround` |
| Tool constraint | `life:tool-limitation` |

## Checklist

- [ ] At least 1 `life:*` tag
- [ ] Content describes the fix, not just the error
- [ ] Domain matches grouping for future skill promotion
- [ ] Gave feedback after applying
