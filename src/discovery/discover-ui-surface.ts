/**
 * SPEC-201 §8 Semantic UI Discovery tracer bullet (Phase 1,
 * docs/proposals/professional-qa-mcp-roadmap.md). Distinct from
 * `DiscoverProductContext` (Knowledge Store search only) — this module is
 * the first thing in the repository that navigates a live page for
 * Discovery purposes, reusing the same Semantic UI pipeline
 * (`extractRawDom` -> `DeterministicDomCleaner`) `PlaywrightExecutionEngine`
 * already uses for execution, but through Discovery's own read-only
 * authorization purpose — this is observation, not test execution, and
 * SHALL NOT be authorized under an `execution:*` permission.
 */
import { type Browser, type Page } from "playwright";

import { extractRawDom } from "../adapters/playwright/extract-raw-dom.js";
import { newFullSizePage } from "../adapters/playwright/full-size-page.js";
import { createLaunchBrowser, type BrowserName } from "../adapters/playwright/browser-launcher.js";
import { DeterministicDomCleaner } from "../adapters/dom-cleaner/deterministic-dom-cleaner.js";
import type { CleanedDomNode } from "../dom-cleaner/public.js";
import type { WorkspaceAuthorizer, WorkspaceContext } from "../requirement-review/public.js";
import {
  capturePageScreenshot,
  defaultScreenshotDir,
} from "../shared/capture-page-screenshot.js";
import type {
  SemanticUiDiscoveryResult,
  SemanticUiElement,
  SemanticUiMap,
} from "./public.js";

export interface Clock {
  now(): Date;
}

export type DiscoverUiSurfaceRequest = Readonly<{
  operation_id: string;
  context: WorkspaceContext;
  url: string;
  /** Phase 9 — defaults to chromium when omitted. */
  browser?: BrowserName;
  /** Visible browser window. Default: `QA_INTELLIGENCE_HEADED` env, else headless. */
  headed?: boolean;
  /** Dogfood GAP-1 — write a full-page PNG and return screenshot_path. */
  include_screenshot?: boolean;
  /** Override default `.qa-screenshots/<operation_id>/`. */
  screenshot_dir?: string;
  /**
   * Dogfood GAP-4 — max named/unnamed elements returned (default 120).
   * Clamped to [20, 2000]; traversal safety cap remains 5000.
   */
  max_elements?: number;
}>;

type Dependencies = Readonly<{
  clock: Clock;
  authorizer: WorkspaceAuthorizer;
  launchBrowser?: () => Promise<Browser>;
}>;

/** Final element count an MCP caller actually receives — bounded to stay well inside a single tool-call response's token budget. */
const MAX_ELEMENTS = 120;
/** Traversal safety cap only — prevents pathological pages (thousands of nodes) from hanging capture; the real limit an MCP caller sees is MAX_ELEMENTS, applied after prioritization. */
const TRAVERSAL_SAFETY_CAP = 5_000;

/** Deep module: one `discover()` call hides browser launch, DOM capture, cleaning, and semantic mapping. */
export class DiscoverUiSurface {
  readonly #clock: Clock;
  readonly #authorizer: WorkspaceAuthorizer;
  readonly #launchBrowser: () => Promise<Browser>;
  readonly #cleaner = new DeterministicDomCleaner();

  constructor(dependencies: Dependencies) {
    this.#clock = dependencies.clock;
    this.#authorizer = dependencies.authorizer;
    this.#launchBrowser = dependencies.launchBrowser ?? createLaunchBrowser();
  }

