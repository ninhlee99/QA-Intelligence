import { createHash } from "node:crypto";

import type {
  JsonObject,
  WorkspaceContext,
} from "../requirement-review/public.js";

export type EvaluationAdapterOperation =
  | "descriptor"
  | "prepareEnvironment"
  | "executeTrial"
  | "evaluateRubric"
  | "collectEvidence"
  | "cleanup"
  | "replay";

export type EvaluationTrialIdentity = Readonly<{
  campaign_id: string;
  case_id: string;
  trial_id: string;
  attempt_id: string;
}>;

export type EvaluationAdapterIdempotency = Readonly<{
  key: string;
  scope: string;
  request_digest: string;
}>;

export type EvaluationAdapterDeadline = Readonly<{
  at: string;
  time_standard: "UTC";
}>;

export type EvaluationAdapterVersion = Readonly<{
  contract: "1.0.0";
  operation_schema: "1.0.0";
}>;

export type DescriptorPayload = Readonly<{
  required_capabilities: readonly EvaluationAdapterOperation[];
}>;

export type DescriptorValue = Readonly<{
  supported_contract_versions: readonly string[];
  supported_operations: readonly EvaluationAdapterOperation[];
  isolation_strength: string;
  deterministic: boolean;
  replay_fidelity: string;
  limits: JsonObject;
  data_residency: readonly string[];
  evidence_guarantees: readonly string[];
  cancellation_guarantee: string;
  cleanup_guarantee: string;
  health: "healthy" | "degraded" | "unavailable";
  capacity: JsonObject;
}>;

export type PrepareEnvironmentPayload = Readonly<{
  subject_ref: string;
  fixture_refs: readonly string[];
  dataset_ref: string;
  policy_ref: string;
  network_policy_ref: string;
  tool_policy_ref: string;
  credential_refs: readonly string[];
  isolation_requirements: JsonObject;
  budget: JsonObject;
  evidence_requirements: readonly string[];
}>;

export type PrepareEnvironmentValue = Readonly<{
  environment_lease: string;
  resolved_versions: Readonly<Record<string, string>>;
  effective_limits: JsonObject;
  isolation_evidence: readonly string[];
  expires_at: string;
  cleanup_required: boolean;
}>;

export type ExecuteTrialPayload = Readonly<{
  environment_lease: string;
  execution_plan_ref: string;
  authorized_input_refs: readonly string[];
}>;

export type ExecuteTrialValue = Readonly<{
  observations: readonly JsonObject[];
  subject_output_refs: readonly string[];
  tool_events: readonly JsonObject[];
  policy_events: readonly JsonObject[];
  resource_usage: JsonObject;
  trial_timings: JsonObject;
  termination_observation: JsonObject;
  raw_evidence_refs: readonly string[];
}>;

export type EvaluateRubricPayload = Readonly<{
  rubric_ref: string;
  eligible_evidence_refs: readonly string[];
  calibration_ref: string;
  independence_policy_ref: string;
  candidate_output_ref: string;
}>;

export type EvaluateRubricValue = Readonly<{
  criterion_observations: readonly JsonObject[];
  provider_native_scores: JsonObject;
  normalized_scores: JsonObject;
  score_scales: JsonObject;
  anchored_evidence: readonly string[];
  uncertainty: JsonObject;
  calibration_version: string;
  conflicts: readonly string[];
  evaluator_warnings: readonly string[];
}>;

export type CollectEvidencePayload = Readonly<{
  required_manifest_ref: string;
  eligible_operation_ids: readonly string[];
}>;

export type CollectEvidenceValue = Readonly<{
  manifest_ref: string;
  entries: readonly JsonObject[];
  completeness_observations: readonly string[];
  reproducibility_limitations: readonly string[];
}>;

export type CleanupPayload = Readonly<{
  environment_lease: string;
  resource_refs: readonly string[];
  cleanup_policy_ref: string;
  compensation_authorization_ref?: string;
}>;

export type CleanupValue = Readonly<{
  resource_outcomes: readonly JsonObject[];
  residual_resources: readonly string[];
  completion_status: "completed";
  residual_risk: readonly string[];
}>;

export type ReplayPayload = Readonly<{
  source_operation_ids: readonly string[];
  evidence_refs: readonly string[];
  exact_input_refs: readonly string[];
  allowed_substitutions: readonly string[];
  requested_fidelity: string;
}>;

export type ReplayValue = Readonly<{
  observations: readonly JsonObject[];
  resolved_versions: Readonly<Record<string, string>>;
  substitutions: readonly string[];
  divergences: readonly string[];
  evidence: readonly string[];
  achieved_fidelity: string;
}>;

export interface EvaluationAdapterOperationMap {
  readonly descriptor: Readonly<{ request: DescriptorPayload; value: DescriptorValue }>;
  readonly prepareEnvironment: Readonly<{
    request: PrepareEnvironmentPayload;
    value: PrepareEnvironmentValue;
  }>;
  readonly executeTrial: Readonly<{
    request: ExecuteTrialPayload;
    value: ExecuteTrialValue;
  }>;
  readonly evaluateRubric: Readonly<{
    request: EvaluateRubricPayload;
    value: EvaluateRubricValue;
  }>;
  readonly collectEvidence: Readonly<{
    request: CollectEvidencePayload;
    value: CollectEvidenceValue;
  }>;
  readonly cleanup: Readonly<{ request: CleanupPayload; value: CleanupValue }>;
  readonly replay: Readonly<{ request: ReplayPayload; value: ReplayValue }>;
}

