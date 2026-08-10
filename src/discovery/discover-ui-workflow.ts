/**
 * SPEC-201 thin multi-page / Navigation slice: crawl same-origin links from
 * a start URL (depth-bounded). Does NOT invent Region/State/Permission
 * concepts — only Page captures + link graph edges grounded in live hrefs.
 */
import { chromium, type Browser, type Page } from "playwright";

import { createLaunchBrowser, type BrowserName } from "../adapters/playwright/browser-launcher.js";
import { newFullSizePage } from "../adapters/playwright/full-size-page.js";
import type { WorkspaceAuthorizer, WorkspaceContext } from "../requirement-review/public.js";
import { DiscoverUiSurface } from "./discover-ui-surface.js";
import type { SemanticUiMap } from "./public.js";

export type WorkflowPageCapture = Readonly<{
  url: string;
  title: string;
  capture_id: string;
  element_count: number;
  named_fields: readonly string[];
  named_actions: readonly string[];
  limitations: readonly string[];
}>;

export type WorkflowEdge = Readonly<{
  from_url: string;
  to_url: string;
  link_text: string;
}>;

export type UiWorkflowDiscoveryResult = Readonly<{
  schema_version: "1.0.0";
  workspace_id: string;
  start_url: string;
  pages: readonly WorkflowPageCapture[];
  edges: readonly WorkflowEdge[];
  limitations: readonly string[];
  /** Full map of the start page only — keeps MCP payload bounded. */
  start_page_map: SemanticUiMap;
}>;

export type DiscoverUiWorkflowRequest = Readonly<{
  operation_id: string;
  context: WorkspaceContext;
  url: string;
  /** Max pages to visit including start (default 3, hard cap 8). */
  max_pages?: number;
  browser?: BrowserName;
}>;

type Dependencies = Readonly<{
  clock: { now(): Date };
  authorizer: WorkspaceAuthorizer;
  discoverUiSurface: DiscoverUiSurface;
  launchBrowser?: () => Promise<Browser>;
}>;

const HARD_CAP = 8;

export class DiscoverUiWorkflow {
  readonly #clock: { now(): Date };
  readonly #authorizer: WorkspaceAuthorizer;
  readonly #discover: DiscoverUiSurface;
  readonly #launchBrowser: () => Promise<Browser>;

  constructor(dependencies: Dependencies) {
    this.#clock = dependencies.clock;
    this.#authorizer = dependencies.authorizer;
    this.#discover = dependencies.discoverUiSurface;
    this.#launchBrowser = dependencies.launchBrowser ?? (() => chromium.launch());
  }

