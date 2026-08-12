/** Provider-neutral public contracts for the Test Design tracer bullet (SPEC-207). */
import type {
  DeterministicRuleEngine,
  JsonObject,
  JsonValue,
  KnowledgeSearch,
  ReasoningProvider,
  RuleEvaluationRequest,
  RuleEvaluationResult,
  StableResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../requirement-review/public.js";

export type TestCaseStatus = "draft" | "in_review" | "accepted" | "deprecated" | "archived";

export type TestCaseStep = Readonly<{
  action: string;
  input?: JsonObject;
}>;

export type TestCaseExpectedResult = Readonly<{
  assertion: string;
  authority: string;
}>;

export type TestCasePriority = "critical" | "high" | "medium" | "low";

/** Mirrors schemas/test-case.schema.json (SPEC-207 §2 Test Case Contract). */
export type TestCase = Readonly<{
  id: string;
  version: string;
  status: TestCaseStatus;
  purpose: string;
  traceability: readonly string[];
  preconditions: readonly string[];
  workspace_scope: string;
  data_requirements?: readonly string[];
  steps: readonly TestCaseStep[];
  expected_results: readonly TestCaseExpectedResult[];
  owner: string;
  actor_scope?: string;
  priority?: TestCasePriority;
  tags?: readonly string[];
  cleanup?: readonly string[];
}>;

export type TestCaseFindingCategory =
  | "completeness"
  | "traceability"
  | "authority"
  | "independence";

export type TestCaseFindingSeverity = "critical" | "high" | "medium" | "low";

export type TestCaseFinding = Readonly<{
  id: string;
  category: TestCaseFindingCategory;
  severity: TestCaseFindingSeverity;
  message: string;
  evidence: readonly string[];
  next_action: string;
}>;

export type TestCaseAssessmentOutcome = "completed" | "indeterminate" | "blocked";

export type TestCaseQualityVerdict =
  | "pass"
  | "pass_with_recommendations"
  | "changes_required"
  | "blocked"
  | "rejected";

export type TestCaseAssessmentUncertainty = Readonly<{
  level: "none" | "low" | "medium" | "high";
  reasons: readonly string[];
}>;

export type TestCaseAssessmentResolvedVersions = Readonly<{
  agent: string;
  skill: string;
  rule_set: string;
  knowledge_snapshot: string;
  policy: string;
  input_schema: string;
  output_schema: string;
  prompt?: string;
}>;

/** Mirrors schemas/test-case-assessment.schema.json. */
export type TestCaseAssessment = Readonly<{
  id: string;
  test_case_ref: string;
  workspace_id: string;
  outcome: TestCaseAssessmentOutcome;
  verdict: TestCaseQualityVerdict;
  findings: readonly TestCaseFinding[];
  questions: readonly string[];
  rule_results: readonly string[];
  evidence: readonly string[];
  uncertainty: TestCaseAssessmentUncertainty;
  resolved_versions: TestCaseAssessmentResolvedVersions;
}>;

export type {
  DeterministicRuleEngine,
  JsonObject,
  JsonValue,
  KnowledgeSearch,
  ReasoningProvider,
  RuleEvaluationRequest,
  RuleEvaluationResult,
  StableResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
};

/**
 * SPEC-207 §6 "AI MAY propose tests only from provided authoritative
 * context" tracer bullet (docs/proposals/professional-qa-mcp-roadmap.md
 * Phase 3): generates `TestCase` records from a Requirement's acceptance
 * criteria bound against an already-discovered `SemanticUiMap` (Phase 1). A
 * criterion this generator cannot bind to a discovered field/action becomes
 * a finding here, never a fabricated step or assertion — distinct from
 * `TestCaseAssessment` above, which judges an existing TestCase's quality
 * rather than producing one.
 */
export type TestCaseGenerationFindingCategory =
  | "unbindable_criterion"
  | "ambiguous_criterion"
  | "no_acceptance_criteria"
  | "missing_expected_result"
  | "missing_option_label"
  | "possible_auth_required";

export type TestCaseGenerationFinding = Readonly<{
  id: string;
  category: TestCaseGenerationFindingCategory;
  message: string;
  evidence: readonly string[];
}>;

/**
 * A structured, executable counterpart to `TestCase.expected_results[].assertion`
 * (which stays free text per SPEC-207 §2). This generator SHALL NOT infer
 * oracle fields from assertion prose — that would be exactly the
 * "invented expected result" SPEC-207 §6 forbids. Oracles exist only when
 * the source acceptance criterion explicitly carried `expected_text` and/or
 * `expected_url_includes` / `expected_title_includes` / `expected_network`
 * (see `generate-test-cases.ts`); otherwise the criterion still produces a
 * `TestCase` but with a `missing_expected_result` finding and no generated
 * assertion, so it cannot be executed unattended.
 */
export type TestCaseGeneratedAssertion = Readonly<{
  test_case_id: string;
  /** Text that SHALL appear (positive case) — mutually exclusive with `forbidden_text`. */
  expected_text?: string;
  /**
   * Text that SHALL NOT appear anywhere in the resulting page (negative:
   * the success text; boundary/adversarial: system-error and unescaped-
   * payload leak markers). Every entry must be absent for the assertion
   * to pass — this is an AND of NOT-contains checks, not an OR.
   */
  forbidden_text?: readonly string[];
  /**
   * Adversarial only: a `window.alert`/`confirm`/`prompt` firing after the
   * step sequence is direct evidence of executed injected script — the
   * signature `forbidden_text` cannot see once a `<script>` tag has been
   * parsed and run by the browser (`DeterministicDomCleaner` removes
   * script nodes from the tree entirely, so no literal text survives to
   * match against). SHALL be false to pass.
   */
  expect_no_dialog?: boolean;
  /** Final page URL must include this substring (richer oracle). */
  expected_url_includes?: string;
  /** Document title must include this substring (richer oracle). */
  expected_title_includes?: string;
  /**
   * UI→API coupling: at least one xhr/fetch during the run must match.
   * Bodies are truncated snippets from the Playwright capture — never invent.
   */
  expected_network?: Readonly<{
    url_includes: string;
    method?: string;
    status?: number | readonly number[];
    body_includes?: string;
  }>;
  /**
   * Structural count oracle (dogfood GAP-2): count cleaned-tree nodes by
   * accessible_role (+ optional name substring) and compare with relation.
   */
  expected_result_count?: Readonly<{
    accessible_role: string;
    accessible_name_includes?: string;
    relation: "eq" | "gte" | "lte";
    value: number;
  }>;
}>;

export type TestCaseGenerationUiElement = Readonly<{
  id: string;
  kind: "page" | "field" | "action";
  accessible_name?: string;
  accessible_role?: string;
  interaction_hint?: "clickable" | "editable" | "selectable" | "navigable" | "none";
}>;

export type TestCaseGenerationRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  requirement_ref: string;
  requirement_title: string;
  acceptance_criteria: readonly JsonObject[];
  ui_map_elements: readonly TestCaseGenerationUiElement[];
  ui_map_source_url: string;
}>;

