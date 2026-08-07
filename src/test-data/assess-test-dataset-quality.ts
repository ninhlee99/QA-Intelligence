import type {
  DeterministicRuleEngine,
  JsonObject,
  JsonValue,
  KnowledgeSearch,
  RuleEvaluationRequest,
  RuleEvaluationResult,
  StableResult,
  TestDataset,
  TestDatasetAssessment,
  TestDatasetAssessmentResolvedVersions,
  TestDatasetFinding,
  TestDatasetFindingCategory,
  TestDatasetFindingSeverity,
  TestDatasetQualityVerdict,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "./public.js";
import {
  hasExactResolvedVersions,
  isJsonObject,
  parseVersionReference,
  readEnum,
  readObject,
  readString,
  readStrings,
  unique,
} from "../shared/rule-engine-support.js";

export interface Clock {
  now(): Date;
}

export interface IdFactory {
  next(scope: "assessment" | "finding"): string;
}

export type TestDatasetReviewRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  test_dataset: TestDataset;
}>;

export type TestDatasetReviewConfiguration = Readonly<{
  resolved_versions: TestDatasetAssessmentResolvedVersions;
  limits: Readonly<{ knowledge_hits: number }>;
}>;

export type TestDatasetReviewFailure = Readonly<{
  class: "configuration" | "authorization" | "knowledge" | "rule";
  code: string;
  outcome: "blocked" | "indeterminate";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type TestDatasetReviewResult = StableResult<TestDatasetAssessment, TestDatasetReviewFailure>;

type Dependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  knowledge: KnowledgeSearch;
  rules: DeterministicRuleEngine;
  clock: Clock;
  ids: IdFactory;
  configuration: TestDatasetReviewConfiguration;
}>;

/**
 * Deep module for the advisory Assess Test Dataset Quality Skill (SPEC-208
 * tracer bullet, same authorize → discover → rule → evidence pipeline as
 * the other Test capability Skills). Scoped to Data Contract completeness
 * (§4) and the sensitive-field-controls rule (§7's "sensitive fields SHALL
 * be minimized, masked, access-controlled, encrypted"). This slice does NOT
 * verify: whether generation is actually deterministic/reproducible (§5,
 * needs execution evidence this Skill doesn't have from a dataset
 * declaration alone), cross-Workspace isolation test execution (§6, needs a
 * real attempted-access test run, not a document review), or masked-data
 * transformation correctness (§3, needs the actual data, which a Workspace-
 * scoped advisory Skill reviewing metadata SHALL NOT be given).
 */
export class AssessTestDatasetQuality {
  readonly #dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }

