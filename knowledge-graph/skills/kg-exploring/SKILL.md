---
name: kg-exploring
description: "Search and browse existing knowledge via knowledge_query and knowledge_list. Use at session start, after context compaction, before coding a feature with stored domain rules, or when user asks 'what do we know about X?'. Triggers: 'find knowledge about', 'what rules exist for', 'browse domains', session start reminder, post-compaction recovery."
---

# Exploring Knowledge

## Workflow

1. `knowledge_list` — overview of domains, categories, lifecycle counts
2. `knowledge_query("relevant topic")` — semantic deep search
3. Read returned chunks — follow auto-links for related context
4. Check confidence + lifecycle to gauge trustworthiness

## Trust Assessment

| Lifecycle | Trust | Action |
|-----------|-------|--------|
| canonical | Very high | Use directly |
| promoted | High | Use, verify if critical |
| validated | Medium | Confirmed but not promoted |
| active | Default | Needs validation |
| hypothesis | Low | Interview user first |
| refuted | Untrusted | Skip |

## Filter Tips

- `filters.domain` — narrow to specific area
- `filters.lifecycle` — show only promoted/validated
- `filters.min_confidence` — filter by effective (decayed) confidence
- `knowledge_query` excludes refuted by default

## Checklist

- [ ] `knowledge_list` to scan domains
- [ ] `knowledge_query` for specific topics
- [ ] Checked lifecycle: promoted > validated > active > hypothesis
- [ ] Checked confidence: >= 0.8 = trustworthy
