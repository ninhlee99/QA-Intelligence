/**
 * Phase 9 — execute a time-boxed exploratory *session* against a live URL
 * (or prior charter): capture Semantic UI Map per browser, auto-check
 * oracles that can be grounded in the capture, leave the rest as
 * manual_follow_up. Never invents business expected results.
 */
import type { WorkspaceAuthorizer, WorkspaceContext } from "../requirement-review/public.js";
import type { DiscoverUiSurface } from "../discovery/discover-ui-surface.js";
import type { SemanticUiElement } from "../discovery/public.js";
import { type BrowserName } from "../adapters/playwright/browser-launcher.js";
import {
  generateExploratoryCharter,
  type ExploratoryCharter,
} from "./generate-exploratory-charter.js";

export type ExploratoryObservationStatus = "pass" | "fail" | "manual_follow_up" | "blocked";

export type ExploratoryObservation = Readonly<{
  id: string;
  browser: BrowserName;
  kind: "oracle" | "focus_area" | "risk" | "surface";
  subject: string;
  status: ExploratoryObservationStatus;
  note: string;
  evidence: readonly string[];
}>;

export type ExploratoryBrowserCapture = Readonly<{
  browser: BrowserName;
  source_url: string;
  capture_id: string;
  field_count: number;
  action_count: number;
  unlabeled_count: number;
  outcome: "captured" | "infrastructure_error" | "blocked";
  message?: string;
}>;

export type ExploratorySessionResult = Readonly<{
  id: string;
  workspace_id: string;
  charter: ExploratoryCharter;
  browsers: readonly BrowserName[];
  captures: readonly ExploratoryBrowserCapture[];
  observations: readonly ExploratoryObservation[];
  /** Suite-level: infrastructure_error if any browser failed to capture; else completed. */
  outcome: "completed" | "infrastructure_error" | "blocked";
  evidence: readonly string[];
  timing: Readonly<{ started_at: string; completed_at: string; duration_seconds: number }>;
}>;

export type ExploratorySessionFailure = Readonly<{
  class: "configuration" | "authorization" | "infrastructure";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type ExecuteExploratorySessionRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  url?: string;
  charter?: ExploratoryCharter;
  objective?: string;
  requirement_ref?: string;
  /** Defaults to [chromium]. Pass two+ for multi-browser compare. */
  browsers?: readonly BrowserName[];
}>;

export type ExecuteExploratorySessionDependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  clock: { now(): Date };
  ids: { next(scope: "session" | "observation"): string };
  discoverUiSurface: DiscoverUiSurface;
}>;

const LEAK_PATTERNS = [
  /internal server error/i,
  /stack trace/i,
  /exception in thread/i,
  /traceback \(most recent call last\)/i,
  /\bat\s+[\w.$]+\([\w.]+:\d+\)/,
];

export class ExecuteExploratorySession {
  readonly #dependencies: ExecuteExploratorySessionDependencies;

  constructor(dependencies: ExecuteExploratorySessionDependencies) {
    this.#dependencies = dependencies;
  }

  async run(
    request: ExecuteExploratorySessionRequest,
  ): Promise<
    | Readonly<{ ok: true; value: ExploratorySessionResult }>
    | Readonly<{ ok: false; failure: ExploratorySessionFailure }>
  > {
    const browsers = request.browsers?.length ? [...request.browsers] : (["chromium"] as BrowserName[]);
    const uniqueBrowsers = [...new Set(browsers)];
    if (uniqueBrowsers.length === 0) {
      return fail("configuration", "browsers must not be empty.", false, ["exploratory:empty-browsers"]);
    }

    const authorization = await this.#dependencies.authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "execute exploratory session",
      consequence_class: "advisory",
      required_permissions: ["discovery:observe"],
      resource_refs: [`workspace:${request.workspace_id}`],
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

    const startedAt = this.#dependencies.clock.now();
    const captures: ExploratoryBrowserCapture[] = [];
    const observations: ExploratoryObservation[] = [];
    let primaryElements: readonly SemanticUiElement[] | undefined;
    let primaryUrl: string | undefined;

    for (const browser of uniqueBrowsers) {
      const url = request.url?.trim() || request.charter?.source_url?.trim();
      if (!url) {
        return fail(
          "configuration",
          "execute_exploratory_session requires url or a charter.source_url.",
          false,
          ["exploratory:missing-url"],
        );
      }

      const discovered = await this.#dependencies.discoverUiSurface.discover({
        operation_id: `${request.operation_id}:${browser}`,
        context: request.context,
        url,
        browser,
      });

