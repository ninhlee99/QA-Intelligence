/**
 * Every Playwright launch site in this repository (`DiscoverUiSurface`,
 * `DiscoverAfterLogin`, `PlaywrightExecutionEngine`) used to call
 * `browser.newPage()` directly, which implicitly creates a default
 * `BrowserContext` with Playwright's fixed default viewport (1280x720) —
 * regardless of the actual test device/display size. That makes headed runs
 * (and screenshots/evidence captured from them) look nothing like what a
 * real user on that device would see.
 *
 * `newContext({ viewport: null })` is Playwright's documented way to opt out
 * of the fixed-viewport behavior: the page then sizes to the actual browser
 * window instead (the OS window's real size in headed mode; Chromium's
 * default headless window size otherwise). Centralized here so all three
 * call sites open a page the same way instead of duplicating this option.
 */
import type { Browser, Page } from "playwright";

/** Opens a page sized to the real browser window instead of a fixed default viewport. */
export async function newFullSizePage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: null });
  return context.newPage();
}
