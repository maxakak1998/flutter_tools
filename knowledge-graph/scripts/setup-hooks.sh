#!/bin/bash
# setup-hooks.sh — Install KG domain-knowledge enforcement hooks
# Run from a project root that uses knowledge-graph.
# Creates .claude/hooks/kg-*.sh and merges hook registrations into .claude/settings.local.json
set -euo pipefail

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${GREEN}==>${NC} ${BOLD}$1${NC}"; }
warn()  { echo -e "${YELLOW}WARNING:${NC} $1"; }
error() { echo -e "${RED}ERROR:${NC} $1"; exit 1; }

# Prereqs
command -v jq &>/dev/null || error "jq is required. Install: brew install jq"

HOOKS_DIR="$PWD/.claude/hooks"
SETTINGS_FILE="$PWD/.claude/settings.local.json"

mkdir -p "$HOOKS_DIR"

# ============================================================================
# Part 1: Hook Scripts
# ============================================================================

info "Creating hook scripts..."

# --------------------------------------------------------------------------
# Hook 1: kg-source-category-check.sh (NEW)
# PreToolUse on knowledge_store AND knowledge_evolve
# --------------------------------------------------------------------------
cat > "$HOOKS_DIR/kg-source-category-check.sh" <<'HOOKEOF'
#!/bin/bash
# PreToolUse hook for knowledge_store and knowledge_evolve
# Enforces source/category compatibility to ensure interview protocol.
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

MARKER_DIR="${TMPDIR:-/tmp}/claude-kg-hooks-$(id -u)"
mkdir -m 700 -p "$MARKER_DIR" 2>/dev/null

# For knowledge_evolve: only check category, skip source (not in evolve schema)
if [ "$TOOL_NAME" = "mcp__knowledge-graph__knowledge_evolve" ]; then
  HAS_NEW_META=$(echo "$INPUT" | jq -r '.tool_input.new_metadata // empty')
  if [ -z "$HAS_NEW_META" ]; then
    exit 0
  fi
  CATEGORY=$(echo "$INPUT" | jq -r '.tool_input.new_metadata.category // ""')
  if [ -z "$CATEGORY" ]; then
    exit 0
  fi
  # Block evolving category to insight/question — store as insight first via knowledge_store
  case "$CATEGORY" in
    insight|question)
      echo "BLOCKED: Cannot evolve category to '$CATEGORY'. Store as '$CATEGORY' first via knowledge_store with proper source." >&2
      exit 2
      ;;
    *) exit 0 ;;
  esac
fi

# For knowledge_store: full source/category check
CATEGORY=$(echo "$INPUT" | jq -r '.tool_input.metadata.category // ""')
SOURCE=$(echo "$INPUT" | jq -r '.tool_input.metadata.source // ""')

# insight/question: MUST have source matching allowed prefixes
case "$CATEGORY" in
  insight|question)
    if [ -z "$SOURCE" ]; then
      echo "BLOCKED: Category '$CATEGORY' requires a source field." >&2
      echo "Allowed sources: user-confirmed:*, observed:*, code-review:*, discussion-with-user:*" >&2
      echo "This ensures the interview protocol was followed." >&2
      exit 2
    fi
    case "$SOURCE" in
      user-confirmed:*|observed:*|code-review:*|discussion-with-user:*) exit 0 ;;
      *)
        echo "BLOCKED: Invalid source '$SOURCE' for category '$CATEGORY'." >&2
        echo "Allowed: user-confirmed:*, observed:*, code-review:*, discussion-with-user:*" >&2
        exit 2
        ;;
    esac
    ;;
  fact|rule|workflow)
    # fact/rule/workflow: block if source is observed:* or code-review:* (must be user-confirmed or no source)
    case "$SOURCE" in
      observed:*|code-review:*)
        echo "BLOCKED: Category '$CATEGORY' cannot use source '$SOURCE'." >&2
        echo "Facts/rules/workflows must be user-confirmed (use source 'user-confirmed:*') or have no source (user said it directly)." >&2
        echo "If this was inferred from code, store as 'insight' first, interview the user, then evolve to 'fact'/'rule'." >&2
        exit 2
        ;;
      *) exit 0 ;;
    esac
    ;;
  *) exit 0 ;;
esac
HOOKEOF

# --------------------------------------------------------------------------
# Hook 1c: kg-entity-decomposition-check.sh (NEW)
# PreToolUse on knowledge_store — enforces entity decomposition rules.
# BLOCKS if 2+ entities but no relations provided.
# --------------------------------------------------------------------------
cat > "$HOOKS_DIR/kg-entity-decomposition-check.sh" <<'HOOKEOF'
#!/bin/bash
# PreToolUse hook for knowledge_store
# Enforces entity-centric decomposition: if 2+ entities, relations[] required.
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Only applies to knowledge_store
case "$TOOL_NAME" in
  *knowledge_store) ;;
  *) exit 0 ;;
esac

ENTITY_COUNT=$(echo "$INPUT" | jq '[.tool_input.metadata.entities // [] | length] | .[0]')
RELATION_COUNT=$(echo "$INPUT" | jq '[.tool_input.metadata.relations // [] | length] | .[0]')
CATEGORY=$(echo "$INPUT" | jq -r '.tool_input.metadata.category // ""')

# Rule: 2+ entities requires at least 1 relation
if [ "$ENTITY_COUNT" -ge 2 ] && [ "$RELATION_COUNT" -eq 0 ]; then
  cat >&2 <<BLOCKMSG
BLOCKED: Chunk has $ENTITY_COUNT entities but no relations.

When a chunk mentions 2+ entities, you MUST describe how they interact via metadata.relations[].
This creates typed edges between entity-index chunks in the knowledge graph.

Fix: Add relations[] to metadata. Example:
  "relations": [
    {"from_entity": "EntityA", "to_entity": "EntityB", "relation": "depends_on"}
  ]