      if (!discovered.ok) {
        const infra = discovered.failure.class === "infrastructure";
        captures.push({
          browser,
          source_url: url,
          capture_id: "",
          field_count: 0,
          action_count: 0,
          unlabeled_count: 0,
          outcome: infra ? "infrastructure_error" : "blocked",
          message: discovered.failure.message,
        });
        observations.push({
          id: this.#dependencies.ids.next("observation"),
          browser,
          kind: "surface",
          subject: `capture on ${browser}`,
          status: infra ? "blocked" : "blocked",
          note: discovered.failure.message,
          evidence: [...discovered.failure.evidence, `browser:${browser}`],
        });
        continue;
      }

      const elements = discovered.value.elements;
      const fields = elements.filter((el) => el.kind === "field");
      const actions = elements.filter((el) => el.kind === "action");
      const unlabeled = elements.filter(
        (el) => (el.kind === "field" || el.kind === "action") && !el.accessible_name?.trim(),
      );
      captures.push({
        browser,
        source_url: discovered.value.source_url,
        capture_id: discovered.value.capture_id,
        field_count: fields.length,
        action_count: actions.length,
        unlabeled_count: unlabeled.length,
        outcome: "captured",
      });
      if (primaryElements === undefined) {
        primaryElements = elements;
        primaryUrl = discovered.value.source_url;
      }

