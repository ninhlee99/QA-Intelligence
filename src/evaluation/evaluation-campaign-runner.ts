import {
  evaluationRequestDigest,
  type AnyEvaluationAdapterResult,
  type CleanupPayload,
  type CollectEvidenceValue,
  type EvaluationAdapter,
  type EvaluationAdapterDeadline,
  type EvaluationAdapterFailure,
  type EvaluationAdapterOperation,
  type EvaluationAdapterOperationMap,
  type EvaluationAdapterRequest,
  type EvaluationAdapterResult,
  type EvaluationTrialIdentity,
  type ExecuteTrialValue,
  type PrepareEnvironmentPayload,
} from "./adapter.js";
import {
  type CriticalInvariant,
  EvaluationManager,
  type EvaluationResult,
  type FailureClass,
  type SubjectReference,
  type SuiteReference,
  type TrialResult,
} from "./evaluation-manager.js";
import type { JsonObject, WorkspaceContext } from "../requirement-review/public.js";

const REQUIRED_OPERATIONS = Object.freeze([
  "prepareEnvironment",
  "executeTrial",
  "collectEvidence",
  "cleanup",
] as const satisfies readonly EvaluationAdapterOperation[]);

export type EvaluationAssertion = Readonly<{
  id: string;
  critical: boolean;
}>;

export type EvaluationTrialPlan = Readonly<{
  identity: EvaluationTrialIdentity;
  prepare: PrepareEnvironmentPayload;
  execute: Readonly<{
    execution_plan_ref: string;
    authorized_input_refs: readonly string[];
  }>;
  evidence_manifest_ref: string;
  cleanup: Omit<CleanupPayload, "environment_lease">;
  assertions: readonly EvaluationAssertion[];
}>;

export type EvaluationCampaignRequest = Readonly<{
  run_id: string;
  workspace: WorkspaceContext;
  subject: SubjectReference;
  suite: SuiteReference;
  resolved_versions: Readonly<Record<string, string>>;
  deadline: EvaluationAdapterDeadline;
  trial: EvaluationTrialPlan;
}>;

export type EvaluationAdapterEvidenceVerification = Readonly<{
  request: EvaluationCampaignRequest;
  execution: ExecuteTrialValue;
  collection: CollectEvidenceValue;
}>;

/** Verifies retained manifest integrity and provenance, not assertion truth. */
export interface EvaluationAdapterEvidenceVerifier {
  verify(input: EvaluationAdapterEvidenceVerification): boolean;
}

export type EvaluationCampaignRunResult = Readonly<{
  evaluation: EvaluationResult;
  operations: readonly AnyEvaluationAdapterResult[];
  cleanup_completed: boolean;
}>;

export type EvaluationCampaignRunnerDependencies = Readonly<{
  adapter: EvaluationAdapter;
  manager: EvaluationManager;
  evidence_verifier: EvaluationAdapterEvidenceVerifier;
}>;

type TrialAnalysis = Readonly<{
  trial: TrialResult;
  invariants: readonly CriticalInvariant[];
}>;

/**
 * Runs one immutable trial boundary through SPEC-511 and hands only verified,
 * normalized facts to EvaluationManager. It owns no release or approval action.
 */
export class EvaluationCampaignRunner {
  readonly #adapter: EvaluationAdapter;
  readonly #manager: EvaluationManager;
  readonly #evidenceVerifier: EvaluationAdapterEvidenceVerifier;

  constructor(dependencies: EvaluationCampaignRunnerDependencies) {
    this.#adapter = dependencies.adapter;
    this.#manager = dependencies.manager;
    this.#evidenceVerifier = dependencies.evidence_verifier;
  }

  async run(input: EvaluationCampaignRequest): Promise<EvaluationCampaignRunResult> {
    return this.#run(immutableCopy(input));
  }

