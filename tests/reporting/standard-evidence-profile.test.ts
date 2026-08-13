import assert from "node:assert/strict";
import test from "node:test";
import { resolveStandardEvidenceProfile } from "../../src/reporting/standard-evidence-profile.js";

test("standard evidence captures every testcase image and failure video by default", () => {
  assert.deepEqual(resolveStandardEvidenceProfile({}), { screenshot_policy: "all", video_policy: "failure_only" });
});

test("explicit evidence controls override the standard profile", () => {
  assert.deepEqual(resolveStandardEvidenceProfile({ include_screenshot: false, include_video: false }), { screenshot_policy: "failure_only", video_policy: "off" });
  assert.deepEqual(resolveStandardEvidenceProfile({ screenshot_policy: "off", video_policy: "all" }), { screenshot_policy: "off", video_policy: "all" });
});

test("invalid evidence policy fails closed", () => {
  assert.deepEqual(resolveStandardEvidenceProfile({ video_policy: "sometimes" }), { ok: false, message: 'video_policy must be off|failure_only|all (got "sometimes").' });
});
