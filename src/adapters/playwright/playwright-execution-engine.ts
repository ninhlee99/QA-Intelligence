import { chromium, type Browser } from "playwright";

import {
  executionRequestDigest,
  type CancelRequest,
  type DescriptorRequest,
  type ExecutionAttemptIdentity,
  type ExecutionEngine,
  type ExecutionEngineEvent,
  type ExecutionEngineEventSink,
  type ExecutionEngineEventType,
  type ExecutionEngineFailure,
  type ExecutionEngineOperation,
  type ExecutionEngineOperationMap,
  type ExecutionEngineProvider,
  type ExecutionEngineRequest,
  type ExecutionEngineResult,
  type FinalizeRequest,
  type PrepareRequest,
  type StartRequest,
  type ValidateRequest,
} from "../../execution-engine/public.js";
import type {
  JsonObject,
  WorkspaceAuthorizationFailure,
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../requirement-review/public.js";
import { DeterministicDomCleaner } from "../dom-cleaner/deterministic-dom-cleaner.js";
import { extractRawDom } from "./extract-raw-dom.js";

export interface Clock {
  now(): Date;
}

/**
 * A real Playwright run needs a real browser-observable assertion, not a
 * scripted outcome literal (that is `DeterministicExecutionEngine`'s job,
 * SPEC-504 §7). `assert` runs after `DomCleaner` (SPEC-302) has already
 * turned the live capture into a `CleanedDomNode` tree — per ADR-022 §4 and
 * ADR-003, this adapter SHALL NOT let a plan author reach past that stage
 * into raw selectors; a plan can only look at accessible role/name/text the
 * Semantic UI pipeline already resolved.
 */
export type PlaywrightExecutionPlan = Readonly<{
  url: string;
  assert(cleaned: import("../../dom-cleaner/public.js").CleanedDomNode): boolean;
}>;

type Dependencies = Readonly<{
  clock: Clock;
  authorizer: WorkspaceAuthorizer;
  provider: ExecutionEngineProvider;
  plans: ReadonlyMap<string, PlaywrightExecutionPlan>;
  launchBrowser?: () => Promise<Browser>;
}>;

type AttemptRecord = Readonly<{
  digest: string;
  events: readonly ExecutionEngineEvent[];
  result: ExecutionEngineResult<"start">;
}>;

const PERMISSION_BY_OPERATION: Readonly<Record<string, string>> = Object.freeze({
  descriptor: "execution:read",
  validate: "execution:read",
  prepare: "execution:execute",
  start: "execution:execute",
  cancel: "execution:cancel",
  finalize: "execution:cleanup",
});

/**
 * SPEC-407/SPEC-504's real browser-execution adapter (ADR-022). Selector
 * and locate logic goes through the same Semantic UI pipeline
 * (`extractRawDom` -> `DeterministicDomCleaner`) already proven against
 * synthetic fixtures in `tests/dom-cleaner/` — this adapter's own job is
 * only driving a real Chromium page and mapping its lifecycle onto the
 * SPEC-504 event stream and outcome vocabulary, not reimplementing DOM
 * cleaning or introducing a second raw-selector code path (ADR-003, ADR-022
 * §4). It SHALL pass the identical `runExecutionEngineContract` suite
 * `DeterministicExecutionEngine` already passes (ADR-022 §4, SPEC-504 §6).
 * A browser that fails to launch fails closed with `infrastructure_failure`
 * — never a silent hang (ADR-022 §4).
 */
export class PlaywrightExecutionEngine implements ExecutionEngine {
  readonly #clock: Clock;
  readonly #authorizer: WorkspaceAuthorizer;
  readonly #provider: ExecutionEngineProvider;
  readonly #plans: ReadonlyMap<string, PlaywrightExecutionPlan>;
  readonly #launchBrowser: () => Promise<Browser>;
  readonly #cleaner = new DeterministicDomCleaner();
  readonly #attempts = new Map<string, AttemptRecord>();
  readonly #cancelled = new Set<string>();

  constructor(dependencies: Dependencies) {
    this.#clock = dependencies.clock;
    this.#authorizer = dependencies.authorizer;
    this.#provider = dependencies.provider;
    this.#plans = dependencies.plans;
    this.#launchBrowser = dependencies.launchBrowser ?? (() => chromium.launch());
  }

  async descriptor(request: DescriptorRequest): Promise<ExecutionEngineResult<"descriptor">> {
    const authorized = await this.#authorize(request, "descriptor");
    if (!authorized.ok) return this.#deny(request, "descriptor", authorized.failure);
    return this.#envelope(request, "descriptor", {
      ok: true,
      value: {
        supported_contract_versions: ["1.0.0"],
        supported_operations: ["descriptor", "validate", "prepare", "start", "cancel", "finalize"],
        capabilities: ["real_browser_execution", "semantic_ui_pipeline"],
        deterministic: false,
        evidence_guarantees: ["cleaned_dom_snapshot"],
        cancellation_guarantee: "cooperative_bounded",
        cleanup_guarantee: "best_effort",
        health: "healthy",
        capacity: {},
      },
    });
  }

  async validate(request: ValidateRequest): Promise<ExecutionEngineResult<"validate">> {
    const authorized = await this.#authorize(request, "validate");
    if (!authorized.ok) return this.#deny(request, "validate", authorized.failure);

    const plan = this.#plans.get(request.attempt.attempt_id);
    if (plan === undefined) {
      return this.#envelope(request, "validate", {
        ok: false,
        failure: unscriptedFailure(request.attempt),
      });
    }
    return this.#envelope(request, "validate", {
      ok: true,
      value: {
        compatible: true,
        resolved_versions: { asset: request.payload.test_version.id },
        incompatibility_reasons: [],
      },
    });
  }

  async prepare(request: PrepareRequest): Promise<ExecutionEngineResult<"prepare">> {
    const authorized = await this.#authorize(request, "prepare");
    if (!authorized.ok) return this.#deny(request, "prepare", authorized.failure);

    const plan = this.#plans.get(request.attempt.attempt_id);
    if (plan === undefined) {
      return this.#envelope(request, "prepare", { ok: false, failure: unscriptedFailure(request.attempt) });
    }
    const now = this.#clock.now();
    return this.#envelope(request, "prepare", {
      ok: true,
      value: {
        environment_lease: `lease:${request.attempt.execution_id}:${request.attempt.attempt_id}`,
        resolved_versions: { environment: request.payload.environment_ref },
        expires_at: new Date(now.valueOf() + 60 * 60 * 1000).toISOString(),
        cleanup_required: true,
      },
    });
  }

  async start(
    request: StartRequest,
    onEvent: ExecutionEngineEventSink,
  ): Promise<ExecutionEngineResult<"start">> {
    const authorized = await this.#authorize(request, "start");
    if (!authorized.ok) return this.#deny(request, "start", authorized.failure);

    const attemptKey = attemptStateKey(request.attempt);
    const digest = executionRequestDigest(request);
    const existing = this.#attempts.get(attemptKey);
    if (existing !== undefined) {
      if (existing.digest !== digest) {
        return this.#envelope(request, "start", {
          ok: false,
          failure: {
            code: "idempotency_conflict",
            retryable: false,
            responsible_domain: "caller",
            message: "A different start request was already retained for this attempt.",
            details: {},
            diagnostic_evidence_refs: [],
          },
        });
      }
      // SPEC-504 §7 idempotent start: replay retained events, do not re-run a real browser.
      for (const event of existing.events) onEvent(event);
      return existing.result;
    }

    const plan = this.#plans.get(request.attempt.attempt_id);
    if (plan === undefined) {
      const result = this.#envelope(request, "start", { ok: false, failure: unscriptedFailure(request.attempt) });
      this.#attempts.set(attemptKey, { digest, events: [], result });
      return result;
    }

    const emitted: ExecutionEngineEvent[] = [];
    let sequence = 0;
    const emit = (type: ExecutionEngineEventType, data: JsonObject = {}): void => {
      const event: ExecutionEngineEvent = {
        type,
        attempt: request.attempt,
        sequence: sequence++,
        occurred_at: this.#clock.now().toISOString(),
        data,
      };
      emitted.push(event);
      onEvent(event);
    };

    const startedAt = this.#clock.now();
    emit("accepted");

    let browser: Browser;
    try {
      browser = await this.#launchBrowser();
    } catch (error) {
      emit("failed", { reason: "browser_launch_failed" });
      const result = this.#envelope(request, "start", {
        ok: false,
        failure: {
          code: "infrastructure_failure",
          retryable: true,
          responsible_domain: "infrastructure",
          message: `Playwright browser failed to launch: ${(error as Error).message}`,
          details: {},
          diagnostic_evidence_refs: [],
        },
      });
      this.#attempts.set(attemptKey, { digest, events: emitted, result });
      return result;
    }

    let result: ExecutionEngineResult<"start">;
    try {
      emit("preparing");
      if (this.#cancelled.has(attemptKey)) {
        emit("cancelled");
        result = this.#cancelledResult(request, startedAt);
      } else {
        const page = await browser.newPage();
        await page.goto(plan.url);
        emit("started");

        if (this.#cancelled.has(attemptKey)) {
          emit("cancelled");
          result = this.#cancelledResult(request, startedAt);
        } else {
          const raw = await extractRawDom(page);
          emit("progress", { stage: "dom_captured" });

          const cleaned = await this.#cleaner.clean({
            capture_id: `capture:${request.attempt.execution_id}:${request.attempt.attempt_id}`,
            url_classification: "internal",
            context: request.workspace,
            actor_role: "execution-engine",
            environment: request.payload.environment_lease,
            captured_at: this.#clock.now().toISOString(),
            raw_content_ref: plan.url,
            raw,
            redaction_policy: { rules: [], redact_text_matching: [] },
            limits: { max_bytes: 5_000_000, max_depth: 64, max_nodes: 20_000, max_attribute_length: 2_000, max_text_length: 5_000 },
            capture_authorized: true,
          });

          if (!cleaned.ok) {
            emit("failed", { reason: "dom_clean_failed", code: cleaned.failure.code });
            result = this.#envelope(request, "start", {
              ok: false,
              failure: {
                code: "plugin_failure",
                retryable: false,
                responsible_domain: "plugin",
                message: cleaned.failure.message,
                details: {},
                diagnostic_evidence_refs: [],
              },
            });
          } else {
            emit("evidence_created", { capture_id: cleaned.value.capture_id });

            if (this.#cancelled.has(attemptKey)) {
              emit("cancelled");
              result = this.#cancelledResult(request, startedAt);
            } else {
              const passed = plan.assert(cleaned.value.sanitized_tree);
              emit("assertion_result", { passed });
              emit("completed");

              const completedAt = this.#clock.now();
              result = this.#envelope(request, "start", {
                ok: true,
                value: {
                  outcome: passed ? "passed" : "failed",
                  evidence: [cleaned.value.capture_id],
                  assertion_results: [{ assertion: "plan.assert", result: passed ? "pass" : "fail" }],
                  resource_usage: {},
                  timing: {
                    started_at: startedAt.toISOString(),
                    completed_at: completedAt.toISOString(),
                    duration_ms: completedAt.valueOf() - startedAt.valueOf(),
                  },
                },
              });
            }
          }
        }
        await page.close();
      }
    } catch (error) {
      emit("failed", { reason: "engine_error" });
      result = this.#envelope(request, "start", {
        ok: false,
        failure: {
          code: "infrastructure_failure",
          retryable: true,
          responsible_domain: "infrastructure",
          message: `Playwright execution failed: ${(error as Error).message}`,
          details: {},
          diagnostic_evidence_refs: [],
        },
      });
    } finally {
      await browser.close();
    }

    this.#attempts.set(attemptKey, { digest, events: emitted, result });
    return result;
  }

  async cancel(request: CancelRequest): Promise<ExecutionEngineResult<"cancel">> {
    const authorized = await this.#authorize(request, "cancel");
    if (!authorized.ok) return this.#deny(request, "cancel", authorized.failure);

    const attemptKey = attemptStateKey(request.attempt);
    const existing = this.#attempts.get(attemptKey);
    // SPEC-602 §5: late provider completion SHALL not replace the terminal
    // platform outcome — an already-terminal attempt is not re-cancelled.
    if (existing !== undefined && existing.result.ok && existing.result.value.outcome !== "cancelled") {
      return this.#envelope(request, "cancel", { ok: true, value: { accepted: false, already_terminal: true } });
    }
    this.#cancelled.add(attemptKey);
    return this.#envelope(request, "cancel", { ok: true, value: { accepted: true, already_terminal: false } });
  }

  async finalize(request: FinalizeRequest): Promise<ExecutionEngineResult<"finalize">> {
    const authorized = await this.#authorize(request, "finalize");
    if (!authorized.ok) return this.#deny(request, "finalize", authorized.failure);

    return this.#envelope(request, "finalize", {
      ok: true,
      value: { cleanup_status: "completed", residual_resources: [] },
    });
  }

  #cancelledResult(request: StartRequest, startedAt: Date): ExecutionEngineResult<"start"> {
    const now = this.#clock.now();
    return this.#envelope(request, "start", {
      ok: true,
      value: {
        outcome: "cancelled",
        evidence: [],
        assertion_results: [],
        resource_usage: {},
        timing: {
          started_at: startedAt.toISOString(),
          completed_at: now.toISOString(),
          duration_ms: now.valueOf() - startedAt.valueOf(),
        },
      },
    });
  }

  async #authorize(
    request: Readonly<{ workspace: WorkspaceContext; operationId: string }>,
    operation: string,
  ): Promise<WorkspaceAuthorizationResult> {
    const authorizationRequest: WorkspaceAuthorizationRequest = {
      operation_id: request.operationId,
      context: request.workspace,
      purpose: `execution-engine:${operation}`,
      consequence_class: "reversible",
      required_permissions: [PERMISSION_BY_OPERATION[operation] ?? "execution:execute"],
      resource_refs: [`workspace:${request.workspace.workspace_id}`],
    };
    return this.#authorizer.authorize(authorizationRequest);
  }

  #envelope<Operation extends ExecutionEngineOperation>(
    request: ExecutionEngineRequest<Operation>,
    operation: Operation,
    outcome:
      | Readonly<{ ok: true; value: ExecutionEngineOperationMap[Operation]["value"] }>
      | Readonly<{ ok: false; failure: ExecutionEngineFailure }>,
  ): ExecutionEngineResult<Operation> {
    const now = this.#clock.now();
    const envelope = {
      operation,
      operationId: request.operationId,
      attempt: request.attempt,
      workspace: request.workspace,
      idempotency: request.idempotency,
      deadline: request.deadline,
      version: request.version,
      provider: this.#provider,
      timing: { started_at: now.toISOString(), completed_at: now.toISOString(), duration_ms: 0 },
      warnings: [],
      evidence: outcome.ok && "evidence" in outcome.value ? (outcome.value as { evidence?: readonly string[] }).evidence ?? [] : [],
    };
    return { ...envelope, ...outcome } as ExecutionEngineResult<Operation>;
  }

  #deny<Operation extends ExecutionEngineOperation>(
    request: ExecutionEngineRequest<Operation>,
    operation: Operation,
    authorizationFailure: WorkspaceAuthorizationFailure,
  ): ExecutionEngineResult<Operation> {
    return this.#envelope(request, operation, {
      ok: false,
      failure: {
        code: "workspace_denied",
        retryable: false,
        responsible_domain: "workspace",
        message: authorizationFailure.message,
        details: {},
        diagnostic_evidence_refs: [],
      },
    });
  }
}

function attemptStateKey(attempt: ExecutionAttemptIdentity): string {
  return `${attempt.execution_id}:${attempt.attempt_id}`;
}

function unscriptedFailure(attempt: ExecutionAttemptIdentity): ExecutionEngineFailure {
  return {
    code: "invalid_request",
    retryable: false,
    responsible_domain: "caller",
    message: `No execution plan registered for attempt ${attempt.attempt_id}.`,
    details: {},
    diagnostic_evidence_refs: [],
  };
}