Available relations: relates_to, depends_on, contradicts, triggers, requires,
  produces, is_part_of, constrains, precedes, transitions_to, governed_by

If entities are truly independent, split into separate chunks with 1 entity each.
BLOCKMSG
  exit 2
fi

exit 0
HOOKEOF

# --------------------------------------------------------------------------
# Hook 1b: kg-source-category-check.sh for evolve (DRIFT FIX)
# The evolve schema does NOT have a source field. Only check category.
# --------------------------------------------------------------------------

# --------------------------------------------------------------------------
# Hook 2: kg-require-validate-evidence.sh (NEW)
# PreToolUse on knowledge_validate
# --------------------------------------------------------------------------
cat > "$HOOKS_DIR/kg-require-validate-evidence.sh" <<'HOOKEOF'
#!/bin/bash
# PreToolUse hook for knowledge_validate
# Requires non-empty evidence when confirming or refuting.
INPUT=$(cat)

MARKER_DIR="${TMPDIR:-/tmp}/claude-kg-hooks-$(id -u)"
mkdir -m 700 -p "$MARKER_DIR" 2>/dev/null

EVIDENCE=$(echo "$INPUT" | jq -r '.tool_input.evidence // ""')
ACTION=$(echo "$INPUT" | jq -r '.tool_input.action // ""')

if [ -z "$EVIDENCE" ]; then
  echo "BLOCKED: knowledge_validate requires 'evidence' field." >&2
  echo "Provide evidence citing where you found confirmation/refutation." >&2
  echo "Suggested prefixes: user:, docs:, code:, tests:, task:" >&2
  echo "Example: evidence: 'code:src/engine/retriever.ts:55 — search weights confirmed'" >&2
  exit 2
fi

exit 0
HOOKEOF

# --------------------------------------------------------------------------
# Hook 3: kg-session-start.sh is REMOVED — replaced by `kg prime`
# The prime command outputs full skill context via additionalContext,
# registered directly as a command hook (no shell script needed).
# --------------------------------------------------------------------------

# --------------------------------------------------------------------------
# Hook 4: kg-learning-capture-check.sh (NEW)
# Stop — gentle reminder (NEVER blocks, always exit 0)
# --------------------------------------------------------------------------
cat > "$HOOKS_DIR/kg-learning-capture-check.sh" <<'HOOKEOF'
#!/bin/bash
# Stop hook — context-aware reminder about KG usage.
# Checks if .dart files were edited without KG consultation.
# NEVER blocks (always exit 0).
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')

# Prevent infinite loop
STOP_MARKER_VAR="KG_STOP_HOOK_ACTIVE"
if [ "${!STOP_MARKER_VAR:-}" = "1" ]; then
  exit 0
fi

MARKER_DIR="${TMPDIR:-/tmp}/claude-kg-hooks-$(id -u)"
TOOL_MARKER="$MARKER_DIR/kg-tool-used-${SESSION_ID}"
EDITS_FILE="$MARKER_DIR/kg-code-edits-${SESSION_ID}"

# No code edits this session — nothing to nudge about
if [ ! -f "$EDITS_FILE" ]; then
  exit 0
fi

# Count unique areas edited
AREAS=$(sort -u "$EDITS_FILE" | head -5)
EDIT_COUNT=$(wc -l < "$EDITS_FILE" | tr -d ' ')

# KG was used — no nudge needed
if [ -f "$TOOL_MARKER" ]; then
  exit 0
fi

# Files edited but KG not consulted — give specific nudge
AREA_LIST=$(echo "$AREAS" | tr '\n' ', ' | sed 's/,$//')
echo "" >&2
echo "[KG Nudge] Edited ${EDIT_COUNT} file(s) in: ${AREA_LIST} — without consulting the knowledge graph." >&2
echo "" >&2
echo "SESSION START (missed):" >&2
echo "  knowledge_list + knowledge_query('<topic>') — check existing domain knowledge" >&2
echo "" >&2
echo "SESSION END (still possible):" >&2
echo "  life_store — store coding gotchas/patterns discovered during this session" >&2
echo "  knowledge_store — store business rules confirmed by user" >&2

# Log session summary to activity.log
KG_DIR=""
CHECK_DIR="$PWD"
while [ "$CHECK_DIR" != "/" ]; do
  if [ -d "$CHECK_DIR/.knowledge-graph" ]; then
    KG_DIR="$CHECK_DIR/.knowledge-graph"
    break
  fi
  CHECK_DIR=$(dirname "$CHECK_DIR")
done
if [ -n "$KG_DIR" ]; then
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  KG_USED="false"
  [ -f "$TOOL_MARKER" ] && KG_USED="true"
  jq -n -c \
    --arg ts "$TIMESTAMP" --arg sid "$SESSION_ID" \
    --arg edits "${EDIT_COUNT:-0}" --argjson kg_used "$KG_USED" \
    --arg areas "${AREA_LIST:-}" \
    '{ts:$ts,session:$sid,event:"session_stop",edits:($edits|tonumber),kg_consulted:$kg_used,areas:$areas}' \
    >> "$KG_DIR/activity.log"
fi

exit 0
HOOKEOF

# --------------------------------------------------------------------------
# Hook 5a: kg-activity-tracker.sh (NEW)
# PostToolUse + PostToolUseFailure on ALL tools — broad session analytics
# --------------------------------------------------------------------------
cat > "$HOOKS_DIR/kg-activity-tracker.sh" <<'HOOKEOF'
#!/bin/bash
# PostToolUse + PostToolUseFailure hook for ALL tools.
# Appends lightweight JSONL to .knowledge-graph/activity.log for session analytics.
# Non-blocking, append-only. Designed for retrospective analysis.
INPUT=$(cat)

# Find .knowledge-graph/ directory (walk up from CWD)
KG_DIR=""
CHECK_DIR="$PWD"
while [ "$CHECK_DIR" != "/" ]; do
  if [ -d "$CHECK_DIR/.knowledge-graph" ]; then
    KG_DIR="$CHECK_DIR/.knowledge-graph"
    break
  fi
  CHECK_DIR=$(dirname "$CHECK_DIR")
