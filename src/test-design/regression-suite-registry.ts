/**
 * SPEC-208/207 companion: Workspace regression suite registry — persist
 * packs of browser TestCases (+ generated assertions) and/or API smoke
 * cases, then re-run later. In-memory for the MCP session (dev tracer).
 */
import type { ApiSmokeCase } from "../api-testing/public.js";
import type { TestCase, TestCaseGeneratedAssertion } from "../test-design/public.js";

export type BrowserRegressionCase = Readonly<{
  kind: "browser";
  test_case: TestCase;
  generated_assertion: TestCaseGeneratedAssertion;
}>;

export type ApiRegressionCase = Readonly<{
  kind: "api";
  case: ApiSmokeCase;
}>;

export type RegressionCase = BrowserRegressionCase | ApiRegressionCase;

export type RegressionSuite = Readonly<{
  id: string;
  workspace_id: string;
  label: string;
  environment_ref?: string;
  base_url?: string;
  cases: readonly RegressionCase[];
  registered_at: string;
}>;

export type RegisterRegressionSuiteInput = Readonly<{
  workspace_id: string;
  id?: string;
  label: string;
  environment_ref?: string;
  base_url?: string;
  cases: readonly RegressionCase[];
}>;

export class InMemoryRegressionSuiteRegistry {
  readonly #byWorkspace = new Map<string, Map<string, RegressionSuite>>();
  readonly #clock: { now(): Date };

  constructor(clock: { now(): Date } = { now: () => new Date() }) {
    this.#clock = clock;
  }

  register(input: RegisterRegressionSuiteInput):
    | Readonly<{ ok: true; suite: RegressionSuite }>
    | Readonly<{ ok: false; code: "invalid_input"; message: string }> {
    if (input.workspace_id.trim().length === 0) {
      return { ok: false, code: "invalid_input", message: "workspace_id is required." };
    }
    if (input.label.trim().length === 0) {
      return { ok: false, code: "invalid_input", message: "label is required." };
    }
    if (input.cases.length === 0) {
      return { ok: false, code: "invalid_input", message: "cases must be non-empty." };
    }
    for (const item of input.cases) {
      if (item.kind !== "browser" && item.kind !== "api") {
        return { ok: false, code: "invalid_input", message: 'Each case.kind must be "browser" or "api".' };
      }
    }

    const id = input.id?.trim() || `suite:${input.workspace_id}:${this.#clock.now().valueOf().toString(36)}`;
    const suite: RegressionSuite = {
      id,
      workspace_id: input.workspace_id,
      label: input.label.trim(),
      ...(input.environment_ref?.trim() ? { environment_ref: input.environment_ref.trim() } : {}),
      ...(input.base_url?.trim() ? { base_url: input.base_url.trim() } : {}),
      cases: input.cases,
      registered_at: this.#clock.now().toISOString(),
    };
    let bucket = this.#byWorkspace.get(input.workspace_id);
    if (bucket === undefined) {
      bucket = new Map();
      this.#byWorkspace.set(input.workspace_id, bucket);
    }
    bucket.set(id, suite);
    return { ok: true, suite };
  }

  list(workspaceId: string): readonly Readonly<{ id: string; label: string; case_count: number; registered_at: string }>[] {
    const bucket = this.#byWorkspace.get(workspaceId);
    if (bucket === undefined) return [];
    return [...bucket.values()]
      .map((suite) => ({
        id: suite.id,
        label: suite.label,
        case_count: suite.cases.length,
        registered_at: suite.registered_at,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  get(workspaceId: string, suiteId: string): RegressionSuite | undefined {
    return this.#byWorkspace.get(workspaceId)?.get(suiteId);
  }
}