  async review(request: TestDatasetReviewRequest): Promise<TestDatasetReviewResult> {
    if (!hasExactResolvedVersions(this.#dependencies.configuration.resolved_versions)) {
      return {
        ok: false,
        failure: {
          class: "configuration",
          code: "invalid_resolved_versions",
          outcome: "indeterminate",
          message: "Test Dataset review configuration requires exact immutable version pins.",
          retryable: false,
          evidence: ["configuration:invalid-resolved-versions"],
        },
      };
    }
    const datasetRef = `${request.test_dataset.id}@${request.test_dataset.version}`;
    const authorization = await this.#dependencies.authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "assess test dataset quality",
      consequence_class: "advisory",
      required_permissions: ["test_dataset:read", "knowledge:read", "assessment:create"],
      resource_refs: [`workspace:${request.workspace_id}`, datasetRef],
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
      query: request.test_dataset.purpose,
      scopes: ["data_policies", "risks"],
      authority_statuses: ["accepted"],
      applicability: { workspace_id: request.workspace_id },
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
      evaluation_id: `${request.operation_id}:test-dataset-quality`,
      context: request.context,
      rule_set: ruleSet,
      effective_at: effectiveAt,
      facts: assessmentFacts(request.test_dataset),
      fact_provenance: unique([
        datasetRef,
        ...request.test_dataset.traced_test_refs,
        ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.provenance]),
      ]),
      requested_decisions: ["test_dataset_quality"],
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
      ruleEvaluation.value.policy_version !== request.context.policy_version
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
          ],
        },
      };
    }
    if (ruleEvaluation.value.outcome === "error" || ruleEvaluation.value.outcome === "not_applicable") {
      return {
        ok: false,
        failure: {
          class: "rule",
          code: `rule_outcome_${ruleEvaluation.value.outcome}`,
          outcome: "indeterminate",
          message: "Deterministic test-dataset-quality rules did not produce an applicable decision.",
          retryable: false,
          evidence: [datasetRef],
        },
      };
    }

    const ruleResultRef = `rule-set:${ruleEvaluation.value.rule_set.id}@${ruleEvaluation.value.rule_set.version}:${ruleEvaluation.value.outcome}`;
    const findings = normalizeFindings(ruleEvaluation.value.outputs["findings"], this.#dependencies.ids, [
      datasetRef,
      ruleResultRef,
    ]);
    const ruleResults = unique([
      ruleResultRef,
      ...ruleEvaluation.value.rule_versions.map((rule) => `rule:${rule.id}@${rule.version}`),
      ...ruleEvaluation.value.explanation_trace,
    ]);
    const evidence = unique([
      datasetRef,
      ...authorization.value.decision_evidence,
      ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.evidence]),
      ...ruleResults,
    ]);

    return {
      ok: true,
      value: {
        id: this.#dependencies.ids.next("assessment"),
        test_dataset_ref: datasetRef,
        workspace_id: request.workspace_id,
        outcome: "completed",
        // Mirrors the category-aware critical mapping used across
        // Requirement/Risk/Test Design/Test Strategy: only
        // "privacy_and_isolation" (sensitive fields declared with no
        // control, SPEC-208 §7) maps to "rejected" — a dataset that is
        // unsafe to use as declared, not merely incomplete. Any other
        // critical finding still blocks, but as "blocked".
        verdict: criticalVerdict(findings) ?? (findings.length === 0 ? "pass" : "changes_required"),
        findings,
        questions: [],
        rule_results: ruleResults,
        evidence,
        uncertainty: { level: "none", reasons: [] },
        resolved_versions: {
          ...this.#dependencies.configuration.resolved_versions,
          knowledge_snapshot: discovery.value.knowledge_snapshot,
        },
      },
    };
  }
}

const REJECTION_FINDING_CATEGORIES: ReadonlySet<TestDatasetFindingCategory> = new Set(["privacy_and_isolation"]);

function criticalVerdict(findings: readonly TestDatasetFinding[]): TestDatasetQualityVerdict | undefined {
  const critical = findings.filter((finding) => finding.severity === "critical");
  if (critical.length === 0) return undefined;
  return critical.some((finding) => REJECTION_FINDING_CATEGORIES.has(finding.category))
    ? "rejected"
    : "blocked";
}

