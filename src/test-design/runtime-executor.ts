import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type { RequirementResolver } from "../requirement-review/runtime-executor.js";
import type { DiscoverUiSurface } from "../discovery/discover-ui-surface.js";
import type { GenerateTestCases } from "./generate-test-cases.js";
import type { TestCase, TestCaseGenerationFinding } from "./public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

/**
 * Composes two already-governed Skills — Discovery (Phase 1) then Test
 * Design generation (Phase 3) — behind one Agent Runtime run, so a caller
 * gets "requirement + URL in, generated TestCases out" without composing
 * multiple MCP calls itself (docs/proposals/professional-qa-mcp-roadmap.md
 * Phase 3 Definition of Done). Each inner Skill still runs its own
 * authorization independently; this executor adds no authority of its own.
 */
export type GenerateTestCasesRuntimeExecutorDependencies = Readonly<{
  requirements: RequirementResolver;
  discovery: DiscoverUiSurface;
  generator: GenerateTestCases;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class GenerateTestCasesRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: GenerateTestCasesRuntimeExecutorDependencies;

  constructor(dependencies: GenerateTestCasesRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const requirementRef = input.start_request.input["requirement_ref"];
    const url = input.start_request.input["url"];
    if (typeof requirementRef !== "string" || requirementRef.trim().length === 0) {
      return { ok: false, failure: failure("orchestration", "invalid_request", "Test Case generation requires an exact requirement_ref input.") };
    }
    if (typeof url !== "string" || url.trim().length === 0) {
      return { ok: false, failure: failure("orchestration", "invalid_request", "Test Case generation requires an exact url input.") };
    }

    // Two sources of acceptance criteria: an inline caller-supplied array
    // (ad hoc, unapproved intent — this executor never widens its own
    // `advisory` consequence class to accept it, per SPEC-512 §9's
    // "inline flow permitted only for advisory/reversible" constraint) or
    // an already-reviewed Requirement resolved by ref (the seeded-demo
    // path this executor originally shipped with). Exactly one is used —
    // an inline array, when present, is the caller's explicit authority
    // and is never silently merged with or overridden by seed data.
    const inlineCriteria = readAcceptanceCriteriaArray(input.start_request.input["acceptance_criteria"]);
    let requirementTitle: string;
    let acceptanceCriteria: readonly JsonObject[];
    if (inlineCriteria !== undefined) {
      const title = input.start_request.input["requirement_title"];
      requirementTitle = typeof title === "string" && title.trim().length > 0 ? title : requirementRef;
      acceptanceCriteria = inlineCriteria;
    } else {
      const resolved = await this.#dependencies.requirements.resolve({
        operation_id: input.execution.operation_id,
        workspace_id: input.reference.workspace_id,
        context: input.execution.workspace_context,
        requirement_ref: requirementRef,
      });
      if (!resolved.ok) return resolved;
      if (
        `${resolved.value.id}@${resolved.value.version}` !== requirementRef ||
        resolved.value.scope["workspace_id"] !== input.reference.workspace_id
      ) {
        return {
          ok: false,
          failure: failure("policy", "context_contamination", "Resolved requirement does not match the retained reference and Workspace.", false, [requirementRef]),
        };
      }
      requirementTitle = resolved.value.title;
      acceptanceCriteria = resolved.value.acceptance_criteria;
    }

    const discovered = await this.#dependencies.discovery.discover({
      operation_id: input.execution.operation_id,
      context: input.execution.workspace_context,
      url,
    });
    if (!discovered.ok) {
      return {
        ok: false,
        failure: failure(
          discovered.failure.class === "authorization" ? "policy" : "skill",
          discovered.failure.class === "authorization" ? "authorization_denied" : "skill_failure",
          discovered.failure.message,
          discovered.failure.retryable,
          discovered.failure.evidence,
        ),
      };
    }

    const generated = await this.#dependencies.generator.generate({
      operation_id: input.execution.operation_id,
      workspace_id: input.reference.workspace_id,
      context: input.execution.workspace_context,
      requirement_ref: requirementRef,
      requirement_title: requirementTitle,
      acceptance_criteria: acceptanceCriteria,
      ui_map_elements: discovered.value.elements,
      ui_map_source_url: discovered.value.source_url,
    });
    if (!generated.ok) {
      return {
        ok: false,
        failure: failure("policy", "authorization_denied", generated.failure.message, generated.failure.retryable, generated.failure.evidence),
      };
    }

    const evidence = unique([
      `capture:${discovered.value.capture_id}`,
      ...generated.value.test_cases.map((testCase) => `test-case:${testCase.id}`),
      ...generated.value.findings.flatMap((finding) => finding.evidence),
    ]);

    return {
      ok: true,
      value: {
        output: generationResultJson(generated.value.test_cases, generated.value.findings, generated.value.generated_assertions, requirementRef, input.reference.workspace_id),
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [],
        citations: unique([...evidence, `requirement:${requirementRef}`, `source-url:${discovered.value.source_url}`]),
        uncertainty: { level: "none", reasons: [] },
        policy_events: [],
        usage: { steps: 2, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence,
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: GenerateTestCasesRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  const expectedAgent = dependencies.expected_agent;
  if (
    input.start_request.agent.id !== expectedAgent.id ||
    input.start_request.agent.version !== expectedAgent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the Test Case Generation executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Generate Test Cases is not present in retained Skill authority.");
  }
  return undefined;
}

function generationResultJson(
  testCases: readonly TestCase[],
  findings: readonly TestCaseGenerationFinding[],
  generatedAssertions: readonly import("./public.js").TestCaseGeneratedAssertion[],
  requirementRef: string,
  workspaceId: string,
): JsonObject {
  return {
    schema_version: "1.0.0",
    workspace_id: workspaceId,
    requirement_ref: requirementRef,
    test_cases: testCases.map((testCase) => ({
      id: testCase.id,
      version: testCase.version,
      status: testCase.status,
      purpose: testCase.purpose,
      traceability: [...testCase.traceability],
      preconditions: [...testCase.preconditions],
      workspace_scope: testCase.workspace_scope,
      steps: testCase.steps.map((step) => ({ action: step.action, input: step.input ?? {} })),
      expected_results: testCase.expected_results.map((result) => ({ assertion: result.assertion, authority: result.authority })),
      owner: testCase.owner,
      priority: testCase.priority ?? null,
      tags: [...(testCase.tags ?? [])],
    })),
    findings: findings.map((finding) => ({
      id: finding.id,
      category: finding.category,
      message: finding.message,
      evidence: [...finding.evidence],
    })),
    generated_assertions: generatedAssertions.map((assertion) => ({
      test_case_id: assertion.test_case_id,
      expected_text: assertion.expected_text ?? null,
      forbidden_text: [...(assertion.forbidden_text ?? [])],
      expect_no_dialog: assertion.expect_no_dialog ?? false,
    })),
  };
}

/** Only a well-formed array of plain objects counts as inline criteria — anything else (missing, wrong shape) falls back to the seeded Requirement Resolver path rather than silently producing zero test cases. */
function readAcceptanceCriteriaArray(value: JsonValue | undefined): readonly JsonObject[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const objects: JsonObject[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return undefined;
    objects.push(entry as JsonObject);
  }
  return objects;
}
