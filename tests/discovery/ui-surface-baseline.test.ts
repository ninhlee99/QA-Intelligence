import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  compareUiSurfaceToBaseline,
  registerUiSurfaceBaseline,
} from "../../src/discovery/ui-surface-baseline.js";
import type { SemanticUiElement } from "../../src/discovery/public.js";

const elementsA: readonly SemanticUiElement[] = [
  {
    id: "e1",
    kind: "field",
    accessible_name: "Username",
    accessible_role: "textbox",
    source_node_id: "n1",
    confidence: 1,
  },
  {
    id: "e2",
    kind: "action",
    accessible_name: "Sign in",
    accessible_role: "button",
    source_node_id: "n2",
    confidence: 1,
  },
];

const elementsB: readonly SemanticUiElement[] = [
  {
    id: "e1",
    kind: "field",
    accessible_name: "Username",
    accessible_role: "textbox",
    source_node_id: "n1",
    confidence: 1,
  },
  {
    id: "e3",
    kind: "action",
    accessible_name: "Cancel",
    accessible_role: "button",
    source_node_id: "n3",
    confidence: 1,
  },
];

test("register + compare surface baseline reports named-control drift", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "qa-surface-baseline-"));
  try {
    const registered = registerUiSurfaceBaseline({
      rootDir,
      workspace_id: "ws-1",
      baseline_id: "login",
      elements: elementsA,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    });
    assert.equal(registered.ok, true);

    const compared = compareUiSurfaceToBaseline({
      rootDir,
      workspace_id: "ws-1",
      baseline_id: "login",
      elements: elementsB,
      label: "live",
    });
    assert.equal(compared.ok, true);
    if (!compared.ok) return;
    assert.ok(compared.diff.only_in_a.some((k) => k.includes("Sign in")));
    assert.ok(compared.diff.only_in_b.some((k) => k.includes("Cancel")));
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("compare without register fails closed", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "qa-surface-baseline-miss-"));
  try {
    const compared = compareUiSurfaceToBaseline({
      rootDir,
      workspace_id: "ws-1",
      baseline_id: "missing",
      elements: elementsA,
    });
    assert.equal(compared.ok, false);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