  async #run(input: EvaluationCampaignRequest): Promise<EvaluationCampaignRunResult> {
    const operations: AnyEvaluationAdapterResult[] = [];
    const configurationFailure = validateCampaignConfiguration(input);
    if (configurationFailure !== undefined) {
      return this.#finish(
        input,
        operations,
        invalidAnalysis(input, [`evaluation:${configurationFailure}`]),
        false,
      );
    }
    const descriptorRequest = operationRequest(input, "descriptor", {
      required_capabilities: REQUIRED_OPERATIONS,
    });
    const descriptor = immutableCopy(await this.#adapter.descriptor(descriptorRequest));
    operations.push(descriptor);

    if (!sameOperationEnvelope(descriptorRequest, descriptor)) {
      return this.#finish(
        input,
        operations,
        invalidAnalysis(input, operationEvidence(operations, "descriptor-envelope-mismatch")),
        false,
      );
    }
    if (!descriptor.ok) {
      return this.#finish(
        input,
        operations,
        failureAnalysis(input, descriptor, operationEvidence(operations)),
        false,
      );
    }
    if (
      !descriptor.value.supported_contract_versions.includes("1.0.0") ||
      descriptor.value.health !== "healthy" ||
      !REQUIRED_OPERATIONS.every((operation) =>
        descriptor.value.supported_operations.includes(operation),
      )
    ) {
      return this.#finish(
        input,
        operations,
        invalidAnalysis(input, operationEvidence(operations, "descriptor-capability-invalid")),
        false,
      );
    }

    const prepareRequest = operationRequest(input, "prepareEnvironment", input.trial.prepare);
    const prepared = immutableCopy(await this.#adapter.prepareEnvironment(prepareRequest));
    operations.push(prepared);
    if (!sameOperationEnvelope(prepareRequest, prepared)) {
      return this.#finish(
        input,
        operations,
        invalidAnalysis(input, operationEvidence(operations, "prepare-envelope-mismatch")),
        false,
      );
    }
    if (!prepared.ok) {
      return this.#finish(
        input,
        operations,
        failureAnalysis(input, prepared, operationEvidence(operations)),
        false,
      );
    }
    if (!validPreparedEnvironment(input, prepared.value)) {
      return this.#cleanupAndFinish(
        input,
        operations,
        prepared.value.environment_lease,
        invalidAnalysis(input, operationEvidence(operations, "environment-version-mismatch")),
        prepared.value.resolved_versions,
        prepared.value.isolation_evidence,
      );
    }

    const executeRequest = operationRequest(input, "executeTrial", {
      environment_lease: prepared.value.environment_lease,
      execution_plan_ref: input.trial.execute.execution_plan_ref,
      authorized_input_refs: input.trial.execute.authorized_input_refs,
    });
    const execution = immutableCopy(await this.#adapter.executeTrial(executeRequest));
    operations.push(execution);
    if (!sameOperationEnvelope(executeRequest, execution)) {
      return this.#cleanupAndFinish(
        input,
        operations,
        prepared.value.environment_lease,
        invalidAnalysis(input, operationEvidence(operations, "execution-envelope-mismatch")),
        prepared.value.resolved_versions,
        prepared.value.isolation_evidence,
      );
    }

    const evidenceRequest = operationRequest(input, "collectEvidence", {
      required_manifest_ref: input.trial.evidence_manifest_ref,
      eligible_operation_ids: [
        descriptor.operationId,
        prepared.operationId,
        execution.operationId,
      ],
    });
    const collection = immutableCopy(await this.#adapter.collectEvidence(evidenceRequest));
    operations.push(collection);
    if (!sameOperationEnvelope(evidenceRequest, collection)) {
      return this.#cleanupAndFinish(
        input,
        operations,
        prepared.value.environment_lease,
        invalidAnalysis(input, operationEvidence(operations, "evidence-envelope-mismatch")),
        prepared.value.resolved_versions,
        prepared.value.isolation_evidence,
      );
    }

    let analysis: TrialAnalysis;
    if (!execution.ok) {
      analysis = failureAnalysis(input, execution);
    } else if (!collection.ok) {
      analysis = failureAnalysis(input, collection);
    } else if (
      collection.value.manifest_ref !== input.trial.evidence_manifest_ref ||
      !verifyEvidence(this.#evidenceVerifier, {
        request: input,
        execution: execution.value,
        collection: collection.value,
      })
    ) {
      analysis = invalidAnalysis(
        input,
        operationEvidence(operations, "evidence-integrity-failure"),
      );
    } else {
      analysis = analyzeAssertions(input, execution.value, collection.value, operations);
    }

    return this.#cleanupAndFinish(
      input,
      operations,
      prepared.value.environment_lease,
      analysis,
      prepared.value.resolved_versions,
      prepared.value.isolation_evidence,
    );
  }

  async #cleanupAndFinish(
    input: EvaluationCampaignRequest,
    operations: AnyEvaluationAdapterResult[],
    environmentLease: string,
    analysis: TrialAnalysis,
    environmentVersions: Readonly<Record<string, string>>,
    retainedEvidence: readonly string[],
  ): Promise<EvaluationCampaignRunResult> {
    const cleanupRequest = operationRequest(input, "cleanup", {
      ...input.trial.cleanup,
      environment_lease: environmentLease,
    });
    const cleanup = immutableCopy(await this.#adapter.cleanup(cleanupRequest));
    operations.push(cleanup);
    const completeEvidence = unique([
      ...analysis.trial.evidence,
      ...retainedEvidence,
      ...operationEvidence(operations),
    ]);
    if (!sameOperationEnvelope(cleanupRequest, cleanup)) {
      const cleanupAnalysis = invalidAnalysis(input, [
        ...completeEvidence,
        "evaluation:cleanup-envelope-mismatch",
      ]);
      return this.#finish(
        input,
        operations,
        preserveSubjectFailure(analysis, cleanupAnalysis, cleanupAnalysis.trial.evidence),
        false,
        environmentVersions,
      );
    }
    if (!cleanup.ok) {
      const cleanupAnalysis = failureAnalysis(input, cleanup, completeEvidence);
      return this.#finish(
        input,
        operations,
        preserveSubjectFailure(
          analysis,
          cleanupAnalysis,
          [
            ...completeEvidence,
            ...cleanup.failure.diagnostic_evidence_refs,
          ],
        ),
        false,
        environmentVersions,
      );
    }
    if (cleanup.value.residual_resources.length > 0) {
      const cleanupAnalysis = invalidAnalysis(input, [
        ...completeEvidence,
        "evaluation:cleanup-residual-resources",
      ]);
      return this.#finish(
        input,
        operations,
        preserveSubjectFailure(analysis, cleanupAnalysis, cleanupAnalysis.trial.evidence),
        false,
        environmentVersions,
      );
    }
    return this.#finish(
      input,
      operations,
      withEvidence(analysis, completeEvidence),
      true,
      environmentVersions,
    );
  }

  #finish(
    input: EvaluationCampaignRequest,
    operations: readonly AnyEvaluationAdapterResult[],
    analysis: TrialAnalysis,
    cleanupCompleted: boolean,
    environmentVersions: Readonly<Record<string, string>> = {},
  ): EvaluationCampaignRunResult {
    const evaluation = immutableCopy(this.#manager.evaluate({
      run_id: input.run_id,
      workspace_id: input.workspace.workspace_id,
      subject: input.subject,
      suite: input.suite,
      resolved_versions: { ...input.resolved_versions, ...environmentVersions },
      trial_results: [analysis.trial],
      critical_invariants: analysis.invariants,
      campaign_state: operations.some(
        (operation) => !operation.ok && operation.failure.code === "cancelled",
      )
        ? "cancelled"
        : analysis.trial.outcome === "blocked"
          ? "blocked"
          : "completed",
    }));
    return Object.freeze({
      evaluation,
      operations: Object.freeze([...operations]),
      cleanup_completed: cleanupCompleted,
    });
  }
}