done
[ -z "$KG_DIR" ] && exit 0

ACTIVITY_LOG="$KG_DIR/activity.log"
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SID=$(echo "$INPUT" | jq -r '.session_id // ""')
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')

# --- Failure event ---
ERROR=$(echo "$INPUT" | jq -r '.error // empty')
if [ -n "$ERROR" ]; then
  SHORT_ERR=$(echo "$ERROR" | head -c 200 | tr '\n\t' '  ')
  jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" --arg err "$SHORT_ERR" \
    '{ts:$ts,session:$sid,event:"tool_error",tool:$tool,error:$err}' >> "$ACTIVITY_LOG"
  exit 0
fi

# --- Success event — extract metadata by tool type ---
case "$TOOL" in
  Read|Edit|Write)
    FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
    AREA=""
    if [[ "$FILE" =~ lib/features/([^/]+)/ ]]; then AREA="${BASH_REMATCH[1]}"
    elif [[ "$FILE" =~ lib/core/([^/]+)/ ]]; then AREA="core/${BASH_REMATCH[1]}"
    elif [[ "$FILE" =~ src/([^/]+)/ ]]; then AREA="src/${BASH_REMATCH[1]}"
    elif [[ "$FILE" =~ test/([^/]+)/ ]]; then AREA="test/${BASH_REMATCH[1]}"
    elif [[ "$FILE" =~ docs/ ]]; then AREA="docs"
    fi
    jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" --arg file "$FILE" --arg area "$AREA" \
      '{ts:$ts,session:$sid,event:"tool",tool:$tool,file:$file,area:$area}' >> "$ACTIVITY_LOG"
    ;;

  Bash)
    CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""' | head -c 120 | tr '\n\t' '  ')
    jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" --arg cmd "$CMD" \
      '{ts:$ts,session:$sid,event:"tool",tool:$tool,command:$cmd}' >> "$ACTIVITY_LOG"
    ;;

  Grep)
    PAT=$(echo "$INPUT" | jq -r '.tool_input.pattern // ""' | head -c 60)
    P=$(echo "$INPUT" | jq -r '.tool_input.path // ""')
    jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" --arg pattern "$PAT" --arg path "$P" \
      '{ts:$ts,session:$sid,event:"tool",tool:$tool,pattern:$pattern,path:$path}' >> "$ACTIVITY_LOG"
    ;;

  Glob)
    PAT=$(echo "$INPUT" | jq -r '.tool_input.pattern // ""')
    P=$(echo "$INPUT" | jq -r '.tool_input.path // ""')
    jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" --arg pattern "$PAT" --arg path "$P" \
      '{ts:$ts,session:$sid,event:"tool",tool:$tool,pattern:$pattern,path:$path}' >> "$ACTIVITY_LOG"
    ;;

  Agent)
    SUB=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // "general-purpose"')
    DESC=$(echo "$INPUT" | jq -r '.tool_input.description // ""' | head -c 100)
    jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" --arg subagent "$SUB" --arg desc "$DESC" \
      '{ts:$ts,session:$sid,event:"tool",tool:$tool,subagent:$subagent,description:$desc}' >> "$ACTIVITY_LOG"
    ;;

  *knowledge_store|*life_store)
    DOM=$(echo "$INPUT" | jq -r '.tool_input.metadata.domain // ""')
    CAT=$(echo "$INPUT" | jq -r '.tool_input.metadata.category // ""')
    SRC=$(echo "$INPUT" | jq -r '.tool_input.metadata.source // ""')
    SUM=$(echo "$INPUT" | jq -r '.tool_input.metadata.summary // ""' | head -c 100 | tr '\n\t' '  ')
    CID=$(echo "$INPUT" | jq -r '.tool_response.id // .tool_response.duplicate_of // ""')
    IS_DEDUP=$(echo "$INPUT" | jq -r '.tool_response.duplicate_of // empty')
    EVT="tool"
    [ -n "$IS_DEDUP" ] && EVT="dedup"
    jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" --arg evt "$EVT" \
      --arg id "$CID" --arg domain "$DOM" --arg category "$CAT" --arg source "$SRC" --arg summary "$SUM" \
      '{ts:$ts,session:$sid,event:$evt,tool:$tool,id:$id,domain:$domain,category:$category,source:$source,summary:$summary}' >> "$ACTIVITY_LOG"
    ;;

  *knowledge_query)
    Q=$(echo "$INPUT" | jq -r '.tool_input.query // ""' | head -c 100)
    HITS=$(echo "$INPUT" | jq -r '.tool_response.results // [] | length')
    jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" --arg query "$Q" --arg hits "$HITS" \
      '{ts:$ts,session:$sid,event:"tool",tool:$tool,query:$query,hits:($hits|tonumber)}' >> "$ACTIVITY_LOG"
    ;;

  *knowledge_validate|*life_feedback)
    CID=$(echo "$INPUT" | jq -r '.tool_input.id // ""')
    ACT=$(echo "$INPUT" | jq -r '.tool_response.action // .tool_input.outcome // ""')
    CONF=$(echo "$INPUT" | jq -r '.tool_response.confidence // .tool_response.score // ""')
    LC=$(echo "$INPUT" | jq -r '.tool_response.lifecycle // ""')
    EV=$(echo "$INPUT" | jq -r '.tool_input.evidence // ""' | head -c 100 | tr '\n\t' '  ')
    jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" \
      --arg id "$CID" --arg action "$ACT" --arg confidence "$CONF" --arg lifecycle "$LC" --arg evidence "$EV" \
      '{ts:$ts,session:$sid,event:"tool",tool:$tool,id:$id,action:$action,confidence:$confidence,lifecycle:$lifecycle,evidence:$evidence}' >> "$ACTIVITY_LOG"
    ;;

  *knowledge_promote)
    CID=$(echo "$INPUT" | jq -r '.tool_input.id // ""')
    REASON=$(echo "$INPUT" | jq -r '.tool_input.reason // ""' | head -c 120 | tr '\n\t' '  ')
    PREV_LC=$(echo "$INPUT" | jq -r '.tool_response.previous_lifecycle // ""')
    NEW_LC=$(echo "$INPUT" | jq -r '.tool_response.new_lifecycle // ""')
    CONF=$(echo "$INPUT" | jq -r '.tool_response.confidence // ""')
    jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" \
      --arg id "$CID" --arg reason "$REASON" --arg prev "$PREV_LC" --arg new "$NEW_LC" --arg conf "$CONF" \
      '{ts:$ts,session:$sid,event:"tool",tool:$tool,id:$id,reason:$reason,prev_lifecycle:$prev,new_lifecycle:$new,confidence:$conf}' >> "$ACTIVITY_LOG"
    ;;

  *knowledge_evolve)
    CID=$(echo "$INPUT" | jq -r '.tool_response.id // ""')
    DOM=$(echo "$INPUT" | jq -r '.tool_input.new_metadata.domain // ""')
    CAT=$(echo "$INPUT" | jq -r '.tool_input.new_metadata.category // ""')
    jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" \
      --arg id "$CID" --arg domain "$DOM" --arg category "$CAT" \
      '{ts:$ts,session:$sid,event:"tool",tool:$tool,id:$id,domain:$domain,category:$category}' >> "$ACTIVITY_LOG"
    ;;

  *knowledge_delete)
    CID=$(echo "$INPUT" | jq -r '.tool_response.id // ""')
    DOM=$(echo "$INPUT" | jq -r '.tool_response.snapshot.domain // ""')
    LC=$(echo "$INPUT" | jq -r '.tool_response.snapshot.lifecycle // ""')
    REASON=$(echo "$INPUT" | jq -r '.tool_input.reason // ""' | head -c 100 | tr '\n\t' '  ')
    jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" \
      --arg id "$CID" --arg domain "$DOM" --arg lifecycle "$LC" --arg reason "$REASON" \
      '{ts:$ts,session:$sid,event:"tool",tool:$tool,id:$id,domain:$domain,lifecycle:$lifecycle,reason:$reason}' >> "$ACTIVITY_LOG"
    ;;

  *knowledge_link)
    SRC=$(echo "$INPUT" | jq -r '.tool_input.source_id // ""')
    TGT=$(echo "$INPUT" | jq -r '.tool_input.target_id // ""')
    REL=$(echo "$INPUT" | jq -r '.tool_input.relation // ""')
    jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" --arg src "$SRC" --arg tgt "$TGT" --arg rel "$REL" \
      '{ts:$ts,session:$sid,event:"tool",tool:$tool,source_id:$src,target_id:$tgt,relation:$rel}' >> "$ACTIVITY_LOG"
    ;;

  *knowledge_list)
    jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" \
      '{ts:$ts,session:$sid,event:"tool",tool:$tool}' >> "$ACTIVITY_LOG"
    ;;

  *life_draft_skill)
    DOM=$(echo "$INPUT" | jq -r '.tool_input.domain // ""')
    SPATH=$(echo "$INPUT" | jq -r '.tool_response.skill_path // ""')
    jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" --arg domain "$DOM" --arg path "$SPATH" \
      '{ts:$ts,session:$sid,event:"tool",tool:$tool,domain:$domain,skill_path:$path}' >> "$ACTIVITY_LOG"
    ;;

  *)
    # Generic fallback: just tool name
    jq -n -c --arg ts "$TS" --arg sid "$SID" --arg tool "$TOOL" \
      '{ts:$ts,session:$sid,event:"tool",tool:$tool}' >> "$ACTIVITY_LOG"
    ;;
