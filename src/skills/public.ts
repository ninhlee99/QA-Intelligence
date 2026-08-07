import type {
  ConsequenceClass,
  JsonObject,
  VersionReference,
  WorkspaceContext,
} from "../requirement-review/public.js";

/**
 * SPEC-509 (Skill Contract): "how the Agent Runtime discovers, validates,
 * selects, invokes, and observes a Skill without depending on its
 * instruction format or implementation packaging." Before this module, no
 * Skill implementation in this repository (`AssessRequirementQuality`,
 * `AssessRiskQuality`, `AssessTestCaseQuality`, ...) implemented a common
 * interface — each exposed its own bespoke `.review()`-shaped method, so
 * the Agent Runtime could not discover, match, or invoke a Skill through
 * one stable seam the way SPEC-508 already requires for the runtime itself.
 * `src/adapters/replay/skill-invocation-adapter.ts` wraps an existing Skill
 * (starting with `AssessRequirementQuality`) behind this interface, proving
 * it against a real Skill rather than only a toy scenario.
 */
export type SkillOperation = "describe" | "match" | "validate" | "invoke";

export type SkillSideEffectClass = "read_only" | "advisory_output" | "controlled_write" | "irreversible";

/** SPEC-509 §3: "The descriptor SHALL include the SPEC-106 definition, trigger model, contract versions, permissions, dependencies, budgets, side-effect class, and evaluation-suite references." */
export type SkillDescriptor = Readonly<{
  skill: VersionReference;
  /** SPEC-106 Agent/Skill definition this descriptor instantiates. */
  definition_ref: string;
  trigger_model: readonly string[];
  contract_versions: Readonly<{ input_schema: string; output_schema: string }>;
  required_permissions: readonly string[];
  dependencies: readonly VersionReference[];
  budgets: Readonly<{ max_duration_seconds: number; max_tokens?: number; max_tool_calls?: number }>;
  side_effect_class: SkillSideEffectClass;
  consequence_class: ConsequenceClass;
  evaluation_suite_refs: readonly string[];
}>;

export type SkillTaskContext = Readonly<{
  workspace: WorkspaceContext;
  purpose: string;
  facts: JsonObject;
}>;

/** SPEC-509 §4: "Match results expose positive and negative trigger evidence, confidence, alternatives, conflicts, and whether human selection is required." */
export type SkillMatchResult = Readonly<{
  matched: boolean;
  confidence: number;
  positive_evidence: readonly string[];
  negative_evidence: readonly string[];
  alternatives: readonly VersionReference[];
  conflicts: readonly string[];
  requires_human_selection: boolean;
}>;

export type SkillInvocation = Readonly<{
  skill: VersionReference;
  operation_id: string;
  run_id: string;
  workspace: WorkspaceContext;
  input: JsonObject;
  authorized_context_refs: readonly string[];
  tool_capabilities: readonly string[];
  policy_version: string;
  limits: Readonly<{ max_duration_seconds: number; max_tokens?: number; max_tool_calls?: number }>;
  idempotency_key: string;
}>;

export type SkillValidationFailureReason =
  | "unknown_skill_version"
  | "missing_required_permission"
  | "unresolved_dependency"
  | "invalid_input"
  | "budget_exceeds_declared_limits";

export type SkillValidationResult =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; reasons: readonly SkillValidationFailureReason[] }>;

/** SPEC-509 §5: "Invalid preconditions prevent invocation." Failure classes distinguish who/what is responsible, mirroring every other adapter seam's failure taxonomy in this repository. */
export type SkillResultFailureClass =
  | "precondition"
  | "authorization"
  | "input"
  | "dependency"
  | "provider"
  | "tool"
  | "budget_exhausted"
  | "cancelled";

export type SkillResultFailure = Readonly<{
  class: SkillResultFailureClass;
  code: string;
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type SkillToolIntent = Readonly<{
  tool: VersionReference;
  purpose: string;
  /** True once the intent was actually invoked, not merely declared (SPEC-509 §5 "side effects are declared before execution"). */
  invoked: boolean;
}>;

export type SkillUncertainty = Readonly<{
  level: "none" | "low" | "medium" | "high";
  reasons: readonly string[];
}>;

/** SPEC-509 §4: "Results expose contract-valid output, postconditions, evidence, Tool intents or calls, usage, uncertainty, escalation, and failure class." */
export type SkillResultValue = Readonly<{
  output: JsonObject;
  postconditions_satisfied: readonly string[];
  evidence: readonly string[];
  tool_intents: readonly SkillToolIntent[];
  usage: Readonly<{ duration_seconds: number; tokens?: number; tool_calls?: number }>;
  uncertainty: SkillUncertainty;
  escalation_required: boolean;
}>;

export type SkillResult =
  | Readonly<{ ok: true; value: SkillResultValue }>
  | Readonly<{ ok: false; failure: SkillResultFailure }>;

export interface Skill {
  describe(skillId: string, version: string): Promise<SkillDescriptor | undefined>;
  match(taskContext: SkillTaskContext): Promise<SkillMatchResult>;
  validate(invocation: SkillInvocation): Promise<SkillValidationResult>;
  invoke(invocation: SkillInvocation): Promise<SkillResult>;
}
