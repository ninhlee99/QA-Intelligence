import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const text = (path) => readFile(new URL(path, root), "utf8");

const pkg = await json("package.json");
assert.equal(pkg.private, false, "package must be publishable");
assert.equal(pkg.bin?.["qa-intelligence-mcp"], "./dist/src/mcp/stdio-entrypoint.js");

const codex = await json("hosts/codex/.codex-plugin/plugin.json");
assert.equal(codex.version, pkg.version, "Codex plugin and package versions must match");
assert.equal(codex.mcpServers, "./.mcp.json");

const productionConfigs = [
  "hosts/codex/.mcp.json",
  "hosts/claude-code/.claude-plugin/plugin.json",
  "hosts/cursor/mcp.json.example",
  "hosts/antigravity/mcp_config.json.example",
];
for (const path of productionConfigs) {
  const content = await text(path);
  assert.match(content, /qa-intelligence-mcp/, `${path} must use the production command`);
  assert.doesNotMatch(content, /QA_INTELLIGENCE_DEV_|dev-entrypoint|\/Users\//, `${path} contains development or machine-local config`);
}

const skillNames = (await readdir(new URL("hosts/codex/skills/", root), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
for (const host of ["codex", "claude-code", "cursor"]) {
  const actual = (await readdir(new URL(`hosts/${host}/skills/`, root), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actual, skillNames, `${host} skill catalog drifted`);
  for (const skill of actual) {
    const content = await text(`hosts/${host}/skills/${skill}/SKILL.md`);
    assert.match(content, /^---\nname: [a-z0-9-]+\ndescription:/, `${host}/${skill} has invalid frontmatter`);
  }
}

process.stdout.write(`distribution valid: ${pkg.name}@${pkg.version}, ${skillNames.length} skills, 4 hosts\n`);
