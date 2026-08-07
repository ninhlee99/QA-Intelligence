import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

import { simpleGit } from "simple-git";

import { GitPlugin } from "../../../src/adapters/git/git-plugin.js";
import type { InitializeRequest, InvokeRequest, PluginDescriptor } from "../../../src/plugins/public.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../../src/requirement-review/public.js";
import { runPluginContract } from "../../plugins/plugin-contract.js";

class AllowingAuthorizer implements WorkspaceAuthorizer {
  async authorize(request: WorkspaceAuthorizationRequest) {
    return {
      ok: true as const,
      value: {
        policy_version: request.context.policy_version,
        effective_permissions: [...request.required_permissions],
        authorized_resource_refs: [...request.resource_refs],
        decision_evidence: ["authorization:allow"],
      },
    };
  }
}

function workspaceContext(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-git-001",
    actor_id: "actor-git-001",
    actor_type: "service",
    roles: ["git-operator"],
    permissions: ["git:read"],
    policy_version: "policy@1.0.0",
    request_id: "request-git-001",
    correlation_id: "correlation-git-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-06T08:00:00.000Z",
    expires_at: "2026-08-06T10:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

function descriptor(): PluginDescriptor {
  return {
    id: "git-plugin",
    version: "0.1.0",
    status: "enabled",
    interfaces: ["SPEC-503", "SPEC-409"],
    capabilities: [
      "repository_metadata",
      "read_file_at_revision",
      "search_paths",
      "diff",
      "history",
      "changed_files",
      "verify_integrity",
    ],
    permissions: ["git:read"],
    configuration_schema: "schemas/plugin.schema.json",
    supported_environments: ["test"],
    compatibility: [],
    owner: "Platform Engineering",
    integrity: { algorithm: "sha256", digest: "0".repeat(64) },
  };
}

let repositoryRoot: string;
let firstRevision: string;
let secondRevision: string;

before(async () => {
  repositoryRoot = await mkdtemp(join(tmpdir(), "qa-intelligence-git-plugin-"));
  const git = simpleGit(repositoryRoot);
  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test");

  await writeFile(join(repositoryRoot, "README.md"), "# hello\n");
  await git.add(["README.md"]);
  await git.commit("initial commit");
  firstRevision = (await git.revparse(["HEAD"])).trim();

  await writeFile(join(repositoryRoot, "README.md"), "# hello world\n");
  await git.add(["README.md"]);
  await git.commit("update readme");
  secondRevision = (await git.revparse(["HEAD"])).trim();
});

after(async () => {
  await rm(repositoryRoot, { recursive: true, force: true });
});

function makePlugin(): GitPlugin {
  return new GitPlugin({
    clock: { now: () => new Date("2026-08-06T08:30:00.000Z") },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "git-plugin", version: "0.1.0" },
    descriptor: descriptor(),
    limits: { max_history_entries: 50, max_file_bytes: 1_000_000 },
  });
}

