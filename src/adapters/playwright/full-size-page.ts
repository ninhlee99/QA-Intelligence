import type { Browser, Page } from "playwright";

export type HttpCredentials = Readonly<{ username: string; password: string }>;

/** `viewport: null` opts out of Playwright's fixed 1280x720 default so headed runs size to the real browser window. `httpCredentials`, when given, answers the browser's native HTTP Basic Auth prompt (distinct from an in-page login form) for every request in this context. */
export async function newFullSizePage(browser: Browser, httpCredentials?: HttpCredentials): Promise<Page> {
  const context = await browser.newContext({ viewport: null, ...(httpCredentials !== undefined ? { httpCredentials } : {}) });
  return context.newPage();
}
