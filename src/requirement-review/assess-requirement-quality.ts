import type {
  AssessmentUncertainty,
  DeterministicRuleEngine,
  FindingSeverity,
  JsonObject,
  JsonValue,
  KnowledgeSearch,
  KnowledgeSearchHit,
  ReasoningProvider,
  Requirement,
  RequirementAssessment,
  RequirementAssessmentResolvedVersions,
  RequirementFinding,
  RequirementFindingCategory,
  RuleEvaluationRequest,
  RuleEvaluationResult,
  StableResult,
  VersionReference,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "./public.js";

export interface Clock {
  now(): Date;
}

export interface IdFactory {
  next(scope: "assessment" | "finding"): string;
}

export type RequirementReviewRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  requirement: Requirement;
}>;

export type RequirementReviewConfiguration = Readonly<{
  resolved_versions: RequirementAssessmentResolvedVersions;
  limits: Readonly<{
    knowledge_hits: number;
    reasoning_tokens: number;
    reasoning_cost: number;
    reasoning_timeout_ms: number;
  }>;
}>;

export type RequirementReviewFailure = Readonly<{
  class: "configuration" | "authorization" | "knowledge" | "rule" | "provider";
  code: string;
  outcome: "blocked" | "indeterminate";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type RequirementReviewResult = StableResult<
  RequirementAssessment,
  RequirementReviewFailure
>;

type Dependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  knowledge: KnowledgeSearch;
  rules: DeterministicRuleEngine;
  reasoning?: ReasoningProvider;
  clock: Clock;
  ids: IdFactory;
  configuration: RequirementReviewConfiguration;
}>;

/**
 * Deep module for the advisory Assess Requirement Quality Skill.
 * The single review interface owns authorization, Discovery, deterministic
 * assessment, bounded reasoning, evidence and failure attribution order.
 */
export class AssessRequirementQuality {
  readonly #dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }

  async review(request: RequirementReviewRequest): Promise<RequirementReviewResult> {
    if (!hasExactResolvedVersions(this.#dependencies.configuration.resolved_versions)) {
      return {
        ok: false,
        failure: {
          class: "configuration",
          code: "invalid_resolved_versions",
          outcome: "indeterminate",
          message: "Requirement review configuration requires exact immutable version pins.",
          retryable: false,
          evidence: ["configuration:invalid-resolved-versions"],
        },
      };
    }
    const requirementRef = `${request.requirement.id}@${request.requirement.version}`;
    const authorization = await this.#dependencies.authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "assess requirement quality",
      consequence_class: "advisory",
      required_permissions: ["requirement:read", "knowledge:read", "assessment:create"],
      resource_refs: [`workspace:${request.workspace_id}`, requirementRef],
    });

    if (!authorization.ok) {
      return {
        ok: false,
        failure: {
          class: "authorization",
          code: authorization.failure.code,
          outcome: "blocked",
          message: authorization.failure.message,
          retryable: authorization.failure.retryable,
          evidence: [...authorization.failure.evidence],
        },
      };
    }

    if (request.workspace_id !== request.context.workspace_id) {
      return {
        ok: false,
        failure: {
          class: "authorization",
          code: "workspace_scope_mismatch",
          outcome: "blocked",
          message: "The requested Workspace does not match the trusted Workspace context.",
          retryable: false,
          evidence: unique([
            ...authorization.value.decision_evidence,
            `context-workspace:${request.context.workspace_id}`,
            `requested-workspace:${request.workspace_id}`,
          ]),
        },
      };
    }

