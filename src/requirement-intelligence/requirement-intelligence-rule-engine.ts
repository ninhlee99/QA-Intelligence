import type {
  DeterministicRuleEngine,
  JsonObject,
  RequirementFindingCategory,
  RequirementStatus,
  RuleEvaluationRequest,
  RuleEvaluationResult,
} from "../requirement-review/public.js";
import { readEnum, readObject, readString } from "../shared/rule-engine-support.js";

const STATUSES_AFTER_DRAFT: ReadonlySet<RequirementStatus> = new Set([
  "in_review",
  "accepted",
  "implemented",
  "verified",
]);

const STATUSES_REQUIRING_BROADER_TRACEABILITY: ReadonlySet<RequirementStatus> = new Set([
  "implemented",
  "verified",
]);

const MIN_TRACEABILITY_EDGES_AFTER_DRAFT = 1;
const MIN_TRACEABILITY_EDGES_AT_IMPLEMENTATION = 2;

/**
 * SPEC-202 §4 (Requirement Contract) and §11 (Traceability), narrowed to
 * what is deterministically checkable today: `traceability[].relationship`
 * is an unconstrained string (no accepted upstream/downstream vocabulary
 * exists yet), so this engine SHALL NOT classify edges by direction — it
 * counts distinct traceability edges against a threshold keyed by lifecycle
 * status instead of asserting a taxonomy nobody has accepted. Duplicate and
 * conflict detection across requirements (SPEC-202 §9) is out of scope: the
 * Assess Requirement Quality Skill this engine plugs into evaluates one
 * Requirement per call and has no corpus-level input to compare against.
 */
export class RequirementIntelligenceRuleEngine implements DeterministicRuleEngine {
  evaluate(request: RuleEvaluationRequest): Promise<RuleEvaluationResult> {
    const requirement = readObject(request.facts, "requirement");
    if (requirement === undefined) {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "invalid_facts",
          message: "The requirement fact is required.",
          retryable: false,
          evidence: [request.evaluation_id],
        },
      });
    }

    const requirementRef = readString(requirement, "ref") ?? "requirement:unknown";
    const findings: JsonObject[] = [];

    if (readString(requirement, "rationale") === undefined) {
      findings.push({
        category: "completeness" satisfies RequirementFindingCategory,
        severity: "medium",
        message: "The requirement has no recorded rationale.",
        evidence: [`${requirementRef}#rationale`, "rule:requirement-has-rationale@1.0.0"],
        next_action: "Record why the requirement exists, not only what it states.",
      });
    }

    const status = readEnum(requirement, "status", [
      "draft",
      "in_review",
      "accepted",
      "implemented",
      "verified",
      "deprecated",
      "superseded",
    ] as const);
    const traceability = requirement["traceability"];
    const edgeCount = Array.isArray(traceability) ? traceability.length : 0;

    // Check the stricter (implemented/verified, 2-edge) requirement FIRST:
    // both status sets can be simultaneously true for the same status, and
    // an implemented/verified requirement with 0 edges is a broadly-
    // traceable gap, not merely an after-draft gap — checking the looser
    // condition first would have reported the wrong, less specific finding
    // for exactly that case.
    if (
      status !== undefined &&
      STATUSES_REQUIRING_BROADER_TRACEABILITY.has(status) &&
      edgeCount < MIN_TRACEABILITY_EDGES_AT_IMPLEMENTATION
    ) {
      findings.push({
        category: "traceability" satisfies RequirementFindingCategory,
        severity: "high",
        message: `A requirement in status "${status}" has only ${edgeCount} traceability edge(s); SPEC-202 §11 expects both upstream intent and downstream impact to be traceable by this stage.`,
        evidence: [`${requirementRef}#traceability`, "rule:requirement-broadly-traceable-at-implementation@1.0.0"],
        next_action: "Record traceability to both the originating intent and at least one downstream artifact (risk, design, rule, test, automation, execution evidence, defect, or release).",
      });
    } else if (status !== undefined && STATUSES_AFTER_DRAFT.has(status) && edgeCount < MIN_TRACEABILITY_EDGES_AFTER_DRAFT) {
      findings.push({
        category: "traceability" satisfies RequirementFindingCategory,
        severity: "high",
        message: `A requirement in status "${status}" has no traceability edge.`,
        evidence: [`${requirementRef}#traceability`, "rule:requirement-traceable-after-draft@1.0.0"],
        next_action: "Record at least one traceability relationship before leaving draft status.",
      });
    }

    if (findings.length > 0) {
      return Promise.resolve(successfulRuleEvaluation(request, "not_satisfied", findings));
    }
    return Promise.resolve(
      successfulRuleEvaluation(request, "satisfied", [], [
        "all deterministic requirement-intelligence rules satisfied",
      ]),
    );
  }
}

function successfulRuleEvaluation(
  request: RuleEvaluationRequest,
  outcome: "satisfied" | "not_satisfied",
  findings: readonly JsonObject[],
  explanation: readonly string[] = ["deterministic requirement-intelligence gaps found"],
): Extract<RuleEvaluationResult, { ok: true }> {
  return {
    ok: true,
    value: {
      outcome,
      rule_set: { ...request.rule_set },
      rule_versions: [
        { id: "requirement-has-rationale", version: "1.0.0" },
        { id: "requirement-traceable-after-draft", version: "1.0.0" },
        { id: "requirement-broadly-traceable-at-implementation", version: "1.0.0" },
      ],
      matched_conditions: findings.map((finding) => readString(finding, "category") ?? "quality-gap"),
      relevant_facts: request.fact_provenance,
      outputs: { findings },
      conflicts: [],
      missing_facts: [],
      explanation_trace: [...explanation],
      policy_version: request.context.policy_version,
      duration_ms: 0,
    },
  };
}
