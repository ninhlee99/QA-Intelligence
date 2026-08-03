import type {
  EvaluationCampaignRequest,
  EvaluationCampaignRunResult,
  EvaluationTrialPlan,
} from "./evaluation-campaign-runner.js";
import {
  EvaluationManager,
  type EvaluationInput,
  type EvaluationResult,
} from "./evaluation-manager.js";
import type { EvaluationCampaignState } from "./campaign-lifecycle.js";

export type MultiTrialEvaluationCampaignRequest = Omit<
  EvaluationCampaignRequest,
  "trial"
> & Readonly<{
  trials: readonly EvaluationTrialPlan[];
  max_parallel_trials: number;
}>;

export interface EvaluationTrialRunner {
  run(input: EvaluationCampaignRequest): Promise<EvaluationCampaignRunResult>;
}

export type MultiTrialEvaluationCampaignResult = Readonly<{
  evaluation: EvaluationResult;
  trial_runs: readonly EvaluationCampaignRunResult[];
  state: EvaluationCampaignState;
  state_history: readonly EvaluationCampaignState[];
  configuration_failures: readonly string[];
  analysis_failures: readonly string[];
}>;

export type EvaluationCampaignCoordinatorDependencies = Readonly<{
  trial_runner: EvaluationTrialRunner;
  manager: EvaluationManager;
}>;

/** Coordinates a declared trial matrix; it never approves evaluation or release. */
export class EvaluationCampaignCoordinator {
  readonly #trialRunner: EvaluationTrialRunner;
  readonly #manager: EvaluationManager;

  constructor(dependencies: EvaluationCampaignCoordinatorDependencies) {
    this.#trialRunner = dependencies.trial_runner;
    this.#manager = dependencies.manager;
  }

  async run(
    request: MultiTrialEvaluationCampaignRequest,
  ): Promise<MultiTrialEvaluationCampaignResult> {
    const retained = immutableCopy(request);
    const configurationFailures = validateCampaign(retained);
    if (configurationFailures.length > 0) {
      const evaluation = immutableCopy(this.#manager.evaluate({
        run_id: retained.run_id,
        workspace_id: retained.workspace.workspace_id,
        subject: retained.subject,
        suite: retained.suite,
        resolved_versions: retained.resolved_versions,
        trial_results: [],
        critical_invariants: [],
        campaign_state: "completed",
      }));
      return immutableCopy({
        evaluation,
        trial_runs: [],
        state: "failed" as const,
        state_history: ["draft", "validating", "failed"] as const,
        configuration_failures: configurationFailures,
        analysis_failures: [],
      });
    }
    const trialRuns = await runBounded(
      retained.trials,
      retained.max_parallel_trials,
      (trial) => this.#trialRunner.run(singleTrialRequest(retained, trial)),
      isCancelledTrialRun,
    );
    const campaignState = adapterCampaignState(trialRuns);
    const versionResolution = resolveCampaignVersions(retained, trialRuns);
    const trialRunFailures = validateTrialRuns(retained, trialRuns, campaignState);
    const resolvedVersions = trialRunFailures.length === 0
      ? versionResolution.versions
      : { ...versionResolution.versions, trial_run_integrity: "unresolved" };
    const evaluation = immutableCopy(this.#manager.evaluate({
      run_id: retained.run_id,
      workspace_id: retained.workspace.workspace_id,
      subject: retained.subject,
      suite: retained.suite,
      resolved_versions: resolvedVersions,
      trial_results: trialRuns.flatMap((run) => run.evaluation.trial_results),
      critical_invariants: commonCriticalInvariants(trialRuns),
      campaign_state: campaignState,
    }));
    const finalState: EvaluationCampaignState = campaignState === "cancelled"
      ? "cancelled"
      : campaignState === "blocked"
        ? "blocked"
        : "awaiting_review";
    const stateHistory: readonly EvaluationCampaignState[] = finalState === "cancelled"
      ? ["draft", "validating", "ready", "running", "cancelled"]
      : [
          "draft",
          "validating",
          "ready",
          "running",
          "analyzing",
          finalState,
        ];
    return immutableCopy({
      evaluation,
      trial_runs: trialRuns,
      state: finalState,
      state_history: stateHistory,
      configuration_failures: [],
      analysis_failures: [...versionResolution.failures, ...trialRunFailures],
    });
  }
}

function validateTrialRuns(
  request: MultiTrialEvaluationCampaignRequest,
  runs: readonly EvaluationCampaignRunResult[],
  campaignState: NonNullable<EvaluationInput["campaign_state"]>,
): string[] {
  const failures: string[] = [];
  if (campaignState !== "cancelled" && runs.length !== request.trials.length) {
    failures.push("trial-run-count-mismatch");
  }
  runs.forEach((run, index) => {
    const expected = request.trials[index];
    const facts = run.evaluation.trial_results;
    const fact = facts?.[0];
    if (
      expected === undefined ||
      run.evaluation.run_id !== request.run_id ||
      run.evaluation.workspace_id !== request.workspace.workspace_id ||
      run.evaluation.subject.type !== request.subject.type ||
      run.evaluation.subject.id !== request.subject.id ||
      run.evaluation.subject.version !== request.subject.version ||
      run.evaluation.suite.id !== request.suite.id ||
      run.evaluation.suite.version !== request.suite.version ||
      facts?.length !== 1 ||
      fact?.case_id !== expected.identity.case_id ||
      fact.trial_id !== expected.identity.trial_id
    ) {
      failures.push(
        `trial-run-identity-mismatch:${expected?.identity.trial_id ?? `index-${index}`}`,
      );
    }
    if (!run.cleanup_completed && fact?.outcome === "passed") {
      failures.push(
        `trial-run-cleanup-inconsistent:${expected?.identity.trial_id ?? `index-${index}`}`,
      );
    }
  });
  return failures;
}