function validateCampaignConfiguration(input: EvaluationCampaignRequest): string | undefined {
  const identity = input.trial.identity;
  const requiredIdentifiers = [
    input.run_id,
    input.workspace.workspace_id,
    input.subject.id,
    input.suite.id,
    identity.campaign_id,
    identity.case_id,
    identity.trial_id,
    identity.attempt_id,
  ];
  if (
    requiredIdentifiers.some((identifier) => identifier.trim().length === 0)
  ) {
    return "invalid-campaign-identity";
  }
  if (identity.campaign_id !== input.run_id) return "campaign-identity-mismatch";
  if (!isSemanticVersion(input.subject.version) || !isSemanticVersion(input.suite.version)) {
    return "unresolved-subject-or-suite-version";
  }
  if (
    Object.keys(input.resolved_versions).length === 0 ||
    Object.values(input.resolved_versions).some((version) => !isExactVersionPin(version))
  ) {
    return "unresolved-version-pin";
  }
  if (
    input.deadline.time_standard !== "UTC" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(input.deadline.at) ||
    Number.isNaN(new Date(input.deadline.at).valueOf())
  ) {
    return "invalid-deadline";
  }
  const assertionIds = input.trial.assertions.map((assertion) => assertion.id);
  if (
    assertionIds.length === 0 ||
    assertionIds.some((id) => id.trim().length === 0) ||
    input.trial.assertions.some((assertion) => typeof assertion.critical !== "boolean") ||
    new Set(assertionIds).size !== assertionIds.length
  ) {
    return "invalid-assertion-matrix";
  }
  return undefined;
}

