import {
  evaluationRequestDigest,
  type CleanupRequest,
  type CollectEvidenceRequest,
  type DescriptorRequest,
  type EvaluationAdapter,
  type EvaluationAdapterFailure,
  type EvaluationAdapterOperation,
  type EvaluationAdapterOperationMap,
  type EvaluationAdapterProvider,
  type EvaluationAdapterRequest,
  type EvaluationAdapterResult,
  type EvaluationAdapterUsage,
  type EvaluateRubricRequest,
  type ExecuteTrialRequest,
  type PrepareEnvironmentRequest,
  type ReplayRequest,
} from "../../evaluation/adapter.js";
import type {
  ConsequenceClass,
  JsonObject,
  WorkspaceAuthorization,
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
} from "../../requirement-review/public.js";

export interface Clock {
  now(): Date;
}

type SuccessOutcome<Operation extends EvaluationAdapterOperation> = Readonly<{
  value: EvaluationAdapterOperationMap[Operation]["value"];
  evidence?: readonly string[];
  warnings?: readonly string[];
  usage?: EvaluationAdapterUsage;
}>;

type FailureOutcome = Readonly<{
  failure: EvaluationAdapterFailure;
  evidence?: readonly string[];
  warnings?: readonly string[];
  usage?: EvaluationAdapterUsage;
}>;

export type ScriptedEvaluationCase = {
  readonly [Operation in EvaluationAdapterOperation]: Readonly<{
    match: EvaluationAdapterRequest<Operation>;
    outcome: SuccessOutcome<Operation> | FailureOutcome;
  }>;
}[EvaluationAdapterOperation];

type Dependencies = Readonly<{
  clock: Clock;
  authorizer: WorkspaceAuthorizer;
  provider: EvaluationAdapterProvider;
  cases: readonly ScriptedEvaluationCase[];
  supported_operations?: readonly EvaluationAdapterOperation[];
}>;

type RetainedResult = EvaluationAdapterResult<EvaluationAdapterOperation>;

const PERMISSION_BY_OPERATION: Readonly<Record<EvaluationAdapterOperation, string>> =
  Object.freeze({
    descriptor: "evaluation:read",
    prepareEnvironment: "evaluation:execute",
    executeTrial: "evaluation:execute",
    evaluateRubric: "evaluation:evaluate",
    collectEvidence: "evaluation:read",
    cleanup: "evaluation:cleanup",
    replay: "evaluation:replay",
  });

const FORBIDDEN_VERDICT_FIELDS = new Set([
  "verdict",
  "recommendation",
  "campaign_state",
  "approval",
  "release_decision",
]);

const ALL_OPERATIONS: readonly EvaluationAdapterOperation[] = Object.freeze([
  "descriptor",
  "prepareEnvironment",
  "executeTrial",
  "evaluateRubric",
  "collectEvidence",
  "cleanup",
  "replay",
]);

/** Deterministic/replay Adapter for SPEC-511 contract and orchestration tests. */
export class ScriptedEvaluationAdapter implements EvaluationAdapter {
  readonly #clock: Clock;
  readonly #authorizer: WorkspaceAuthorizer;
  readonly #provider: EvaluationAdapterProvider;
  readonly #cases: readonly ScriptedEvaluationCase[];
  readonly #supportedOperations: ReadonlySet<EvaluationAdapterOperation>;
  readonly #retained = new Map<string, Readonly<{ digest: string; result: RetainedResult }>>();

