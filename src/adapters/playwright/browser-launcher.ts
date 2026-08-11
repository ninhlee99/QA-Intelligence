/**
 * Shared Playwright browser launch helpers (Phase 9 multi-browser).
 * Discovery and execution inject `launchBrowser` from here so MCP can
 * select chromium / firefox / webkit without forking engine code.
 */
import { chromium, firefox, webkit, type Browser } from "playwright";

export type BrowserName = "chromium" | "firefox" | "webkit";

const LAUNCHERS: Readonly<Record<BrowserName, () => Promise<Browser>>> = {
  chromium: () => chromium.launch(),
  firefox: () => firefox.launch(),
  webkit: () => webkit.launch(),
};

export function isBrowserName(value: string): value is BrowserName {
  return value === "chromium" || value === "firefox" || value === "webkit";
}

export function createLaunchBrowser(browser: BrowserName = "chromium"): () => Promise<Browser> {
  return LAUNCHERS[browser];
}

export function parseBrowserName(raw: unknown, fallback: BrowserName = "chromium"): BrowserName | Readonly<{ error: string }> {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw !== "string" || !isBrowserName(raw.trim().toLowerCase())) {
    return { error: `browser must be one of chromium|firefox|webkit (got ${JSON.stringify(raw)}).` };
  }
  return raw.trim().toLowerCase() as BrowserName;
}