esac

exit 0
HOOKEOF

# --------------------------------------------------------------------------
# Hook 5b: kg-track-code-edits.sh (NEW)
# PostToolUse on Edit and Write — records feature areas for Stop nudge
# --------------------------------------------------------------------------
cat > "$HOOKS_DIR/kg-track-code-edits.sh" <<'HOOKEOF'
#!/bin/bash
# PostToolUse hook for Edit and Write — tracks file edits per session.
# Skips non-code files (markers, logs, lock files). No blocking, no output.
INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
[ -z "$FILE_PATH" ] && exit 0

# Skip files that are clearly not code/config worth tracking
case "$FILE_PATH" in
  */daemon.port|*/daemon.pid|*.log|*.lock) exit 0 ;;
esac

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
MARKER_DIR="${TMPDIR:-/tmp}/claude-kg-hooks-$(id -u)"
mkdir -m 700 -p "$MARKER_DIR" 2>/dev/null

EDITS_FILE="$MARKER_DIR/kg-code-edits-${SESSION_ID}"

# Extract area from path
AREA=""
if [[ "$FILE_PATH" =~ lib/features/([^/]+)/ ]]; then
  AREA="${BASH_REMATCH[1]}"
elif [[ "$FILE_PATH" =~ lib/core/([^/]+)/ ]]; then
  AREA="core/${BASH_REMATCH[1]}"
elif [[ "$FILE_PATH" =~ src/([^/]+)/ ]]; then
  AREA="src/${BASH_REMATCH[1]}"
elif [[ "$FILE_PATH" =~ test/([^/]+)/ ]]; then
  AREA="test/${BASH_REMATCH[1]}"
elif [[ "$FILE_PATH" =~ docs/ ]]; then
  AREA="docs"
else
  # Use filename for top-level files
  AREA=$(basename "$FILE_PATH")
fi

echo "$AREA" >> "$EDITS_FILE"

exit 0
HOOKEOF

# --------------------------------------------------------------------------
# Hook 6: kg-mark-tool-used.sh (NEW)
# PostToolUse on all KG tools — marks KG was used in this session
# --------------------------------------------------------------------------
cat > "$HOOKS_DIR/kg-mark-tool-used.sh" <<'HOOKEOF'
#!/bin/bash
# PostToolUse hook for all KG tools — marks that KG was used in this session.
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')

