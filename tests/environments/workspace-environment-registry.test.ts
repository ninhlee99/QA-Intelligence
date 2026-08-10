import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryWorkspaceEnvironmentRegistry,
  isDevEscapeUrl,
} from "../../src/environments/workspace-environment-registry.js";

const clock = { now: (): Date => new Date("2026-08-10T12:00:00.000Z") };

test("environment registry registers and lists metadata", () => {
  const registry = new InMemoryWorkspaceEnvironmentRegistry(clock);
  const registered = registry.register({
    workspace_id: "ws-1",
    environment_ref: "environment:staging",
    base_url: "https://staging.example.com",
    label: "Staging",
  });
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  const listed = registry.list("ws-1");
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.base_url, "https://staging.example.com");
});

test("resolveTargetUrl prefers environment_ref and allowlists http(s)", () => {
  const registry = new InMemoryWorkspaceEnvironmentRegistry(clock);
  registry.register({
    workspace_id: "ws-1",
    environment_ref: "environment:staging",
    base_url: "https://staging.example.com",
  });

  const viaRef = registry.resolveTargetUrl({
    workspace_id: "ws-1",
    environment_ref: "environment:staging",
  });
  assert.equal(viaRef.ok, true);
  if (viaRef.ok) assert.equal(viaRef.via, "environment_ref");

  const underBase = registry.resolveTargetUrl({
    workspace_id: "ws-1",
    url: "https://staging.example.com/login",
  });
  assert.equal(underBase.ok, true);

  const denied = registry.resolveTargetUrl({
    workspace_id: "ws-1",
    url: "https://evil.example.com",
  });
  assert.equal(denied.ok, false);
});

test("dev escape hatches allow data and loopback without registration", () => {
  assert.equal(isDevEscapeUrl("data:text/html,hi"), true);
  assert.equal(isDevEscapeUrl("http://127.0.0.1:3000/x"), true);
  assert.equal(isDevEscapeUrl("https://example.com"), false);

  const registry = new InMemoryWorkspaceEnvironmentRegistry(clock);
  const loopback = registry.resolveTargetUrl({
    workspace_id: "ws-1",
    url: "http://localhost:9/login",
  });
  assert.equal(loopback.ok, true);
  if (loopback.ok) assert.equal(loopback.via, "dev_escape");
});
