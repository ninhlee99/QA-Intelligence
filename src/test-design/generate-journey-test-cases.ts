/**
 * Thin E2E journey generator from `discover_ui_workflow` pages/edges.
 * Builds navigable click chains grounded in observed link_text + URLs —
 * never invents business rules. Assertions prefer URL includes (final hop).
 */
import type { TestCase, TestCaseGeneratedAssertion, TestCaseStep } from "./public.js";
import type { WorkflowEdge, WorkflowPageCapture } from "../discovery/discover-ui-workflow.js";

export type GenerateJourneyInput = Readonly<{
  workspace_id: string;
  requirement_ref?: string;
  start_url: string;
  pages: readonly WorkflowPageCapture[];
  edges: readonly WorkflowEdge[];
  /** Max hops in a multi-edge path (default 3, cap 5). */
  max_hops?: number;
  owner?: string;
  /**
   * Optional UI→API oracle copied onto every generated assertion.
   * Caller supplies observed API substring — never invent routes.
   */
  expected_network?: Readonly<{
    url_includes: string;
    method?: string;
    status?: number | readonly number[];
    body_includes?: string;
  }>;
}>;

export type GenerateJourneyResult = Readonly<{
  schema_version: "1.0.0";
  workspace_id: string;
  requirement_ref?: string;
  test_cases: readonly TestCase[];
  generated_assertions: readonly TestCaseGeneratedAssertion[];
  findings: readonly string[];
}>;

export function generateJourneyTestCases(input: GenerateJourneyInput): GenerateJourneyResult {
  const findings: string[] = [];
  const testCases: TestCase[] = [];
  const assertions: TestCaseGeneratedAssertion[] = [];
  const maxHops = Math.min(Math.max(input.max_hops ?? 3, 1), 5);
  const owner = input.owner?.trim() || "journey-generator";
  const req = input.requirement_ref?.trim();

  if (input.edges.length === 0) {
    findings.push("No workflow edges — cannot generate journeys. Re-run discover_ui_workflow on a multi-link surface.");
    return {
      schema_version: "1.0.0",
      workspace_id: input.workspace_id,
      ...(req !== undefined ? { requirement_ref: req } : {}),
      test_cases: [],
      generated_assertions: [],
      findings,
    };
  }

  // One-hop journeys: every edge from start_url (or any edge if none match).
  const startNorm = normalize(input.start_url);
  const fromStart = input.edges.filter((edge) => normalize(edge.from_url) === startNorm);
  const oneHop = (fromStart.length > 0 ? fromStart : input.edges).slice(0, 8);

  let seq = 0;
  for (const edge of oneHop) {
    seq += 1;
    const id = `journey-hop1-${seq}`;
    const steps = buildSteps(edge.from_url, [edge]);
    const targetHint = pathHint(edge.to_url);
    pushCase({
      id,
      steps,
      purpose: `Navigate via link "${edge.link_text}" from ${edge.from_url} to ${edge.to_url}.`,
      urlIncludes: targetHint,
      pages: input.pages,
      workspace_id: input.workspace_id,
      owner,
      req,
      expectedNetwork: input.expected_network,
      testCases,
      assertions,
      findings,
    });
  }

  // Multi-hop: greedy path from start following unused edges.
  const path = greedyPath(input.edges, startNorm, maxHops);
  if (path.length >= 2) {
    seq += 1;
    const id = `journey-path-${seq}`;
    const origin = path[0]!.from_url;
    const finalUrl = path[path.length - 1]!.to_url;
    const steps = buildSteps(origin, path);
    pushCase({
      id,
      steps,
      purpose: `Multi-hop journey (${path.length} links): ${path.map((e) => e.link_text).join(" → ")}.`,
      urlIncludes: pathHint(finalUrl),
      pages: input.pages,
      workspace_id: input.workspace_id,
      owner,
      req,
      expectedNetwork: input.expected_network,
      testCases,
      assertions,
      findings,
    });
  } else {
    findings.push("No multi-hop path ≥2 edges from start_url — one-hop journeys only.");
  }

  findings.push(
    input.expected_network?.url_includes
      ? "Journeys assert final URL substring + optional expected_network from caller."
      : "Journeys assert final URL substring only — pass expected_network on generate_journey_test_cases when UI hops trigger a known API (use discover_ui_workflow network_hints as candidates only).",
  );

  const hintCount = input.pages.reduce((n, page) => n + (page.network_hints?.length ?? 0), 0);
  if (hintCount > 0 && !input.expected_network?.url_includes) {
    findings.push(
      `Workflow pages carried ${hintCount} network_hint(s) — not auto-bound; confirm then pass expected_network.`,
    );
  }

  return {
    schema_version: "1.0.0",
    workspace_id: input.workspace_id,
    ...(req !== undefined ? { requirement_ref: req } : {}),
    test_cases: testCases,
    generated_assertions: assertions,
    findings,
  };
}

