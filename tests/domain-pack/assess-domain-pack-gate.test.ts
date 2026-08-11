import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assessDomainPackGate } from "../../src/domain-pack/assess-domain-pack-gate.js";
import { defaultDomainPackTemplateRoot } from "../../src/domain-pack/bootstrap-domain-pack.js";

test("stock template pack is high_risk_unconfirmed", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa-pack-gate-"));
  try {
    const pack = join(root, "domain-knowledge");
    await mkdir(pack, { recursive: true });
    await cp(defaultDomainPackTemplateRoot(), pack, { recursive: true });
    const gate = assessDomainPackGate({ product_root: root });
    assert.equal(gate.present, true);
    assert.equal(gate.high_risk_unconfirmed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("filled pack without stubs can clear high risk", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa-pack-clear-"));
  try {
    const pack = join(root, "domain-knowledge");
    await mkdir(pack, { recursive: true });
    await writeFile(
      join(pack, "INDEX.md"),
      "# INDEX\n\n| Domain | Status |\n| business | confirmed |\n",
      "utf8",
    );
    await writeFile(join(pack, "business.md"), "# Business\nConfirmed rules.\n", "utf8");
    const gate = assessDomainPackGate({ product_root: root });
    assert.equal(gate.present, true);
    assert.equal(gate.high_risk_unconfirmed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
