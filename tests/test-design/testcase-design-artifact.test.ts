import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadTestcaseDesignCase, writeTestcaseDesignArtifact } from "../../src/test-design/testcase-design-artifact.js";

test("writes a versioned QA handoff and loads one exact testcase with its matching assertion", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa-design-artifact-"));
  try {
    const testCase = {
      id: "TC-1", version: "1.0.0", status: "draft" as const, purpose: "Sign in", traceability: ["AC-1"],
      preconditions: [], workspace_scope: "workspace-1", steps: [{ action: "navigate", input: { url: "https://example.test" } }],
      expected_results: [{ assertion: "Welcome appears", authority: "AC-1" }], owner: "QA",
    };
    const written = await writeTestcaseDesignArtifact({
      output_dir: join(root, ".qa-testcases", "op-1"), workspace_id: "workspace-1", requirement_ref: "REQ-1@1.0.0",
      generated_at: "2026-08-12T00:00:00.000Z", test_cases: [testCase],
      generated_assertions: [{ test_case_id: "TC-1", expected_text: "Welcome" }], findings: [],
    });
    assert.equal(written.ok, true, JSON.stringify(written));
    if (!written.ok) return;

    const loaded = await loadTestcaseDesignCase({
      artifact_path: written.path, allowed_root: root, workspace_id: "workspace-1", test_case_id: "TC-1",
    });
    assert.equal(loaded.ok, true, JSON.stringify(loaded));
    if (!loaded.ok) return;
    assert.equal(loaded.test_case.id, "TC-1");
    assert.equal(loaded.generated_assertion.expected_text, "Welcome");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when a testcase design artifact is modified after QA handoff", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa-design-tamper-"));
  try {
    const written = await writeTestcaseDesignArtifact({
      output_dir: root, workspace_id: "workspace-1", requirement_ref: "REQ-1@1.0.0", generated_at: "2026-08-12T00:00:00.000Z",
      test_cases: [{ id: "TC-1", version: "1.0.0", status: "draft", purpose: "Original", traceability: ["AC-1"], preconditions: [], workspace_scope: "workspace-1", steps: [], expected_results: [{ assertion: "x", authority: "AC-1" }], owner: "QA" }],
      generated_assertions: [{ test_case_id: "TC-1", expected_text: "x" }], findings: [],
    });
    assert.equal(written.ok, true);
    if (!written.ok) return;
    const raw = await readFile(written.path, "utf8");
    await writeFile(written.path, raw.replace("Original", "Modified"), "utf8");

    const loaded = await loadTestcaseDesignCase({ artifact_path: written.path, allowed_root: root, workspace_id: "workspace-1", test_case_id: "TC-1" });
    assert.equal(loaded.ok, false);
    if (!loaded.ok) assert.match(loaded.message, /integrity verification failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when testcase_file resolves outside the configured artifact root", async () => {
  const allowedRoot = await mkdtemp(join(tmpdir(), "qa-design-allowed-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "qa-design-outside-"));
  try {
    const written = await writeTestcaseDesignArtifact({
      output_dir: outsideRoot, workspace_id: "workspace-1", requirement_ref: "REQ-1@1.0.0", generated_at: "2026-08-12T00:00:00.000Z",
      test_cases: [], generated_assertions: [], findings: [],
    });
    assert.equal(written.ok, true);
    if (!written.ok) return;
    const loaded = await loadTestcaseDesignCase({ artifact_path: written.path, allowed_root: allowedRoot, workspace_id: "workspace-1", test_case_id: "TC-1" });
    assert.equal(loaded.ok, false);
    if (!loaded.ok) assert.match(loaded.message, /must stay within/);
  } finally {
    await rm(allowedRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});