function operationRequest<Operation extends EvaluationAdapterOperation>(
  input: EvaluationCampaignRequest,
  operation: Operation,
  payload: EvaluationAdapterOperationMap[Operation]["request"],
): EvaluationAdapterRequest<Operation> {
  const operationId = `${input.trial.identity.attempt_id}:${operation}`;
  const scope = [
    input.workspace.workspace_id,
    input.trial.identity.campaign_id,
    input.trial.identity.trial_id,
    input.trial.identity.attempt_id,
  ].join(":");
  const request: EvaluationAdapterRequest<Operation> = {
    operation,
    operationId,
    trial: input.trial.identity,
    workspace: input.workspace,
    idempotency: { key: operationId, scope, request_digest: "" },
    deadline: input.deadline,
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload,
  };
  return immutableCopy({
    ...request,
    idempotency: {
      ...request.idempotency,
      request_digest: evaluationRequestDigest(request),
    },
  });
}

function sameOperationEnvelope<Operation extends EvaluationAdapterOperation>(
  request: EvaluationAdapterRequest<Operation>,
  result: EvaluationAdapterResult<Operation>,
): boolean {
  return stableStringify({
    operation: result.operation,
    operationId: result.operationId,
    trial: result.trial,
    workspace: result.workspace,
    idempotency: result.idempotency,
    deadline: result.deadline,
    version: result.version,
  }) === stableStringify({
    operation: request.operation,
    operationId: request.operationId,
    trial: request.trial,
    workspace: request.workspace,
    idempotency: request.idempotency,
    deadline: request.deadline,
    version: request.version,
  });
}

function validPreparedEnvironment(
  input: EvaluationCampaignRequest,
  environment: EvaluationAdapterOperationMap["prepareEnvironment"]["value"],
): boolean {
  const entries = Object.entries(environment.resolved_versions);
  return (
    environment.environment_lease.trim().length > 0 &&
    entries.length > 0 &&
    entries.every(([key, version]) =>
      isExactVersionPin(version) &&
      (input.resolved_versions[key] === undefined || input.resolved_versions[key] === version)
    )
  );
}

function analyzeAssertions(
  input: EvaluationCampaignRequest,
  execution: ExecuteTrialValue,
  collection: CollectEvidenceValue,
  operations: readonly AnyEvaluationAdapterResult[],
): TrialAnalysis {
  const expected = input.trial.assertions;
  const expectedIds = new Set(expected.map((assertion) => assertion.id));
  const observations = execution.observations.map(assertionObservation);
  const observedIds = new Set(
    observations.flatMap((observation) => observation === undefined ? [] : [observation.id]),
  );
  const invalid =
    expected.length === 0 ||
    expectedIds.size !== expected.length ||
    observations.some((observation) => observation === undefined) ||
    observedIds.size !== observations.length ||
    observedIds.size !== expectedIds.size ||
    [...expectedIds].some((id) => !observedIds.has(id)) ||
    observations.some(
      (observation) =>
        observation !== undefined &&
        !execution.raw_evidence_refs.includes(observation.evidence_ref),
    );
  const evidence = unique([
    ...operationEvidence(operations),
    ...execution.raw_evidence_refs,
    collection.manifest_ref,
  ]);
  if (invalid) return invalidAnalysis(input, evidence);

  const normalized = observations.filter(
    (observation): observation is AssertionObservation => observation !== undefined,
  );
  const observationById = new Map(normalized.map((observation) => [observation.id, observation]));
  const failed = normalized.some((observation) => !observation.passed);
  return {
    trial: {
      case_id: input.trial.identity.case_id,
      trial_id: input.trial.identity.trial_id,
      outcome: failed ? "failed" : "passed",
      failure_class: failed ? "subject" : "none",
      evidence,
    },
    invariants: expected
      .filter((assertion) => assertion.critical)
      .map((assertion) => ({
        id: assertion.id,
        passed: observationById.get(assertion.id)?.passed === true,
      })),
  };
}