function validateCampaign(request: MultiTrialEvaluationCampaignRequest): string[] {
  const failures: string[] = [];
  if (request.trials.length === 0) failures.push("empty-trial-matrix");
  if (!Number.isInteger(request.max_parallel_trials) || request.max_parallel_trials < 1) {
    failures.push("invalid-max-parallel-trials");
  }
  if (request.trials.some((trial) => trial.identity.campaign_id !== request.run_id)) {
    failures.push("campaign-identity-mismatch");
  }
  const trialIds = request.trials.map((trial) => trial.identity.trial_id);
  if (new Set(trialIds).size !== trialIds.length) failures.push("duplicate-trial-id");
  const attemptIds = request.trials.map((trial) => trial.identity.attempt_id);
  if (new Set(attemptIds).size !== attemptIds.length) failures.push("duplicate-attempt-id");
  return failures;
}

function singleTrialRequest(
  request: MultiTrialEvaluationCampaignRequest,
  trial: EvaluationTrialPlan,
): EvaluationCampaignRequest {
  return {
    run_id: request.run_id,
    workspace: request.workspace,
    subject: request.subject,
    suite: request.suite,
    resolved_versions: request.resolved_versions,
    deadline: request.deadline,
    trial,
  };
}

async function runBounded<Input, Output>(
  inputs: readonly Input[],
  maximumParallel: number,
  run: (input: Input) => Promise<Output>,
  stop: (output: Output) => boolean,
): Promise<readonly Output[]> {
  const results: Array<Output | undefined> = new Array(inputs.length);
  let nextIndex = 0;
  let stopped = false;
  async function worker(): Promise<void> {
    while (!stopped && nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const input = inputs[index];
      if (input !== undefined) {
        const output = await run(input);
        results[index] = output;
        if (stop(output)) stopped = true;
      }
    }
  }
  const workerCount = Math.min(maximumParallel, inputs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results.filter((output): output is Output => output !== undefined);
}

function commonCriticalInvariants(
  runs: readonly EvaluationCampaignRunResult[],
): EvaluationInput["critical_invariants"] {
  const first = runs[0]?.evaluation.critical_invariants ?? [];
  return first
    .filter((invariant) => runs.every((run) =>
      run.evaluation.critical_invariants.some((candidate) => candidate.id === invariant.id)
    ))
    .map((invariant) => ({
      id: invariant.id,
      passed: runs.every((run) =>
        run.evaluation.critical_invariants.some(
          (candidate) => candidate.id === invariant.id && candidate.passed,
        )
      ),
    }));
}

function resolveCampaignVersions(
  request: MultiTrialEvaluationCampaignRequest,
  runs: readonly EvaluationCampaignRunResult[],
): Readonly<{
  versions: Readonly<Record<string, string>>;
  failures: readonly string[];
}> {
  const versions: Record<string, string> = { ...request.resolved_versions };
  const failures: string[] = [];
  const keys = new Set([
    ...Object.keys(request.resolved_versions),
    ...runs.flatMap((run) => Object.keys(run.evaluation.resolved_versions)),
  ]);
  for (const key of keys) {
    const values = runs.map((run) => run.evaluation.resolved_versions[key]);
    if (values.some((version) => version === undefined)) {
      versions[key] = "unresolved";
      failures.push(`resolved-version-missing:${key}`);
      continue;
    }
    const exactValues = values.filter((version): version is string => version !== undefined);
    const distinct = new Set(exactValues);
    const configured = request.resolved_versions[key];
    if (
      distinct.size !== 1 ||
      (configured !== undefined && exactValues.some((version) => version !== configured))
    ) {
      versions[key] = "unresolved";
      failures.push(`resolved-version-conflict:${key}`);
    } else if (exactValues[0] !== undefined) {
      versions[key] = exactValues[0];
    }
  }
  return { versions, failures };
}

function adapterCampaignState(
  runs: readonly EvaluationCampaignRunResult[],
): NonNullable<EvaluationInput["campaign_state"]> {
  if (runs.some((run) => run.operations.some(
    (operation) => !operation.ok && operation.failure.code === "cancelled",
  ))) return "cancelled";
  if (runs.some((run) => run.evaluation.trial_results.some(
    (trial) => trial.outcome === "blocked",
  ))) return "blocked";
  return "completed";
}

function isCancelledTrialRun(run: EvaluationCampaignRunResult): boolean {
  return run.operations.some(
    (operation) => !operation.ok && operation.failure.code === "cancelled",
  );
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