/**
 * SPEC-207 §4 techniques this tracer bullet actually implements, per field.
 * `positive` is the existing valid-input case. `negative` submits a wrong
 * value and expects the success text to NOT appear (the system correctly
 * rejects it). `boundary` submits an oversized value and expects no
 * infrastructure/system-error text to leak (SPEC-210 §4's
 * `infrastructure_error` distinction — a boundary case that crashes the
 * app is itself a finding-worthy bug, not test noise). `empty` submits a
 * blank value; `whitespace` submits spaces/tabs only — kept distinct from
 * `empty` because some validators trim before checking and some don't, so
 * they can pass/fail independently. `unicode` submits multi-byte/emoji
 * input to catch encoding/mojibake bugs. `type_confusion` submits a
 * non-numeric string into a field whose name looks numeric (Age, Amount,
 * ...) — only generated when that signal is present, never fabricated for
 * a field with no numeric name. `adversarial` submits a benign
 * injection/XSS probe string and expects it to come back escaped as inert
 * text, never executed or reflected as raw markup and never accompanied by
 * a leaked stack trace — this checks input handling, not a real exploit
 * attempt (no callback URLs, no destructive payloads).
 */
export type TestCaseVariant =
  | "positive"
  | "negative"
  | "boundary"
  | "empty"
  | "whitespace"
  | "unicode"
  | "type_confusion"
  | "adversarial";

export type TestCaseGenerationResult = Readonly<{
  schema_version: "1.0.0";
  workspace_id: string;
  requirement_ref: string;
  test_cases: readonly TestCase[];
  findings: readonly TestCaseGenerationFinding[];
  generated_assertions: readonly TestCaseGeneratedAssertion[];
}>;

export type TestCaseGenerationFailure = Readonly<{
  class: "configuration" | "authorization";
  code: string;
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type GenerateTestCasesResult = StableResult<
  TestCaseGenerationResult,
  TestCaseGenerationFailure
>;
