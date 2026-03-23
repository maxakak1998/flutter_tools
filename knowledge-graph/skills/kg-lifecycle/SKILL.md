---
name: kg-lifecycle
description: "Validate, refute, and promote knowledge through the lifecycle state machine via knowledge_validate and knowledge_promote. Use when confirming/refuting a chunk with evidence, promoting validated knowledge, or managing knowledge quality. Triggers: 'confirm this', 'refute this', 'promote to canonical', 'validate knowledge', golden evidence check."
---

# Knowledge Lifecycle Management

## State Machine

```
hypothesis ──[3x confirm + conf>=0.85]──> validated ──[golden evidence]──> promoted ──[conf>=0.9]──> canonical
active ──[promote]──> promoted
any ──[conf<0.2]──> refuted ──[confirm + conf>=0.2]──> hypothesis
```

## Validate

1. Find evidence in code, docs, tests, or user confirmation
2. `knowledge_validate(id, "confirm", evidence: "code:src/file.ts:42")`
3. Evidence REQUIRED (hook blocks without it)
4. Prefixes: `user:`, `docs:`, `code:`, `tests:`, `task:`

## Promote

1. Verify ALL 4 golden evidence sources:
   - `[docs:path]` — documented
   - `[code:path:line]` — implemented
   - `[tests:path]` — tested
   - `[task:issue-id]` — tracked
2. `knowledge_promote(id, reason: "Golden Evidence: [docs:...] [code:...] [tests:...] [task:...]")`
3. Hook blocks if any source missing

## Refute

1. `knowledge_validate(id, "refute", evidence: "code:src/new.ts — rule no longer applies")`
2. At confidence < 0.2 → lifecycle becomes `refuted`

## Checklist

- [ ] Evidence included with every validate call
- [ ] Golden evidence verified before promoting
- [ ] Reason cites all 4 sources
- [ ] Not promoting chunks with confidence < 0.5
