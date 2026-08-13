import assert from "node:assert/strict";
import test from "node:test";

import { assessEvidenceCaptureStatus } from "../../src/reporting/evidence-capture-status.js";

test("assessEvidenceCaptureStatus reports partial when requested video evidence is missing", () => {
  const status = assessEvidenceCaptureStatus({
    screenshot_policy: "failure_only",
    video_policy: "all",
    test_cases: [
      { outcome: "passed", evidence: ["/tmp/one.webm"] },
      { outcome: "failed", evidence: ["/tmp/failure.png"] },
      { outcome: "not_executed", evidence: [] },
    ],
  });

  assert.equal(status.status, "partial");
  assert.equal(status.expected_video_count, 2);
  assert.equal(status.captured_video_count, 1);
  assert.equal(status.expected_failure_screenshot_count, 1);
  assert.equal(status.captured_failure_screenshot_count, 1);
  assert.equal(status.expected_failure_trace_count, 1);
  assert.equal(status.captured_failure_trace_count, 0);
  assert.equal(status.warnings.length, 2);
});

test("assessEvidenceCaptureStatus counts retry videos as one covered testcase", () => {
  const status = assessEvidenceCaptureStatus({
    screenshot_policy: "failure_only",
    video_policy: "all",
    test_cases: [
      { outcome: "failed", evidence: ["attempt-1.webm", "attempt-2.webm", "failure.png", "failure.zip"] },
    ],
  });

  assert.equal(status.expected_video_count, 1);
  assert.equal(status.captured_video_count, 1);
  assert.equal(status.status, "complete");
});

test("standard profile requires screenshot evidence for every executed testcase", () => {
  const status = assessEvidenceCaptureStatus({
    screenshot_policy: "all",
    video_policy: "failure_only",
    test_cases: [
      { outcome: "passed", evidence: ["passed.png"] },
      { outcome: "failed", evidence: ["failed.png", "failed.zip", "failed.webm"] },
    ],
  });
  assert.equal(status.expected_screenshot_count, 2);
  assert.equal(status.captured_screenshot_count, 2);
  assert.equal(status.status, "complete");
});

test("screenshot evidence requested for a passing run is never reported as not_requested", () => {
  const status = assessEvidenceCaptureStatus({
    screenshot_policy: "all",
    video_policy: "off",
    test_cases: [{ outcome: "passed", evidence: ["passed.png"] }],
  });

  assert.equal(status.status, "complete");
});