    const discovery = await this.#dependencies.knowledge.search({
      operation_id: request.operation_id,
      context: request.context,
      query: `${request.requirement.title}\n${request.requirement.statement}`,
      scopes: ["requirements", "business_rules", "glossary", "architecture", "risk"],
      authority_statuses: ["accepted"],
      applicability: { workspace_id: request.workspace_id, capability_id: request.requirement.capability_id },
      limit: this.#dependencies.configuration.limits.knowledge_hits,
      knowledge_snapshot: this.#dependencies.configuration.resolved_versions.knowledge_snapshot,
    });

    if (!discovery.ok) {
      const blocked = discovery.failure.code === "unauthorized" || discovery.failure.code === "forbidden";
      return {
        ok: false,
        failure: {
          class: "knowledge",
          code: discovery.failure.code,
          outcome: blocked ? "blocked" : "indeterminate",
          message: discovery.failure.message,
          retryable: discovery.failure.retryable,
          evidence: [...discovery.failure.evidence],
        },
      };
    }

    const effectiveAt = this.#dependencies.clock.now().toISOString();
    const ruleSet = parseVersionReference(this.#dependencies.configuration.resolved_versions.rule_set);
    const ruleEvaluation = await this.#dependencies.rules.evaluate({
      evaluation_id: `${request.operation_id}:requirement-quality`,
      context: request.context,
      rule_set: ruleSet,
      effective_at: effectiveAt,
      facts: assessmentFacts(request.requirement, discovery.value.hits),
      fact_provenance: unique([
        requirementRef,
        ...request.requirement.source,
        ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.provenance]),
      ]),
      requested_decisions: ["requirement_quality"],
      trace_level: "full",
    });

    if (!ruleEvaluation.ok) {
      return {
        ok: false,
        failure: {
          class: "rule",
          code: ruleEvaluation.failure.code,
          outcome: ruleEvaluation.failure.code === "authorization_denied" ? "blocked" : "indeterminate",
          message: ruleEvaluation.failure.message,
          retryable: ruleEvaluation.failure.retryable,
          evidence: [...ruleEvaluation.failure.evidence],
        },
      };
    }

    if (
      ruleEvaluation.value.rule_set.id !== ruleSet.id ||
      ruleEvaluation.value.rule_set.version !== ruleSet.version ||
      ruleEvaluation.value.policy_version !== request.context.policy_version ||
      !hasExactRuleVersions(ruleEvaluation.value.rule_versions)
    ) {
      return {
        ok: false,
        failure: {
          class: "rule",
          code: "incompatible_version",
          outcome: "indeterminate",
          message: "Rule evaluation returned an unrequested Rule Set or policy version.",
          retryable: false,
          evidence: [
            `requested-rule-set:${ruleSet.id}@${ruleSet.version}`,
            `returned-rule-set:${ruleEvaluation.value.rule_set.id}@${ruleEvaluation.value.rule_set.version}`,
            `requested-policy:${request.context.policy_version}`,
            `returned-policy:${ruleEvaluation.value.policy_version}`,
          ],
        },
      };
    }

    const ruleResultRef = `rule-set:${ruleEvaluation.value.rule_set.id}@${ruleEvaluation.value.rule_set.version}:${ruleEvaluation.value.outcome}`;
    const findings = normalizeFindings(
      ruleEvaluation.value.outputs["findings"],
      this.#dependencies.ids,
      [requirementRef, ruleResultRef],
    );
    const ruleResults = unique([
      ruleResultRef,
      ...ruleEvaluation.value.rule_versions.map((rule) => `rule:${rule.id}@${rule.version}`),
      ...ruleEvaluation.value.explanation_trace,
    ]);
    const baseEvidence = unique([
      requirementRef,
      ...authorization.value.decision_evidence,
      ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.evidence]),
      ...ruleResults,
    ]);

    if (
      ruleEvaluation.value.outcome === "error" ||
      ruleEvaluation.value.outcome === "not_applicable"
    ) {
      return {
        ok: false,
        failure: {
          class: "rule",
          code: `rule_outcome_${ruleEvaluation.value.outcome}`,
          outcome: "indeterminate",
          message: "Deterministic requirement-quality rules did not produce an applicable decision.",
          retryable: false,
          evidence: baseEvidence,
        },
      };
    }

    if (ruleEvaluation.value.outcome !== "indeterminate") {
      return {
        ok: true,
        value: this.#assessment({
          request,
          findings,
          questions: [],
          ruleResults,
          evidence: baseEvidence,
          outcome: "completed",
          verdict:
            ruleEvaluation.value.outcome === "satisfied" && findings.length === 0
              ? "pass"
              : "changes_required",
          uncertainty: { level: "none", reasons: [] },
          knowledgeSnapshot: discovery.value.knowledge_snapshot,
        }),
      };
    }

    const unresolved = unique([
      ...ruleEvaluation.value.missing_facts,
      ...ruleEvaluation.value.conflicts,
    ]);
    const reasoning = this.#dependencies.reasoning;
    if (reasoning === undefined) {
      return {
        ok: true,
        value: this.#assessment({
          request,
          findings,
          questions: unresolvedQuestions(unresolved),
          ruleResults,
          evidence: baseEvidence,
          outcome: "indeterminate",
          verdict: "changes_required",
          uncertainty: {
            level: "high",
            reasons: unresolved.length === 0 ? ["Deterministic assessment is unresolved."] : unresolved,
          },
          knowledgeSnapshot: discovery.value.knowledge_snapshot,
        }),
      };
    }

    const reasoned = await reasoning.generate({
      operation_id: `${request.operation_id}:bounded-reasoning`,
      context: request.context,
      purpose: "assess unresolved semantic gaps",
      consequence_class: "advisory",
      capability_constraints: [
        "Do not invent business intent.",
        "Return uncertainty and a human-answerable question when authority is missing.",
        "Do not approve, edit, or mutate the requirement.",
      ],
      prompt: parseVersionReference(this.#dependencies.configuration.resolved_versions.prompt),
      authorized_context_refs: unique([
        requirementRef,
        ...discovery.value.hits.map((hit) => hit.knowledge_ref),
        ...ruleResults,
      ]),
      output_schema: parseVersionReference(this.#dependencies.configuration.resolved_versions.output_schema),
      allowed_tools: [],
      limits: {
        max_tokens: this.#dependencies.configuration.limits.reasoning_tokens,
        max_cost: this.#dependencies.configuration.limits.reasoning_cost,
        timeout_ms: this.#dependencies.configuration.limits.reasoning_timeout_ms,
        max_retries: 0,
      },
      safety_policy: parseVersionReference(this.#dependencies.configuration.resolved_versions.policy),
    });

    if (!reasoned.ok) {
      return {
        ok: false,
        failure: {
          class: "provider",
          code: reasoned.failure.code,
          outcome: "indeterminate",
          message: reasoned.failure.message,
          retryable: reasoned.failure.retryable,
          evidence: unique([...baseEvidence, ...reasoned.failure.evidence]),
        },
      };
    }

    const providerQuestions = readStrings(reasoned.value.structured_output, "questions");
    const providerQuestion = readString(reasoned.value.structured_output, "question");
    const providerReasons = readStrings(reasoned.value.structured_output, "uncertainty_reasons");
    const providerReason = readString(reasoned.value.structured_output, "uncertainty");
    const questions = unique([
      ...providerQuestions,
      ...(providerQuestion === undefined ? [] : [providerQuestion]),
      ...unresolvedQuestions(unresolved),
    ]);
    const uncertaintyReasons = unique([
      ...providerReasons,
      ...(providerReason === undefined ? [] : [providerReason]),
      ...unresolved,
    ]);

    return {
      ok: true,
      value: this.#assessment({
        request,
        findings,
        questions: questions.length === 0 ? ["Which authoritative evidence resolves the requirement ambiguity?"] : questions,
        ruleResults,
        evidence: unique([
          ...baseEvidence,
          `provider:${reasoned.value.provider_id}@${reasoned.value.provider_version}`,
          ...reasoned.value.citations,
        ]),
        outcome: "indeterminate",
        verdict: "changes_required",
        uncertainty: {
          level: "high",
          reasons: uncertaintyReasons.length === 0 ? ["Business intent is not established by authoritative evidence."] : uncertaintyReasons,
        },
        knowledgeSnapshot: discovery.value.knowledge_snapshot,
      }),
    };
  }

  #assessment(input: Readonly<{
    request: RequirementReviewRequest;
    findings: readonly RequirementFinding[];
    questions: readonly string[];
    ruleResults: readonly string[];
    evidence: readonly string[];
    outcome: RequirementAssessment["outcome"];
    verdict: RequirementAssessment["verdict"];
    uncertainty: AssessmentUncertainty;
    knowledgeSnapshot: string;
  }>): RequirementAssessment {
    return {
      id: this.#dependencies.ids.next("assessment"),
      requirement_ref: `${input.request.requirement.id}@${input.request.requirement.version}`,
      workspace_id: input.request.workspace_id,
      outcome: input.outcome,
      // SPEC-203 §7/§9: "A score SHALL NOT override a critical finding" /
      // "critical failures block acceptance" — enforced explicitly here,
      // as the single choke point before any verdict leaves this Skill, so
      // no future branch can accidentally let a critical finding coexist
      // with a passing verdict.
      verdict: input.findings.some((finding) => finding.severity === "critical")
        ? "rejected"
        : input.verdict,
      findings: [...input.findings],
      questions: [...input.questions],
      rule_results: [...input.ruleResults],
      evidence: [...input.evidence],
      uncertainty: { level: input.uncertainty.level, reasons: [...input.uncertainty.reasons] },
      resolved_versions: {
        ...this.#dependencies.configuration.resolved_versions,
        knowledge_snapshot: input.knowledgeSnapshot,
      },
    };
  }
}