type AssertionObservation = Readonly<{
  id: string;
  passed: boolean;
  evidence_ref: string;
}>;

function assertionObservation(value: JsonObject): AssertionObservation | undefined {
  const id = value["assertion_id"];
  const passed = value["observed"];
  const evidenceRef = value["evidence_ref"];
  return typeof id === "string" && id.length > 0 && typeof passed === "boolean" &&
    typeof evidenceRef === "string" && evidenceRef.length > 0
    ? { id, passed, evidence_ref: evidenceRef }
    : undefined;
}

function invalidAnalysis(
  input: EvaluationCampaignRequest,
  evidence: readonly string[],
): TrialAnalysis {
  return {
    trial: {
      case_id: input.trial.identity.case_id,
      trial_id: input.trial.identity.trial_id,
      outcome: "indeterminate",
      failure_class: "invalid_test",
      evidence: ensureEvidence(evidence, "invalid-test"),
    },
    invariants: [],
  };
}

function failureAnalysis<Operation extends EvaluationAdapterOperation>(
  input: EvaluationCampaignRequest,
  result: EvaluationAdapterResult<Operation> & Readonly<{ ok: false }>,
  retainedEvidence: readonly string[] = [],
): TrialAnalysis {
  const classification = classifyFailure(result.failure);
  return {
    trial: {
      case_id: input.trial.identity.case_id,
      trial_id: input.trial.identity.trial_id,
      outcome: classification.outcome,
      failure_class: classification.failureClass,
      evidence: ensureEvidence(
        [
          ...retainedEvidence,
          ...result.evidence,
          ...result.failure.diagnostic_evidence_refs,
        ],
        `${result.operation}:${result.failure.code}`,
      ),
    },
    invariants: [],
  };
}

function withEvidence(
  analysis: TrialAnalysis,
  retainedEvidence: readonly string[],
): TrialAnalysis {
  return {
    trial: {
      ...analysis.trial,
      evidence: unique([...analysis.trial.evidence, ...retainedEvidence]),
    },
    invariants: analysis.invariants,
  };
}

function preserveSubjectFailure(
  analysis: TrialAnalysis,
  safetyFailure: TrialAnalysis,
  retainedEvidence: readonly string[],
): TrialAnalysis {
  return analysis.trial.failure_class === "subject"
    ? withEvidence(analysis, retainedEvidence)
    : safetyFailure;
}

function classifyFailure(failure: EvaluationAdapterFailure): Readonly<{
  outcome: TrialResult["outcome"];
  failureClass: FailureClass;
}> {
  if (failure.code === "workspace_denied" || failure.code === "policy_denied") {
    return { outcome: "blocked", failureClass: "policy_denial" };
  }
  if (
    failure.code === "invalid_request" ||
    failure.code === "unsupported_version" ||
    failure.code === "unsupported_capability" ||
    failure.code === "idempotency_conflict" ||
    failure.code === "rubric_invalid" ||
    failure.code === "evidence_incomplete" ||
    failure.code === "evidence_integrity_failure"
  ) {
    return { outcome: "indeterminate", failureClass: "invalid_test" };
  }
  return { outcome: "indeterminate", failureClass: "infrastructure" };
}

function operationEvidence(
  operations: readonly AnyEvaluationAdapterResult[],
  additional?: string,
): string[] {
  return unique([
    ...operations.flatMap((operation) => operation.evidence),
    ...(additional === undefined ? [] : [`evaluation:${additional}`]),
  ]);
}

function ensureEvidence(evidence: readonly string[], fallback: string): string[] {
  const retained = unique(evidence);
  return retained.length > 0 ? retained : [`evaluation:${fallback}`];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function verifyEvidence(
  verifier: EvaluationAdapterEvidenceVerifier,
  input: EvaluationAdapterEvidenceVerification,
): boolean {
  try {
    return verifier.verify(input);
  } catch {
    return false;
  }
}

function isSemanticVersion(value: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function isExactVersionPin(value: string): boolean {
  return (
    isSemanticVersion(value) ||
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value)
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function immutableCopy<Value>(value: Value): Value {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => immutableCopy(entry))) as Value;
  }
  if (value !== null && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, immutableCopy(entry)]),
      ),
    ) as Value;
  }
  return value;
}