export type EvaluationAdapterRequest<Operation extends EvaluationAdapterOperation> =
  Readonly<{
    operation: Operation;
    operationId: string;
    trial: EvaluationTrialIdentity;
    workspace: WorkspaceContext;
    idempotency: EvaluationAdapterIdempotency;
    deadline: EvaluationAdapterDeadline;
    version: EvaluationAdapterVersion;
    payload: EvaluationAdapterOperationMap[Operation]["request"];
  }>;

export type DescriptorRequest = EvaluationAdapterRequest<"descriptor">;
export type PrepareEnvironmentRequest = EvaluationAdapterRequest<"prepareEnvironment">;
export type ExecuteTrialRequest = EvaluationAdapterRequest<"executeTrial">;
export type EvaluateRubricRequest = EvaluationAdapterRequest<"evaluateRubric">;
export type CollectEvidenceRequest = EvaluationAdapterRequest<"collectEvidence">;
export type CleanupRequest = EvaluationAdapterRequest<"cleanup">;
export type ReplayRequest = EvaluationAdapterRequest<"replay">;

export type AnyEvaluationAdapterRequest = {
  readonly [Operation in EvaluationAdapterOperation]: EvaluationAdapterRequest<Operation>;
}[EvaluationAdapterOperation];

export type EvaluationAdapterFailureCode =
  | "invalid_request"
  | "unsupported_version"
  | "unsupported_capability"
  | "workspace_denied"
  | "policy_denied"
  | "deadline_exceeded"
  | "cancelled"
  | "idempotency_conflict"
  | "resource_exhausted"
  | "unavailable"
  | "infrastructure_failure"
  | "provider_failure"
  | "rubric_invalid"
  | "evidence_incomplete"
  | "evidence_integrity_failure"
  | "cleanup_incomplete"
  | "replay_unavailable"
  | "replay_mismatch";

export type EvaluationAdapterFailure = Readonly<{
  code: EvaluationAdapterFailureCode;
  retryable: boolean;
  responsible_domain:
    | "caller"
    | "workspace"
    | "policy"
    | "adapter"
    | "provider"
    | "evidence"
    | "cleanup"
    | "replay";
  message: string;
  details: JsonObject;
  diagnostic_evidence_refs: readonly string[];
  provider_details: JsonObject;
}>;

export type EvaluationAdapterProvider = Readonly<{
  id: string;
  version: string;
}>;

export type EvaluationAdapterTiming = Readonly<{
  started_at: string;
  completed_at: string;
  duration_ms: number;
}>;

export type EvaluationAdapterUsage = Readonly<{
  tokens?: number;
  cost?: number;
  compute_ms?: number;
}>;

type EvaluationAdapterResultEnvelope<Operation extends EvaluationAdapterOperation> =
  Readonly<{
    operation: Operation;
    operationId: string;
    trial: EvaluationTrialIdentity;
    workspace: WorkspaceContext;
    idempotency: EvaluationAdapterIdempotency;
    deadline: EvaluationAdapterDeadline;
    version: EvaluationAdapterVersion;
    provider: EvaluationAdapterProvider;
    timing: EvaluationAdapterTiming;
    usage: EvaluationAdapterUsage;
    warnings: readonly string[];
    evidence: readonly string[];
  }>;

export type EvaluationAdapterResult<Operation extends EvaluationAdapterOperation> =
  EvaluationAdapterResultEnvelope<Operation> &
    (
      | Readonly<{
          ok: true;
          value: EvaluationAdapterOperationMap[Operation]["value"];
        }>
      | Readonly<{ ok: false; failure: EvaluationAdapterFailure }>
    );

export type AnyEvaluationAdapterResult = {
  readonly [Operation in EvaluationAdapterOperation]: EvaluationAdapterResult<Operation>;
}[EvaluationAdapterOperation];

export interface EvaluationAdapter {
  descriptor(request: DescriptorRequest): Promise<EvaluationAdapterResult<"descriptor">>;
  prepareEnvironment(
    request: PrepareEnvironmentRequest,
  ): Promise<EvaluationAdapterResult<"prepareEnvironment">>;
  executeTrial(
    request: ExecuteTrialRequest,
  ): Promise<EvaluationAdapterResult<"executeTrial">>;
  evaluateRubric(
    request: EvaluateRubricRequest,
  ): Promise<EvaluationAdapterResult<"evaluateRubric">>;
  collectEvidence(
    request: CollectEvidenceRequest,
  ): Promise<EvaluationAdapterResult<"collectEvidence">>;
  cleanup(request: CleanupRequest): Promise<EvaluationAdapterResult<"cleanup">>;
  replay(request: ReplayRequest): Promise<EvaluationAdapterResult<"replay">>;
}

/** Canonical digest binding excludes only the digest field itself. */
export function evaluationRequestDigest<Operation extends EvaluationAdapterOperation>(
  request: EvaluationAdapterRequest<Operation>,
): string {
  const canonical = {
    ...request,
    idempotency: {
      ...request.idempotency,
      request_digest: "",
    },
  };
  return `sha256:${createHash("sha256").update(stableStringify(canonical)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return value;
}
