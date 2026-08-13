/**
 * Phase 10 depth portfolio smokes: WCAG-subset heuristics, optional
 * axe-core stage, navigation perf threshold, and light security
 * heuristics. Not a pen-test, not full WCAG certification. Critical
 * findings are never hidden by green counts (SPEC-212 §6 pattern).
 */
import AxeBuilder from "@axe-core/playwright";
import { type Browser, type Page } from "playwright";

import { createLaunchBrowser, type BrowserName } from "../adapters/playwright/browser-launcher.js";
import type { WorkspaceAuthorizer, WorkspaceContext } from "../requirement-review/public.js";

export type DepthSmokeStage = "a11y_subset" | "axe" | "perf" | "security";

export type DepthSmokeSeverity = "critical" | "high" | "medium" | "low";

export type DepthSmokeFinding = Readonly<{
  id: string;
  stage: DepthSmokeStage;
  category: string;
  severity: DepthSmokeSeverity;
  message: string;
  evidence: readonly string[];
}>;

export type DepthSmokeReport = Readonly<{
  id: string;
  workspace_id: string;
  source_url: string;
  browser: BrowserName;
  stages: readonly DepthSmokeStage[];
  findings: readonly DepthSmokeFinding[];
  summary: Readonly<{ critical: number; high: number; medium: number; low: number }>;
  /** True when any critical finding exists — callers must not treat pass counts as release-ready. */
  has_critical: boolean;
  perf?: Readonly<{
    load_event_end_ms: number | null;
    threshold_ms: number;
    within_threshold: boolean | null;
  }>;
  limitations: readonly string[];
  evidence: readonly string[];
  timing: Readonly<{ started_at: string; completed_at: string; duration_seconds: number }>;
}>;

export type DepthSmokeFailure = Readonly<{
  class: "configuration" | "authorization" | "infrastructure";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type RunDepthSmokesRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  url: string;
  stages?: readonly DepthSmokeStage[];
  browser?: BrowserName;
  /** Perf gate — default 3000ms to loadEventEnd. */
  perf_threshold_ms?: number;
}>;

export type RunDepthSmokesDependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  clock: { now(): Date };
  ids: { next(scope: "report" | "finding"): string };
  launchBrowser?: () => Promise<Browser>;
}>;

/** Default portfolio — axe is opt-in (`stages` includes `"axe"`). */
const DEFAULT_STAGES: readonly DepthSmokeStage[] = ["a11y_subset", "perf", "security"];
const KNOWN_STAGES: readonly DepthSmokeStage[] = ["a11y_subset", "axe", "perf", "security"];

export class RunDepthSmokes {
  readonly #dependencies: RunDepthSmokesDependencies;

  constructor(dependencies: RunDepthSmokesDependencies) {
    this.#dependencies = dependencies;
  }

