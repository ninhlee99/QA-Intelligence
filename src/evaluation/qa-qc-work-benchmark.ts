export type QaQcSupportStatus = "automated" | "assisted" | "human_only";

export type QaQcWorkTask = Readonly<{
  id: string;
  role: "QA" | "QC" | "governance";
  name: string;
  weight: number;
  critical: boolean;
  default_status: QaQcSupportStatus;
  limitation?: string;
}>;

/**
 * Workload weights are a product benchmark, not elapsed-time telemetry.
 * Human accountability remains in the denominator so the score cannot imply
 * that automation replaces release owners or certification engagements.
 */
export const QA_QC_WORK_CATALOG: readonly QaQcWorkTask[] = Object.freeze([
  { id: "qa-requirement-review", role: "QA", name: "Requirement and AC quality review", weight: 6, critical: true, default_status: "automated" },
  { id: "qa-risk-strategy", role: "QA", name: "Risk analysis and test strategy", weight: 6, critical: true, default_status: "assisted", limitation: "Novel product risk needs domain-owner confirmation." },
  { id: "qa-testcase-design", role: "QA", name: "Traceable executable testcase design", weight: 10, critical: true, default_status: "automated" },
  { id: "qa-data-readiness", role: "QA", name: "Test data, seed, cleanup, and oracle readiness", weight: 5, critical: true, default_status: "assisted", limitation: "Business-valid datasets may require a human owner." },
  { id: "qc-browser-execution", role: "QC", name: "Human-like real-browser execution", weight: 12, critical: true, default_status: "automated" },
  { id: "qc-evidence", role: "QC", name: "Screenshot, trace, video, and integrity evidence", weight: 9, critical: true, default_status: "automated" },
  { id: "qc-result-artifacts", role: "QC", name: "Completed testcase JSON/CSV result artifacts", weight: 6, critical: true, default_status: "automated" },
  { id: "qc-defect-triage", role: "QC", name: "Failure classification and defect drafting", weight: 7, critical: true, default_status: "automated" },
  { id: "qc-regression-retest", role: "QC", name: "Targeted regression and retest", weight: 7, critical: true, default_status: "automated" },
  { id: "qc-exploratory", role: "QC", name: "Bounded exploratory testing", weight: 5, critical: false, default_status: "assisted", limitation: "Novel observations and usability judgment need review." },
  { id: "qc-api-authz", role: "QC", name: "API and authorization negative testing", weight: 5, critical: true, default_status: "automated" },
  { id: "qc-nonfunctional-smoke", role: "QC", name: "Accessibility, performance, and security smoke", weight: 4, critical: false, default_status: "automated", limitation: "Smoke coverage is not formal certification." },
  { id: "qc-flake-learning", role: "QC", name: "Flake detection, learning, and recurrence", weight: 4, critical: false, default_status: "automated" },
  { id: "governed-release-advice", role: "governance", name: "Evidence-backed release recommendation", weight: 4, critical: true, default_status: "automated" },
  { id: "human-release-accountability", role: "governance", name: "Release/legal accountability and novel domain truth", weight: 6, critical: false, default_status: "human_only", limitation: "Human-only accountability." },
  { id: "human-certification", role: "governance", name: "Formal pentest, load, and WCAG certification", weight: 4, critical: false, default_status: "human_only", limitation: "Requires qualified external or human-led engagement." },
]);

export type QaQcBenchmarkObservation = Readonly<{
  task_id: string;
  status: QaQcSupportStatus;
  proof_refs: readonly string[];
  verified: boolean;
}>;

export type QaQcBenchmarkReport = Readonly<{
  schema_version: "1.0.0";
  target_percent: 90;
  total_weight: number;
  automated_weight: number;
  assisted_weight: number;
  human_only_weight: number;
  supported_weight: number;
  supported_percent: number;
  target_met: boolean;
  blockers: readonly string[];
  tasks: readonly Readonly<QaQcWorkTask & { observed_status: QaQcSupportStatus | "unverified"; proof_refs: readonly string[] }>[];
}>;

export function assessQaQcWorkBenchmark(input: Readonly<{
  observations: readonly QaQcBenchmarkObservation[];
}>): QaQcBenchmarkReport {
  const blockers: string[] = [];
  const byId = new Map<string, QaQcBenchmarkObservation>();
  const catalog = new Map(QA_QC_WORK_CATALOG.map((task) => [task.id, task]));
  for (const observation of input.observations) {
    if (!catalog.has(observation.task_id)) {
      blockers.push(`unknown benchmark task: ${observation.task_id}`);
      continue;
    }
    if (byId.has(observation.task_id)) {
      blockers.push(`duplicate benchmark observation: ${observation.task_id}`);
      continue;
    }
    byId.set(observation.task_id, observation);
  }

  let automated = 0;
  let assisted = 0;
  let humanOnly = 0;
  const tasks = QA_QC_WORK_CATALOG.map((task) => {
    const observation = byId.get(task.id);
    let observed: QaQcSupportStatus | "unverified" = "unverified";
    let proofRefs: readonly string[] = [];
    if (observation !== undefined) {
      proofRefs = observation.proof_refs;
      if (task.default_status === "human_only" && observation.status !== "human_only") {
        blockers.push(`${task.id} cannot be widened beyond human_only by benchmark input.`);
      } else if (observation.status === "human_only") {
        observed = "human_only";
        humanOnly += task.weight;
      } else if (!observation.verified || observation.proof_refs.length === 0) {
        if (task.critical) blockers.push(`${task.id} is critical but has no verified proof.`);
      } else {
        observed = observation.status;
        if (observation.status === "automated") automated += task.weight;
        else assisted += task.weight;
      }
    } else {
      if (task.default_status === "human_only") {
        observed = "human_only";
        humanOnly += task.weight;
      } else if (task.critical) blockers.push(`${task.id} is critical but was not observed.`);
    }
    return { ...task, observed_status: observed, proof_refs: proofRefs };
  });
  const total = QA_QC_WORK_CATALOG.reduce((sum, task) => sum + task.weight, 0);
  const supported = automated + assisted;
  if (total !== 100) blockers.push(`benchmark catalog weight must equal 100 (got ${total}).`);
  return {
    schema_version: "1.0.0",
    target_percent: 90,
    total_weight: total,
    automated_weight: automated,
    assisted_weight: assisted,
    human_only_weight: humanOnly,
    supported_weight: supported,
    supported_percent: total === 0 ? 0 : Math.round((supported / total) * 10_000) / 100,
    target_met: total === 100 && supported >= 90 && blockers.length === 0,
    blockers,
    tasks,
  };
}