  constructor(dependencies: Dependencies) {
    this.#clock = dependencies.clock;
    this.#authorizer = dependencies.authorizer;
    this.#provider = immutableCopy(dependencies.provider);
    this.#cases = immutableCopy(dependencies.cases);
    this.#supportedOperations = new Set(
      ["descriptor", ...(dependencies.supported_operations ?? ALL_OPERATIONS)],
    );
  }

  descriptor(request: DescriptorRequest): Promise<EvaluationAdapterResult<"descriptor">> {
    return this.#invoke(request);
  }

  prepareEnvironment(
    request: PrepareEnvironmentRequest,
  ): Promise<EvaluationAdapterResult<"prepareEnvironment">> {
    return this.#invoke(request);
  }

  executeTrial(
    request: ExecuteTrialRequest,
  ): Promise<EvaluationAdapterResult<"executeTrial">> {
    return this.#invoke(request);
  }

  evaluateRubric(
    request: EvaluateRubricRequest,
  ): Promise<EvaluationAdapterResult<"evaluateRubric">> {
    return this.#invoke(request);
  }

  collectEvidence(
    request: CollectEvidenceRequest,
  ): Promise<EvaluationAdapterResult<"collectEvidence">> {
    return this.#invoke(request);
  }

  cleanup(request: CleanupRequest): Promise<EvaluationAdapterResult<"cleanup">> {
    return this.#invoke(request);
  }

  replay(request: ReplayRequest): Promise<EvaluationAdapterResult<"replay">> {
    return this.#invoke(request);
  }

  async #invoke<Operation extends EvaluationAdapterOperation>(
    request: EvaluationAdapterRequest<Operation>,
  ): Promise<EvaluationAdapterResult<Operation>> {
    const startedAt = this.#clock.now();
    const validationFailure = validateRequest(request);
    if (validationFailure) {
      return this.#failed(request, validationFailure, startedAt);
    }

    const authorizationRequest = authorizationFor(request);
    const authorization = await this.#authorizer.authorize(authorizationRequest);
    if (!authorization.ok) {
      return this.#failed(
        request,
        authorizationFailure(authorization.failure.code),
        startedAt,
        authorization.failure.evidence,
      );
    }
    if (!authorizationCovers(authorization.value, authorizationRequest)) {
      return this.#failed(
        request,
        failure(
          "policy_denied",
          "policy",
          "Workspace authorization does not cover the requested operation.",
        ),
        startedAt,
        authorization.value.decision_evidence,
      );
    }

    const key = retainedKey(request);
    const retained = this.#retained.get(key);
    if (retained) {
      if (retained.digest !== request.idempotency.request_digest) {
        return this.#failed(
          request,
          failure(
            "idempotency_conflict",
            "caller",
            "The idempotency key is already bound to a different request digest.",
          ),
          startedAt,
          authorization.value.decision_evidence,
        );
      }
      return retained.result as EvaluationAdapterResult<Operation>;
    }

    if (deadlineElapsed(request, startedAt)) {
      return this.#retain(
        key,
        request.idempotency.request_digest,
        this.#failed(
          request,
          failure(
            "deadline_exceeded",
            "adapter",
            "The Evaluation Adapter operation deadline has elapsed.",
          ),
          startedAt,
          authorization.value.decision_evidence,
        ),
      );
    }

    if (!this.#supportedOperations.has(request.operation)) {
      return this.#retain(
        key,
        request.idempotency.request_digest,
        this.#failed(
          request,
          failure(
            "unsupported_capability",
            "adapter",
            `Evaluation Adapter operation ${request.operation} is not supported.`,
          ),
          startedAt,
          authorization.value.decision_evidence,
        ),
      );
    }

    const scripted = this.#cases.find((candidate) =>
      sameRequest(candidate.match, request),
    );
    if (!scripted) {
      return this.#retain(
        key,
        request.idempotency.request_digest,
        this.#failed(
          request,
          failure(
            "unavailable",
            "adapter",
            "No deterministic replay case matches the authorized request.",
            true,
          ),
          startedAt,
          authorization.value.decision_evidence,
        ),
      );
    }

    const completedAt = this.#clock.now();
    if (deadlineElapsed(request, completedAt)) {
      return this.#retain(
        key,
        request.idempotency.request_digest,
        this.#failed(
          request,
          failure(
            "deadline_exceeded",
            "adapter",
            "A late Evaluation Adapter result cannot replace the terminal timeout.",
          ),
          startedAt,
          authorization.value.decision_evidence,
          [],
          {},
          completedAt,
        ),
      );
    }

    if ("failure" in scripted.outcome) {
      return this.#retain(
        key,
        request.idempotency.request_digest,
        this.#failed(
          request,
          scripted.outcome.failure,
          startedAt,
          mergeEvidence(
            authorization.value.decision_evidence,
            scripted.outcome.evidence,
          ),
          scripted.outcome.warnings,
          scripted.outcome.usage,
          completedAt,
        ),
      );
    }
    if (request.operation === "cleanup") {
      const cleanup = scripted.outcome
        .value as EvaluationAdapterOperationMap["cleanup"]["value"];
      if (cleanup.residual_resources.length > 0) {
        return this.#retain(
          key,
          request.idempotency.request_digest,
          this.#failed(
            request,
            failure(
              "cleanup_incomplete",
              "cleanup",
              "Cleanup retained residual resources and cannot be reported as completed.",
              false,
              {
                residual_resources: cleanup.residual_resources,
                residual_risk: cleanup.residual_risk,
              },
            ),
            startedAt,
            mergeEvidence(
              authorization.value.decision_evidence,
              scripted.outcome.evidence,
            ),
            scripted.outcome.warnings,
            scripted.outcome.usage,
            completedAt,
          ),
        );
      }
    }
    if (containsForbiddenVerdictField(scripted.outcome.value)) {
      return this.#retain(
        key,
        request.idempotency.request_digest,
        this.#failed(
          request,
          failure(
            "provider_failure",
            "adapter",
            "Adapter observations contain a forbidden verdict or campaign field.",
          ),
          startedAt,
          authorization.value.decision_evidence,
          [],
          {},
          completedAt,
        ),
      );
    }
    if (
      request.operation === "descriptor" &&
      !sameStringSet(
        (scripted.outcome.value as EvaluationAdapterOperationMap["descriptor"]["value"])
          .supported_operations,
        [...this.#supportedOperations],
      )
    ) {
      return this.#retain(
        key,
        request.idempotency.request_digest,
        this.#failed(
          request,
          failure(
            "provider_failure",
            "adapter",
            "Descriptor capabilities do not match the configured Adapter capabilities.",
          ),
          startedAt,
          authorization.value.decision_evidence,
          [],
          {},
          completedAt,
        ),
      );
    }

    const result = immutableCopy({
      ...this.#envelope(
        request,
        startedAt,
        mergeEvidence(
          authorization.value.decision_evidence,
          scripted.outcome.evidence,
        ),
        scripted.outcome.warnings,
        scripted.outcome.usage,
        completedAt,
      ),
      ok: true as const,
      value: scripted.outcome.value,
    }) as EvaluationAdapterResult<Operation>;
    return this.#retain(key, request.idempotency.request_digest, result);
  }

  #failed<Operation extends EvaluationAdapterOperation>(
    request: EvaluationAdapterRequest<Operation>,
    failureValue: EvaluationAdapterFailure,
    startedAt: Date,
    evidence: readonly string[] = failureValue.diagnostic_evidence_refs,
    warnings: readonly string[] = [],
    usage: EvaluationAdapterUsage = {},
    completedAt?: Date,
  ): EvaluationAdapterResult<Operation> {
    return immutableCopy({
      ...this.#envelope(request, startedAt, evidence, warnings, usage, completedAt),
      ok: false as const,
      failure: failureValue,
    }) as EvaluationAdapterResult<Operation>;
  }

  #envelope<Operation extends EvaluationAdapterOperation>(
    request: EvaluationAdapterRequest<Operation>,
    startedAt: Date,
    evidence: readonly string[] = [],
    warnings: readonly string[] = [],
    usage: EvaluationAdapterUsage = {},
    completion?: Date,
  ): Omit<EvaluationAdapterResult<Operation>, "ok" | "value" | "failure"> {
    const completedAt = completion ?? this.#clock.now();
    return {
      operation: request.operation,
      operationId: request.operationId,
      trial: request.trial,
      workspace: request.workspace,
      idempotency: request.idempotency,
      deadline: request.deadline,
      version: request.version,
      provider: this.#provider,
      timing: {
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
        duration_ms: Math.max(0, completedAt.valueOf() - startedAt.valueOf()),
      },
      usage,
      warnings,
      evidence,
    };
  }

  #retain<Operation extends EvaluationAdapterOperation>(
    key: string,
    digest: string,
    result: EvaluationAdapterResult<Operation>,
  ): EvaluationAdapterResult<Operation> {
    this.#retained.set(key, { digest, result: result as RetainedResult });
    return result;
  }
}

