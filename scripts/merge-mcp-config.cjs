#!/usr/bin/env node
/**
 * Merge a qa-intelligence MCP server entry into a host config file without
 * clobbering the rest of the file. Used by install.sh for one-command setup.
 *
 * Usage: node merge-mcp-config.cjs <mode> <targetFile> <workspaceId>
 *   mode: json | claude-json | claude-plugin | yaml
 */
const fs = require("fs");
const path = require("path");

const [, , mode, targetFile, workspaceId] = process.argv;

if (!mode || !targetFile || !workspaceId) {
  console.error("Usage: merge-mcp-config.cjs <mode> <targetFile> <workspaceId>");
  process.exit(1);
}

const serverEntry = {
  command: "qa-intelligence-mcp",
  env: {
    QA_INTELLIGENCE_WORKSPACE_ID: workspaceId,
    QA_INTELLIGENCE_TOOL_PROFILE: "expert",
  },
};

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const backup = `${filePath}.bak-${Date.now()}`;
    fs.copyFileSync(filePath, backup);
    console.error(`Warning: ${filePath} was not valid JSON. Backed up to ${backup} and starting fresh.`);
    return {};
  }
}

function writeJson(filePath, data) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

switch (mode) {
  case "json": {
    // Generic { mcpServers: { ... } } file (Cursor, Antigravity).
    const data = readJsonSafe(targetFile);
    data.mcpServers = data.mcpServers || {};
    data.mcpServers["qa-intelligence"] = serverEntry;
    writeJson(targetFile, data);
    break;
  }
  case "claude-json": {
    // ~/.claude.json keeps many unrelated keys — only touch mcpServers.
    const data = readJsonSafe(targetFile);
    data.mcpServers = data.mcpServers || {};
    data.mcpServers["qa-intelligence"] = serverEntry;
    writeJson(targetFile, data);
    break;
  }
  case "claude-plugin": {
    // Plugin manifest ships its own mcpServers block already committed in
    // the repo; nothing to merge into the user's machine. No-op placeholder
    // kept so install.sh has one code path per host.
    break;
  }
  case "yaml": {
    let yaml;
    try {
      yaml = require("js-yaml");
    } catch {
      console.error("js-yaml not resolvable; run install.sh from the repo root.");
      process.exit(1);
    }
    let data = {};
    if (fs.existsSync(targetFile)) {
      const raw = fs.readFileSync(targetFile, "utf8");
      try {
        data = yaml.load(raw) || {};
      } catch {
        const backup = `${targetFile}.bak-${Date.now()}`;
        fs.copyFileSync(targetFile, backup);
        console.error(`Warning: ${targetFile} was not valid YAML. Backed up to ${backup} and starting fresh.`);
        data = {};
      }
    }
    data.mcpServers = data.mcpServers || {};
    data.mcpServers["qa-intelligence"] = serverEntry;
    ensureDir(targetFile);
    fs.writeFileSync(targetFile, yaml.dump(data), "utf8");
    break;
  }
  default:
    console.error(`Unknown mode: ${mode}`);
    process.exit(1);
}
