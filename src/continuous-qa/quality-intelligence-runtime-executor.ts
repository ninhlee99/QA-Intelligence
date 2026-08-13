import type { AgentRunExecutor, AgentRunExecutorInput, AgentRunExecutorResult } from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { JsonObject, VersionReference, WorkspaceAuthorizer } from "../requirement-review/public.js";
import { selectIncrementalTests, type SelectableTestCase } from "./incremental-test-selection.js";
import { assessQualityTrend, type QualityWindow } from "./quality-trend.js";
import { assessApiContractDrift, type ApiContract } from "../deep-testing/api-contract-drift.js";
import { assessPerformanceBudget } from "../deep-testing/performance-budget.js";
import { generateStateJourneys, type StateTransition } from "../deep-testing/state-model-journeys.js";
import { assessMutationAdequacy } from "../deep-testing/mutation-adequacy.js";
import { buildResponsiveMatrix } from "../deep-testing/responsive-matrix.js";

export class QualityIntelligenceRuntimeExecutor implements AgentRunExecutor {
  constructor(private readonly dependencies: Readonly<{ authorizer: WorkspaceAuthorizer; expected_agent: VersionReference; expected_skill: VersionReference; mode: "continuous" | "deep" }>) {}
  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const { expected_agent: agent, expected_skill: skill } = this.dependencies;
    if (input.start_request.agent.id !== agent.id || !(input.start_request.allowed_skills ?? []).some((item) => item.id === skill.id && item.version === skill.version)) return { ok: false, failure: failure("policy", "authorization_denied", "Quality intelligence Skill is not retained.") };
    const authorization = await this.dependencies.authorizer.authorize({ operation_id: input.execution.operation_id, context: input.execution.workspace_context, purpose: `${this.dependencies.mode} QA analysis`, consequence_class: "advisory", required_permissions: ["execution:read"], resource_refs: [`workspace:${input.reference.workspace_id}`] });
    if (!authorization.ok) return { ok: false, failure: failure("policy", "authorization_denied", authorization.failure.message) };
    const raw = input.start_request.input;
    let output: JsonObject;
    try {
      output = this.dependencies.mode === "continuous" ? {
        selection: selectIncrementalTests({ changed_paths: strings(raw["changed_paths"]), cases: array(raw["cases"]) as unknown as SelectableTestCase[], critical_smoke_ids: strings(raw["critical_smoke_ids"]) }) as unknown as JsonObject,
        trend: assessQualityTrend({ windows: array(raw["quality_windows"]) as unknown as QualityWindow[], max_pass_rate_drop: number(raw["max_pass_rate_drop"], .03), max_flake_rate: number(raw["max_flake_rate"], .05), max_escaped_defects: number(raw["max_escaped_defects"], 0) }) as unknown as JsonObject,
      } : {
        responsive_matrix: buildResponsiveMatrix(strings(raw["browsers"])) as unknown as JsonObject,
        api_contract: assessApiContractDrift({ baseline: object(raw["api_baseline"]) as ApiContract, candidate: object(raw["api_candidate"]) as ApiContract }) as unknown as JsonObject,
        performance: assessPerformanceBudget({ observations: array(raw["performance_observations"]) as never[], budgets: object(raw["performance_budgets"]) as Readonly<Record<string, number>> }) as unknown as JsonObject,
        state_model: generateStateJourneys({ initial_state: String(raw["initial_state"] ?? ""), transitions: array(raw["transitions"]) as unknown as StateTransition[], max_steps: number(raw["max_steps"], 20) }) as unknown as JsonObject,
        mutation: assessMutationAdequacy({ mutants: array(raw["mutants"]) as never[], minimum_score: number(raw["minimum_mutation_score"], .8) }) as unknown as JsonObject,
      };
    } catch (error) { return { ok: false, failure: failure("orchestration", "invalid_request", `Invalid quality intelligence input: ${(error as Error).message}`) }; }
    const skillRef = `${skill.id}@${skill.version}`;
    return { ok: true, value: { output, output_validated: true, satisfied_evidence_requirements: [], resolved_versions: { agent: `${agent.id}@${agent.version}`, skill: skillRef }, rule_results: [], skill_usage: [skillRef], tool_usage: [], citations: [], uncertainty: { level: "none", reasons: [] }, policy_events: ["execution:read:allowed"], usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 }, evidence: [`quality-intelligence:${this.dependencies.mode}`], cleanup_status: "not_required", knowledge_candidates: [] } };
  }
}
function array(value: unknown): readonly unknown[] { if (!Array.isArray(value)) throw new Error("required array missing"); return value; }
function strings(value: unknown): string[] { return array(value).filter((item): item is string => typeof item === "string"); }
function object(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("required object missing"); return value as Record<string, unknown>; }
function number(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