  async discover(request: DiscoverUiSurfaceRequest): Promise<SemanticUiDiscoveryResult> {
    const authorization = await this.#authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "discover-ui-surface",
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

    let browser: Browser;
    try {
      const launch =
        request.browser !== undefined || request.headed !== undefined
          ? createLaunchBrowser(request.browser ?? "chromium", {
              ...(request.headed !== undefined ? { headed: request.headed } : {}),
            })
          : this.#launchBrowser;
      browser = await launch();
    } catch (error) {
      return {
        ok: false,
        failure: {
          class: "infrastructure",
          code: "browser_launch_failed",
          message: `Discovery browser failed to launch: ${(error as Error).message}`,
          retryable: true,
          evidence: [],
        },
      };
    }

    try {
      const page = await newFullSizePage(browser);
      let result: SemanticUiDiscoveryResult;
      try {
        await page.goto(request.url);
        result = await this.captureSemanticUiMap(page, {
          context: request.context,
          url: request.url,
          operation_id: request.operation_id,
          ...(request.include_screenshot === true ? { include_screenshot: true } : {}),
          ...(request.screenshot_dir !== undefined ? { screenshot_dir: request.screenshot_dir } : {}),
          ...(request.max_elements !== undefined ? { max_elements: request.max_elements } : {}),
        });
      } finally {
        await page.close();
      }
      return result;
    } catch (error) {
      return {
        ok: false,
        failure: {
          class: "infrastructure",
          code: "navigation_failed",
          message: `Discovery navigation failed: ${(error as Error).message}`,
          retryable: true,
          evidence: [],
        },
      };
    } finally {
      await browser.close();
    }
  }

  /**
   * Captures a Semantic UI Map from a page that is already on the target
   * URL, on a browser/page this method does not own (does not launch,
   * navigate, or close it) — the seam `DiscoverAfterLoginRuntimeExecutor`
   * uses to discover a screen reachable only after a login step, on the
   * exact same session/cookies that login produced, instead of `discover()`'s
   * always-fresh, always-unauthenticated browser.
   */
  async captureSemanticUiMap(
    page: Page,
    request: Readonly<{
      context: WorkspaceContext;
      url: string;
      operation_id: string;
      include_screenshot?: boolean;
      screenshot_dir?: string;
      max_elements?: number;
    }>,
  ): Promise<SemanticUiDiscoveryResult> {
    const capturedAt = this.#clock.now().toISOString();
    const captureId = `capture:discovery:${request.operation_id}`;
    // A single-page app typically finishes the `load` event before its JS
    // framework has rendered anything — capturing immediately after
    // navigation often yields an empty shell or a loading skeleton instead
    // of the real UI. `networkidle` waits for in-flight requests (the API
    // calls that populate real content) to settle; a page that never goes
    // idle (long-polling, websockets) times out and is captured as-is
    // rather than hanging indefinitely.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    const raw = await extractRawDom(page);

    const cleaned = await this.#cleaner.clean({
      capture_id: captureId,
      url_classification: "internal",
      context: request.context,
      actor_role: "discovery",
      environment: "discovery",
      captured_at: capturedAt,
      raw_content_ref: request.url,
      raw,
      redaction_policy: { rules: [], redact_text_matching: [] },
      limits: { max_bytes: 5_000_000, max_depth: 64, max_nodes: 20_000, max_attribute_length: 2_000, max_text_length: 5_000 },
      capture_authorized: true,
    });
    if (!cleaned.ok) {
      return {
        ok: false,
        failure: {
          class: "engine",
          code: cleaned.failure.code,
          message: cleaned.failure.message,
          retryable: false,
          evidence: [],
        },
      };
    }

    // Collect against a much higher safety cap than what is actually
    // returned — a real page (Wikipedia, any content-heavy site) can
    // carry thousands of nav links, most unnamed or navigational noise.
    // Cutting at the final MAX_ELEMENTS *during* traversal would keep
    // whatever appears first in DOM order and silently drop the actual
    // form fields further down the page; instead every element is
    // gathered up to the safety cap, then the ones an MCP caller would
    // actually bind a TestCase to (named Fields/Actions) are kept first.
    const allElements: SemanticUiElement[] = [];
    const limitations: string[] = [];
    collectSemanticElements(cleaned.value.sanitized_tree, undefined, allElements, limitations);

    const maxElements = clampMaxElements(request.max_elements);
    const elements = prioritizeElements(allElements, maxElements);
    if (allElements.length > elements.length) {
      limitations.push(`truncated_to_${elements.length}_of_${allElements.length}_elements`);
    }
    // Dogfood GAP-4: discovery does not enumerate <option> children; multi-select
    // needs caller-supplied option_label(s). Surface that limitation explicitly.
    if (elements.some((el) => el.interaction_hint === "selectable")) {
      limitations.push("selectable_options_not_enumerated_supply_option_label_or_option_labels");
    }

    let screenshot_path: string | undefined;
    if (request.include_screenshot === true) {
      const dir = request.screenshot_dir ?? defaultScreenshotDir(request.operation_id);
      screenshot_path = await capturePageScreenshot(page, dir, sanitizeBasename(request.operation_id));
      if (screenshot_path === undefined) {
        limitations.push("screenshot_capture_failed");
      }
    }

    const map: SemanticUiMap = {
      schema_version: "1.0.0",
      workspace_id: request.context.workspace_id,
      source_url: request.url,
      capture_id: cleaned.value.capture_id,
      captured_at: capturedAt,
      elements: Object.freeze(elements),
      limitations: Object.freeze(limitations),
      ...(screenshot_path !== undefined ? { screenshot_path } : {}),
    };
    return { ok: true, value: map };
  }
}

