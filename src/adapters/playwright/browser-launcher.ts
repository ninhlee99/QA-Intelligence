/**
 * Shared Playwright browser launch helpers (Phase 9 multi-browser).
 * Discovery and execution inject `launchBrowser` from here so MCP can
 * select chromium / firefox / webkit without forking engine code.
 *
 * Headed vs headless: Playwright defaults to headless. Interactive MCP
 * testing needs a visible window — pass `headed: true` on the tool call
 * or set `QA_INTELLIGENCE_HEADED=1` in the MCP server env. Explicit
 * `headed: false` wins over the env (CI-safe). Env is read at launch
 * time, not at factory construction.
 */
import { chromium, firefox, webkit, type Browser, type LaunchOptions } from "playwright";

export type BrowserName = "chromium" | "firefox" | "webkit";

export type PlaywrightLaunchOptions = Readonly<{
  /** Visible Chromium/Firefox/WebKit window. Default: env, else headless. */
  headed?: boolean;
}>;

export function isBrowserName(value: string): value is BrowserName {
  return value === "chromium" || value === "firefox" || value === "webkit";
}

export function isHeadedFromEnv(): boolean {
  const raw = process.env["QA_INTELLIGENCE_HEADED"]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Explicit boolean wins; otherwise `QA_INTELLIGENCE_HEADED`. Default headless. */
export function resolveHeaded(headed?: boolean): boolean {
  if (headed === true) return true;
  if (headed === false) return false;
  return isHeadedFromEnv();
}

/** MCP/runtime input: `true`/`false` or omit (env). */
export function headedFromInput(raw: unknown): boolean | undefined {
  if (raw === true) return true;
  if (raw === false) return false;
  return undefined;
}

function launchOptions(headed?: boolean): LaunchOptions {
  return { headless: !resolveHeaded(headed) };
}

const LAUNCHERS: Readonly<Record<BrowserName, (options: LaunchOptions) => Promise<Browser>>> = {
  chromium: (options) => chromium.launch(options),
  firefox: (options) => firefox.launch(options),
  webkit: (options) => webkit.launch(options),
};

export function createLaunchBrowser(
  browser: BrowserName = "chromium",
  options?: PlaywrightLaunchOptions,
): () => Promise<Browser> {
  return () => LAUNCHERS[browser](launchOptions(options?.headed));
}

export function parseBrowserName(raw: unknown, fallback: BrowserName = "chromium"): BrowserName | Readonly<{ error: string }> {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw !== "string" || !isBrowserName(raw.trim().toLowerCase())) {
    return { error: `browser must be one of chromium|firefox|webkit (got ${JSON.stringify(raw)}).` };
  }
  return raw.trim().toLowerCase() as BrowserName;
}
