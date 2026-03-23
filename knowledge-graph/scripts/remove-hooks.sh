#!/bin/bash
# remove-hooks.sh — Remove KG domain-knowledge enforcement hooks
# Restores original hooks and cleans up settings.local.json
#
# This is the reverse of setup-hooks.sh. It:
# 1. Removes 6 new hook scripts from .claude/hooks/
# 2. Restores 2 existing hooks to their original version (without $MARKER_DIR)
# 3. Removes KG hook registrations from settings.local.json
# 4. Reverts hook paths from .claude/hooks/kg-* to ./hooks/kg-*
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${GREEN}==>${NC} ${BOLD}$1${NC}"; }
warn()  { echo -e "${YELLOW}WARNING:${NC} $1"; }
error() { echo -e "${RED}ERROR:${NC} $1"; exit 1; }

command -v jq &>/dev/null || error "jq is required. Install: brew install jq"

HOOKS_DIR="$PWD/.claude/hooks"
SETTINGS_FILE="$PWD/.claude/settings.local.json"

[ -d "$PWD/.claude" ] || error "No .claude/ directory found in $PWD. Run from the project root."

# ─── Step 1: Remove 6 new hook scripts ─────────────────────────────────────────

NEW_HOOKS=(
  "kg-source-category-check.sh"
  "kg-require-validate-evidence.sh"
  "kg-session-query-reminder.sh"
  "kg-session-start.sh"
  "kg-learning-capture-check.sh"
  "kg-activity-tracker.sh"
  "kg-track-code-edits.sh"
  "kg-mark-tool-used.sh"
  "kg-audit-log.sh"
  "kg-tool-failure.sh"
  "kg-session-end-cleanup.sh"
  "kg-require-consult-before-edit.sh"
  "kg-mark-consulted.sh"
  "kg-mark-consulted-bash.sh"
)

info "Removing new hook scripts..."
removed_count=0
for hook in "${NEW_HOOKS[@]}"; do
  hook_path="$HOOKS_DIR/$hook"
  if [ -f "$hook_path" ]; then
    rm "$hook_path"
    echo "  Removed: $hook"
    ((removed_count++))
  else
    echo "  Skipped (not found): $hook"
  fi
done
echo "  $removed_count hook script(s) removed."

# ─── Step 2: Restore 2 existing hooks to original version ──────────────────────

info "Restoring original hook scripts..."

cat > "$HOOKS_DIR/kg-require-domain-check.sh" << 'HOOK_EOF'
#!/bin/bash
# PreToolUse hook for knowledge_store
# Blocks store if knowledge_list was not called first in this session.
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
MARKER="/tmp/kg-domains-checked-${SESSION_ID}"

if [ -f "$MARKER" ]; then
  exit 0
fi

echo "BLOCKED: Call knowledge_list first to check existing domains before storing." >&2
echo "This prevents domain fragmentation (e.g., 'di' vs 'dependency-injection')." >&2
echo "Run knowledge_list, scan the returned domains, reuse a matching one, then retry." >&2
exit 2
HOOK_EOF
chmod +x "$HOOKS_DIR/kg-require-domain-check.sh"
echo "  Restored: kg-require-domain-check.sh"

cat > "$HOOKS_DIR/kg-mark-domains-checked.sh" << 'HOOK_EOF'
#!/bin/bash
# PostToolUse hook for knowledge_list
# Marks that domain reuse check was performed in this session.
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
touch "/tmp/kg-domains-checked-${SESSION_ID}"
exit 0
HOOK_EOF
chmod +x "$HOOKS_DIR/kg-mark-domains-checked.sh"
echo "  Restored: kg-mark-domains-checked.sh"

# ─── Step 3: Clean up settings.local.json ───────────────────────────────────────

if [ ! -f "$SETTINGS_FILE" ]; then
  warn "settings.local.json not found at $SETTINGS_FILE — skipping settings cleanup."
  info "Done."
  exit 0
fi

# Backup settings file
BACKUP_FILE="${SETTINGS_FILE}.bak.$(date +%s)"
cp "$SETTINGS_FILE" "$BACKUP_FILE"
info "Backed up settings to: $(basename "$BACKUP_FILE")"

SETTINGS=$(cat "$SETTINGS_FILE")

