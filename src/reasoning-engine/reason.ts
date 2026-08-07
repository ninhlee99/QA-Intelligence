import { isExactVersionReference } from "../shared/rule-engine-support.js";
import type {
  DeterministicRuleEngine,
  JsonObject,
  KnowledgeSearch,
  ReasoningProvider,
  WorkspaceAuthorizer,
} from "../requirement-review/public.js";
import type {
  ReasoningEngineFailure,
  ReasoningEngineOutput,
  ReasoningEngineRequest,
  ReasoningEngineResult,
  ReasoningEngineUncertainty,
} from "./public.js";

export type ReasoningEngineDependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  rules: DeterministicRuleEngine;
  knowledge: KnowledgeSearch;
  reasoningProvider: ReasoningProvider;
}>;

const HIGH_IMPACT_CONSEQUENCE_CLASSES: ReadonlySet<string> = new Set(["controlled_side_effect", "high_consequence"]);

/**
 * SPEC-308 §3's 8-step pipeline: authorize → resolve purpose/risk/output
 * contract → apply deterministic rules → discover/rank governed knowledge →
 * assemble minimal context → invoke bounded AI (only when rules leave the
 * request unresolved) → validate claims/citations/policy → return result.
 * Free function, not a class — no state persists between calls, a
 * structural enforcement of §2's "SHALL NOT... persist conclusions as
 * accepted knowledge," not merely a documented rule.
 */
export async function reason(
  dependencies: ReasoningEngineDependencies,
  request: ReasoningEngineRequest,
): Promise<ReasoningEngineOutput> {
  // Step 1: Authorize Request and Workspace.
  const authorization = await dependencies.authorizer.authorize({
    operation_id: request.operation_id,
    context: request.context,
    purpose: request.purpose,
    consequence_class: request.consequence_class,
    required_permissions: ["reasoning:invoke", "knowledge:read"],
    resource_refs: [`workspace:${request.workspace_id}`],
  });
  if (!authorization.ok) {
    return blocked("missing_authority", authorization.failure.message, authorization.failure.retryable, [
      ...authorization.failure.evidence,
    ]);
  }
  if (request.workspace_id !== request.context.workspace_id) {
    return blocked(
      "missing_authority",
      "The requested Workspace does not match the trusted Workspace context.",
      false,
      [`context-workspace:${request.context.workspace_id}`, `requested-workspace:${request.workspace_id}`],
    );
  }

  // Step 2: Resolve Purpose, Risk, and Output Contract.
  if (request.purpose.trim().length === 0) {
    return blocked("configuration_invalid", "A Reasoning Engine request requires a non-empty purpose.", false, []);
  }
  if (request.ai_capability !== undefined) {
    const { prompt, output_schema: outputSchema, safety_policy: safetyPolicy } = request.ai_capability;
    const invalidReference = [prompt, outputSchema, safetyPolicy].find(
      (reference) => !isExactVersionReference(`${reference.id}@${reference.version}`),
    );
    if (invalidReference !== undefined) {
      return blocked(
        "configuration_invalid",
        "ai_capability.prompt, output_schema, and safety_policy must be exact version references.",
        false,
        [],
      );
    }
  }

  // Step 3: Apply Deterministic Rules.
  const ruleEvaluation = await dependencies.rules.evaluate({
    evaluation_id: `${request.operation_id}:reasoning`,
    context: request.context,
    rule_set: request.rule_set,
    effective_at: request.context.issued_at,
    facts: { purpose: request.purpose, consequence_class: request.consequence_class } as JsonObject,
    fact_provenance: [`operation:${request.operation_id}`],
    requested_decisions: ["reasoning_applicability"],
    trace_level: "summary",
  });
  if (!ruleEvaluation.ok) {
    const code = ruleEvaluation.failure.code === "authorization_denied" ? "missing_authority" : "insufficient_evidence";
    return blocked(code, ruleEvaluation.failure.message, ruleEvaluation.failure.retryable, [
      ...ruleEvaluation.failure.evidence,
    ]);
  }
  const deterministicFindings = readFindings(ruleEvaluation.value.outputs["findings"]);
  const ruleResolved = ruleEvaluation.value.outcome === "satisfied" || ruleEvaluation.value.outcome === "not_satisfied";

  // Step 4: Discover and Rank Governed Knowledge — accepted knowledge
  // only (§2: "SHALL NOT... invent evidence" — a candidate is not yet
  // admissible evidence for a claim).
  const discovery = await dependencies.knowledge.search({
    operation_id: request.operation_id,
    context: request.context,
    query: request.knowledge_query.query,
    scopes: request.knowledge_query.scopes,
    authority_statuses: ["accepted"],
    applicability: request.knowledge_query.applicability,
    limit: 20,
    knowledge_snapshot: "current",
  });
  if (!discovery.ok) {
    // §6: missing authority (the caller isn't allowed to search at all)
    // and policy denial (the caller may search, but this specific query
    // or scope is policy-blocked) are distinct failure modes — "forbidden"
    // is the latter, "unauthorized" the former.
    const code =
      discovery.failure.code === "unauthorized"
        ? "missing_authority"
        : discovery.failure.code === "forbidden"
          ? "policy_denial"
          : "insufficient_evidence";
    return blocked(code, discovery.failure.message, discovery.failure.retryable, [...discovery.failure.evidence]);
  }

  // Step 5: Assemble Minimal Context — bounded to only the hits this
  // request actually retrieved (§8: "Policy SHALL bound context size").
  const authorizedContextRefs = discovery.value.hits.map((hit) => hit.knowledge_ref);
  const requiredHumanAction = HIGH_IMPACT_CONSEQUENCE_CLASSES.has(request.consequence_class)
    ? `Human approval required before acting on this ${request.consequence_class} reasoning result.`
    : null;

  // Step 6: Invoke Bounded AI Capability — only when rules left the
  // request unresolved AND the caller supplied an AI capability (§1:
  // rules run first, AI fills the gap rules leave, not a redundant
  // second opinion when rules already resolved it).
  if (ruleResolved || request.ai_capability === undefined) {
    return resolved({
      status: "rules_only",
      deterministicFindings,
      inferredClaims: [],
      sourceCitations: [],
      contradictions: [],
      uncertainty: ruleResolved
        ? { level: "none", reasons: [] }
        : { level: "high", reasons: ["Deterministic rules did not resolve this request and no AI capability was supplied."] },
      modelIdentity: null,
      policyVersion: ruleEvaluation.value.policy_version,
      workspaceId: request.workspace_id,
      requiredHumanAction,
      indeterminate: !ruleResolved,
    });
  }

  const aiCapability = request.ai_capability;
  const capabilityConstraints = HIGH_IMPACT_CONSEQUENCE_CLASSES.has(request.consequence_class)
    ? ["no_autonomous_execution"]
    : [];
  const generation = await dependencies.reasoningProvider.generate({
    operation_id: request.operation_id,
    context: request.context,
    purpose: request.purpose,
    consequence_class: request.consequence_class,
    capability_constraints: capabilityConstraints,
    prompt: aiCapability.prompt,
    authorized_context_refs: authorizedContextRefs,
    output_schema: aiCapability.output_schema,
    allowed_tools: aiCapability.allowed_tools,
    limits: { max_tokens: 4000, max_cost: 1, timeout_ms: 30_000, max_retries: 1 },
    safety_policy: aiCapability.safety_policy,
  });
  if (!generation.ok) {
    return blocked(mapReasoningFailureCode(generation.failure.code), generation.failure.message, generation.failure.retryable, [
      ...generation.failure.evidence,
    ]);
  }

  // Step 7: Validate Claims, Citations, and Policy — a citation the
  // engine never retrieved is rejected, not trusted (a prompt-injected
  // model could fabricate a plausible-looking ref).
  const retrievedRefs = new Set(authorizedContextRefs);
  const validCitations = generation.value.citations.filter((citation) => retrievedRefs.has(citation));
  const invalidCitations = generation.value.citations.filter((citation) => !retrievedRefs.has(citation));
  const claimsSurvived = validCitations.length > 0 || generation.value.citations.length === 0;

  const uncertaintyReasons = invalidCitations.map(
    (citation) => `Citation "${citation}" does not correspond to any retrieved knowledge reference and was rejected.`,
  );

  // Step 8: Return Result, Evidence, and Uncertainty.
  return resolved({
    status: "ai_invoked",
    deterministicFindings,
    inferredClaims: claimsSurvived ? [generation.value.structured_output] : [],
    sourceCitations: validCitations,
    contradictions: [],
    uncertainty: {
      level: uncertaintyReasons.length > 0 ? "medium" : "none",
      reasons: uncertaintyReasons,
    },
    modelIdentity: { provider_id: generation.value.provider_id, provider_version: generation.value.provider_version, model_id: generation.value.model_id },
    policyVersion: ruleEvaluation.value.policy_version,
    workspaceId: request.workspace_id,
    requiredHumanAction,
    indeterminate: !claimsSurvived,
  });
}

