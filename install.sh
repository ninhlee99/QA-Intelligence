#!/usr/bin/env bash
# One-command install: build the MCP server once, then wire it into every
# coding-agent host detected on this machine (Claude Code, Cursor, Codex,
# Antigravity). Safe to re-run — existing host configs are merged, not
# clobbered, and nothing is overwritten without the qa-intelligence key.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

log() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$1"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$1"; }

# ---------------------------------------------------------------------------
# 0. Preflight
# ---------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js >=24 <25 required. Install via nvm: https://github.com/nvm-sh/nvm" >&2
  exit 1
fi
NODE_MAJOR="$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" != "24" ]; then
  warn "Node $NODE_MAJOR detected; this project requires Node 24 (.nvmrc). Continuing anyway."
fi

# workspace id: derived from the target project folder name, sanitized to
# match QA_INTELLIGENCE_WORKSPACE_ID's required pattern ^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$
TARGET_DIR="${1:-$PWD}"
RAW_NAME="$(basename "$TARGET_DIR")"
WORKSPACE_ID="$(node -e '
  const raw = process.argv[1];
  let id = raw.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^[^a-zA-Z0-9]+/, "");
  if (id.length < 3) id = ("qa-" + id).padEnd(3, "0");
  process.stdout.write(id.slice(0, 64));
' "$RAW_NAME")"

log "Repo: $REPO_ROOT"
log "Workspace id: $WORKSPACE_ID (override with QA_INTELLIGENCE_WORKSPACE_ID env var before running hosts)"

# ---------------------------------------------------------------------------
# 1. Build once — every host shares the same global binary
# ---------------------------------------------------------------------------
log "Installing dependencies (npm install)"
npm install --no-fund --no-audit

log "Installing Playwright Chromium"
npx playwright install chromium

log "Building"
npm run build

log "Linking qa-intelligence-mcp globally"
npm install --global . --no-fund --no-audit

if ! command -v qa-intelligence-mcp >/dev/null 2>&1; then
  warn "qa-intelligence-mcp not on PATH after global install. Check your npm global bin directory is on PATH."
else
  ok "qa-intelligence-mcp installed: $(command -v qa-intelligence-mcp)"
fi

# ---------------------------------------------------------------------------
# 2. Host detection + config wiring
# ---------------------------------------------------------------------------
MCP_JSON_MERGE="$REPO_ROOT/scripts/merge-mcp-config.cjs"

FOUND_ANY=0

# --- Claude Code: use the native plugin marketplace mechanism ---
if command -v claude >/dev/null 2>&1; then
  FOUND_ANY=1
  log "Claude Code CLI detected — installing plugin via marketplace"
  if claude plugin marketplace add "$REPO_ROOT" >/dev/null 2>&1; then
    :
  else
    warn "marketplace add reported an issue (may already be added) — continuing"
  fi
  if claude plugin install qa-intelligence >/dev/null 2>&1; then
    ok "Claude Code plugin installed"
  else
    warn "Claude Code plugin install reported an issue (may already be installed)"
  fi
  QA_INTELLIGENCE_WORKSPACE_ID="$WORKSPACE_ID" node "$MCP_JSON_MERGE" claude-plugin "$REPO_ROOT/hosts/claude-code/.claude-plugin/plugin.json" "$WORKSPACE_ID" || true
elif [ -d "$HOME/.claude" ] || [ -f "$HOME/.claude.json" ]; then
  FOUND_ANY=1
  log "Claude Code config detected (no CLI on PATH) — writing MCP entry to ~/.claude.json"
  node "$MCP_JSON_MERGE" claude-json "$HOME/.claude.json" "$WORKSPACE_ID"
  ok "Wrote qa-intelligence MCP entry to ~/.claude.json"
fi

# --- Cursor ---
if [ -d "$HOME/.cursor" ]; then
  FOUND_ANY=1
  log "Cursor detected — writing MCP entry to ~/.cursor/mcp.json"
  node "$MCP_JSON_MERGE" json "$HOME/.cursor/mcp.json" "$WORKSPACE_ID"
  ok "Cursor MCP config updated. Restart Cursor and copy hosts/cursor/skills/ if you want the Skills too."
fi

# --- Codex ---
if [ -d "$HOME/.codex" ]; then
  FOUND_ANY=1
  log "Codex detected — writing MCP entry to ~/.codex/config.yaml"
  node "$MCP_JSON_MERGE" yaml "$HOME/.codex/config.yaml" "$WORKSPACE_ID"
  ok "Codex MCP config updated."
fi

# --- Antigravity ---
if [ -d "$TARGET_DIR/.agents" ]; then
  FOUND_ANY=1
  log "Antigravity workspace detected — writing MCP entry to $TARGET_DIR/.agents/mcp_config.json"
  node "$MCP_JSON_MERGE" json "$TARGET_DIR/.agents/mcp_config.json" "$WORKSPACE_ID"
  ok "Antigravity MCP config updated."
fi

if [ "$FOUND_ANY" = 0 ]; then
  warn "No host config directory found (~/.claude, ~/.cursor, ~/.codex, .agents/)."
  warn "Manual setup: see docs/GUIDE.md section 5."
fi

echo
ok "Install complete. Workspace: $WORKSPACE_ID"
echo "Next: open your host and run  /qa-intelligence:test <url>  (or ask the agent to use the QA Intelligence 'test' skill)."