# Helper: remove a specific hook command from entries under a given event
remove_hook_command() {
  local event="$1" command="$2"
  SETTINGS=$(echo "$SETTINGS" | jq \
    --arg event "$event" \
    --arg cmd "$command" '
    if .hooks[$event] then
      .hooks[$event] |= map(
        .hooks |= map(select(.command != $cmd))
      ) |
      # Remove entries with empty hooks arrays
      .hooks[$event] |= map(select(.hooks | length > 0))
    else . end
  ')
}

# Helper: remove an entire entry matching a specific matcher under a given event
remove_matcher_entry() {
  local event="$1" matcher="$2"
  SETTINGS=$(echo "$SETTINGS" | jq \
    --arg event "$event" \
    --arg matcher "$matcher" '
    if .hooks[$event] then
      .hooks[$event] |= map(select(.matcher != $matcher))
    else . end
  ')
}

info "Cleaning settings.local.json..."

# Remove new hook commands from PreToolUse entries (for knowledge_store matcher)
remove_hook_command "PreToolUse" ".claude/hooks/kg-source-category-check.sh"
remove_hook_command "PreToolUse" ".claude/hooks/kg-require-validate-evidence.sh"
echo "  Removed kg-source-category-check.sh from PreToolUse"
echo "  Removed kg-require-validate-evidence.sh from PreToolUse"

# Remove entire PreToolUse entry for knowledge_evolve matcher
remove_matcher_entry "PreToolUse" "mcp__knowledge-graph__knowledge_evolve"
echo "  Removed PreToolUse entry for knowledge_evolve"

# Remove entire PreToolUse entry for knowledge_validate matcher
remove_matcher_entry "PreToolUse" "mcp__knowledge-graph__knowledge_validate"
echo "  Removed PreToolUse entry for knowledge_validate"

# Remove new hook commands from PostToolUse entries
remove_hook_command "PostToolUse" ".claude/hooks/kg-activity-tracker.sh"
remove_hook_command "PostToolUse" ".claude/hooks/kg-track-code-edits.sh"
remove_hook_command "PostToolUse" ".claude/hooks/kg-audit-log.sh"
remove_hook_command "PostToolUse" ".claude/hooks/kg-mark-tool-used.sh"
echo "  Removed kg-activity-tracker.sh from PostToolUse"
echo "  Removed kg-track-code-edits.sh from PostToolUse"
echo "  Removed kg-audit-log.sh from PostToolUse (legacy)"
echo "  Removed kg-mark-tool-used.sh from PostToolUse"

# Remove consultation gate from PreToolUse
remove_hook_command "PreToolUse" ".claude/hooks/kg-require-consult-before-edit.sh"
echo "  Removed kg-require-consult-before-edit.sh from PreToolUse"

# Remove consulted markers from PostToolUse
remove_hook_command "PostToolUse" ".claude/hooks/kg-mark-consulted.sh"
echo "  Removed kg-mark-consulted.sh from PostToolUse"

remove_hook_command "PostToolUse" ".claude/hooks/kg-mark-consulted-bash.sh"
echo "  Removed kg-mark-consulted-bash.sh from PostToolUse"

# Remove activity tracker from PostToolUseFailure (broad matcher)
remove_hook_command "PostToolUseFailure" ".claude/hooks/kg-activity-tracker.sh"
echo "  Removed kg-activity-tracker.sh from PostToolUseFailure"

# Remove kg context from UserPromptSubmit
remove_hook_command "UserPromptSubmit" "kg context"
echo "  Removed kg context from UserPromptSubmit"

# Remove kg-session-query-reminder.sh from UserPromptSubmit (legacy)
remove_hook_command "UserPromptSubmit" ".claude/hooks/kg-session-query-reminder.sh"
echo "  Removed kg-session-query-reminder.sh from UserPromptSubmit (legacy)"

# Remove entire PostToolUseFailure entry for knowledge-graph matcher
remove_matcher_entry "PostToolUseFailure" "mcp__knowledge-graph__.*"
echo "  Removed PostToolUseFailure entry for knowledge-graph"

# Remove kg prime and legacy kg-session-start.sh from SessionStart
remove_hook_command "SessionStart" "kg prime"
remove_hook_command "SessionStart" ".claude/hooks/kg-session-start.sh"
echo "  Removed kg prime from SessionStart"
echo "  Removed kg-session-start.sh from SessionStart (legacy)"

# Remove kg prime from PreCompact
remove_hook_command "PreCompact" "kg prime"
echo "  Removed kg prime from PreCompact"

# Remove kg-session-end-cleanup.sh from SessionEnd
remove_hook_command "SessionEnd" ".claude/hooks/kg-session-end-cleanup.sh"
echo "  Removed kg-session-end-cleanup.sh from SessionEnd"

# Remove kg-learning-capture-check.sh from Stop
remove_hook_command "Stop" ".claude/hooks/kg-learning-capture-check.sh"
echo "  Removed kg-learning-capture-check.sh from Stop"

# Revert hook paths: .claude/hooks/kg-* -> ./hooks/kg-* for the 3 original hooks
SETTINGS=$(echo "$SETTINGS" | jq '
  def revert_path:
    if type == "string" and startswith(".claude/hooks/kg-") then
      "./hooks/kg-" + ltrimstr(".claude/hooks/kg-")
    else . end;

  if .hooks then
    .hooks |= with_entries(
      .value |= map(
        .hooks |= map(
          .command |= revert_path
        )
      )
    )
  else . end
')
echo "  Reverted hook paths: .claude/hooks/kg-* -> ./hooks/kg-*"

# Remove empty event arrays (cosmetic cleanup)
SETTINGS=$(echo "$SETTINGS" | jq '
  if .hooks then
    .hooks |= with_entries(select(.value | length > 0))
  else . end
')

# Write cleaned settings back
echo "$SETTINGS" | jq '.' > "$SETTINGS_FILE"

info "Settings cleanup complete."

# ─── Summary ────────────────────────────────────────────────────────────────────

echo ""
info "Removal complete."
echo "  - Removed $removed_count new hook scripts from .claude/hooks/"
echo "  - Restored kg-require-domain-check.sh (original, /tmp markers)"
echo "  - Restored kg-mark-domains-checked.sh (original, /tmp markers)"
echo "  - Cleaned KG registrations from settings.local.json"
echo "  - Reverted hook paths to ./hooks/kg-* prefix"
echo "  - Backup: $(basename "$BACKUP_FILE")"
echo ""
echo "  Remaining hooks in .claude/hooks/:"
ls -1 "$HOOKS_DIR" 2>/dev/null | sed 's/^/    /' || echo "    (none)"
