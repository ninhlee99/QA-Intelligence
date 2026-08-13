import type { VideoEvidencePolicy } from "../adapters/playwright/playwright-execution-engine.js";

export type ScreenshotEvidencePolicy = "off" | "failure_only" | "all";
export type StandardEvidenceProfile = Readonly<{ screenshot_policy: ScreenshotEvidencePolicy; video_policy: VideoEvidencePolicy }>;
export type EvidenceProfileResolution = StandardEvidenceProfile | Readonly<{ ok: false; message: string }>;

export function resolveStandardEvidenceProfile(input: Readonly<{ screenshot_policy?: unknown; video_policy?: unknown; include_screenshot?: unknown; include_video?: unknown }>): EvidenceProfileResolution {
  const screenshot = input.screenshot_policy ?? (input.include_screenshot === false ? "failure_only" : "all");
  const video = input.video_policy ?? (input.include_video === false ? "off" : input.include_video === true ? "all" : "failure_only");
  if (screenshot !== "off" && screenshot !== "failure_only" && screenshot !== "all") return { ok: false, message: `screenshot_policy must be off|failure_only|all (got ${JSON.stringify(screenshot)}).` };
  if (video !== "off" && video !== "failure_only" && video !== "all") return { ok: false, message: `video_policy must be off|failure_only|all (got ${JSON.stringify(video)}).` };
  return { screenshot_policy: screenshot, video_policy: video };
}