/**
 * Maps the cleaned DOM tree into the SPEC-101 Page/Field/Action subset:
 * the root is the Page, any node with an `editable`/`selectable`
 * interaction hint is a Field, any `clickable`/`navigable` node is an
 * Action. Region/Validation/Navigation/Workflow/State/Permission are not
 * mapped here (Phase 1 scope, see module docstring) — a node that doesn't
 * fit Page/Field/Action is simply not emitted, never forced into the
 * wrong concept.
 */
function collectSemanticElements(
  node: CleanedDomNode,
  parentId: string | undefined,
  out: SemanticUiElement[],
  limitations: string[],
  isRoot = true,
): void {
  if (out.length >= TRAVERSAL_SAFETY_CAP) {
    if (!limitations.includes("traversal_safety_cap_reached")) limitations.push("traversal_safety_cap_reached");
    return;
  }

  const kind = isRoot
    ? "page"
    : node.interaction_hint === "editable" || node.interaction_hint === "selectable"
      ? "field"
      : node.interaction_hint === "clickable" || node.interaction_hint === "navigable"
        ? "action"
        : undefined;

  let thisId = parentId;
  if (kind !== undefined) {
    thisId = node.node_id;
    out.push({
      id: node.node_id,
      kind,
      ...(node.accessible_name !== undefined ? { accessible_name: node.accessible_name } : {}),
      ...(node.accessible_role !== undefined ? { accessible_role: node.accessible_role } : {}),
      ...(!isRoot && parentId !== undefined ? { parent_id: parentId } : {}),
      ...(node.interaction_hint !== undefined ? { interaction_hint: node.interaction_hint } : {}),
      source_node_id: node.node_id,
      confidence: 1.0,
    });
  }

  for (const child of node.children) {
    collectSemanticElements(child, thisId, out, limitations, false);
  }
}

/**
 * A `page` element and every named Field/Action (the ones a caller can
 * actually write an acceptance criterion against, per `generate-test-cases.ts`'s
 * name-matching) are kept first, in original DOM order; unnamed
 * navigational noise (the majority of nodes on a content-heavy page like
 * Wikipedia) fills any remaining budget only after that. This is a
 * priority reordering, never a fabrication — every element returned was
 * really discovered; only which subset survives the limit changes.
 */
function prioritizeElements(
  elements: readonly SemanticUiElement[],
  limit: number,
): readonly SemanticUiElement[] {
  if (elements.length <= limit) return elements;
  const named = elements.filter((element) => element.kind === "page" || element.accessible_name !== undefined);
  const unnamed = elements.filter((element) => element.kind !== "page" && element.accessible_name === undefined);
  return [...named, ...unnamed].slice(0, limit);
}

function clampMaxElements(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return MAX_ELEMENTS;
  return Math.min(2_000, Math.max(20, Math.floor(raw)));
}

function sanitizeBasename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "capture";
}
