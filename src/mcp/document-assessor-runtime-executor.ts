/**
 * Shared MCP/runtime adapter for document-quality Skills (Phase 7):
 * Risk / TestStrategy / TestCase / Report assessors. Caller supplies the
 * document JSON; this executor never invents content — only runs the
 * injected Skill's review().
 */
import type { JsonObject, JsonValue, VersionReference, WorkspaceContext } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type DocumentQualityFinding = Readonly<{
  id: string;
  category: string;
  severity: string;
  message: string;
  evidence: readonly string[];
  next_action?: string;
}>;

export type DocumentQualityAssessment = Readonly<{
  id: string;
  verdict: string;
  findings: readonly DocumentQualityFinding[];
  evidence: readonly string[];
  questions?: readonly string[];
  uncertainty?: Readonly<{ level: string; reasons: readonly string[] }>;
}>;

export type DocumentQualityReviewFailure = Readonly<{
  class: string;
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type DocumentQualityRuntimeExecutorDependencies = Readonly<{
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  /** JSON input key, e.g. "risk" / "test_strategy" / "test_case" / "report". */
  document_key: string;
  review: (input: Readonly<{
    operation_id: string;
    workspace_id: string;
    context: WorkspaceContext;
    document: JsonObject;
  }>) => Promise<
    | Readonly<{ ok: true; value: DocumentQualityAssessment }>
    | Readonly<{ ok: false; failure: DocumentQualityReviewFailure }>
  >;
}>;

export class DocumentQualityRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: DocumentQualityRuntimeExecutorDependencies;

  constructor(dependencies: DocumentQualityRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const raw = input.start_request.input[this.#dependencies.document_key];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          `${this.#dependencies.document_key} must be a non-empty object matching the governed document contract.`,
        ),
      };
    }
    const document = raw as JsonObject;
    if (Object.keys(document).length === 0) {
      return {
        ok: false,
        failure: failure("orchestration", "invalid_request", `${this.#dependencies.document_key} must not be empty.`),
      };
    }

    const review = await this.#dependencies.review({
      operation_id: input.execution.operation_id,
      workspace_id: input.reference.workspace_id,
      context: input.execution.workspace_context,
      document,
    });
    if (!review.ok) {
      return {
        ok: false,
        failure: failure(
          review.failure.class === "authorization" ? "policy" : "skill",
          review.failure.class === "authorization" ? "authorization_denied" : "skill_failure",
          review.failure.message,
          review.failure.retryable,
          review.failure.evidence,
        ),
      };
    }

    const assessment = review.value;
    return {
      ok: true,
      value: {
        output: {
          id: assessment.id,
          verdict: assessment.verdict,
          findings: assessment.findings.map((finding) => ({
            id: finding.id,
            category: finding.category,
            severity: finding.severity,
            message: finding.message,
            evidence: [...finding.evidence],
            next_action: finding.next_action ?? null,
          })),
          questions: [...(assessment.questions ?? [])],
          evidence: [...assessment.evidence],
          uncertainty: assessment.uncertainty
            ? { level: assessment.uncertainty.level, reasons: [...assessment.uncertainty.reasons] }
            : { level: "none", reasons: [] },
        },
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
        citations: unique([...assessment.evidence]),
        uncertainty: {
          level: (assessment.uncertainty?.level as "none" | "low" | "medium" | "high") ?? "none",
          reasons: [...(assessment.uncertainty?.reasons ?? [])],
        },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [...assessment.evidence],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

/** Map a Skill assessment shape onto the shared MCP output contract. */
export function toDocumentQualityAssessment(assessment: Readonly<{
  id: string;
  verdict: string;
  findings: readonly Readonly<{
    id: string;
    category: string;
    severity: string;
    message: string;
    evidence: readonly string[];
    next_action?: string;
  }>[];
  evidence: readonly string[];
  questions?: readonly string[];
  uncertainty?: Readonly<{ level: string; reasons: readonly string[] }>;
}>): DocumentQualityAssessment {
  return {
    id: assessment.id,
    verdict: assessment.verdict,
    findings: assessment.findings.map((finding) => ({
      id: finding.id,
      category: finding.category,
      severity: finding.severity,
      message: finding.message,
      evidence: [...finding.evidence],
      ...(finding.next_action !== undefined ? { next_action: finding.next_action } : {}),
    })),
    evidence: [...assessment.evidence],
    ...(assessment.questions !== undefined ? { questions: [...assessment.questions] } : {}),
    ...(assessment.uncertainty !== undefined
      ? { uncertainty: { level: assessment.uncertainty.level, reasons: [...assessment.uncertainty.reasons] } }
      : {}),
  };
}

export function toDocumentQualityFailure(failure: Readonly<{
  class: string;
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>): DocumentQualityReviewFailure {
  return {
    class: failure.class,
    message: failure.message,
    retryable: failure.retryable,
    evidence: [...failure.evidence],
  };
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: DocumentQualityRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the document quality executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Document quality Skill is not present in retained Skill authority.");
  }
  return undefined;
}
