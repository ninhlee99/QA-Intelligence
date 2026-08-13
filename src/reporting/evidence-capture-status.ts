import type { VideoEvidencePolicy } from "../adapters/playwright/playwright-execution-engine.js";
import type { ScreenshotEvidencePolicy } from "./standard-evidence-profile.js";

export type EvidenceCaptureStatus = Readonly<{
  schema_version: "1.0.0";
  status: "not_requested" | "complete" | "partial";
  video_policy: VideoEvidencePolicy;
  screenshot_policy: ScreenshotEvidencePolicy;
  expected_video_count: number;
  captured_video_count: number;
  expected_screenshot_count: number;
  captured_screenshot_count: number;
  expected_failure_screenshot_count: number;
  captured_failure_screenshot_count: number;
  expected_failure_trace_count: number;
  captured_failure_trace_count: number;
  warnings: readonly string[];
}>;

export function assessEvidenceCaptureStatus(input: Readonly<{
  screenshot_policy?: ScreenshotEvidencePolicy;
  video_policy: VideoEvidencePolicy;
  test_cases: readonly Readonly<{ outcome: string; evidence: readonly string[] }>[];
}>): EvidenceCaptureStatus {
  const eligible = input.test_cases.filter((testCase) => testCase.outcome !== "not_executed");
  const screenshotPolicy = input.screenshot_policy ?? "failure_only";
  const expected = input.video_policy === "all"
    ? eligible.length
    : input.video_policy === "failure_only"
      ? eligible.filter((testCase) => testCase.outcome !== "passed").length
      : 0;
  // Count covered testcases, not raw artifacts: retries may legitimately
  // retain more than one video for a single testcase.
  const captured = eligible.filter((testCase) => testCase.evidence.some((ref) => ref.endsWith(".webm"))).length;
  const failed = eligible.filter((testCase) => testCase.outcome !== "passed");
  const expectedScreenshots = screenshotPolicy === "all" ? eligible.length : screenshotPolicy === "failure_only" ? failed.length : 0;
  const capturedAllScreenshots = eligible.filter((testCase) => testCase.evidence.some((ref) => ref.endsWith(".png"))).length;
  const capturedScreenshots = failed.filter((testCase) => testCase.evidence.some((ref) => ref.endsWith(".png"))).length;
  const capturedTraces = failed.filter((testCase) => testCase.evidence.some((ref) => ref.endsWith(".zip"))).length;
  const missing = Math.max(0, expected - captured);
  const missingRequiredScreenshots = Math.max(0, expectedScreenshots - capturedAllScreenshots);
  const missingTraces = Math.max(0, failed.length - capturedTraces);
  const warnings = [
    ...(missing > 0 ? [`${missing} required video evidence artifact(s) were not captured.`] : []),
    ...(missingRequiredScreenshots > 0 ? [`${missingRequiredScreenshots} required testcase screenshot(s) were not captured.`] : []),
    ...(missingTraces > 0 ? [`${missingTraces} failed testcase(s) have no trace evidence.`] : []),
  ];
  return {
    schema_version: "1.0.0",
    status: expected === 0 && expectedScreenshots === 0 && failed.length === 0
      ? "not_requested"
      : warnings.length === 0 ? "complete" : "partial",
    video_policy: input.video_policy,
    screenshot_policy: screenshotPolicy,
    expected_video_count: expected,
    captured_video_count: captured,
    expected_screenshot_count: expectedScreenshots,
    captured_screenshot_count: capturedAllScreenshots,
    expected_failure_screenshot_count: failed.length,
    captured_failure_screenshot_count: capturedScreenshots,
    expected_failure_trace_count: failed.length,
    captured_failure_trace_count: capturedTraces,
    warnings,
  };
}