/** Pure, in-process deterministic rules for the Data Contract completeness tracer bullet (SPEC-208 §4/§7/§9). */
export class TestDatasetQualityRuleEngine implements DeterministicRuleEngine {
  evaluate(request: RuleEvaluationRequest): Promise<RuleEvaluationResult> {
    const dataset = readObject(request.facts, "test_dataset");
    if (dataset === undefined) {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "invalid_facts",
          message: "The test_dataset fact is required.",
          retryable: false,
          evidence: [request.evaluation_id],
        },
      });
    }

    const datasetRef = readString(dataset, "ref") ?? "test-dataset:unknown";
    const findings: JsonObject[] = [];

    const tracedTests = dataset["traced_test_refs"];
    if (!Array.isArray(tracedTests) || tracedTests.length === 0) {
      findings.push({
        category: "traceability" satisfies TestDatasetFindingCategory,
        severity: "high",
        message: "The test dataset traces to no test case.",
        evidence: [`${datasetRef}#traced_test_refs`, "rule:test-dataset-has-traced-tests@1.0.0"],
        next_action: "Trace this dataset to at least one test case that consumes it.",
      });
    }

    for (const [field, label] of [
      ["schema_ref", "schema reference"],
      ["source", "source"],
      ["generation_method", "generation method"],
      ["setup", "setup procedure"],
      ["teardown", "teardown procedure"],
      ["retention", "retention policy"],
      ["disposal", "disposal policy"],
      ["workspace_scope", "Workspace scope"],
      ["environment_scope", "environment scope"],
    ] as const) {
      if (readString(dataset, field) === undefined) {
        findings.push({
          category: "completeness" satisfies TestDatasetFindingCategory,
          severity: "high",
          message: `The test dataset has no ${label}.`,
          evidence: [`${datasetRef}#${field}`, `rule:test-dataset-has-${field.replace(/_/g, "-")}@1.0.0`],
          next_action: `Record the ${label} for this dataset, per SPEC-208 §4.`,
        });
      }
    }

    if (readString(dataset, "owner") === undefined) {
      findings.push({
        category: "lifecycle" satisfies TestDatasetFindingCategory,
        severity: "high",
        message: "The test dataset has no accountable owner.",
        evidence: [`${datasetRef}#owner`, "rule:test-dataset-has-owner@1.0.0"],
        next_action: "Assign an accountable owner before this dataset can be accepted.",
      });
    }

    // SPEC-208 §7: "Sensitive fields SHALL be minimized, masked, access-
    // controlled, encrypted, and retained only as required." A dataset that
    // declares sensitive fields but records no control for them is unsafe
    // to use as declared — this is a safety rule, not a completeness
    // preference, and maps to "rejected" (see criticalVerdict above).
    const containsSensitiveFields = dataset["contains_sensitive_fields"];
    const sensitiveFieldControls = dataset["sensitive_field_controls"];
    if (
      containsSensitiveFields === true &&
      (!Array.isArray(sensitiveFieldControls) || sensitiveFieldControls.length === 0)
    ) {
      findings.push({
        category: "privacy_and_isolation" satisfies TestDatasetFindingCategory,
        severity: "critical",
        message: "The test dataset declares sensitive fields but records no control for them.",
        evidence: [`${datasetRef}#sensitive_field_controls`, "rule:test-dataset-sensitive-fields-have-controls@1.0.0"],
        next_action: "Record how sensitive fields are minimized, masked, access-controlled, or encrypted, per SPEC-208 §7.",
      });
    }

    // SPEC-208 §8: "Evaluation datasets SHALL identify labels, provenance,
    // representativeness, known bias, contamination risks, version, and
    // protected-data authorization." A dataset declared as an AI evaluation
    // dataset without this metadata cannot support the representativeness/
    // bias/contamination judgment §8 requires — this is checkable
    // statically from the dataset's own declaration, unlike reproducibility
    // or cross-Workspace isolation which need the data itself.
    if (readString(dataset, "classification") === "ai_evaluation_dataset") {
      const metadata = readObject(dataset, "ai_evaluation_metadata");
      const missingMetadataFields: string[] = [];
      if (metadata === undefined) {
        missingMetadataFields.push("ai_evaluation_metadata");
      } else {
        const labels = metadata["labels"];
        if (!Array.isArray(labels) || labels.length === 0) missingMetadataFields.push("labels");
        if (readString(metadata, "representativeness") === undefined) missingMetadataFields.push("representativeness");
        if (readString(metadata, "known_bias") === undefined) missingMetadataFields.push("known_bias");
        if (readString(metadata, "contamination_risk") === undefined) missingMetadataFields.push("contamination_risk");
        if (readString(metadata, "protected_data_authorization_ref") === undefined) {
          missingMetadataFields.push("protected_data_authorization_ref");
        }
      }
      if (missingMetadataFields.length > 0) {
        findings.push({
          category: "completeness" satisfies TestDatasetFindingCategory,
          severity: "high",
          message: `The dataset is classified as an AI evaluation dataset but is missing: ${missingMetadataFields.join(", ")}.`,
          evidence: [`${datasetRef}#ai_evaluation_metadata`, "rule:test-dataset-ai-evaluation-metadata-is-complete@1.0.0"],
          next_action: "Record labels, representativeness, known bias, contamination risk, and protected-data authorization for this AI evaluation dataset, per SPEC-208 §8.",
        });
      }
    }

    if (findings.length > 0) {
      return Promise.resolve(successfulRuleEvaluation(request, "not_satisfied", findings));
    }
    return Promise.resolve(
      successfulRuleEvaluation(request, "satisfied", [], ["all deterministic test-dataset-quality rules satisfied"]),
    );
  }
}