MARKER_DIR="${TMPDIR:-/tmp}/claude-kg-hooks-$(id -u)"
mkdir -m 700 -p "$MARKER_DIR" 2>/dev/null
touch "$MARKER_DIR/kg-tool-used-${SESSION_ID}"

exit 0
HOOKEOF

# --------------------------------------------------------------------------
# Update existing: kg-require-domain-check.sh (use MARKER_DIR)
# --------------------------------------------------------------------------
cat > "$HOOKS_DIR/kg-require-domain-check.sh" <<'HOOKEOF'
#!/bin/bash
# PreToolUse hook for knowledge_store
# Blocks store if knowledge_list was not called first in this session.
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')

MARKER_DIR="${TMPDIR:-/tmp}/claude-kg-hooks-$(id -u)"
mkdir -m 700 -p "$MARKER_DIR" 2>/dev/null
MARKER="$MARKER_DIR/kg-domains-checked-${SESSION_ID}"

if [ -f "$MARKER" ]; then
  exit 0
fi

echo "BLOCKED: Call knowledge_list first to check existing domains before storing." >&2
echo "This prevents domain fragmentation (e.g., 'di' vs 'dependency-injection')." >&2
echo "Run knowledge_list, scan the returned domains, reuse a matching one, then retry." >&2
exit 2
HOOKEOF

# --------------------------------------------------------------------------
# Update existing: kg-mark-domains-checked.sh (use MARKER_DIR)
# --------------------------------------------------------------------------
cat > "$HOOKS_DIR/kg-mark-domains-checked.sh" <<'HOOKEOF'
#!/bin/bash
# PostToolUse hook for knowledge_list
# Marks that domain reuse check was performed in this session.
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')

MARKER_DIR="${TMPDIR:-/tmp}/claude-kg-hooks-$(id -u)"
mkdir -m 700 -p "$MARKER_DIR" 2>/dev/null
touch "$MARKER_DIR/kg-domains-checked-${SESSION_ID}"

exit 0
HOOKEOF

# --------------------------------------------------------------------------
# Existing: kg-require-golden-evidence.sh (ensure it exists)
# --------------------------------------------------------------------------
cat > "$HOOKS_DIR/kg-require-golden-evidence.sh" <<'HOOKEOF'
#!/bin/bash
# PreToolUse hook for knowledge_promote
# Blocks promote if reason doesn't cite all 4 golden evidence sources.
INPUT=$(cat)
REASON=$(echo "$INPUT" | jq -r '.tool_input.reason // ""')

missing=""
echo "$REASON" | grep -q '\[docs:' || missing="${missing} [docs:]"
echo "$REASON" | grep -q '\[code:' || missing="${missing} [code:]"
echo "$REASON" | grep -q '\[tests:' || missing="${missing} [tests:]"
echo "$REASON" | grep -q '\[task:' || missing="${missing} [task:]"

if [ -n "$missing" ]; then
  echo "BLOCKED: Golden evidence incomplete. Missing:${missing}" >&2
  echo "The reason field must cite ALL 4 sources. Format:" >&2
  echo "  Golden Evidence: [docs:path] [code:path:line] [tests:path] [task:issue-id]" >&2
  exit 2
fi

exit 0
HOOKEOF

# --------------------------------------------------------------------------
# Hook 10: kg-tool-failure.sh (NEW)
# PostToolUseFailure — classifies KG tool failures, suggests remediation
# --------------------------------------------------------------------------
cat > "$HOOKS_DIR/kg-tool-failure.sh" <<'HOOKEOF'
#!/bin/bash
# PostToolUseFailure hook for knowledge-graph tools.
# Classifies failure and injects remediation guidance via additionalContext.
INPUT=$(cat)

# Circuit breaker: mark KG consultation as failed for query/list tools
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
case "$TOOL_NAME" in
  *knowledge_query|*knowledge_list)
    SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
    if [ -n "$SESSION_ID" ]; then
      MARKER_DIR="${TMPDIR:-/tmp}/claude-kg-hooks-$(id -u)"
      mkdir -m 700 -p "$MARKER_DIR" 2>/dev/null
      touch "$MARKER_DIR/kg-consult-failed-${SESSION_ID}"
    fi
    ;;
esac

ERROR=$(echo "$INPUT" | jq -r '.error // ""')

# Classify likely root cause
if echo "$ERROR" | grep -qi 'ECONNREFUSED\|fetch failed\|daemon.*not.*running\|connection refused'; then
  HINT="KG daemon is not running. Try: kg doctor, then kg serve"
elif echo "$ERROR" | grep -qi 'no.*\.knowledge-graph\|project.*not.*found\|not.*initialized'; then
  HINT="No .knowledge-graph/ found in this project. Run: kg init"
elif echo "$ERROR" | grep -qi 'ollama\|embedding\|bge-m3\|model.*not.*found'; then
  HINT="Ollama may be unavailable. Check: ollama serve, then ollama pull bge-m3"
elif echo "$ERROR" | grep -qi 'lock\|locked\|busy\|database'; then
  HINT="Database may be locked by another process. Try: kg stop, then kg serve"
elif echo "$ERROR" | grep -qi 'cannot delete.*without.*reason\|lifecycle.*guard\|policy.*reject'; then
  HINT="Delete blocked by lifecycle guard. Add a 'reason' field explaining why this validated/promoted/canonical chunk should be removed."
else
  HINT="KG tool failed unexpectedly. Run: kg doctor"
fi

# Truncate error for context (max 200 chars)
SHORT_ERROR=$(echo "$ERROR" | head -c 200)

jq -n --arg hint "$HINT" --arg err "$SHORT_ERROR" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUseFailure",
    additionalContext: ("[KG Recovery] " + $hint + " | Error: " + $err)
  }
}'

