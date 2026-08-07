import type { Browser, Page } from "playwright";

/** `viewport: null` opts out of Playwright's fixed 1280x720 default so headed runs size to the real browser window. */
export async function newFullSizePage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: null });
  return context.newPage();
}
