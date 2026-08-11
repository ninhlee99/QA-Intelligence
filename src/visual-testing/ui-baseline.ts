/**
 * Visual baseline thin slice: capture full-page PNG under .qa-baselines/
 * and compare via SHA-256 + PNG dimensions. Exact-match only (no soft
 * perceptual threshold) — mismatch is an observation, not auto product fail.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { type Browser } from "playwright";

import { createLaunchBrowser, type BrowserName } from "../adapters/playwright/browser-launcher.js";
import { newFullSizePage } from "../adapters/playwright/full-size-page.js";

export type VisualBaselineMeta = Readonly<{
  baseline_id: string;
  workspace_id: string;
  url: string;
  browser: BrowserName;
  captured_at: string;
  width: number;
  height: number;
  sha256: string;
  byte_length: number;
  png_path: string;
}>;

export type CaptureUiBaselineInput = Readonly<{
  rootDir: string;
  workspace_id: string;
  baseline_id: string;
  url: string;
  browser?: BrowserName;
  launchBrowser?: () => Promise<Browser>;
  now?: () => Date;
}>;

export type CaptureUiBaselineResult =
  | Readonly<{ ok: true; meta: VisualBaselineMeta }>
  | Readonly<{ ok: false; message: string }>;

export type CompareUiBaselineInput = Readonly<{
  rootDir: string;
  workspace_id: string;
  baseline_id: string;
  url: string;
  browser?: BrowserName;
  launchBrowser?: () => Promise<Browser>;
  now?: () => Date;
}>;

export type CompareUiBaselineResult =
  | Readonly<{
      ok: true;
      match: boolean;
      baseline: VisualBaselineMeta;
      live: Readonly<{
        sha256: string;
        byte_length: number;
        width: number;
        height: number;
        png_path: string;
      }>;
      note: string;
    }>
  | Readonly<{ ok: false; message: string }>;

export async function captureUiBaseline(input: CaptureUiBaselineInput): Promise<CaptureUiBaselineResult> {
  const browserName = input.browser ?? "chromium";
  const launch = input.launchBrowser ?? createLaunchBrowser(browserName);
  let browser: Browser | undefined;
  try {
    browser = await launch();
    const page = await newFullSizePage(browser);
    try {
      await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      const png = await page.screenshot({ fullPage: true, type: "png" });
      const dims = readPngDimensions(png);
      if (!dims.ok) return { ok: false, message: dims.message };
      const sha256 = createHash("sha256").update(png).digest("hex");
      const paths = baselinePaths(input.rootDir, input.workspace_id, input.baseline_id);
      mkdirSync(dirname(paths.png), { recursive: true });
      writeFileSync(paths.png, png);
      const meta: VisualBaselineMeta = {
        baseline_id: input.baseline_id,
        workspace_id: input.workspace_id,
        url: input.url,
        browser: browserName,
        captured_at: (input.now ?? (() => new Date()))().toISOString(),
        width: dims.width,
        height: dims.height,
        sha256,
        byte_length: png.byteLength,
        png_path: paths.png,
      };
      writeFileSync(paths.meta, JSON.stringify(meta, null, 2), "utf8");
      return { ok: true, meta };
    } finally {
      await page.close();
    }
  } catch (error) {
    return { ok: false, message: `capture_ui_baseline failed: ${(error as Error).message}` };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function compareUiBaseline(input: CompareUiBaselineInput): Promise<CompareUiBaselineResult> {
  const paths = baselinePaths(input.rootDir, input.workspace_id, input.baseline_id);
  if (!existsSync(paths.meta) || !existsSync(paths.png)) {
    return {
      ok: false,
      message: `No baseline "${input.baseline_id}" under ${paths.dir} — run capture_ui_baseline first.`,
    };
  }
  let baseline: VisualBaselineMeta;
  try {
    baseline = JSON.parse(readFileSync(paths.meta, "utf8")) as VisualBaselineMeta;
  } catch (error) {
    return { ok: false, message: `Failed to read baseline meta: ${(error as Error).message}` };
  }

  const browserName = input.browser ?? baseline.browser ?? "chromium";
  const launch = input.launchBrowser ?? createLaunchBrowser(browserName);
  let browser: Browser | undefined;
  try {
    browser = await launch();
    const page = await newFullSizePage(browser);
    try {
      await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      const png = await page.screenshot({ fullPage: true, type: "png" });
      const dims = readPngDimensions(png);
      if (!dims.ok) return { ok: false, message: dims.message };
      const sha256 = createHash("sha256").update(png).digest("hex");
      mkdirSync(paths.dir, { recursive: true });
      const livePath = join(paths.dir, `live-${Date.now()}.png`);
      writeFileSync(livePath, png);
      const match =
        sha256 === baseline.sha256 &&
        dims.width === baseline.width &&
        dims.height === baseline.height;
      const note = match
        ? "Exact PNG match (SHA-256 + dimensions). Soft perceptual threshold not applied."
        : dims.width !== baseline.width || dims.height !== baseline.height
          ? `Dimension mismatch: baseline ${baseline.width}x${baseline.height} vs live ${dims.width}x${dims.height}. Observation only — not an auto product fail.`
          : "Pixel/hash mismatch at same dimensions. Observation only — not an auto product fail. Soft perceptual compare deferred.";
      return {
        ok: true,
        match,
        baseline,
        live: {
          sha256,
          byte_length: png.byteLength,
          width: dims.width,
          height: dims.height,
          png_path: livePath,
        },
        note,
      };
    } finally {
      await page.close();
    }
  } catch (error) {
    return { ok: false, message: `compare_ui_baseline failed: ${(error as Error).message}` };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

function baselinePaths(rootDir: string, workspaceId: string, baselineId: string): Readonly<{
  dir: string;
  png: string;
  meta: string;
}> {
  const safeWs = workspaceId.replace(/[^A-Za-z0-9._-]/g, "_");
  const safeId = baselineId.replace(/[^A-Za-z0-9._-]/g, "_");
  const dir = join(rootDir, safeWs, safeId);
  return { dir, png: join(dir, "baseline.png"), meta: join(dir, "baseline.json") };
}

/** Exported for unit tests — IHDR width/height only. */
export function readPngDimensions(
  png: Buffer,
): Readonly<{ ok: true; width: number; height: number }> | Readonly<{ ok: false; message: string }> {
  if (png.byteLength < 24) return { ok: false, message: "PNG too small to read IHDR." };
  const signature = png.subarray(0, 8);
  const expected = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!signature.equals(expected)) return { ok: false, message: "Not a PNG buffer." };
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  return { ok: true, width, height };
}
