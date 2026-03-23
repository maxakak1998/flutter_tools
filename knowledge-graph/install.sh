#!/bin/bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  Knowledge-Graph MCP Server — Installer                     ║
# ║                                                              ║
# ║  Steps:                                                      ║
# ║    1. Check prerequisites (Node.js >= 18, npm)               ║
# ║    2. Get source (local copy or git clone)                   ║
# ║    3. Install npm dependencies & build TypeScript            ║
# ║    4. Copy hook scripts to ~/.knowledge-graph/scripts/       ║
# ║    5. Copy skill definitions to ~/.knowledge-graph/skills/   ║
# ║    6. Create CLI symlinks (kg, knowledge-graph)              ║
# ║    7. Install Ollama (if missing) & pull bge-m3 model        ║
# ║    8. Configure Claude Code MCP server                       ║
# ╚══════════════════════════════════════════════════════════════╝
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

# ── Step 1: Check prerequisites ─────────────────────────────────
# Require Node.js >= 18 and npm (needed for building TypeScript)

info "Step 1/8: Checking prerequisites..."

command -v node &>/dev/null || error "Node.js not found. Install from https://nodejs.org (>= 18 required)"

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 18 ]; then
  error "Node.js >= 18 required (found v$(node -v))"
fi

command -v npm &>/dev/null || error "npm not found. Install Node.js from https://nodejs.org"

info "Installing knowledge-graph to $KG_HOME"
mkdir -p "$KG_HOME"

# ── Step 2: Get source ──────────────────────────────────────────
# Local: rsync from current dir (excludes node_modules, dist)
# Remote: git clone or git pull from REPO_URL

info "Step 2/8: Getting source..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

if [ -f "$SCRIPT_DIR/package.json" ] && grep -q '"knowledge-graph-mcp"' "$SCRIPT_DIR/package.json" 2>/dev/null; then
  info "Installing from local source: $SCRIPT_DIR"
  if [ "$SCRIPT_DIR" != "$KG_HOME/src" ]; then
    rm -rf "$KG_HOME/src"
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

# ── Step 3: Install dependencies & build ─────────────────────────
# npm install → TypeScript compile → copy dashboard HTML

info "Step 3/8: Installing dependencies & building..."

cd "$KG_HOME/src"

npm install
npm run build

chmod +x "$KG_HOME/src/dist/cli.js"

# ── Step 4: Copy hook scripts ────────────────────────────────────
# setup-hooks.sh and remove-hooks.sh → ~/.knowledge-graph/scripts/
# These are run by `kg setup-hooks` in target projects

info "Step 4/8: Copying hook scripts..."

mkdir -p "$KG_HOME/scripts"
if [ -d "$KG_HOME/src/scripts" ]; then
  cp "$KG_HOME/src/scripts/setup-hooks.sh" "$KG_HOME/scripts/setup-hooks.sh"
  cp "$KG_HOME/src/scripts/remove-hooks.sh" "$KG_HOME/scripts/remove-hooks.sh"
  chmod +x "$KG_HOME/scripts/setup-hooks.sh" "$KG_HOME/scripts/remove-hooks.sh"
  info "Copied to $KG_HOME/scripts/"
fi

# ── Step 5: Copy skill definitions ──────────────────────────────
# skills/ (project source) → ~/.knowledge-graph/skills/ (runtime)
# Then `kg setup-skills` copies to target project's .claude/skills/

info "Step 5/8: Copying skill definitions..."

if [ -d "$KG_HOME/src/skills" ]; then
  rm -rf "$KG_HOME/skills"
  mkdir -p "$KG_HOME/skills"
  cp -r "$KG_HOME/src/skills/"* "$KG_HOME/skills/"
  info "Copied to $KG_HOME/skills/"
fi

# ── Step 6: Create CLI symlinks ──────────────────────────────────
# Symlink dist/cli.js → /usr/local/bin/kg (or ~/.local/bin/kg)
# Creates both `knowledge-graph` and `kg` aliases

info "Step 6/8: Creating CLI symlinks..."

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

  if ! echo "$PATH" | tr ':' '\n' | grep -q "$HOME/.local/bin"; then
    warn "~/.local/bin is not in your PATH. Add it:"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo "  # Add to ~/.bashrc or ~/.zshrc to make permanent"
  fi
fi

# ── Step 7: Install Ollama & pull embedding model ────────────────
# 7a. Install Ollama if not found (brew cask on macOS, curl on Linux)
# 7b. Start Ollama server if not running (wait up to 15s)
# 7c. Pull bge-m3 embedding model (1024 dimensions, used for vector search)

info "Step 7/8: Setting up Ollama & bge-m3 model..."

# 7a. Install Ollama
if ! command -v ollama &>/dev/null; then
  info "Ollama not found. Installing..."
  if [ "$(uname)" = "Darwin" ]; then
    if command -v brew &>/dev/null; then
      brew install --cask ollama || error "Failed to install Ollama via Homebrew"
    else
      curl -fsSL https://ollama.com/install.sh | sh || error "Failed to install Ollama"
    fi
  else
    curl -fsSL https://ollama.com/install.sh | sh || error "Failed to install Ollama"
  fi
  info "Ollama installed"
else
  info "Ollama found: $(ollama --version 2>/dev/null || echo 'unknown version')"
fi

# 7b. Start Ollama server if not running
if ! curl -sf http://localhost:11434/api/tags &>/dev/null; then
  info "Starting Ollama server..."
  if [ "$(uname)" = "Darwin" ]; then
    open -a Ollama 2>/dev/null || ollama serve &>/dev/null &
  else
    ollama serve &>/dev/null &
  fi
  for i in $(seq 1 15); do
    curl -sf http://localhost:11434/api/tags &>/dev/null && break
    sleep 1
  done
  curl -sf http://localhost:11434/api/tags &>/dev/null || warn "Ollama not responding after 15s. Run 'ollama serve' manually."
else
  info "Ollama server already running"
fi

# 7c. Pull bge-m3 embedding model
info "Pulling bge-m3 model..."
ollama pull bge-m3 || warn "Failed to pull bge-m3. Run 'ollama pull bge-m3' manually."

# ── Step 8: Configure Claude Code MCP server ─────────────────────
# Writes knowledge.json config and prints MCP registration instructions

info "Step 8/8: Configuring Claude Code MCP server..."

node "$KG_HOME/src/dist/cli.js" setup || warn "Auto-setup failed. Run 'knowledge-graph setup' manually."

# ── Done ─────────────────────────────────────────────────────────

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