function validateRequest<Operation extends EvaluationAdapterOperation>(
  request: EvaluationAdapterRequest<Operation>,
): EvaluationAdapterFailure | undefined {
  if (
    request.version.contract !== "1.0.0" ||
    request.version.operation_schema !== "1.0.0"
  ) {
    return failure(
      "unsupported_version",
      "caller",
      "Unsupported Evaluation Adapter contract or operation schema version.",
    );
  }
  const required = [
    request.operationId,
    request.trial.campaign_id,
    request.trial.case_id,
    request.trial.trial_id,
    request.trial.attempt_id,
    request.workspace.workspace_id,
    request.workspace.actor_id,
    request.workspace.policy_version,
    request.idempotency.key,
    request.idempotency.scope,
    request.idempotency.request_digest,
  ];
  if (required.some((value) => value.trim().length === 0)) {
    return failure(
      "invalid_request",
      "caller",
      "Evaluation Adapter identifiers and authority bindings must be non-empty.",
    );
  }
  if (request.workspace.schema_version !== "1.0.0") {
    return failure(
      "workspace_denied",
      "workspace",
      "Unsupported or untrusted Workspace context.",
    );
  }
  if (
    request.idempotency.request_digest !== evaluationRequestDigest(request)
  ) {
    return failure(
      "invalid_request",
      "caller",
      "The canonical request digest does not match the request envelope.",
    );
  }
  if (!isStrictUtcInstant(request.deadline.at)) {
    return failure(
      "invalid_request",
      "caller",
      "The deadline must be an RFC 3339 UTC instant ending in Z.",
    );
  }
  const deadline = new Date(request.deadline.at);
  if (
    request.deadline.time_standard !== "UTC" ||
    Number.isNaN(deadline.valueOf())
  ) {
    return failure(
      "invalid_request",
      "caller",
      "The deadline must be a valid UTC instant.",
    );
  }
  return undefined;
}

