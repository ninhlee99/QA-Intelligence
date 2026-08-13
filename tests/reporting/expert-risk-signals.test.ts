import assert from "node:assert/strict";
import test from "node:test";

import {
  detectExpertRiskSignals,
  deriveExpertMandateBlockers,
  hookCoverageFromExtensions,
} from "../../src/reporting/expert-risk-signals.js";
import { isPassLikeClaim } from "../../src/reporting/expert-checklist.js";

test("detectExpertRiskSignals smells roles money api journey", () => {
  const signals = detectExpertRiskSignals({
    request_context: "Admin role billing refund OpenAPI checkout flow",
    acceptance_criteria: [{ id: "1", statement: "User can pay invoice" }],
  });
  assert.equal(signals.needs_roles, true);
  assert.equal(signals.needs_money_oracles, true);
  assert.equal(signals.needs_api_authz, true);
  assert.equal(signals.needs_journeys, true);
});

test("deriveExpertMandateBlockers when hooks missing", () => {
  const signals = detectExpertRiskSignals({
    acceptance_criteria: [{ statement: "Admin can manage roles via API" }],
  });
  const blockers = deriveExpertMandateBlockers(signals, {
    role_compare_ran: false,
    openapi_cases_added: false,
    journey_cases_added: false,
    any_expected_network_on_ac: false,
  });
  assert.ok(blockers.some((b) => b.code === "e2_roles_not_exercised"));
  assert.ok(blockers.some((b) => b.code === "e2_api_authz_not_exercised"));
});

test("hookCoverageFromExtensions reads ok hooks", () => {
  const coverage = hookCoverageFromExtensions(
    {
      role_compare_hook: { ok: true },
      openapi_hook: { ok: true, case_count: 3 },
      journey_hook: { ok: true, journey_cases_added: 2 },
    },
    [{ expected_network: { url_includes: "/pay" } }],
  );
  assert.equal(coverage.role_compare_ran, true);
  assert.equal(coverage.openapi_cases_added, true);
  assert.equal(coverage.journey_cases_added, true);
  assert.equal(coverage.any_expected_network_on_ac, true);
});

test("isPassLikeClaim ignores negated wording", () => {
  assert.equal(isPassLikeClaim("do not pass this build"), false);
  assert.equal(isPassLikeClaim("not ready to ship"), false);
  assert.equal(isPassLikeClaim("Blocked — do not release"), false);
  assert.equal(isPassLikeClaim("Ready to ship"), true);
  assert.equal(isPassLikeClaim("All good, LGTM"), true);
});