  async discover(request: DiscoverUiWorkflowRequest): Promise<
    | Readonly<{ ok: true; value: UiWorkflowDiscoveryResult }>
    | Readonly<{
        ok: false;
        failure: Readonly<{
          class: "authorization" | "infrastructure" | "engine";
          code: string;
          message: string;
          retryable: boolean;
          evidence: readonly string[];
        }>;
      }>
  > {
    const authorization = await this.#authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "discover-ui-workflow",
      consequence_class: "advisory",
      required_permissions: ["discovery:observe"],
      resource_refs: [`workspace:${request.context.workspace_id}`],
    });
    if (!authorization.ok) {
      return {
        ok: false,
        failure: {
          class: "authorization",
          code: authorization.failure.code,
          message: authorization.failure.message,
          retryable: authorization.failure.retryable,
          evidence: [...authorization.failure.evidence],
        },
      };
    }

    const maxPages = Math.min(Math.max(request.max_pages ?? 3, 1), HARD_CAP);
    let browser: Browser;
    try {
      const launch =
        request.browser !== undefined ? createLaunchBrowser(request.browser) : this.#launchBrowser;
      browser = await launch();
    } catch (error) {
      return {
        ok: false,
        failure: {
          class: "infrastructure",
          code: "browser_launch_failed",
          message: `Workflow discovery browser failed to launch: ${(error as Error).message}`,
          retryable: true,
          evidence: [],
        },
      };
    }

    const pages: WorkflowPageCapture[] = [];
    const edges: WorkflowEdge[] = [];
    const limitations: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [normalizeUrl(request.url)];
    let startPageMap: SemanticUiMap | undefined;

    try {
      const page = await newFullSizePage(browser);
      try {
        while (queue.length > 0 && pages.length < maxPages) {
          const current = queue.shift()!;
          if (visited.has(current)) continue;
          visited.add(current);

          try {
            await page.goto(current, { waitUntil: "domcontentloaded", timeout: 20_000 });
          } catch (error) {
            limitations.push(`navigation_failed:${current}:${(error as Error).message}`);
            continue;
          }

          const captured = await this.#discover.captureSemanticUiMap(page, {
            context: request.context,
            url: current,
            operation_id: `${request.operation_id}:page-${pages.length}`,
          });
          if (!captured.ok) {
            limitations.push(`capture_failed:${current}:${captured.failure.message}`);
            continue;
          }

          const map = captured.value;
          if (startPageMap === undefined) startPageMap = map;

          const title = await page.title().catch(() => "");
          const namedFields = map.elements
            .filter((el) => el.kind === "field" && el.accessible_name)
            .map((el) => el.accessible_name!)
            .slice(0, 20);
          const namedActions = map.elements
            .filter((el) => el.kind === "action" && el.accessible_name)
            .map((el) => el.accessible_name!)
            .slice(0, 20);

          pages.push({
            url: current,
            title,
            capture_id: map.capture_id,
            element_count: map.elements.length,
            named_fields: namedFields,
            named_actions: namedActions,
            limitations: [...map.limitations],
          });

          if (pages.length >= maxPages) break;

          const links = await collectSameOriginLinks(page, current);
          for (const link of links) {
            edges.push({ from_url: current, to_url: link.href, link_text: link.text });
            if (!visited.has(link.href) && !queue.includes(link.href)) {
              queue.push(link.href);
            }
          }
        }
      } finally {
        await page.close();
      }
    } catch (error) {
      return {
        ok: false,
        failure: {
          class: "infrastructure",
          code: "navigation_failed",
          message: `Workflow discovery failed: ${(error as Error).message}`,
          retryable: true,
          evidence: [],
        },
      };
    } finally {
      await browser.close();
    }

    if (startPageMap === undefined || pages.length === 0) {
      return {
        ok: false,
        failure: {
          class: "infrastructure",
          code: "navigation_failed",
          message: "Workflow discovery captured no pages.",
          retryable: true,
          evidence: [],
        },
      };
    }

    if (queue.length > 0 || visited.size > pages.length) {
      limitations.push(`truncated_crawl_max_pages_${maxPages}`);
    }
    limitations.push("Region/State/Permission concepts not mapped — Navigation link graph only.");

    return {
      ok: true,
      value: {
        schema_version: "1.0.0",
        workspace_id: request.context.workspace_id,
        start_url: normalizeUrl(request.url),
        pages,
        edges: dedupeEdges(edges),
        limitations,
        start_page_map: startPageMap,
      },
    };
  }
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

async function collectSameOriginLinks(
  page: Page,
  currentUrl: string,
): Promise<readonly Readonly<{ href: string; text: string }>[]> {
  let origin: string;
  try {
    origin = new URL(currentUrl).origin;
  } catch {
    return [];
  }

  const raw = (await page.evaluate(`(() => {
    const anchors = Array.from(document.querySelectorAll("a[href]")).slice(0, 40);
    return anchors.map((anchor) => ({
      href: anchor.href,
      text: ((anchor.innerText || anchor.getAttribute("aria-label") || "").trim()).slice(0, 80),
    }));
  })()`)) as Array<{ href: string; text: string }>;

  const out: Array<{ href: string; text: string }> = [];
  const seen = new Set<string>();
  for (const item of raw) {
    try {
      const parsed = new URL(item.href);
      if (parsed.origin !== origin) continue;
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      parsed.hash = "";
      const href = parsed.toString();
      if (href === normalizeUrl(currentUrl)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      out.push({ href, text: item.text || href });
    } catch {
      continue;
    }
  }
  return out.slice(0, 12);
}

function dedupeEdges(edges: readonly WorkflowEdge[]): readonly WorkflowEdge[] {
  const seen = new Set<string>();
  const out: WorkflowEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from_url}|${edge.to_url}|${edge.link_text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out.slice(0, 40);
}