exit 0
HOOKEOF

# --------------------------------------------------------------------------
# Hook 11: kg-session-end-cleanup.sh (NEW)
# SessionEnd — cleans up session-specific marker files
# MUST be fast: default timeout is 1.5s. Direct path deletion only.
# --------------------------------------------------------------------------
cat > "$HOOKS_DIR/kg-session-end-cleanup.sh" <<'HOOKEOF'
#!/bin/bash
# SessionEnd hook — cleans up session-specific marker files.
# Direct path deletion only (no glob/scan) to stay within 1.5s timeout.
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')

MARKER_DIR="${TMPDIR:-/tmp}/claude-kg-hooks-$(id -u)"

# Direct deletion of known session files — no glob, no scan
rm -f "$MARKER_DIR/kg-domains-checked-${SESSION_ID}" 2>/dev/null
rm -f "$MARKER_DIR/kg-tool-used-${SESSION_ID}" 2>/dev/null
rm -f "$MARKER_DIR/kg-code-edits-${SESSION_ID}" 2>/dev/null
rm -f "$MARKER_DIR/kg-session-reminder-${SESSION_ID}" 2>/dev/null
rm -f "$MARKER_DIR/kg-consulted-${SESSION_ID}" 2>/dev/null
rm -f "$MARKER_DIR/kg-consult-failed-${SESSION_ID}" 2>/dev/null

exit 0
HOOKEOF

# --------------------------------------------------------------------------
# Hook 12: kg-require-consult-before-edit.sh (NEW)
# PreToolUse on Edit and Write — blocks until KG is consulted
# --------------------------------------------------------------------------
cat > "$HOOKS_DIR/kg-require-consult-before-edit.sh" <<'HOOKEOF'
#!/bin/bash
# PreToolUse hook for Edit and Write
# Blocks edits until KG is consulted in this session (via MCP tools or CLI).
# Circuit breaker: allows edits if KG consultation was attempted but failed.
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
[ -z "$SESSION_ID" ] && exit 0

MARKER_DIR="${TMPDIR:-/tmp}/claude-kg-hooks-$(id -u)"

# 1. Already consulted → ALLOW
[ -f "$MARKER_DIR/kg-consulted-${SESSION_ID}" ] && exit 0

# 2. Consultation failed (circuit breaker) → ALLOW with warning
if [ -f "$MARKER_DIR/kg-consult-failed-${SESSION_ID}" ]; then
  echo "[KG] Warning: KG consultation failed earlier. Proceeding without KG context." >&2
  exit 0
fi

# 3. No .knowledge-graph/ in project tree → ALLOW (KG not configured)
CHECK_DIR="$PWD"
KG_FOUND=false
while [ "$CHECK_DIR" != "/" ]; do
  if [ -d "$CHECK_DIR/.knowledge-graph" ]; then
    KG_FOUND=true
    break
  fi
  CHECK_DIR=$(dirname "$CHECK_DIR")
done
[ "$KG_FOUND" = "false" ] && exit 0