  async run(
    request: RunDepthSmokesRequest,
  ): Promise<
    | Readonly<{ ok: true; value: DepthSmokeReport }>
    | Readonly<{ ok: false; failure: DepthSmokeFailure }>
  > {
    const url = request.url.trim();
    if (!url || !/^(https?:|data:)/i.test(url)) {
      return fail("configuration", "url must be an http(s) or data: URL.", false, ["depth-smoke:invalid-url"]);
    }
    const stages = request.stages?.length ? [...new Set(request.stages)] : [...DEFAULT_STAGES];
    for (const stage of stages) {
      if (!KNOWN_STAGES.includes(stage)) {
        return fail("configuration", `Unknown depth stage "${stage}".`, false, ["depth-smoke:bad-stage"]);
      }
    }

    const authorization = await this.#dependencies.authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "run depth smokes",
      consequence_class: "advisory",
      required_permissions: ["discovery:observe"],
      resource_refs: [`workspace:${request.workspace_id}`, `url:${url}`],
    });
    if (!authorization.ok) {
      return fail(
        "authorization",
        authorization.failure.message,
        authorization.failure.retryable,
        [...authorization.failure.evidence],
      );
    }
    if (request.workspace_id !== request.context.workspace_id) {
      return fail("authorization", "Workspace mismatch.", false, [
        `context-workspace:${request.context.workspace_id}`,
        `requested-workspace:${request.workspace_id}`,
      ]);
    }

    const browserName = request.browser ?? "chromium";
    const launch = this.#dependencies.launchBrowser ?? createLaunchBrowser(browserName);

    const startedAt = this.#dependencies.clock.now();
    let browser: Browser;
    try {
      browser = await launch();
    } catch (error) {
      return fail(
        "infrastructure",
        `Browser launch failed: ${(error as Error).message}`,
        true,
        [`browser:${browserName}`, "depth-smoke:launch-failed"],
      );
    }

    const findings: DepthSmokeFinding[] = [];
    let perf: DepthSmokeReport["perf"];
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

        if (stages.includes("a11y_subset")) {
          findings.push(...(await collectA11ySubset(page, this.#dependencies.ids, url)));
        }
        if (stages.includes("axe")) {
          findings.push(...(await collectAxe(page, this.#dependencies.ids, url)));
        }
        if (stages.includes("perf")) {
          const threshold = request.perf_threshold_ms ?? 3_000;
          const perfResult = await collectPerf(page, this.#dependencies.ids, url, threshold);
          findings.push(...perfResult.findings);
          perf = perfResult.perf;
        }
        if (stages.includes("security")) {
          findings.push(...(await collectSecurity(page, this.#dependencies.ids, url)));
        }
      } finally {
        await page.close();
        await context.close();
      }
    } catch (error) {
      return fail(
        "infrastructure",
        `Depth smoke navigation/eval failed: ${(error as Error).message}`,
        true,
        [`url:${url}`, "depth-smoke:nav-failed"],
      );
    } finally {
      await browser.close();
    }

    const completedAt = this.#dependencies.clock.now();
    const summary = summarize(findings);
    const evidence = unique([
      ...authorization.value.decision_evidence,
      `url:${url}`,
      `browser:${browserName}`,
      ...stages.map((s) => `stage:${s}`),
      ...findings.flatMap((f) => f.evidence),
    ]);

    return {
      ok: true,
      value: {
        id: this.#dependencies.ids.next("report"),
        workspace_id: request.workspace_id,
        source_url: url,
        browser: browserName,
        stages,
        findings,
        summary,
        has_critical: summary.critical > 0,
        ...(perf !== undefined ? { perf } : {}),
        limitations: [
          stages.includes("axe")
            ? "axe-core stage reports engine violations — still not a full WCAG certification claim."
            : "Not axe-core / full WCAG conformance — heuristic subset only (pass stages:[\"axe\"] for axe-core).",
          "Perf uses PerformanceNavigationTiming when available; SPA soft-nav may under-report.",
          "Security heuristics are smoke-level — not a penetration test.",
          "Critical findings MUST block a cheerful green summary (SPEC-212 §6 pattern).",
        ],
        evidence,
        timing: {
          started_at: startedAt.toISOString(),
          completed_at: completedAt.toISOString(),
          duration_seconds: Math.max(0, (completedAt.getTime() - startedAt.getTime()) / 1000),
        },
      },
    };
  }
}

async function collectA11ySubset(
  page: Page,
  ids: { next(scope: "report" | "finding"): string },
  url: string,
): Promise<DepthSmokeFinding[]> {
  const snapshot = (await page.evaluate(`(() => {
    const htmlLang = document.documentElement.getAttribute("lang")?.trim() || "";
    const title = document.title?.trim() || "";
    const images = Array.from(document.querySelectorAll("img"));
    const missingAlt = images.filter((img) => !img.hasAttribute("alt")).length;
    return { htmlLang, title, imageCount: images.length, missingAlt };
  })()`)) as Readonly<{
    htmlLang: string;
    title: string;
    imageCount: number;
    missingAlt: number;
  }>;

  const findings: DepthSmokeFinding[] = [];
  if (!snapshot.htmlLang) {
    findings.push({
      id: ids.next("finding"),
      stage: "a11y_subset",
      category: "missing_html_lang",
      severity: "high",
      message: "Document <html> has no lang attribute (WCAG 3.1.1 Language of Page — subset).",
      evidence: [`url:${url}`, "a11y:html-lang:missing"],
    });
  }
  if (!snapshot.title) {
    findings.push({
      id: ids.next("finding"),
      stage: "a11y_subset",
      category: "missing_document_title",
      severity: "medium",
      message: "Document title is empty (WCAG 2.4.2 Page Titled — subset).",
      evidence: [`url:${url}`, "a11y:title:missing"],
    });
  }
  if (snapshot.missingAlt > 0) {
    findings.push({
      id: ids.next("finding"),
      stage: "a11y_subset",
      category: "image_missing_alt",
      severity: "critical",
      message: `${snapshot.missingAlt} of ${snapshot.imageCount} <img> element(s) lack an alt attribute (WCAG 1.1.1 — subset).`,
      evidence: [`url:${url}`, `a11y:img-missing-alt:${snapshot.missingAlt}`],
    });
  }
  return findings;
}

async function collectAxe(
  page: Page,
  ids: { next(scope: "report" | "finding"): string },
  url: string,
): Promise<DepthSmokeFinding[]> {
  const results = await new AxeBuilder({ page }).analyze();
  const findings: DepthSmokeFinding[] = [];
  for (const violation of results.violations) {
    const impact = violation.impact ?? "moderate";
    const severity: DepthSmokeSeverity =
      impact === "critical" ? "critical" : impact === "serious" ? "high" : impact === "moderate" ? "medium" : "low";
    const nodes = violation.nodes.length;
    findings.push({
      id: ids.next("finding"),
      stage: "axe",
      category: `axe:${violation.id}`,
      severity,
      message: `${violation.help} (${nodes} node(s); axe impact=${impact}).`,
      evidence: [
        `url:${url}`,
        `axe:rule:${violation.id}`,
        `axe:impact:${impact}`,
        `axe:nodes:${nodes}`,
        ...(violation.tags.slice(0, 4).map((tag) => `axe:tag:${tag}`)),
      ],
    });
  }
  return findings;
}

async function collectPerf(
  page: Page,
  ids: { next(scope: "report" | "finding"): string },
  url: string,
  thresholdMs: number,
): Promise<Readonly<{ findings: DepthSmokeFinding[]; perf: NonNullable<DepthSmokeReport["perf"]> }>> {
  const timing = (await page.evaluate(`(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    if (!nav) return { loadEventEnd: null };
    return { loadEventEnd: nav.loadEventEnd };
  })()`)) as Readonly<{ loadEventEnd: number | null }>;

  const load = timing.loadEventEnd;
  const within = load === null ? null : load <= thresholdMs;
  const findings: DepthSmokeFinding[] = [];
  if (load === null) {
    findings.push({
      id: ids.next("finding"),
      stage: "perf",
      category: "perf_timing_unavailable",
      severity: "low",
      message: "PerformanceNavigationTiming unavailable — perf smoke inconclusive.",
      evidence: [`url:${url}`, "perf:timing:unavailable"],
    });
  } else if (within === false) {
    findings.push({
      id: ids.next("finding"),
      stage: "perf",
      category: "perf_threshold_exceeded",
      severity: "high",
      message: `loadEventEnd ${Math.round(load)}ms exceeds threshold ${thresholdMs}ms.`,
      evidence: [`url:${url}`, `perf:loadEventEnd:${Math.round(load)}`, `perf:threshold:${thresholdMs}`],
    });
  }

  return {
    findings,
    perf: {
      load_event_end_ms: load === null ? null : Math.round(load),
      threshold_ms: thresholdMs,
      within_threshold: within,
    },
  };
}

async function collectSecurity(
  page: Page,
  ids: { next(scope: "report" | "finding"): string },
  url: string,
): Promise<DepthSmokeFinding[]> {
  const snapshot = (await page.evaluate(`(() => {
    const passwordFields = Array.from(document.querySelectorAll('input[type="password"]'));
    const passwordWithoutAutocomplete = passwordFields.filter((el) => {
      const ac = el.getAttribute("autocomplete");
      return ac === null || ac === "" || ac === "off";
    }).length;
    const inlineHandlers = document.querySelectorAll(
      "[onclick],[onerror],[onload],[onmouseover],[onfocus],[onsubmit]",
    ).length;
    const forms = Array.from(document.querySelectorAll("form"));
    const formsToHttp = forms.filter((form) => {
      const action = form.getAttribute("action") || "";
      return /^http:\\/\\//i.test(action);
    }).length;
    return {
      passwordFieldCount: passwordFields.length,
      passwordWithoutAutocomplete,
      inlineHandlers,
      formsToHttp,
    };
  })()`)) as Readonly<{
    passwordFieldCount: number;
    passwordWithoutAutocomplete: number;
    inlineHandlers: number;
    formsToHttp: number;
  }>;

  const findings: DepthSmokeFinding[] = [];
  if (snapshot.formsToHttp > 0) {
    findings.push({
      id: ids.next("finding"),
      stage: "security",
      category: "form_posts_to_http",
      severity: "critical",
      message: `${snapshot.formsToHttp} form(s) post to an http:// action — credentials/data may travel in cleartext.`,
      evidence: [`url:${url}`, `security:form-http:${snapshot.formsToHttp}`],
    });
  }
  if (url.startsWith("http://") && snapshot.passwordFieldCount > 0) {
    findings.push({
      id: ids.next("finding"),
      stage: "security",
      category: "password_over_http",
      severity: "critical",
      message: "Password field(s) present on an http:// page — login may be intercepted.",
      evidence: [`url:${url}`, `security:password-over-http:${snapshot.passwordFieldCount}`],
    });
  }
  if (snapshot.passwordWithoutAutocomplete > 0) {
    findings.push({
      id: ids.next("finding"),
      stage: "security",
      category: "password_autocomplete_weak",
      severity: "medium",
      message: `${snapshot.passwordWithoutAutocomplete} password field(s) missing a useful autocomplete attribute (e.g. current-password).`,
      evidence: [`url:${url}`, `security:password-autocomplete:${snapshot.passwordWithoutAutocomplete}`],
    });
  }
  if (snapshot.inlineHandlers > 0) {
    findings.push({
      id: ids.next("finding"),
      stage: "security",
      category: "inline_event_handlers",
      severity: "medium",
      message: `${snapshot.inlineHandlers} element(s) use inline event handlers — raises XSS surface; confirm CSP.`,
      evidence: [`url:${url}`, `security:inline-handlers:${snapshot.inlineHandlers}`],
    });
  }
  return findings;
}

function summarize(findings: readonly DepthSmokeFinding[]): DepthSmokeReport["summary"] {
  const summary = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    summary[finding.severity] += 1;
  }
  return summary;
}

function fail(
  failureClass: DepthSmokeFailure["class"],
  message: string,
  retryable: boolean,
  evidence: readonly string[],
): Readonly<{ ok: false; failure: DepthSmokeFailure }> {
  return { ok: false, failure: { class: failureClass, message, retryable, evidence } };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
