import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { bootstrapDomainPack } from "../../src/domain-pack/bootstrap-domain-pack.js";

test("bootstrapDomainPack creates pack from templates", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa-domain-pack-"));
  try {
    const result = bootstrapDomainPack({
      product_root: root,
      request_context: "Test https://app.example/pay admin role billing refund",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.created, true);
    assert.ok(result.updated_files.includes("INDEX.md"));
    const index = await readFile(join(root, "domain-knowledge", "INDEX.md"), "utf8");
    assert.match(index, /app\.example/);
    const money = await readFile(join(root, "domain-knowledge", "money-flows.md"), "utf8");
    assert.match(money, /Money-related wording/);
    const permissions = await readFile(join(root, "domain-knowledge", "permissions.md"), "utf8");
    assert.match(permissions, /roles\/auth/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bootstrapDomainPack rejects relative product_root", () => {
  const result = bootstrapDomainPack({ product_root: "relative/path" });
  assert.equal(result.ok, false);
});