/** Pure, in-process deterministic rules for the initial tracer bullet. */
export class RequirementQualityRuleEngine implements DeterministicRuleEngine {
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

    const findings: JsonObject[] = [];
    const requirementRef = readString(requirement, "ref") ?? "requirement:unknown";
    const acceptanceCriteria = requirement["acceptance_criteria"];
    if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0) {
      findings.push({
        category: "missing_acceptance_criterion",
        severity: "high",
        message: "The requirement has no observable acceptance criterion.",
        evidence: [`${requirementRef}#acceptance_criteria`, "rule:requirement-has-acceptance-criteria@1.0.0"],
        next_action: "Define at least one observable, verifiable acceptance criterion.",
      });
    }

    const source = requirement["source"];
    if (!Array.isArray(source) || source.length === 0) {
      findings.push({
        category: "traceability",
        severity: "high",
        message: "The requirement has no authoritative source.",
        evidence: [`${requirementRef}#source`, "rule:requirement-has-authoritative-source@1.0.0"],
        next_action: "Link the requirement to an authoritative source and retain its exact version.",
      });
    }

    if (findings.length > 0) {
      return Promise.resolve(successfulRuleEvaluation(request, "not_satisfied", findings, [], [
        "deterministic material quality gaps found",
      ]));
    }

    const statement = (readString(requirement, "statement") ?? "").toLowerCase();
    const ambiguousTerms = ["quickly", "easy", "user-friendly", "appropriate", "as needed"].filter((term) =>
      statement.includes(term),
    );
    if (ambiguousTerms.length > 0) {
      return Promise.resolve(successfulRuleEvaluation(
        request,
        "indeterminate",
        [],
        ambiguousTerms.map((term) => `authoritative meaning for '${term}'`),
        ["semantic term requires authoritative clarification"],
      ));
    }

    return Promise.resolve(successfulRuleEvaluation(request, "satisfied", [], [], [
      "all deterministic requirement-quality rules satisfied",
    ]));
  }
}