function mapReasoningFailureCode(code: string): ReasoningEngineFailure["code"] {
  switch (code) {
    case "schema_failure":
      return "invalid_output";
    case "safety_refusal":
    case "tool_denied":
      return "unsafe_request";
    case "usage_limit":
    case "timeout":
    case "provider_unavailable":
    case "provider_error":
      return "provider_failure";
    case "authorization_denied":
      return "missing_authority";
    default:
      return "provider_failure";
  }
}

function readFindings(value: unknown): readonly JsonObject[] {
  return Array.isArray(value) ? (value as JsonObject[]) : [];
}

function blocked(
  code: ReasoningEngineFailure["code"],
  message: string,
  retryable: boolean,
  evidence: readonly string[],
): ReasoningEngineOutput {
  return { ok: false, failure: { code, message, retryable, evidence } };
}

function resolved(input: {
  status: "rules_only" | "ai_invoked";
  deterministicFindings: readonly JsonObject[];
  inferredClaims: readonly JsonObject[];
  sourceCitations: readonly string[];
  contradictions: readonly string[];
  uncertainty: ReasoningEngineUncertainty;
  modelIdentity: ReasoningEngineResult["model_identity"];
  policyVersion: string;
  workspaceId: string;
  requiredHumanAction: string | null;
  indeterminate: boolean;
}): ReasoningEngineOutput {
  return {
    ok: true,
    value: {
      outcome: input.indeterminate ? "indeterminate" : "resolved",
      status: input.status,
      deterministic_findings: input.deterministicFindings,
      inferred_claims: input.inferredClaims,
      source_citations: input.sourceCitations,
      contradictions: input.contradictions,
      uncertainty: input.uncertainty,
      model_identity: input.modelIdentity,
      policy_version: input.policyVersion,
      workspace_id: input.workspaceId,
      required_human_action: input.requiredHumanAction,
    },
  };
}
