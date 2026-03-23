#!/bin/bash
# Install knowledge-graph MCP server
#
# Usage:
#   bash install.sh                          # Install from local directory
#   curl -sSL <raw-url>/install.sh | bash    # Install from remote
#
# Environment:
#   KG_HOME   Install directory (default: ~/.knowledge-graph)

set -euo pipefail

KG_HOME="${KG_HOME:-$HOME/.knowledge-graph}"
REPO_URL="https://github.com/maxakak1998/flutter_tools.git"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${GREEN}==>${NC} ${BOLD}$1${NC}"; }
warn()  { echo -e "${YELLOW}WARNING:${NC} $1"; }
error() { echo -e "${RED}ERROR:${NC} $1"; exit 1; }

# ── Check prerequisites ──────────────────────────────────────

command -v node &>/dev/null || error "Node.js not found. Install from https://nodejs.org (>= 18 required)"

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 18 ]; then
  error "Node.js >= 18 required (found v$(node -v))"
fi

command -v npm &>/dev/null || error "npm not found. Install Node.js from https://nodejs.org"

info "Installing knowledge-graph to $KG_HOME"

# ── Create install directory ──────────────────────────────────

mkdir -p "$KG_HOME"

# ── Get source ────────────────────────────────────────────────

# Detect if running from within the source directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

if [ -f "$SCRIPT_DIR/package.json" ] && grep -q '"knowledge-graph-mcp"' "$SCRIPT_DIR/package.json" 2>/dev/null; then
  info "Installing from local source: $SCRIPT_DIR"
  if [ "$SCRIPT_DIR" != "$KG_HOME/src" ]; then
    rm -rf "$KG_HOME/src"
    # Copy source but exclude node_modules and dist (will be rebuilt)
    mkdir -p "$KG_HOME/src"
    rsync -a --exclude='node_modules' --exclude='dist' "$SCRIPT_DIR/" "$KG_HOME/src/"
  fi
else
  info "Cloning from $REPO_URL"
  if [ -d "$KG_HOME/src/.git" ]; then
    cd "$KG_HOME/src" && git pull
  else
    rm -rf "$KG_HOME/src"
    git clone "$REPO_URL" "$KG_HOME/src"
  fi
fi

# ── Install dependencies and build ───────────────────────────

cd "$KG_HOME/src"

info "Installing dependencies..."
npm install

info "Building TypeScript..."
npm run build

# ── Make CLI executable ───────────────────────────────────────

chmod +x "$KG_HOME/src/dist/cli.js"

# ── Copy scripts ─────────────────────────────────────────────

mkdir -p "$KG_HOME/scripts"
if [ -d "$KG_HOME/src/scripts" ]; then
  cp "$KG_HOME/src/scripts/setup-hooks.sh" "$KG_HOME/scripts/setup-hooks.sh"
  cp "$KG_HOME/src/scripts/remove-hooks.sh" "$KG_HOME/scripts/remove-hooks.sh"
  chmod +x "$KG_HOME/scripts/setup-hooks.sh" "$KG_HOME/scripts/remove-hooks.sh"
  info "Copied hook scripts to $KG_HOME/scripts/"
fi

# ── Copy skills ──────────────────────────────────────────────

if [ -d "$KG_HOME/src/skills" ]; then
  rm -rf "$KG_HOME/skills"
  mkdir -p "$KG_HOME/skills"
  cp -r "$KG_HOME/src/skills/"* "$KG_HOME/skills/"
  info "Copied KG skills to $KG_HOME/skills/"
fi

# ── Create symlink in PATH ────────────────────────────────────

LINK_TARGET="$KG_HOME/src/dist/cli.js"

if [ -w /usr/local/bin ]; then
  ln -sf "$LINK_TARGET" /usr/local/bin/knowledge-graph
  ln -sf "$LINK_TARGET" /usr/local/bin/kg
  info "Symlinked to /usr/local/bin/knowledge-graph (alias: kg)"
else
  mkdir -p "$HOME/.local/bin"
  ln -sf "$LINK_TARGET" "$HOME/.local/bin/knowledge-graph"
  ln -sf "$LINK_TARGET" "$HOME/.local/bin/kg"
  info "Symlinked to ~/.local/bin/knowledge-graph (alias: kg)"

  # Check if ~/.local/bin is in PATH
  if ! echo "$PATH" | tr ':' '\n' | grep -q "$HOME/.local/bin"; then
    warn "~/.local/bin is not in your PATH. Add it:"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo "  # Add to ~/.bashrc or ~/.zshrc to make permanent"
  fi
fi

# ── Check Ollama ──────────────────────────────────────────────

if command -v ollama &>/dev/null; then
  info "Ollama found. Pulling bge-m3 model..."
  ollama pull bge-m3 || warn "Failed to pull bge-m3. Run 'ollama pull bge-m3' manually."
else
  warn "Ollama not found. Install from https://ollama.ai"
  echo "  After installing: ollama pull bge-m3"
fi

# ── Setup MCP config ──────────────────────────────────────────

info "Configuring Claude Code MCP server..."
node "$KG_HOME/src/dist/cli.js" setup || warn "Auto-setup failed. Run 'knowledge-graph setup' manually."

# ── Done ──────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}Installation complete!${NC}"
echo ""
echo "  Next steps:"
echo "    1. cd into your project and run: kg init"
echo "    2. Verify:    kg doctor"
echo "    3. Restart Claude Code to pick up the MCP server"
echo ""
echo "  Each project gets its own .knowledge-graph/ directory (like .git/)."
echo "  Multiple Claude sessions can connect to the same project simultaneously."
echo ""
