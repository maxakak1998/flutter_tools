# ECA Decomposition Script — Part 3 Remaining Work

## Status
- DB wiped clean — 0 chunks
- Code fix applied: `src/client.ts` updated with ECA categories, relations, layer filters
- Rebuilt and installed via `bash install.sh`
- **Requires new session** for MCP server to pick up new schema

## What to Do Next Session

Start new Claude Code session, then execute the FULL Part 3 from scratch:

1. **Phase B**: Store 22 low-density nodes (batch) — concepts, references, simple rules
2. **Phase C**: Store 10 medium-density ECA trees (~47 nodes)
3. **Phase D**: Store 6 high-density ECA trees (~56 nodes)
4. **Phase E**: Cross-tree links
5. **Phase F**: Verification

All node content and metadata are defined in the plan (Part 3, sections 3.2-3.3).
Plan location: search conversation history or the plan transcript at:
`/Users/kiet.phi/.claude/projects/-Users-kiet-phi-Documents-AC-Project-upcoz-mobile-flutter-tools-knowledge-graph/a3c4509a-2053-47b8-86f4-665f23584a89.jsonl`

### Cross-Tree Links (Phase E)

After all trees stored, create these inter-tree edges:
- "Whitelist odds blocking" depends_on "Auto-verify triggers"
- "Promotion unlink gate" depends_on "Promotion eligibility by bet type"
- "Reuse mode exit paths" relates_to "Betslip lifecycle state machine"
- "Place Bet verification gate" triggers "Auto-verify triggers"
- "Odds direction indicator" is_part_of "Odds change display" rule
