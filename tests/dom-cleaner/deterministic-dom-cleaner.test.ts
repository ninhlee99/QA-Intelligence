import assert from "node:assert/strict";
import test from "node:test";

import { cleanedTreeDigest, DeterministicDomCleaner } from "../../src/adapters/dom-cleaner/deterministic-dom-cleaner.js";
import type { DomCleanRequest, RawDomNode, RedactionPolicy } from "../../src/dom-cleaner/public.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";

function workspaceContext(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-dom-001",
    actor_id: "actor-dom-001",
    actor_type: "service",
    roles: ["ui-capture"],
    permissions: ["capture:read"],
    policy_version: "policy@1.0.0",
    request_id: "request-dom-001",
    correlation_id: "correlation-dom-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-06T09:00:00.000Z",
    expires_at: "2026-08-06T11:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

function emptyPolicy(): RedactionPolicy {
  return { rules: [], redact_text_matching: [] };
}

function limits(overrides: Partial<DomCleanRequest["limits"]> = {}): DomCleanRequest["limits"] {
  return { max_bytes: 100_000, max_depth: 50, max_nodes: 1000, max_attribute_length: 500, max_text_length: 1000, ...overrides };
}

function baseRequest(raw: RawDomNode, overrides: Partial<DomCleanRequest> = {}): DomCleanRequest {
  return {
    capture_id: "capture-001",
    url_classification: "internal",
    context: workspaceContext(),
    actor_role: "qa-agent",
    environment: "test",
    captured_at: "2026-08-06T09:00:00.000Z",
    raw_content_ref: "capture://raw/001",
    raw,
    redaction_policy: emptyPolicy(),
    limits: limits(),
    capture_authorized: true,
    ...overrides,
  };
}

function node(tag: string, overrides: Partial<RawDomNode> = {}): RawDomNode {
  return { tag, attributes: {}, children: [], ...overrides };
}

test("removes script and style tags entirely (SPEC-302 §2)", async () => {
  const cleaner = new DeterministicDomCleaner();
  const raw = node("div", {
    children: [node("script", { text: "alert('x')" }), node("style", { text: "body{}" }), node("p", { text: "hello" })],
  });

  const result = await cleaner.clean(baseRequest(raw));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const tags = result.value.sanitized_tree.children.map((child) => child.tag);
  assert.deepEqual(tags, ["p"]);
  assert.ok(result.value.warnings.some((warning) => warning.includes("removed as prohibited content")));
});

test("retains accessible role, name, and hierarchy", async () => {
  const cleaner = new DeterministicDomCleaner();
  const raw = node("div", {
    children: [node("button", { accessible_role: "button", accessible_name: "Submit", text: "Submit" })],
  });

  const result = await cleaner.clean(baseRequest(raw));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const button = result.value.sanitized_tree.children[0];
  assert.equal(button?.accessible_role, "button");
  assert.equal(button?.accessible_name, "Submit");
  assert.equal(button?.interaction_hint, "clickable");
});

test("redacts an attribute matching the redaction policy and records the event", async () => {
  const cleaner = new DeterministicDomCleaner();
  const raw = node("input", { attributes: { "data-ssn": "123-45-6789", type: "text" } });
  const request = baseRequest(raw, {
    redaction_policy: { rules: [{ attribute_pattern: "^data-ssn$", reason: "personal data" }], redact_text_matching: [] },
  });

  const result = await cleaner.clean(request);

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.sanitized_tree.retained_attributes["data-ssn"], undefined);
  assert.equal(result.value.sanitized_tree.retained_attributes["type"], "text");
  assert.equal(result.value.redaction_events.length, 1);
  assert.equal(result.value.redaction_events[0]?.reason, "personal data");
});

test("redacts text content matching a sensitive pattern", async () => {
  const cleaner = new DeterministicDomCleaner();
  const raw = node("p", { text: "call me at 555-123-4567" });
  const request = baseRequest(raw, {
    redaction_policy: { rules: [], redact_text_matching: ["\\d{3}-\\d{3}-\\d{4}"] },
  });

  const result = await cleaner.clean(request);

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.sanitized_tree.text, undefined);
  assert.equal(result.value.redaction_events.length, 1);
});

test("fails closed with excessive_size when the node count exceeds the limit (SPEC-302 §8)", async () => {
  const cleaner = new DeterministicDomCleaner();
  const raw = node("div", { children: Array.from({ length: 10 }, () => node("span")) });
  const request = baseRequest(raw, { limits: limits({ max_nodes: 5 }) });

  const result = await cleaner.clean(request);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "excessive_size");
});

test("fails closed when the capture was not authorized, before any cleaning happens", async () => {
  const cleaner = new DeterministicDomCleaner();
  const request = baseRequest(node("div"), { capture_authorized: false });

  const result = await cleaner.clean(request);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "capture_unauthorized");
});

test("source_node_mapping traces every retained node back to its raw tree path", async () => {
  const cleaner = new DeterministicDomCleaner();
  const raw = node("div", { children: [node("p"), node("span", { children: [node("b")] })] });

  const result = await cleaner.clean(baseRequest(raw));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const paths = result.value.source_node_mapping.map((mapping) => mapping.raw_path);
  assert.deepEqual(paths, [[], [0], [1], [1, 0]]);
});

test("determinism: identical input, policy, and cleaner version produce byte-identical output (SPEC-302 §7)", async () => {
  const cleaner = new DeterministicDomCleaner();
  const raw = node("div", { children: [node("button", { accessible_role: "button", text: "Go" })] });
  const request = baseRequest(raw);

  const first = await cleaner.clean(request);
  const second = await cleaner.clean(request);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(cleanedTreeDigest(first.value.sanitized_tree), cleanedTreeDigest(second.value.sanitized_tree));
});

test("noise attributes (style, class, event handlers) are dropped without a redaction event", async () => {
  const cleaner = new DeterministicDomCleaner();
  const raw = node("div", { attributes: { style: "color:red", class: "foo", onclick: "doThing()", id: "real-id" } });

  const result = await cleaner.clean(baseRequest(raw));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const attributes = result.value.sanitized_tree.retained_attributes;
  assert.equal(attributes["style"], undefined);
  assert.equal(attributes["class"], undefined);
  assert.equal(attributes["onclick"], undefined);
  assert.equal(attributes["id"], "real-id");
  assert.equal(result.value.redaction_events.length, 0, "noise removal is not the same as policy-driven redaction");
});

test("coverage reports raw and retained node counts honestly", async () => {
  const cleaner = new DeterministicDomCleaner();
  const raw = node("div", { children: [node("script"), node("p"), node("p")] });

  const result = await cleaner.clean(baseRequest(raw));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.coverage.raw_node_count, 4);
  assert.equal(result.value.coverage.retained_node_count, 3);
});