function deadlineElapsed<Operation extends EvaluationAdapterOperation>(
  request: EvaluationAdapterRequest<Operation>,
  at: Date,
): boolean {
  return new Date(request.deadline.at).valueOf() <= at.valueOf();
}

function isStrictUtcInstant(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value);
}

function authorizationFor<Operation extends EvaluationAdapterOperation>(
  request: EvaluationAdapterRequest<Operation>,
): WorkspaceAuthorizationRequest {
  return {
    operation_id: request.operationId,
    context: request.workspace,
    purpose: `${request.operation} evaluation trial`,
    consequence_class: consequenceFor(request.operation),
    required_permissions: [PERMISSION_BY_OPERATION[request.operation]],
    resource_refs: [
      `workspace:${request.workspace.workspace_id}`,
      `evaluation-campaign:${request.trial.campaign_id}`,
      `evaluation-case:${request.trial.case_id}`,
      `evaluation-trial:${request.trial.trial_id}`,
      `evaluation-attempt:${request.trial.attempt_id}`,
      ...operationResourceRefs(request),
    ],
  };
}

function consequenceFor(operation: EvaluationAdapterOperation): ConsequenceClass {
  switch (operation) {
    case "descriptor":
    case "evaluateRubric":
    case "collectEvidence":
      return "advisory";
    case "prepareEnvironment":
    case "executeTrial":
    case "cleanup":
    case "replay":
      return "controlled_side_effect";
  }
}