function successfulRuleEvaluation(
  request: RuleEvaluationRequest,
  outcome: "satisfied" | "not_satisfied" | "indeterminate",
  findings: readonly JsonObject[],
  missingFacts: readonly string[],
  explanation: readonly string[],
): Extract<RuleEvaluationResult, { ok: true }> {
  return {
    ok: true,
    value: {
      outcome,
      rule_set: { ...request.rule_set },
      rule_versions: [
        { id: "requirement-has-acceptance-criteria", version: "1.0.0" },
        { id: "requirement-has-authoritative-source", version: "1.0.0" },
        { id: "requirement-avoids-unbounded-terms", version: "1.0.0" },
      ],
      matched_conditions: findings.map((finding) => readString(finding, "category") ?? "quality-gap"),
      relevant_facts: request.fact_provenance,
      outputs: { findings },
      conflicts: [],
      missing_facts: [...missingFacts],
      explanation_trace: [...explanation],
      policy_version: request.context.policy_version,
      duration_ms: 0,
    },
  };
}

const findingCategories = [
  "atomicity",
  "clarity",
  "completeness",
  "consistency",
  "correctness_against_authority",
  "feasibility",
  "necessity",
  "testability",
  "traceability",
  "applicability",
  "security_and_privacy",
  "workspace_safety",
  "ambiguity",
  "risk",
  "missing_acceptance_criterion",
] as const;