# 4. Check file path — exempt known noise patterns
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
case "$FILE_PATH" in
  # KG internal data
  */.knowledge-graph/*) exit 0 ;;
  # Build output directories
  */dist/*|*/build/*|*/out/*|*/target/*|*/node_modules/*) exit 0 ;;
  */.dart_tool/*|*/.next/*|*/.nuxt/*|*/.turbo/*|*/coverage/*) exit 0 ;;
  # Runtime artifacts
  *.log|*.lock|*.pid|*.port) exit 0 ;;
  # Generated code
  *.g.dart|*.freezed.dart) exit 0 ;;
  *.gen.*|*.generated.*|*.pb.*) exit 0 ;;
esac

# 5. BLOCK — not consulted, not failed, not exempt
cat >&2 <<'BLOCKMSG'
BLOCKED: Chưa tham vấn knowledge graph trong session này.

Trước khi edit, tham vấn KG (chỉ cần 1 lần/session):

  Bash (nhanh nhất):
    kg list                      # xem domains & lifecycle
    kg query '<chủ-đề>'         # tìm knowledge liên quan

  MCP tools:
    ToolSearch('select:mcp__knowledge-graph__knowledge_list,mcp__knowledge-graph__knowledge_query')
    knowledge_list / knowledge_query('<topic>')

  Nếu KG không available: kg doctor → kg serve

TẠI SAO: KG chứa business rules, domain constraints, gotchas từ sessions trước.
BLOCKMSG
exit 2
HOOKEOF

# --------------------------------------------------------------------------
# Hook 13: kg-mark-consulted.sh (NEW)
# PostToolUse on knowledge_query and knowledge_list — marks KG consulted
# --------------------------------------------------------------------------
cat > "$HOOKS_DIR/kg-mark-consulted.sh" <<'HOOKEOF'
#!/bin/bash
# PostToolUse hook for knowledge_query and knowledge_list
# Marks that KG was consulted (read/query) in this session.
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
[ -z "$SESSION_ID" ] && exit 0

MARKER_DIR="${TMPDIR:-/tmp}/claude-kg-hooks-$(id -u)"
mkdir -m 700 -p "$MARKER_DIR" 2>/dev/null
touch "$MARKER_DIR/kg-consulted-${SESSION_ID}"

exit 0
HOOKEOF

# --------------------------------------------------------------------------
# Hook 14: kg-mark-consulted-bash.sh (NEW)
# PostToolUse on Bash — detects kg list/query CLI usage
# --------------------------------------------------------------------------
cat > "$HOOKS_DIR/kg-mark-consulted-bash.sh" <<'HOOKEOF'
#!/bin/bash
# PostToolUse hook for Bash — detects kg list/kg query CLI usage.
# Sets kg-consulted marker when CLI wrappers are used successfully.
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

case "$COMMAND" in
  *kg\ list*|*kg\ query*|*knowledge-graph\ list*|*knowledge-graph\ query*)
    SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
    [ -z "$SESSION_ID" ] && exit 0
    MARKER_DIR="${TMPDIR:-/tmp}/claude-kg-hooks-$(id -u)"
    mkdir -m 700 -p "$MARKER_DIR" 2>/dev/null
    touch "$MARKER_DIR/kg-consulted-${SESSION_ID}"
    ;;
esac

exit 0
HOOKEOF

# ============================================================================
# Part 1.5: Clean up legacy hooks
# ============================================================================

# Remove old kg-session-query-reminder.sh (replaced by kg prime)
if [ -f "$HOOKS_DIR/kg-session-query-reminder.sh" ]; then
  rm -f "$HOOKS_DIR/kg-session-query-reminder.sh"
  info "Removed legacy kg-session-query-reminder.sh (replaced by kg prime)"
fi

# Remove old kg-session-start.sh (replaced by kg prime)
if [ -f "$HOOKS_DIR/kg-session-start.sh" ]; then
  rm -f "$HOOKS_DIR/kg-session-start.sh"
  info "Removed legacy kg-session-start.sh (replaced by kg prime)"
fi

# Remove old kg-audit-log.sh (replaced by kg-activity-tracker.sh)
if [ -f "$HOOKS_DIR/kg-audit-log.sh" ]; then
  rm -f "$HOOKS_DIR/kg-audit-log.sh"
  info "Removed legacy kg-audit-log.sh (merged into kg-activity-tracker.sh)"
fi
# Also clean kg-audit-log.sh references from settings (file deleted but JSON refs remained)
if [ -f "$SETTINGS_FILE" ]; then
  AUDIT_REFS=$(grep -c 'kg-audit-log.sh' "$SETTINGS_FILE" 2>/dev/null || true)
  if [ "$AUDIT_REFS" -gt 0 ]; then
    info "Cleaning $AUDIT_REFS stale kg-audit-log.sh references from settings..."
  fi
fi

# ============================================================================
# Part 2: Make all hook scripts executable
# ============================================================================

info "Setting permissions..."
chmod +x "$HOOKS_DIR"/kg-*.sh

# ============================================================================
# Part 3: Merge hook registrations into settings.local.json
# ============================================================================

info "Merging hook registrations into settings.local.json..."

# Read current settings (or start with empty object)
if [ -f "$SETTINGS_FILE" ]; then
  # Only create backup once — don't overwrite on subsequent runs
  if [ ! -f "${SETTINGS_FILE}.bak" ]; then
    cp "$SETTINGS_FILE" "${SETTINGS_FILE}.bak"
    info "Backed up existing settings to ${SETTINGS_FILE}.bak"
  fi
  SETTINGS=$(cat "$SETTINGS_FILE")
else
  SETTINGS='{}'
fi

# Update old paths: ./hooks/kg-* -> .claude/hooks/kg-*
SETTINGS=$(echo "$SETTINGS" | jq '
  if .hooks then
    .hooks |= with_entries(
      .value |= map(
        .hooks |= map(
          if (.command | test("^\\./hooks/kg-")) then
            .command = (.command | sub("^\\./hooks/"; ".claude/hooks/"))
          else . end
        )
      )
    )
  else . end
')

# Helper: add a hook to an event array, merging with existing matchers
# Usage: add_hook EVENT MATCHER COMMAND
add_hook() {
  local event="$1" matcher="$2" command="$3"

  SETTINGS=$(echo "$SETTINGS" | jq \
    --arg event "$event" \
    --arg matcher "$matcher" \
    --arg cmd "$command" '
    # Ensure .hooks and .hooks[$event] exist
    .hooks //= {} |
    .hooks[$event] //= [] |

    # Find existing entry index with this matcher
    (.hooks[$event] | map(.matcher) | index($matcher)) as $idx |

    if $idx != null then
      # Matcher exists — add hook command if not already present
      if (.hooks[$event][$idx].hooks | map(.command) | index($cmd)) == null then
        .hooks[$event][$idx].hooks += [{"type": "command", "command": $cmd}]
      else
        .
      end
    else
      # New matcher — append entry
      .hooks[$event] += [{"matcher": $matcher, "hooks": [{"type": "command", "command": $cmd}]}]
    end
  ')
}

# --- PreToolUse hooks ---
add_hook "PreToolUse" "mcp__knowledge-graph__knowledge_store" ".claude/hooks/kg-require-domain-check.sh"
add_hook "PreToolUse" "mcp__knowledge-graph__knowledge_store" ".claude/hooks/kg-source-category-check.sh"
add_hook "PreToolUse" "mcp__knowledge-graph__knowledge_store" ".claude/hooks/kg-entity-decomposition-check.sh"
add_hook "PreToolUse" "mcp__knowledge-graph__knowledge_promote" ".claude/hooks/kg-require-golden-evidence.sh"
add_hook "PreToolUse" "mcp__knowledge-graph__knowledge_evolve" ".claude/hooks/kg-source-category-check.sh"
add_hook "PreToolUse" "mcp__knowledge-graph__knowledge_validate" ".claude/hooks/kg-require-validate-evidence.sh"

# --- Consultation gate (blocks Edit/Write until KG consulted) ---
add_hook "PreToolUse" "Edit" ".claude/hooks/kg-require-consult-before-edit.sh"
add_hook "PreToolUse" "Write" ".claude/hooks/kg-require-consult-before-edit.sh"

# --- PostToolUse hooks (KG-specific markers) ---
add_hook "PostToolUse" "mcp__knowledge-graph__knowledge_list" ".claude/hooks/kg-mark-domains-checked.sh"
add_hook "PostToolUse" "mcp__knowledge-graph__knowledge_list" ".claude/hooks/kg-mark-tool-used.sh"
add_hook "PostToolUse" "mcp__knowledge-graph__knowledge_store" ".claude/hooks/kg-mark-tool-used.sh"
add_hook "PostToolUse" "mcp__knowledge-graph__knowledge_evolve" ".claude/hooks/kg-mark-tool-used.sh"
add_hook "PostToolUse" "mcp__knowledge-graph__knowledge_query" ".claude/hooks/kg-mark-tool-used.sh"
add_hook "PostToolUse" "mcp__knowledge-graph__knowledge_validate" ".claude/hooks/kg-mark-tool-used.sh"
add_hook "PostToolUse" "mcp__knowledge-graph__knowledge_promote" ".claude/hooks/kg-mark-tool-used.sh"
add_hook "PostToolUse" "mcp__knowledge-graph__knowledge_link" ".claude/hooks/kg-mark-tool-used.sh"
add_hook "PostToolUse" "mcp__knowledge-graph__knowledge_delete" ".claude/hooks/kg-mark-tool-used.sh"
add_hook "PostToolUse" "mcp__knowledge-graph__life_store" ".claude/hooks/kg-mark-tool-used.sh"
add_hook "PostToolUse" "mcp__knowledge-graph__life_feedback" ".claude/hooks/kg-mark-tool-used.sh"
add_hook "PostToolUse" "mcp__knowledge-graph__life_draft_skill" ".claude/hooks/kg-mark-tool-used.sh"

# --- Code edit tracking (for Stop nudge) ---
add_hook "PostToolUse" "Edit" ".claude/hooks/kg-track-code-edits.sh"
add_hook "PostToolUse" "Write" ".claude/hooks/kg-track-code-edits.sh"

# --- Consulted markers (MCP path) ---
add_hook "PostToolUse" "mcp__knowledge-graph__knowledge_list" ".claude/hooks/kg-mark-consulted.sh"
add_hook "PostToolUse" "mcp__knowledge-graph__knowledge_query" ".claude/hooks/kg-mark-consulted.sh"

# --- Consulted markers (Bash/CLI path) ---
add_hook "PostToolUse" "Bash" ".claude/hooks/kg-mark-consulted-bash.sh"

# --- Broad activity tracking (all tools) ---
add_hook "PostToolUse" "" ".claude/hooks/kg-activity-tracker.sh"

# --- PostToolUseFailure hooks ---
add_hook "PostToolUseFailure" "mcp__knowledge-graph__.*" ".claude/hooks/kg-tool-failure.sh"
add_hook "PostToolUseFailure" "" ".claude/hooks/kg-activity-tracker.sh"

# --- SessionStart (kg prime replaces kg-session-start.sh) ---
add_hook "SessionStart" "" "kg prime"

# --- PreCompact (kg prime restores KG context after compaction) ---
add_hook "PreCompact" "" "kg prime"

# --- SessionEnd ---
add_hook "SessionEnd" "" ".claude/hooks/kg-session-end-cleanup.sh"

# --- Stop ---
add_hook "Stop" "" ".claude/hooks/kg-learning-capture-check.sh"

# --- Legacy cleanup: remove old hooks from settings ---
SETTINGS=$(echo "$SETTINGS" | jq '
  # Remove old UserPromptSubmit reminder
  if .hooks.UserPromptSubmit then
    .hooks.UserPromptSubmit |= map(
      .hooks |= map(select(.command != ".claude/hooks/kg-session-query-reminder.sh"))
    ) |
    .hooks.UserPromptSubmit |= map(select(.hooks | length > 0)) |
    if (.hooks.UserPromptSubmit | length) == 0 then del(.hooks.UserPromptSubmit) else . end
  else . end |
  # Remove old kg-session-start.sh from SessionStart (replaced by kg prime)
  if .hooks.SessionStart then
    .hooks.SessionStart |= map(
      .hooks |= map(select(.command != ".claude/hooks/kg-session-start.sh"))
    ) |
    .hooks.SessionStart |= map(select(.hooks | length > 0))
  else . end |
  # Remove stale kg-audit-log.sh references from all hook events
  .hooks |= (to_entries | map(
    .value |= map(
      .hooks |= map(select(.command != ".claude/hooks/kg-audit-log.sh"))
    ) |
    .value |= map(select(.hooks | length > 0))
  ) | from_entries)
')

# Write back (pretty-printed)
echo "$SETTINGS" | jq '.' > "$SETTINGS_FILE"

# ============================================================================
# Part 4: Summary
# ============================================================================

info "Hooks installed to $HOOKS_DIR"
info "Settings merged into $SETTINGS_FILE"
echo ""
echo "Hooks installed (15 scripts + kg prime, 7 events):"
echo "  [PreToolUse]          kg-require-domain-check.sh"
echo "  [PreToolUse]          kg-source-category-check.sh (evolve: category only, no source)"
echo "  [PreToolUse]          kg-entity-decomposition-check.sh (2+ entities → require relations)"
echo "  [PreToolUse]          kg-require-golden-evidence.sh"
echo "  [PreToolUse]          kg-require-validate-evidence.sh"
echo "  [PreToolUse]          kg-require-consult-before-edit.sh (gate Edit/Write until KG consulted)"
echo "  [PostToolUse]         kg-mark-consulted.sh (MCP query/list → consulted marker)"
echo "  [PostToolUse]         kg-mark-consulted-bash.sh (Bash kg list/query → consulted marker)"
echo "  [PostToolUse]         kg-mark-domains-checked.sh"
echo "  [PostToolUse]         kg-activity-tracker.sh (ALL tools → session analytics)"
echo "  [PostToolUse]         kg-track-code-edits.sh (Edit/Write → area tracker for Stop nudge)"
echo "  [PostToolUse]         kg-mark-tool-used.sh"
echo "  [PostToolUseFailure]  kg-tool-failure.sh"
echo "  [SessionStart]        kg prime (injects full skill context)"
echo "  [PreCompact]          kg prime (restores KG context after compaction)"
echo "  [SessionEnd]          kg-session-end-cleanup.sh"
echo "  [Stop]                kg-learning-capture-check.sh"
echo ""
echo "Restart Claude Code to activate hooks."