function operationResourceRefs<Operation extends EvaluationAdapterOperation>(
  request: EvaluationAdapterRequest<Operation>,
): string[] {
  switch (request.operation) {
    case "descriptor": {
      const payload = request.payload as EvaluationAdapterOperationMap["descriptor"]["request"];
      return payload.required_capabilities.map(
        (capability) => `evaluation-capability:${capability}`,
      );
    }
    case "prepareEnvironment": {
      const payload = request
        .payload as EvaluationAdapterOperationMap["prepareEnvironment"]["request"];
      return [
        `subject:${payload.subject_ref}`,
        ...payload.fixture_refs.map((reference) => `fixture:${reference}`),
        `dataset:${payload.dataset_ref}`,
        `policy:${payload.policy_ref}`,
        `network-policy:${payload.network_policy_ref}`,
        `tool-policy:${payload.tool_policy_ref}`,
        ...payload.credential_refs.map((reference) => `credential:${reference}`),
        ...payload.evidence_requirements.map(
          (requirement) => `evidence-requirement:${requirement}`,
        ),
      ];
    }
    case "executeTrial": {
      const payload = request.payload as EvaluationAdapterOperationMap["executeTrial"]["request"];
      return [
        `environment-lease:${payload.environment_lease}`,
        `execution-plan:${payload.execution_plan_ref}`,
        ...payload.authorized_input_refs.map((reference) => `input:${reference}`),
      ];
    }
    case "evaluateRubric": {
      const payload = request.payload as EvaluationAdapterOperationMap["evaluateRubric"]["request"];
      return [
        `rubric:${payload.rubric_ref}`,
        ...payload.eligible_evidence_refs.map((reference) => `evidence:${reference}`),
        `calibration:${payload.calibration_ref}`,
        `independence-policy:${payload.independence_policy_ref}`,
        `candidate-output:${payload.candidate_output_ref}`,
      ];
    }
    case "collectEvidence": {
      const payload = request.payload as EvaluationAdapterOperationMap["collectEvidence"]["request"];
      return [
        `evidence-manifest:${payload.required_manifest_ref}`,
        ...payload.eligible_operation_ids.map((operationId) => `evaluation-operation:${operationId}`),
      ];
    }
    case "cleanup": {
      const payload = request.payload as EvaluationAdapterOperationMap["cleanup"]["request"];
      return [
        `environment-lease:${payload.environment_lease}`,
        ...payload.resource_refs.map((reference) => `cleanup-resource:${reference}`),
        `cleanup-policy:${payload.cleanup_policy_ref}`,
        ...(payload.compensation_authorization_ref === undefined
          ? []
          : [`compensation-authorization:${payload.compensation_authorization_ref}`]),
      ];
    }
    case "replay": {
      const payload = request.payload as EvaluationAdapterOperationMap["replay"]["request"];
      return [
        ...payload.source_operation_ids.map((operationId) => `evaluation-operation:${operationId}`),
        ...payload.evidence_refs.map((reference) => `evidence:${reference}`),
        ...payload.exact_input_refs.map((reference) => `input:${reference}`),
        ...payload.allowed_substitutions.map((substitution) => `replay-substitution:${substitution}`),
      ];
    }
  }
}

function authorizationCovers(
  authorization: WorkspaceAuthorization,
  request: WorkspaceAuthorizationRequest,
): boolean {
  const permissions = new Set(authorization.effective_permissions);
  const resources = new Set(authorization.authorized_resource_refs);
  return (
    authorization.policy_version === request.context.policy_version &&
    request.required_permissions.every((permission) => permissions.has(permission)) &&
    request.resource_refs.every((resource) => resources.has(resource))
  );
}

function authorizationFailure(code: string): EvaluationAdapterFailure {
  return code === "insufficient_permission" || code === "stale_policy"
    ? failure("policy_denied", "policy", "Evaluation operation is denied by policy.")
    : failure("workspace_denied", "workspace", "Workspace context is denied.");
}

function failure(
  code: EvaluationAdapterFailure["code"],
  responsibleDomain: EvaluationAdapterFailure["responsible_domain"],
  message: string,
  retryable = false,
  details: JsonObject = {},
): EvaluationAdapterFailure {
  return {
    code,
    retryable,
    responsible_domain: responsibleDomain,
    message,
    details,
    diagnostic_evidence_refs: [],
    provider_details: {},
  };
}

function retainedKey<Operation extends EvaluationAdapterOperation>(
  request: EvaluationAdapterRequest<Operation>,
): string {
  return [
    request.workspace.workspace_id,
    request.idempotency.scope,
    request.idempotency.key,
  ].join("\u0000");
}

function sameRequest(
  expected: EvaluationAdapterRequest<EvaluationAdapterOperation>,
  actual: EvaluationAdapterRequest<EvaluationAdapterOperation>,
): boolean {
  return stableStringify(expected) === stableStringify(actual);
}

function containsForbiddenVerdictField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenVerdictField);
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([key, entry]) =>
        FORBIDDEN_VERDICT_FIELDS.has(key) || containsForbiddenVerdictField(entry),
    );
  }
  return false;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

function mergeEvidence(
  authorizationEvidence: readonly string[],
  operationEvidence: readonly string[] | undefined,
): string[] {
  return [...new Set([...authorizationEvidence, ...(operationEvidence ?? [])])];
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

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as object)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function immutableCopy<Value>(value: Value): Value {
  return deepFreeze(structuredClone(value));
}