const findingSeverities = ["critical", "high", "medium", "low"] as const;

function normalizeFindings(
  value: JsonValue | undefined,
  ids: IdFactory,
  fallbackEvidence: readonly string[],
): RequirementFinding[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const findings: RequirementFinding[] = [];
  for (const candidate of value) {
    if (!isJsonObject(candidate)) {
      continue;
    }
    const category = readEnum(candidate, "category", findingCategories);
    const severity = readEnum(candidate, "severity", findingSeverities);
    const message = readString(candidate, "message");
    if (category === undefined || severity === undefined || message === undefined) {
      continue;
    }
    const evidence = readStrings(candidate, "evidence");
    findings.push({
      id: ids.next("finding"),
      category: category as RequirementFindingCategory,
      severity: severity as FindingSeverity,
      message,
      evidence: evidence.length === 0 ? [...fallbackEvidence] : unique([...evidence, ...fallbackEvidence]),
      next_action:
        readString(candidate, "next_action") ??
        "Resolve this evidenced requirement-quality gap and re-run the assessment.",
    });
  }
  return findings;
}

function assessmentFacts(requirement: Requirement, knowledge: readonly KnowledgeSearchHit[]): JsonObject {
  return {
    requirement: {
      ref: `${requirement.id}@${requirement.version}`,
      id: requirement.id,
      version: requirement.version,
      status: requirement.status,
      title: requirement.title,
      statement: requirement.statement,
      source: [...requirement.source],
      owner: requirement.owner,
      capability_id: requirement.capability_id,
      scope: requirement.scope,
      rationale: requirement.rationale ?? null,
      acceptance_criteria: [...requirement.acceptance_criteria],
      assumptions: [...(requirement.assumptions ?? [])],
      traceability: requirement.traceability.map((edge) => ({ ...edge })),
    },
    knowledge: knowledge.map((hit) => ({
      knowledge_ref: hit.knowledge_ref,
      title: hit.title,
      excerpt: hit.excerpt,
      authority_status: hit.authority_status,
      provenance: [...hit.provenance],
      evidence: [...hit.evidence],
      relevance: hit.relevance,
    })),
  };
}

function parseVersionReference(value: string): VersionReference {
  const separator = value.lastIndexOf("@");
  if (separator <= 0 || separator === value.length - 1) {
    return { id: value, version: "unresolved" };
  }
  return { id: value.slice(0, separator), version: value.slice(separator + 1) };
}

function hasExactResolvedVersions(
  versions: RequirementAssessmentResolvedVersions,
): boolean {
  const reference = /^[A-Za-z0-9][A-Za-z0-9._:/-]*@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
  const semanticVersion = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
  return (
    reference.test(versions.agent) &&
    reference.test(versions.skill) &&
    reference.test(versions.prompt) &&
    reference.test(versions.rule_set) &&
    semanticVersion.test(versions.knowledge_snapshot) &&
    reference.test(versions.policy) &&
    reference.test(versions.input_schema) &&
    reference.test(versions.output_schema)
  );
}

function hasExactRuleVersions(versions: readonly VersionReference[]): boolean {
  const semanticVersion = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
  const identities = versions.map((version) => `${version.id}@${version.version}`);
  return (
    versions.length > 0 &&
    identities.length === new Set(identities).size &&
    versions.every(
      (version) =>
        version.id.trim().length > 0 && semanticVersion.test(version.version),
    )
  );
}

function unresolvedQuestions(unresolved: readonly string[]): string[] {
  return unresolved.map((gap) => `Which authoritative evidence resolves ${gap}?`);
}

function readObject(object: JsonObject, key: string): JsonObject | undefined {
  const value = object[key];
  return isJsonObject(value) ? value : undefined;
}

function readString(object: JsonObject, key: string): string | undefined {
  const value = object[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStrings(object: JsonObject, key: string): string[] {
  const value = object[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function readEnum<const Value extends string>(
  object: JsonObject,
  key: string,
  values: readonly Value[],
): Value | undefined {
  const value = object[key];
  return typeof value === "string" && values.some((candidate) => candidate === value)
    ? (value as Value)
    : undefined;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