function initializeRequestFor(operationId: string): InitializeRequest {
  return {
    operation: "initialize",
    operationId,
    workspace: workspaceContext(),
    idempotency: { key: `init:${operationId}`, scope: "initialize", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { configuration: { repository_root: repositoryRoot }, secret_refs: [] },
  };
}

function invokeRequestFor(instanceRef: string, operationId: string, outcome: "success" | "failure"): InvokeRequest {
  return {
    operation: "invoke",
    operationId,
    workspace: workspaceContext(),
    idempotency: { key: `invoke:${operationId}`, scope: "invoke", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload:
      outcome === "success"
        ? { instance_ref: instanceRef, capability: "repository_metadata", input: {} }
        : {
            instance_ref: instanceRef,
            capability: "verify_integrity",
            input: { path: "README.md", revision: "HEAD", expected_digest: "sha256:wrong" },
          },
  };
}

runPluginContract("git-plugin", {
  makePlugin: () => makePlugin(),
  workspaceContext,
  initializeRequestFor,
  invokeRequestFor,
});

test("read_file_at_revision returns exact-revision content and a matching integrity digest", async () => {
  const plugin = makePlugin();
  const initialized = await plugin.initialize(initializeRequestFor("op-init-read"));
  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  if (!initialized.ok) return;

  const result = await plugin.invoke({
    operation: "invoke",
    operationId: "op-read-file",
    workspace: workspaceContext(),
    idempotency: { key: "read-file-1", scope: "invoke", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { instance_ref: initialized.value.instance_ref, capability: "read_file_at_revision", input: { path: "README.md", revision: firstRevision } },
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "success");
  assert.equal(result.value.output["content"], "# hello\n");
  assert.ok(typeof result.value.output["integrity_digest"] === "string");
});

test("path traversal is rejected before reaching simple-git (SPEC-409 §4)", async () => {
  const plugin = makePlugin();
  const initialized = await plugin.initialize(initializeRequestFor("op-init-traversal"));
  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  if (!initialized.ok) return;

  const result = await plugin.invoke({
    operation: "invoke",
    operationId: "op-traversal",
    workspace: workspaceContext(),
    idempotency: { key: "traversal-1", scope: "invoke", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { instance_ref: initialized.value.instance_ref, capability: "read_file_at_revision", input: { path: "../../etc/passwd", revision: "HEAD" } },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "invalid_request");
});

test("an absolute path is rejected before reaching simple-git (SPEC-409 §4)", async () => {
  const plugin = makePlugin();
  const initialized = await plugin.initialize(initializeRequestFor("op-init-absolute"));
  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  if (!initialized.ok) return;

  const result = await plugin.invoke({
    operation: "invoke",
    operationId: "op-absolute",
    workspace: workspaceContext(),
    idempotency: { key: "absolute-1", scope: "invoke", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { instance_ref: initialized.value.instance_ref, capability: "read_file_at_revision", input: { path: "/etc/passwd", revision: "HEAD" } },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "invalid_request");
});

test("an unknown revision fails closed with a distinct failure code, not a thrown exception", async () => {
  const plugin = makePlugin();
  const initialized = await plugin.initialize(initializeRequestFor("op-init-unknown-rev"));
  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  if (!initialized.ok) return;

  const result = await plugin.invoke({
    operation: "invoke",
    operationId: "op-unknown-rev",
    workspace: workspaceContext(),
    idempotency: { key: "unknown-rev-1", scope: "invoke", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { instance_ref: initialized.value.instance_ref, capability: "read_file_at_revision", input: { path: "README.md", revision: "0".repeat(40) } },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "invalid_request");
});

test("history is bounded by the configured max_history_entries limit", async () => {
  const plugin = new GitPlugin({
    clock: { now: () => new Date("2026-08-06T08:30:00.000Z") },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "git-plugin", version: "0.1.0" },
    descriptor: descriptor(),
    limits: { max_history_entries: 1, max_file_bytes: 1_000_000 },
  });
  const initialized = await plugin.initialize(initializeRequestFor("op-init-history"));
  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  if (!initialized.ok) return;

  const result = await plugin.invoke({
    operation: "invoke",
    operationId: "op-history",
    workspace: workspaceContext(),
    idempotency: { key: "history-1", scope: "invoke", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { instance_ref: initialized.value.instance_ref, capability: "history", input: {} },
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const entries = result.value.output["entries"] as readonly unknown[];
  assert.equal(entries.length, 1);
});

test("changed_files reports the modified path between two revisions", async () => {
  const plugin = makePlugin();
  const initialized = await plugin.initialize(initializeRequestFor("op-init-changed"));
  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  if (!initialized.ok) return;

  const result = await plugin.invoke({
    operation: "invoke",
    operationId: "op-changed",
    workspace: workspaceContext(),
    idempotency: { key: "changed-1", scope: "invoke", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { instance_ref: initialized.value.instance_ref, capability: "changed_files", input: { from_revision: firstRevision, to_revision: secondRevision } },
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const files = result.value.output["files"] as ReadonlyArray<{ status: string; path: string }>;
  assert.ok(files.some((file) => file.path === "README.md"));
});

test("verify_integrity confirms a matching digest and reports mismatch for a wrong one", async () => {
  const plugin = makePlugin();
  const initialized = await plugin.initialize(initializeRequestFor("op-init-verify"));
  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  if (!initialized.ok) return;

  const readResult = await plugin.invoke({
    operation: "invoke",
    operationId: "op-verify-read",
    workspace: workspaceContext(),
    idempotency: { key: "verify-read-1", scope: "invoke", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { instance_ref: initialized.value.instance_ref, capability: "read_file_at_revision", input: { path: "README.md", revision: firstRevision } },
  });
  assert.equal(readResult.ok, true, JSON.stringify(readResult));
  if (!readResult.ok) return;
  const expectedDigest = readResult.value.output["integrity_digest"] as string;

  const verified = await plugin.invoke({
    operation: "invoke",
    operationId: "op-verify",
    workspace: workspaceContext(),
    idempotency: { key: "verify-1", scope: "invoke", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { instance_ref: initialized.value.instance_ref, capability: "verify_integrity", input: { path: "README.md", revision: firstRevision, expected_digest: expectedDigest } },
  });
  assert.equal(verified.ok, true, JSON.stringify(verified));
  if (!verified.ok) return;
  assert.equal(verified.value.outcome, "success");

  const mismatched = await plugin.invoke({
    operation: "invoke",
    operationId: "op-verify-mismatch",
    workspace: workspaceContext(),
    idempotency: { key: "verify-mismatch-1", scope: "invoke", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { instance_ref: initialized.value.instance_ref, capability: "verify_integrity", input: { path: "README.md", revision: firstRevision, expected_digest: "sha256:wrong" } },
  });
  assert.equal(mismatched.ok, true, JSON.stringify(mismatched));
  if (!mismatched.ok) return;
  assert.equal(mismatched.value.outcome, "failure");
});