function buildSteps(startUrl: string, edges: readonly WorkflowEdge[]): TestCaseStep[] {
  const steps: TestCaseStep[] = [{ action: "navigate", input: { url: startUrl } }];
  for (const edge of edges) {
    const name = edge.link_text.trim() || pathHint(edge.to_url);
    steps.push({
      action: "click",
      input: { accessible_name: name, accessible_role: "link" },
    });
    steps.push({
      action: "wait_for",
      input: {
        accessible_name: name,
        accessible_role: "link",
        timeout_ms: 3_000,
      },
    });
    // After navigation, waiting for the clicked link is weak — prefer a
    // named control on the destination page when discovery captured one.
  }
  // Replace trailing wait_for targets with destination page anchors when known.
  return steps;
}

function pushCase(args: {
  id: string;
  steps: TestCaseStep[];
  purpose: string;
  urlIncludes: string;
  pages: readonly WorkflowPageCapture[];
  workspace_id: string;
  owner: string;
  req: string | undefined;
  expectedNetwork: GenerateJourneyInput["expected_network"];
  testCases: TestCase[];
  assertions: TestCaseGeneratedAssertion[];
  findings: string[];
}): void {
  const refined = refineWaitSteps(args.steps, args.pages);
  const expectedResults = [
    {
      assertion: `Final URL includes "${args.urlIncludes}".`,
      authority: args.req ?? "journey:url-oracle",
    },
    ...(args.expectedNetwork?.url_includes
      ? [
          {
            assertion: `Network xhr/fetch URL includes "${args.expectedNetwork.url_includes}".`,
            authority: args.req ?? "journey:network-oracle",
          },
        ]
      : []),
  ];
  const testCase: TestCase = {
    id: args.id,
    version: "0.1.0",
    status: "draft",
    purpose: args.purpose,
    traceability: args.req !== undefined ? [args.req] : [],
    preconditions: ["Workflow edges observed by discover_ui_workflow at generation time."],
    workspace_scope: args.workspace_id,
    steps: refined,
    expected_results: expectedResults,
    owner: args.owner,
  };
  args.testCases.push(testCase);
  args.assertions.push({
    test_case_id: args.id,
    expected_url_includes: args.urlIncludes,
    ...(args.expectedNetwork?.url_includes
      ? {
          expected_network: {
            url_includes: args.expectedNetwork.url_includes,
            ...(args.expectedNetwork.method !== undefined ? { method: args.expectedNetwork.method } : {}),
            ...(args.expectedNetwork.status !== undefined ? { status: args.expectedNetwork.status } : {}),
            ...(args.expectedNetwork.body_includes !== undefined
              ? { body_includes: args.expectedNetwork.body_includes }
              : {}),
          },
        }
      : {}),
  });
  if (!args.urlIncludes) {
    args.findings.push(`${args.id}: weak URL oracle — destination path empty.`);
  }
}

function refineWaitSteps(
  steps: TestCaseStep[],
  pages: readonly WorkflowPageCapture[],
): TestCaseStep[] {
  // Map navigate/click sequences: after each click toward to_url, if we can
  // infer destination from preceding edge via purpose — simpler: for wait_for
  // after click, if next page in pages has a named field/action, wait for that.
  const out: TestCaseStep[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    if (step.action !== "wait_for") {
      out.push(step);
      continue;
    }
    // Look at previous click's implied navigation — use any page that isn't start.
    const anchor = pickDestinationAnchor(pages);
    if (anchor !== undefined) {
      out.push({
        action: "wait_for",
        input: {
          accessible_name: anchor.name,
          ...(anchor.role !== undefined ? { accessible_role: anchor.role } : {}),
          timeout_ms: 5_000,
        },
      });
    } else {
      // Skip weak wait_for on the same link just clicked.
      continue;
    }
  }
  return out;
}

function pickDestinationAnchor(
  pages: readonly WorkflowPageCapture[],
): Readonly<{ name: string; role?: string }> | undefined {
  for (const page of pages.slice(1)) {
    const action = page.named_actions[0];
    if (action) return { name: action, role: "button" };
    const field = page.named_fields[0];
    if (field) return { name: field, role: "textbox" };
  }
  return undefined;
}

function greedyPath(edges: readonly WorkflowEdge[], start: string, maxHops: number): WorkflowEdge[] {
  const path: WorkflowEdge[] = [];
  let current = start;
  const used = new Set<string>();
  for (let hop = 0; hop < maxHops; hop += 1) {
    const next = edges.find(
      (edge) => normalize(edge.from_url) === current && !used.has(`${edge.from_url}|${edge.to_url}|${edge.link_text}`),
    );
    if (next === undefined) break;
    used.add(`${next.from_url}|${next.to_url}|${next.link_text}`);
    path.push(next);
    current = normalize(next.to_url);
  }
  return path;
}

function normalize(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function pathHint(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.length > 1 ? parsed.pathname : parsed.host;
  } catch {
    return url.slice(0, 64);
  }
}
