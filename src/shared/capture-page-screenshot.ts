/**
 * Best-effort PNG capture for discovery/execution evidence (dogfood GAP-1).
 * Failures return undefined — never fail the parent operation.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";

export async function capturePageScreenshot(
  page: Page,
  dir: string,
  basename: string,
): Promise<string | undefined> {
  try {
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${basename}_${Date.now()}.png`);
    await page.screenshot({ path, fullPage: true });
    return path;
  } catch {
    return undefined;
  }
}

export function defaultScreenshotDir(operationId: string): string {
  return join(process.cwd(), ".qa-screenshots", operationId);
}