      const pageText = flattenAccessibleText(elements);
      observations.push(...evaluateAutomatedOracles({
        ids: this.#dependencies.ids,
        browser,
        elements,
        pageText,
        captureId: discovered.value.capture_id,
      }));
    }

    const charter =
      request.charter ??
      generateExploratoryCharter({
        elements: primaryElements ?? [],
        ...(primaryUrl !== undefined ? { source_url: primaryUrl } : {}),
        ...(request.objective !== undefined ? { objective: request.objective } : {}),
        ...(request.requirement_ref !== undefined ? { requirement_ref: request.requirement_ref } : {}),
      });

    // Charter oracles / focus / risks that were not auto-checked → manual_follow_up
    // on the primary successful browser (or first browser if none succeeded).
    const noteBrowser =
      captures.find((c) => c.outcome === "captured")?.browser ?? uniqueBrowsers[0]!;
    for (const oracle of charter.oracles) {
      if (observations.some((obs) => obs.kind === "oracle" && obs.subject === oracle)) continue;
      observations.push({
        id: this.#dependencies.ids.next("observation"),
        browser: noteBrowser,
        kind: "oracle",
        subject: oracle,
        status: "manual_follow_up",
        note: "Not auto-checkable from a single Semantic UI Map capture — follow during the time box.",
        evidence: [`browser:${noteBrowser}`, "oracle:manual"],
      });
    }
    for (const focus of charter.focus_areas) {
      observations.push({
        id: this.#dependencies.ids.next("observation"),
        browser: noteBrowser,
        kind: "focus_area",
        subject: focus,
        status: "manual_follow_up",
        note: "Focus area recorded for the tester time box — not auto-executed.",
        evidence: [`browser:${noteBrowser}`, "focus:manual"],
      });
    }

    if (uniqueBrowsers.length >= 2) {
      const okCaptures = captures.filter((c) => c.outcome === "captured");
      if (okCaptures.length >= 2) {
        const [a, b] = okCaptures;
        const deltaFields = Math.abs(a!.field_count - b!.field_count);
        const deltaActions = Math.abs(a!.action_count - b!.action_count);
        observations.push({
          id: this.#dependencies.ids.next("observation"),
          browser: a!.browser,
          kind: "surface",
          subject: `multi-browser parity ${a!.browser} vs ${b!.browser}`,
          status: deltaFields === 0 && deltaActions === 0 ? "pass" : "fail",
          note:
            deltaFields === 0 && deltaActions === 0
              ? "Field/action counts match across browsers for this capture."
              : `Field/action count delta: fields=${deltaFields}, actions=${deltaActions}. Investigate rendering differences.`,
          evidence: [
            `browser:${a!.browser}:fields:${a!.field_count}:actions:${a!.action_count}`,
            `browser:${b!.browser}:fields:${b!.field_count}:actions:${b!.action_count}`,
          ],
        });
      }
    }

    const completedAt = this.#dependencies.clock.now();
    const anyInfra = captures.some((c) => c.outcome === "infrastructure_error");
    const anyOk = captures.some((c) => c.outcome === "captured");
    const outcome = anyInfra ? "infrastructure_error" : anyOk ? "completed" : "blocked";
    const evidence = unique([
      ...authorization.value.decision_evidence,
      ...captures.flatMap((c) =>
        c.capture_id ? [`capture:${c.capture_id}`, `browser:${c.browser}`] : [`browser:${c.browser}:failed`],
      ),
      ...observations.flatMap((o) => o.evidence),
    ]);

    return {
      ok: true,
      value: {
        id: this.#dependencies.ids.next("session"),
        workspace_id: request.workspace_id,
        charter,
        browsers: uniqueBrowsers,
        captures,
        observations,
        outcome,
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

function evaluateAutomatedOracles(input: Readonly<{
  ids: { next(scope: "session" | "observation"): string };
  browser: BrowserName;
  elements: readonly SemanticUiElement[];
  pageText: string;
  captureId: string;
}>): ExploratoryObservation[] {
  const out: ExploratoryObservation[] = [];
  const leakOracle = "No stack traces, raw exception text, or 'internal server error' leaked to the UI.";
  const leaked = LEAK_PATTERNS.some((pattern) => pattern.test(input.pageText));
  out.push({
    id: input.ids.next("observation"),
    browser: input.browser,
    kind: "oracle",
    subject: leakOracle,
    status: leaked ? "fail" : "pass",
    note: leaked
      ? "Leakage pattern matched in accessible text of the capture."
      : "No leakage pattern matched in accessible text of this capture.",
    evidence: [`capture:${input.captureId}`, `browser:${input.browser}`, leaked ? "oracle:leak:hit" : "oracle:leak:clean"],
  });

  const nameOracle = "Accessible names (if present) remain stable and match visible labels.";
  const unlabeled = input.elements.filter(
    (el) => (el.kind === "field" || el.kind === "action") && !el.accessible_name?.trim(),
  );
  out.push({
    id: input.ids.next("observation"),
    browser: input.browser,
    kind: "oracle",
    subject: nameOracle,
    status: unlabeled.length === 0 ? "pass" : "fail",
    note:
      unlabeled.length === 0
        ? "All discovered fields/actions have accessible names on this capture."
        : `${unlabeled.length} interactive element(s) lack accessible names.`,
    evidence: [`capture:${input.captureId}`, `browser:${input.browser}`, `unlabeled:${unlabeled.length}`],
  });

  return out;
}

function flattenAccessibleText(elements: readonly SemanticUiElement[]): string {
  return elements
    .map((el) => [el.accessible_name, el.accessible_role].filter(Boolean).join(" "))
    .join("\n");
}

function fail(
  failureClass: ExploratorySessionFailure["class"],
  message: string,
  retryable: boolean,
  evidence: readonly string[],
): Readonly<{ ok: false; failure: ExploratorySessionFailure }> {
  return { ok: false, failure: { class: failureClass, message, retryable, evidence } };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