function successfulRuleEvaluation(
  request: RuleEvaluationRequest,
  outcome: "satisfied" | "not_satisfied",
  findings: readonly JsonObject[],
  explanation: readonly string[] = ["deterministic test-dataset-quality gaps found"],
): Extract<RuleEvaluationResult, { ok: true }> {
  return {
    ok: true,
    value: {
      outcome,
      rule_set: { ...request.rule_set },
      rule_versions: [
        { id: "test-dataset-has-traced-tests", version: "1.0.0" },
        { id: "test-dataset-completeness", version: "1.0.0" },
        { id: "test-dataset-has-owner", version: "1.0.0" },
        { id: "test-dataset-sensitive-fields-have-controls", version: "1.0.0" },
        { id: "test-dataset-ai-evaluation-metadata-is-complete", version: "1.0.0" },
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

function assessmentFacts(dataset: TestDataset): JsonObject {
  return {
    test_dataset: {
      ref: `${dataset.id}@${dataset.version}`,
      id: dataset.id,
      version: dataset.version,
      status: dataset.status,
      owner: dataset.owner,
      purpose: dataset.purpose,
      traced_test_refs: [...dataset.traced_test_refs],
      schema_ref: dataset.schema_ref,
      source: dataset.source,
      generation_method: dataset.generation_method,
      classification: dataset.classification,
      workspace_scope: dataset.workspace_scope,
      environment_scope: dataset.environment_scope,
      validity_constraints: [...(dataset.validity_constraints ?? [])],
      setup: dataset.setup,
      teardown: dataset.teardown,
      retention: dataset.retention,
      disposal: dataset.disposal,
      contains_sensitive_fields: dataset.contains_sensitive_fields ?? false,
      sensitive_field_controls: [...(dataset.sensitive_field_controls ?? [])],
      ai_evaluation_metadata:
        dataset.ai_evaluation_metadata === undefined
          ? null
          : {
              labels: [...(dataset.ai_evaluation_metadata.labels ?? [])],
              representativeness: dataset.ai_evaluation_metadata.representativeness ?? null,
              known_bias: dataset.ai_evaluation_metadata.known_bias ?? null,
              contamination_risk: dataset.ai_evaluation_metadata.contamination_risk ?? null,
              protected_data_authorization_ref:
                dataset.ai_evaluation_metadata.protected_data_authorization_ref ?? null,
            },
    },
  };
}

function normalizeFindings(
  value: JsonValue | undefined,
  ids: IdFactory,
  fallbackEvidence: readonly string[],
): TestDatasetFinding[] {
  if (!Array.isArray(value)) return [];
  const categories = ["completeness", "traceability", "privacy_and_isolation", "lifecycle"] as const;
  const severities = ["critical", "high", "medium", "low"] as const;

  const findings: TestDatasetFinding[] = [];
  for (const candidate of value) {
    if (!isJsonObject(candidate)) continue;
    const category = readEnum(candidate, "category", categories);
    const severity = readEnum(candidate, "severity", severities);
    const message = readString(candidate, "message");
    if (category === undefined || severity === undefined || message === undefined) continue;
    const evidence = readStrings(candidate, "evidence");
    findings.push({
      id: ids.next("finding"),
      category: category as TestDatasetFindingCategory,
      severity: severity as TestDatasetFindingSeverity,
      message,
      evidence: evidence.length === 0 ? [...fallbackEvidence] : unique([...evidence, ...fallbackEvidence]),
      next_action:
        readString(candidate, "next_action") ??
        "Resolve this evidenced test-dataset-quality gap and re-run the assessment.",
    });
  }
  return findings;
}

