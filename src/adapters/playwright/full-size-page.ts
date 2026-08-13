import { access } from "node:fs/promises";
import type { Browser, Page } from "playwright";

export type HttpCredentials = Readonly<{ username: string; password: string }>;

/** `viewport: null` opts out of Playwright's fixed 1280x720 default so headed runs size to the real browser window. `httpCredentials`, when given, answers the browser's native HTTP Basic Auth prompt (distinct from an in-page login form) for every request in this context. */
export async function newFullSizePage(
  browser: Browser,
  httpCredentials?: HttpCredentials,
  recordVideoDir?: string,
  storageStatePath?: string,
): Promise<Page> {
  const storageState = storageStatePath !== undefined && await exists(storageStatePath) ? storageStatePath : undefined;
  const context = await browser.newContext({
    viewport: null,
    ...(httpCredentials !== undefined ? { httpCredentials } : {}),
    ...(recordVideoDir !== undefined ? { recordVideo: { dir: recordVideoDir } } : {}),
    ...(storageState !== undefined ? { storageState } : {}),
  });
  return context.newPage();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
